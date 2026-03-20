import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Freeze commission for a trade (Admin Hold)
 * PATCH /api/admin/trades/:id/freeze
 */
export async function freezeCommission(req: Request, res: Response) {
    try {
        const { id } = req.params;

        await (prisma.trade as any).update({
            where: { id },
            data: { isCommissionFrozen: true }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "COMMISSION_FROZEN",
                entity: "Trade",
                entityId: id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, isCommissionFrozen: true });
    } catch (error) {
        console.error("Error freezing commission:", error);
        res.status(500).json({ error: "Failed to freeze commission" });
    }
}

/**
 * Unfreeze commission for a trade
 * PATCH /api/admin/trades/:id/unfreeze
 */
export async function unfreezeCommission(req: Request, res: Response) {
    try {
        const { id } = req.params;

        await (prisma.trade as any).update({
            where: { id },
            data: { isCommissionFrozen: false }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "COMMISSION_UNFROZEN",
                entity: "Trade",
                entityId: id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, isCommissionFrozen: false });
    } catch (error) {
        console.error("Error unfreezing commission:", error);
        res.status(500).json({ error: "Failed to unfreeze commission" });
    }
}
