import { Request, Response } from "express";
import prisma from "../../config/db";
import { Decimal } from "@prisma/client/runtime/library";
import { checkAndRefreshTradeExpiry, checkAndRefreshTradeRequestExpiry } from "../customer/customer.portal.routes";

/** Default negotiation config keys stored in SystemConfig */
const CONFIG_KEY = "negotiation_config";

async function getNegotiationConfig() {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const defaults = {
        turnoverThreshold: 10_000, // Default to $10,000 USD
        maxDiscountPct: 0.05,       // 5%
        enabled: true,
    };
    if (!row || typeof row.value !== "object" || Array.isArray(row.value)) return defaults;
    const val = row.value as any;
    
    // Backwards compatibility for DB keys (threshold and discountBps vs turnoverThreshold and maxDiscountPct)
    const turnoverThreshold = val.turnoverThreshold !== undefined 
        ? val.turnoverThreshold 
        : (val.threshold !== undefined ? val.threshold : defaults.turnoverThreshold);
        
    const maxDiscountPct = val.maxDiscountPct !== undefined 
        ? val.maxDiscountPct 
        : (val.discountBps !== undefined ? val.discountBps / 100 : defaults.maxDiscountPct);
        
    const enabled = val.enabled !== undefined ? Boolean(val.enabled) : defaults.enabled;

    return {
        turnoverThreshold: Number(turnoverThreshold),
        maxDiscountPct: Number(maxDiscountPct),
        enabled
    };
}

async function getUsdToNgnRate(): Promise<number> {
    try {
        // Primary: read the latest ingested OneLiquidity rate from the exchange-rate module
        const { getProviderRate } = require("../exchange-rate/exchange-rate.service");
        const rateRecord = await getProviderRate("NGN", "USD");
        if (rateRecord && rateRecord.providerRate > 0) {
            return rateRecord.providerRate;
        }
    } catch (primaryErr: any) {
        console.warn("[Negotiation] exchange-rate module unavailable:", primaryErr.message);
    }

    // Secondary: try SystemConfig fx_rates (admin-configured values)
    try {
        const row = await prisma.systemConfig.findUnique({ where: { key: "fx_rates" } });
        if (row && Array.isArray(row.value)) {
            const usdNgnPair = (row.value as any[]).find(r => r.pair === "USD/NGN" || r.pair === "USD_NGN");
            if (usdNgnPair) {
                const configRate = Number(usdNgnPair.sell || usdNgnPair.buy);
                if (configRate > 0) return configRate;
            }
        }
    } catch (configErr: any) {
        console.warn("[Negotiation] SystemConfig fx_rates unavailable:", configErr.message);
    }

    // If we reach here, we have no rate at all — throw rather than use a silent wrong value
    throw new Error(
        "USD/NGN rate unavailable for turnover calculation. " +
        "Ensure OneLiquidity rates are being ingested and ONELIQUIDITY_API_KEY is set."
    );
}

function getTradeUsdAmount(trade: { amount: any, sendCurrency: string, receiveCurrency: string, fxRate: any }, usdToNgnRate: number): number {
    const amount = Number(trade.amount);
    const fxRate = Number(trade.fxRate || 1);
    const sendUpper = trade.sendCurrency.toUpperCase();
    const receiveUpper = trade.receiveCurrency.toUpperCase();

    if (sendUpper === "USD") {
        return amount;
    }
    if (receiveUpper === "USD") {
        return fxRate > 0 ? amount / fxRate : amount;
    }
    if (sendUpper === "NGN") {
        if (usdToNgnRate <= 0) throw new Error("Invalid USD/NGN rate for turnover calculation");
        return amount / usdToNgnRate;
    }
    if (receiveUpper === "NGN") {
        const amountInNgn = amount * fxRate;
        if (usdToNgnRate <= 0) throw new Error("Invalid USD/NGN rate for turnover calculation");
        return amountInNgn / usdToNgnRate;
    }
    return amount;
}


/**
 * GET /customer/portal/trades/:id/negotiate/eligibility
 * Returns whether the customer is eligible to negotiate on this trade.
 */
