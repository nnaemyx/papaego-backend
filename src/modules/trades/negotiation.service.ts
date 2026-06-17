import prisma from "../../config/db";

/**
 * Fixed negotiation discount: 0.05% = 0.0005
 * new_rate = base_rate × (1 - 0.0005)
 * Final displayed rate = Math.floor(new_rate) — rounded down to nearest whole number
 */
const NEGOTIATION_DISCOUNT = 0.0005;

/** SystemConfig key for the daily turnover target */
const TURNOVER_TARGET_KEY = "daily_turnover_target";

/** SystemConfig key for negotiation feature toggle */
const NEGOTIATION_ENABLED_KEY = "negotiation_enabled";

// ─── Turnover Tracking ───────────────────────────────────────────────────────

/**
 * Get today's total completed trade volume (in NGN).
 */
export async function getDailyTurnoverTotal(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Check if we have a cached daily turnover record for today
    const cached = await prisma.dailyTurnover.findUnique({
        where: { date: todayStart },
    });

    if (cached) return Number(cached.totalVolume);

    // Compute from scratch: sum all completed trades today
    const result = await prisma.trade.aggregate({
        _sum: { amount: true },
        where: {
            status: "COMPLETED",
            createdAt: { gte: todayStart },
        },
    });

    const volume = Number(result._sum.amount || 0);

    // Cache the result
    await prisma.dailyTurnover.upsert({
        where: { date: todayStart },
        update: { totalVolume: volume },
        create: { date: todayStart, totalVolume: volume },
    });

    return volume;
}

/**
 * Get the admin-configured daily turnover target.
 * Defaults to 50,000,000 NGN if not configured.
 */
export async function getTurnoverTarget(): Promise<number> {
    const config = await prisma.systemConfig.findUnique({
        where: { key: TURNOVER_TARGET_KEY },
    });

    if (!config) return 50_000_000; // Default: ₦50M

    const data = config.value as any;
    return Number(data.target || 50_000_000);
}

/**
 * Check if negotiation feature is enabled globally.
 */
export async function isNegotiationFeatureEnabled(): Promise<boolean> {
    const config = await prisma.systemConfig.findUnique({
        where: { key: NEGOTIATION_ENABLED_KEY },
    });

    if (!config) return true; // Enabled by default
    const data = config.value as any;
    return data.enabled !== false;
}

/**
 * Check if today's turnover target has been met.
 */
export async function isTurnoverTargetMet(): Promise<boolean> {
    const [volume, target] = await Promise.all([
        getDailyTurnoverTotal(),
        getTurnoverTarget(),
    ]);

    return volume >= target;
}

// ─── Negotiation Eligibility ─────────────────────────────────────────────────

export interface NegotiationEligibility {
    eligible: boolean;
    reason: string;
    turnoverMet: boolean;
    featureEnabled: boolean;
    currentTurnover: number;
    targetTurnover: number;
}

/**
 * Check whether a trade/tradeRequest is eligible for negotiation.
 */
export async function checkNegotiationEligibility(
    tradeId: string
): Promise<NegotiationEligibility> {
    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
    const tradeRequest = trade ? null : await prisma.tradeRequest.findUnique({ where: { id: tradeId } });
    const activeItem = trade || tradeRequest;

    if (!activeItem) {
        return {
            eligible: false,
            reason: "Trade not found",
            turnoverMet: false,
            featureEnabled: false,
            currentTurnover: 0,
            targetTurnover: 0,
        };
    }

    const isTradeRequest = !trade;

    const featureEnabled = await isNegotiationFeatureEnabled();
    if (!featureEnabled) {
        return {
            eligible: false,
            reason: "Negotiation feature is currently disabled",
            turnoverMet: false,
            featureEnabled: false,
            currentTurnover: 0,
            targetTurnover: await getTurnoverTarget(),
        };
    }

    if (activeItem.negotiationUsed) {
        return {
            eligible: false,
            reason: "Negotiation has already been used for this trade",
            turnoverMet: true,
            featureEnabled: true,
            currentTurnover: await getDailyTurnoverTotal(),
            targetTurnover: await getTurnoverTarget(),
        };
    }

    if (!activeItem.fxRate) {
        return {
            eligible: false,
            reason: "Trade has no quoted rate yet",
            turnoverMet: false,
            featureEnabled: true,
            currentTurnover: await getDailyTurnoverTotal(),
            targetTurnover: await getTurnoverTarget(),
        };
    }

    const [currentTurnover, targetTurnover] = await Promise.all([
        getDailyTurnoverTotal(),
        getTurnoverTarget(),
    ]);

    const turnoverMet = currentTurnover >= targetTurnover;

    if (!turnoverMet) {
        return {
            eligible: false,
            reason: "Daily turnover target has not been reached yet",
            turnoverMet: false,
            featureEnabled: true,
            currentTurnover,
            targetTurnover,
        };
    }

    return {
        eligible: true,
        reason: "Trade is eligible for negotiation",
        turnoverMet: true,
        featureEnabled: true,
        currentTurnover,
        targetTurnover,
    };
}

