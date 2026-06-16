import cron from "node-cron";
import prisma from "../config/db";

/**
 * Runs every minute. Finds all QUOTED trades whose lockedUntil has passed
 * and automatically sets them to EXPIRED, logging the action.
 */
export function startRateExpiryJob() {
    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();

            const expiredTrades = await prisma.trade.findMany({
                where: {
                    status: "QUOTED",
                    lockedUntil: { lt: now },
                },
                select: { id: true },
            });

            if (expiredTrades.length === 0) return;

            const ids = expiredTrades.map((t) => t.id);

            await prisma.trade.updateMany({
                where: { id: { in: ids } },
                data: { status: "EXPIRED" },
            });

            // Immutable audit log for each expired trade
            await prisma.auditLog.createMany({
                data: ids.map((id) => ({
                    actorId: "SYSTEM",
                    role: "ADMIN" as const,
                    action: "RATE_EXPIRED",
                    entity: "Trade",
                    entityId: id,
                    ip: "127.0.0.1",
                    metadata: { reason: "Rate validity window elapsed" },
                })),
            });

            console.log(`[FX Expiry Job] Expired ${ids.length} trade(s): ${ids.join(", ")}`);
        } catch (err) {
            console.error("[FX Expiry Job] Error:", err);
        }
    });

    console.log("[FX Expiry Job] Rate expiry cron started (every minute).");
}
