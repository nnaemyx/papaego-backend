import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getCommissions,
    getCommission,
    getCommissionStats,
    updateCommissionStatus,
    addCommissionNote,
    exportCommissions,
    getAgentCommissions
} from "./commission.controller";

const router = Router();

router.use(auth);

// Agent routes
router.get("/my-commissions", requireRole("AGENT"), getAgentCommissions);

// Admin-only routes
router.get("/", requireRole("ADMIN"), getCommissions);
router.get("/stats", requireRole("ADMIN"), getCommissionStats);
router.get("/export", requireRole("ADMIN"), exportCommissions);
router.get("/:id", requireRole("ADMIN"), getCommission);
router.patch("/:id/status", requireRole("ADMIN"), updateCommissionStatus);
router.post("/:id/notes", requireRole("ADMIN"), addCommissionNote);

export default router;
