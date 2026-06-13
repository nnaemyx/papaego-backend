import { Request, Response } from "express";
import {
    checkNegotiationEligibility,
    applyNegotiation,
    getDailyTurnoverTotal,
    getTurnoverTarget,
    isTurnoverTargetMet,
    isNegotiationFeatureEnabled,
    setTurnoverTarget,
    setNegotiationEnabled,
} from "./negotiation.service";

// ─── Customer Endpoints ──────────────────────────────────────────────────────

/**
 * GET /api/trades/negotiation-eligibility/:tradeId
 * Check if negotiation is available for a specific trade.
 * Returns eligibility status and reason.
 */
export async function getNegotiationEligibility(req: Request, res: Response) {
    try {
        const { tradeId } = req.params;
        const eligibility = await checkNegotiationEligibility(tradeId);
        res.json(eligibility);
    } catch (error) {
        console.error("Error checking negotiation eligibility:", error);
        res.status(500).json({ error: "Failed to check eligibility" });
    }
}

/**
 * GET /api/trades/negotiation-status
 * Global negotiation status — is negotiation currently available?
 * Used by frontend to show/hide the "Negotiate Rate" button.
 */
export async function getNegotiationStatus(req: Request, res: Response) {
    try {
        const [featureEnabled, turnoverMet, currentTurnover, targetTurnover] =
            await Promise.all([
                isNegotiationFeatureEnabled(),
                isTurnoverTargetMet(),
                getDailyTurnoverTotal(),
                getTurnoverTarget(),
            ]);

        res.json({
            negotiationAvailable: featureEnabled && turnoverMet,
            featureEnabled,
            turnoverMet,
            currentTurnover,
            targetTurnover,
            turnoverProgress: targetTurnover > 0
                ? Math.min(100, Math.round((currentTurnover / targetTurnover) * 100))
                : 0,
        });
    } catch (error) {
        console.error("Error fetching negotiation status:", error);
        res.status(500).json({ error: "Failed to fetch negotiation status" });
    }
}

/**
 * POST /api/trades/:tradeId/negotiate
 * Apply the fixed 0.05% negotiation discount to a trade.
 * One-time per trade. Second attempts are blocked.
 */
export async function negotiateTrade(req: Request, res: Response) {
    try {
        const { tradeId } = req.params;
        const userId = (req as any).user.id;
        const ip = req.ip || "127.0.0.1";

        // First check eligibility
        const eligibility = await checkNegotiationEligibility(tradeId);
        if (!eligibility.eligible) {
            return res.status(403).json({
                error: eligibility.reason,
                eligible: false,
            });
        }

        // Apply negotiation
        const result = await applyNegotiation(tradeId, userId, ip);

        res.json(result);
    } catch (error: any) {
        console.error("Error applying negotiation:", error);

        // Handle specific business logic errors
        if (error.message === "Negotiation has already been used for this trade") {
            return res.status(409).json({ error: error.message });
        }
        if (error.message === "Trade not found") {
            return res.status(404).json({ error: error.message });
        }

        res.status(500).json({ error: "Failed to apply negotiation" });
    }
}

// ─── Admin Endpoints ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/turnover/today
 * Admin view of today's daily turnover and target status.
 */
export async function getAdminTurnoverStats(req: Request, res: Response) {
    try {
        const [currentTurnover, targetTurnover, featureEnabled, turnoverMet] =
            await Promise.all([
                getDailyTurnoverTotal(),
                getTurnoverTarget(),
                isNegotiationFeatureEnabled(),
                isTurnoverTargetMet(),
            ]);

        res.json({
            currentTurnover,
            targetTurnover,
            turnoverMet,
            featureEnabled,
            turnoverProgress: targetTurnover > 0
                ? Math.min(100, Math.round((currentTurnover / targetTurnover) * 100))
                : 0,
        });
    } catch (error) {
        console.error("Error fetching turnover stats:", error);
        res.status(500).json({ error: "Failed to fetch turnover stats" });
    }
}

/**
 * POST /api/admin/turnover/config
 * Set the daily turnover target and/or toggle negotiation feature.
 * Body: { target?: number, enabled?: boolean }
 */
export async function updateTurnoverConfig(req: Request, res: Response) {
    try {
        const { target, enabled } = req.body;
        const adminId = (req as any).user.id;
        const ip = req.ip || "127.0.0.1";

        if (target !== undefined) {
            if (typeof target !== "number" || target <= 0) {
                return res.status(400).json({ error: "Target must be a positive number" });
            }
            await setTurnoverTarget(target, adminId, ip);
        }

        if (enabled !== undefined) {
            if (typeof enabled !== "boolean") {
                return res.status(400).json({ error: "Enabled must be a boolean" });
            }
            await setNegotiationEnabled(enabled, adminId, ip);
        }

        // Return updated state
        const [currentTarget, isEnabled] = await Promise.all([
            getTurnoverTarget(),
            isNegotiationFeatureEnabled(),
        ]);

        res.json({
            success: true,
            target: currentTarget,
            enabled: isEnabled,
        });
    } catch (error) {
        console.error("Error updating turnover config:", error);
        res.status(500).json({ error: "Failed to update turnover config" });
    }
}