export async function checkNegotiationEligibility(req: Request, res: Response) {
    try {
        const customer = (req as any).user.customer;
        const { id: tradeId } = req.params;

        let trade = await prisma.trade.findFirst({
            where: { id: tradeId, customerId: customer.id },
        });
        if (!trade) {
            trade = await prisma.trade.findFirst({
                where: { tradeRequestId: tradeId, customerId: customer.id },
            });
        }

        let tradeRequest = null;
        if (!trade) {
            tradeRequest = await prisma.tradeRequest.findFirst({
                where: { id: tradeId, customerId: customer.id },
            });
        }

        if (!trade && !tradeRequest) return res.status(404).json({ error: "Trade not found" });

        const isTradeRequest = !trade;
        const activeItem = isTradeRequest 
            ? await checkAndRefreshTradeRequestExpiry(tradeRequest)
            : await checkAndRefreshTradeExpiry(trade);

        if (!activeItem) {
            return res.status(404).json({ error: isTradeRequest ? "TradeRequest not found" : "Trade not found" });
        }

        if (!["QUOTED", "SENT_TO_CUSTOMER"].includes(activeItem.status)) {
            return res.json({ eligible: false, reason: "Trade is not in a negotiable state" });
        }

        if (activeItem.negotiationUsed) {
            return res.json({ eligible: false, reason: "Negotiation already used for this trade" });
        }

        const config = await getNegotiationConfig();

        if (!config.enabled) {
            return res.json({ eligible: false, reason: "Rate negotiation is currently disabled" });
        }

        // Sum last 30 days of completed trades for this customer
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentTrades = await prisma.trade.findMany({
            where: {
                customerId: customer.id,
                status: "COMPLETED",
                createdAt: { gte: thirtyDaysAgo },
            },
            select: {
                amount: true,
                sendCurrency: true,
                receiveCurrency: true,
                fxRate: true,
            }
        });

        const usdToNgnRate = await getUsdToNgnRate();
        let turnover = 0;
        for (const t of recentTrades) {
            turnover += getTradeUsdAmount(t, usdToNgnRate);
        }

        const eligible = turnover >= config.turnoverThreshold;

        return res.json({
            eligible,
            turnover,
            turnoverThreshold: config.turnoverThreshold,
            maxDiscountPct: config.maxDiscountPct,
            reason: eligible
                ? undefined
                : `Minimum 30-day turnover of $${config.turnoverThreshold.toLocaleString()} required (current: $${turnover.toLocaleString(undefined, { maximumFractionDigits: 2 })})`,
        });
    } catch (err) {
        console.error("[Negotiation] eligibility error:", err);
        res.status(500).json({ error: "Failed to check eligibility" });
    }
}

/**
 * POST /customer/portal/trades/:id/negotiate
 * Customer submits a counter-rate request.
 * Body: { requestedRate: number }
 */