// ─── Apply Negotiation ───────────────────────────────────────────────────────

export interface NegotiationResult {
    success: boolean;
    originalRate: number;
    negotiatedRate: number;
    discountApplied: number;
    message: string;
}

/**
 * Apply the fixed 0.05% negotiation discount to a trade / tradeRequest.
 * 
 * Formula: new_rate = base_rate × (1 - 0.0005)
 * Display: Math.floor(new_rate) — rounded down to nearest whole number
 * 
 * This is a one-time operation per trade. Second attempts are blocked.
 */
export async function applyNegotiation(
    tradeId: string,
    userId: string,
    ip: string = "127.0.0.1"
): Promise<NegotiationResult> {
    // Use a transaction to ensure atomicity
    return await prisma.$transaction(async (tx) => {
        // Re-fetch inside transaction with lock semantics
        const trade = await tx.trade.findUnique({ where: { id: tradeId } });
        const tradeRequest = trade ? null : await tx.tradeRequest.findUnique({ where: { id: tradeId } });
        const activeItem = trade || tradeRequest;

        if (!activeItem) {
            throw new Error("Trade not found");
        }

        const isTradeRequest = !trade;

        // Double-check: block second attempts at DB level
        if (activeItem.negotiationUsed) {
            throw new Error("Negotiation has already been used for this trade");
        }

        if (!activeItem.fxRate) {
            throw new Error("Trade has no quoted rate");
        }

        const originalRate = Number(activeItem.fxRate);
        const rawNewRate = originalRate * (1 - NEGOTIATION_DISCOUNT);
        const negotiatedRate = Math.floor(rawNewRate); // Round down to nearest whole number

        if (isTradeRequest) {
            const amount = Number(activeItem.amount);
            const payoutAmountVal = activeItem.sendCurrency === 'NGN' 
                ? (amount / negotiatedRate) 
                : (amount * negotiatedRate);

            // Update tradeRequest with negotiated rate
            await tx.tradeRequest.update({
                where: { id: tradeId },
                data: {
                    originalFxRate: originalRate,
                    negotiatedRate: negotiatedRate,
                    fxRate: negotiatedRate, // Update active rate
                    payoutAmount: payoutAmountVal,
                    negotiationUsed: true,
                },
            });

            // Create immutable negotiation log
            await tx.negotiationLog.create({
                data: {
                    tradeId,
                    userId,
                    originalRate: originalRate,
                    newRate: negotiatedRate,
                    discount: NEGOTIATION_DISCOUNT,
                },
            });

            // Create audit log
            await tx.auditLog.create({
                data: {
                    actorId: userId,
                    role: "CUSTOMER", // Negotiation is customer-initiated
                    action: "NEGOTIATION_APPLIED",
                    entity: "TradeRequest",
                    entityId: tradeId,
                    ip,
                    metadata: {
                        originalRate,
                        negotiatedRate,
                        discount: NEGOTIATION_DISCOUNT,
                        rawCalculation: rawNewRate,
                    },
                },
            });
        } else {
            const amount = Number(activeItem.amount);
            const payoutAmountVal = activeItem.sendCurrency === 'NGN' 
                ? (amount / negotiatedRate) 
                : (amount * negotiatedRate);

            // Update trade with negotiated rate
            await tx.trade.update({
                where: { id: tradeId },
                data: {
                    originalFxRate: originalRate,
                    negotiatedRate: negotiatedRate,
                    fxRate: negotiatedRate, // Update active rate
                    payoutAmount: payoutAmountVal.toFixed(2),
                    negotiationUsed: true,
                },
            });

            // Create immutable negotiation log
            await tx.negotiationLog.create({
                data: {
                    tradeId,
                    userId,
                    originalRate: originalRate,
                    newRate: negotiatedRate,
                    discount: NEGOTIATION_DISCOUNT,
                },
            });

            // Create audit log
            await tx.auditLog.create({
                data: {
                    actorId: userId,
                    role: "CUSTOMER", // Negotiation is customer-initiated
                    action: "NEGOTIATION_APPLIED",
                    entity: "Trade",
                    entityId: tradeId,
                    ip,
                    metadata: {
                        originalRate,
                        negotiatedRate,
                        discount: NEGOTIATION_DISCOUNT,
                        rawCalculation: rawNewRate,
                    },
                },
            });
        }

        return {
            success: true,
            originalRate,
            negotiatedRate,
            discountApplied: NEGOTIATION_DISCOUNT,
            message: `Rate negotiated from ₦${originalRate.toLocaleString()} to ₦${negotiatedRate.toLocaleString()}`,
        };
    });
}

