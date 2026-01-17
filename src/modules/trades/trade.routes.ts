import { Router } from "express";
import { quoteTrade } from "./trade.controller";
import { requireRole } from "../../middlewares/rbac.middleware";
import { auth } from "../../middlewares/auth.middleware";
import { updateTradeStatus } from "./trade.service";
import prisma from "../../config/db";

const router = Router();

router.post(
    "/agent/trades/:id/quote",
    auth,
    requireRole("AGENT"),
    quoteTrade
);
router.post(
    "/customer/trades/:id/confirm",
    auth,
    requireRole("CUSTOMER"),
    async (req, res) => {
        await updateTradeStatus(req.params.id, "CUSTOMER_CONFIRMED", (req as any).user);
        res.json({ success: true });
    }
);
router.post(
    "/compliance/trades/:id/flag",
    auth,
    requireRole("COMPLIANCE"),
    async (req, res) => {
        await updateTradeStatus(req.params.id, "FLAGGED", (req as any).user);
        res.json({ flagged: true });
    }
);
router.post(
    "/admin/agents/:id/suspend",
    auth,
    requireRole("ADMIN"),
    async (req, res) => {
        await prisma.user.update({
            where: { id: req.params.id },
            data: { isActive: false }
        });
        res.json({ suspended: true });
    }
);

export default router;