export async function requestNegotiation(req: Request, res: Response) {
    try {
        const customer = (req as any).user.customer;
        const { id: tradeId } = req.params;
        const { requestedRate } = req.body;

        if (!requestedRate || isNaN(Number(requestedRate))) {
            return res.status(400).json({ error: "requestedRate is required and must be a number" });
        }

        let trade = await prisma.trade.findFirst({
            where: { id: tradeId, customerId: customer.id },
        });
        if (!trade) {
            trade = await prisma.trade.findFirst({
                where: { tradeRequestId: tradeId, customerId: customer.id },
            });
        }

        let tradeRequest = null;
        if (!trade) {
            tradeRequest = await prisma.tradeRequest.findFirst({
                where: { id: tradeId, customerId: customer.id },
            });
        }

        if (!trade && !tradeRequest) return res.status(404).json({ error: "Trade not found" });

        const isTradeRequest = !trade;
        const activeItem = isTradeRequest 
            ? await checkAndRefreshTradeRequestExpiry(tradeRequest)
            : await checkAndRefreshTradeExpiry(trade);

        if (!activeItem) {
            return res.status(404).json({ error: isTradeRequest ? "TradeRequest not found" : "Trade not found" });
        }

        if (!["QUOTED", "SENT_TO_CUSTOMER"].includes(activeItem.status)) {
            return res.status(409).json({ error: isTradeRequest ? "TradeRequest is not in a negotiable state" : "Trade is not in a negotiable state" });
        }
        if (activeItem.negotiationUsed) {
            return res.status(409).json({ error: "Negotiation already used for this trade" });
        }
        if (!activeItem.fxRate) {
            return res.status(409).json({ error: "Trade has no rate to negotiate against" });
        }

        const config = await getNegotiationConfig();
        if (!config.enabled) {
            return res.status(403).json({ error: "Rate negotiation is currently disabled" });
        }

        const originalRate = Number(activeItem.fxRate);
        const requested = Number(requestedRate);
        const minAllowed = originalRate * (1 - config.maxDiscountPct);

        if (requested < minAllowed) {
            return res.status(400).json({
                error: `Requested rate is below the maximum allowed discount. Minimum allowable rate: ${minAllowed.toFixed(4)}`,
            });
        }

        // Verify turnover
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentTrades = await prisma.trade.findMany({
            where: {
                customerId: customer.id,
                status: "COMPLETED",
                createdAt: { gte: thirtyDaysAgo },
            },
            select: {
                amount: true,
                sendCurrency: true,
                receiveCurrency: true,
                fxRate: true,
            }
        });
        const usdToNgnRate = await getUsdToNgnRate();
        let turnover = 0;
        for (const t of recentTrades) {
            turnover += getTradeUsdAmount(t, usdToNgnRate);
        }
        if (turnover < config.turnoverThreshold) {
            return res.status(403).json({ error: `Turnover threshold not met for negotiation. Required: $${config.turnoverThreshold.toLocaleString()}, Current: $${turnover.toLocaleString(undefined, { maximumFractionDigits: 2 })}` });
        }

        const discount = ((originalRate - requested) / originalRate) * 100;

        await prisma.negotiationLog.create({
            data: {
                tradeId: activeItem.id,
                userId: (req as any).user.id,
                originalRate: new Decimal(originalRate),
                newRate: new Decimal(requested),
                discount: new Decimal(discount),
            },
        });

        if (isTradeRequest) {
            await prisma.tradeRequest.update({
                where: { id: activeItem.id },
                data: {
                    originalFxRate: new Decimal(originalRate),
                    negotiatedRate: new Decimal(requested),
                },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "CUSTOMER",
                    action: "NEGOTIATION_REQUESTED",
                    entity: "TradeRequest",
                    entityId: activeItem.id,
                    ip: req.ip || "127.0.0.1",
                    metadata: {
                        originalRate,
                        requestedRate: requested,
                        discountPct: discount.toFixed(2),
                    },
                },
            });
        } else {
            await prisma.trade.update({
                where: { id: activeItem.id },
                data: {
                    originalFxRate: new Decimal(originalRate),
                    negotiatedRate: new Decimal(requested),
                },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "CUSTOMER",
                    action: "NEGOTIATION_REQUESTED",
                    entity: "Trade",
                    entityId: activeItem.id,
                    ip: req.ip || "127.0.0.1",
                    metadata: {
                        originalRate,
                        requestedRate: requested,
                        discountPct: discount.toFixed(2),
                    },
                },
            });
        }

        res.json({
            success: true,
            message: "Negotiation request submitted. Awaiting admin review.",
            originalRate,
            requestedRate: requested,
            discountPct: discount.toFixed(2),
        });
    } catch (err) {
        console.error("[Negotiation] request error:", err);
        res.status(500).json({ error: "Failed to submit negotiation request" });
    }
}

/**
 * POST /admin/transactions/:id/negotiate/approve
 * Admin approves the negotiated rate.
 */