// ─── Daily Turnover Update ───────────────────────────────────────────────────

/**
 * Update daily turnover when a trade is completed.
 * Called from trade.service.ts on COMPLETED status change.
 */
export async function updateDailyTurnover(tradeAmount: number): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const target = await getTurnoverTarget();

    await prisma.dailyTurnover.upsert({
        where: { date: todayStart },
        update: {
            totalVolume: { increment: tradeAmount },
            targetMet: undefined, // Will be set below
        },
        create: {
            date: todayStart,
            totalVolume: tradeAmount,
            targetMet: tradeAmount >= target,
        },
    });

    // Re-check if target is now met
    const updated = await prisma.dailyTurnover.findUnique({
        where: { date: todayStart },
    });

    if (updated && Number(updated.totalVolume) >= target && !updated.targetMet) {
        await prisma.dailyTurnover.update({
            where: { date: todayStart },
            data: { targetMet: true },
        });
    }
}

// ─── Admin Configuration ─────────────────────────────────────────────────────

/**
 * Set the daily turnover target.
 */
export async function setTurnoverTarget(target: number, adminId: string, ip: string): Promise<void> {
    const previousTarget = await getTurnoverTarget();

    await prisma.systemConfig.upsert({
        where: { key: TURNOVER_TARGET_KEY },
        update: { value: { target } as any },
        create: { key: TURNOVER_TARGET_KEY, value: { target } as any },
    });

    await prisma.auditLog.create({
        data: {
            actorId: adminId,
            role: "ADMIN",
            action: "TURNOVER_TARGET_CHANGED",
            entity: "SystemConfig",
            entityId: TURNOVER_TARGET_KEY,
            ip,
            metadata: {
                previousTarget,
                newTarget: target,
            },
        },
    });
}

/**
 * Toggle negotiation feature on/off.
 */
export async function setNegotiationEnabled(enabled: boolean, adminId: string, ip: string): Promise<void> {
    await prisma.systemConfig.upsert({
        where: { key: NEGOTIATION_ENABLED_KEY },
        update: { value: { enabled } as any },
        create: { key: NEGOTIATION_ENABLED_KEY, value: { enabled } as any },
    });

    await prisma.auditLog.create({
        data: {
            actorId: adminId,
            role: "ADMIN",
            action: enabled ? "NEGOTIATION_ENABLED" : "NEGOTIATION_DISABLED",
            entity: "SystemConfig",
            entityId: NEGOTIATION_ENABLED_KEY,
            ip,
        },
    });
}