export async function adminApproveNegotiation(req: Request, res: Response) {
    try {
        const { id: tradeId } = req.params;

        const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
        const tradeRequest = trade ? null : await prisma.tradeRequest.findUnique({ where: { id: tradeId } });
        const activeItem = trade || tradeRequest;

        if (!activeItem) return res.status(404).json({ error: "Trade not found" });

        const isTradeRequest = !trade;

        if (!activeItem.negotiatedRate || !activeItem.originalFxRate) {
            return res.status(409).json({ error: "No pending negotiation on this trade" });
        }
        if (activeItem.negotiationUsed) {
            return res.status(409).json({ error: "Negotiation already settled" });
        }

        if (isTradeRequest) {
            const amount = Number(activeItem.amount);
            const negotiatedRateVal = Number(activeItem.negotiatedRate);
            const payoutAmountVal = activeItem.sendCurrency === 'NGN' 
                ? (amount / negotiatedRateVal) 
                : (amount * negotiatedRateVal);

            await prisma.tradeRequest.update({
                where: { id: tradeId },
                data: {
                    fxRate: activeItem.negotiatedRate,
                    payoutAmount: new Decimal(payoutAmountVal),
                    negotiationUsed: true,
                },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "ADMIN",
                    action: "NEGOTIATION_APPROVED",
                    entity: "TradeRequest",
                    entityId: tradeId,
                    ip: req.ip || "127.0.0.1",
                    metadata: {
                        originalRate: activeItem.originalFxRate?.toString(),
                        approvedRate: activeItem.negotiatedRate?.toString(),
                    },
                },
            });
        } else {
            const amount = Number(activeItem.amount);
            const negotiatedRateVal = Number(activeItem.negotiatedRate);
            const payoutAmountVal = activeItem.sendCurrency === 'NGN' 
                ? (amount / negotiatedRateVal) 
                : (amount * negotiatedRateVal);

            await prisma.trade.update({
                where: { id: tradeId },
                data: {
                    fxRate: activeItem.negotiatedRate,
                    payoutAmount: payoutAmountVal.toFixed(2),
                    negotiationUsed: true,
                },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "ADMIN",
                    action: "NEGOTIATION_APPROVED",
                    entity: "Trade",
                    entityId: tradeId,
                    ip: req.ip || "127.0.0.1",
                    metadata: {
                        originalRate: activeItem.originalFxRate?.toString(),
                        approvedRate: activeItem.negotiatedRate?.toString(),
                    },
                },
            });
        }

        res.json({ success: true, newFxRate: activeItem.negotiatedRate?.toString() });
    } catch (err) {
        console.error("[Negotiation] admin approve error:", err);
        res.status(500).json({ error: "Failed to approve negotiation" });
    }
}

/**
 * POST /admin/transactions/:id/negotiate/reject
 * Admin rejects the negotiation request (rate stays unchanged).
 */
export async function adminRejectNegotiation(req: Request, res: Response) {
    try {
        const { id: tradeId } = req.params;

        const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
        const tradeRequest = trade ? null : await prisma.tradeRequest.findUnique({ where: { id: tradeId } });
        const activeItem = trade || tradeRequest;

        if (!activeItem) return res.status(404).json({ error: "Trade not found" });

        const isTradeRequest = !trade;

        if (!activeItem.negotiatedRate) {
            return res.status(409).json({ error: "No pending negotiation on this trade" });
        }

        // Clear pending negotiation fields but keep original rate untouched
        if (isTradeRequest) {
            await prisma.tradeRequest.update({
                where: { id: tradeId },
                data: {
                    negotiatedRate: null,
                    negotiationUsed: true, // Consumed — customer cannot re-negotiate
                },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "ADMIN",
                    action: "NEGOTIATION_REJECTED",
                    entity: "TradeRequest",
                    entityId: tradeId,
                    ip: req.ip || "127.0.0.1",
                    metadata: { requestedRate: activeItem.negotiatedRate?.toString() },
                },
            });
        } else {
            await prisma.trade.update({
                where: { id: tradeId },
                data: {
                    negotiatedRate: null,
                    negotiationUsed: true, // Consumed — customer cannot re-negotiate
                },
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "ADMIN",
                    action: "NEGOTIATION_REJECTED",
                    entity: "Trade",
                    entityId: tradeId,
                    ip: req.ip || "127.0.0.1",
                    metadata: { requestedRate: activeItem.negotiatedRate?.toString() },
                },
            });
        }

        res.json({ success: true, message: "Negotiation rejected. Original rate retained." });
    } catch (err) {
        console.error("[Negotiation] admin reject error:", err);
        res.status(500).json({ error: "Failed to reject negotiation" });
    }
}

/**
 * GET /admin/negotiation/config
 * Returns current negotiation configuration.
 */
export async function getNegotiationSettings(req: Request, res: Response) {
    try {
        const config = await getNegotiationConfig();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch negotiation config" });
    }
}

/**
 * PATCH /admin/negotiation/config
 * Admin updates negotiation config.
 * Body: { turnoverThreshold?, maxDiscountPct?, enabled? }
 */
export async function updateNegotiationSettings(req: Request, res: Response) {
    try {
        const { turnoverThreshold, maxDiscountPct, enabled } = req.body;

        const existing = await getNegotiationConfig();
        const updated = {
            ...existing,
            ...(turnoverThreshold !== undefined && { turnoverThreshold: Number(turnoverThreshold) }),
            ...(maxDiscountPct !== undefined && { maxDiscountPct: Number(maxDiscountPct) }),
            ...(enabled !== undefined && { enabled: Boolean(enabled) }),
        };

        await prisma.systemConfig.upsert({
            where: { key: CONFIG_KEY },
            update: { value: updated },
            create: { key: CONFIG_KEY, value: updated },
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "NEGOTIATION_CONFIG_UPDATED",
                entity: "SystemConfig",
                entityId: CONFIG_KEY,
                ip: req.ip || "127.0.0.1",
                metadata: updated,
            },
        });

        res.json({ success: true, config: updated });
    } catch (err) {
        console.error("[Negotiation] config update error:", err);
        res.status(500).json({ error: "Failed to update negotiation config" });
    }
}

/**
 * GET /admin/turnover/today
 * Returns current day's turnover statistics compared to target.
 */
export async function getTurnoverStats(req: Request, res: Response) {
    try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const todayTrades = await prisma.trade.findMany({
            where: {
                status: "COMPLETED",
                createdAt: { gte: startOfToday },
            },
            select: {
                amount: true,
                sendCurrency: true,
                receiveCurrency: true,
                fxRate: true,
            }
        });

        const usdToNgnRate = await getUsdToNgnRate();
        let currentTurnover = 0;
        for (const t of todayTrades) {
            currentTurnover += getTradeUsdAmount(t, usdToNgnRate);
        }

        // Fetch turnover config
        const targetRow = await prisma.systemConfig.findUnique({
            where: { key: "daily_turnover_target" }
        });
        
        let targetTurnover = 3_000_000; // Default target: $3M
        let enabled = true;

        if (targetRow && typeof targetRow.value === "object" && !Array.isArray(targetRow.value)) {
            const val = targetRow.value as any;
            targetTurnover = val.target !== undefined ? Number(val.target) : 3_000_000;
            enabled = val.enabled !== undefined ? Boolean(val.enabled) : true;
        }

        const turnoverProgress = targetTurnover > 0 
            ? Math.min(100, Math.round((currentTurnover / targetTurnover) * 100))
            : 100;
        
        const turnoverMet = currentTurnover >= targetTurnover;

        res.json({
            currentTurnover,
            targetTurnover,
            turnoverMet,
            featureEnabled: enabled,
            turnoverProgress
        });
    } catch (err) {
        console.error("[Negotiation] error getting turnover stats:", err);
        res.status(500).json({ error: "Failed to fetch turnover stats" });
    }
}

/**
 * POST /admin/turnover/config
 * Admin updates daily turnover config.
 * Body: { target?, enabled? }
 */
export async function updateTurnoverConfig(req: Request, res: Response) {
    try {
        const { target, enabled } = req.body;

        // Fetch existing target config
        const targetRow = await prisma.systemConfig.findUnique({
            where: { key: "daily_turnover_target" }
        });
        
        let existing = { target: 3_000_000, enabled: true };
        if (targetRow && typeof targetRow.value === "object" && !Array.isArray(targetRow.value)) {
            existing = { ...existing, ...(targetRow.value as object) };
        }

        const updated = {
            target: target !== undefined ? Number(target) : existing.target,
            enabled: enabled !== undefined ? Boolean(enabled) : existing.enabled
        };

        await prisma.systemConfig.upsert({
            where: { key: "daily_turnover_target" },
            update: { value: updated },
            create: { key: "daily_turnover_target", value: updated },
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "TURNOVER_CONFIG_UPDATED",
                entity: "SystemConfig",
                entityId: "daily_turnover_target",
                ip: req.ip || "127.0.0.1",
                metadata: updated,
            },
        });

        res.json({ success: true, target: updated.target, enabled: updated.enabled });
    } catch (err) {
        console.error("[Negotiation] error updating turnover config:", err);
        res.status(500).json({ error: "Failed to update turnover target" });
    }
}
