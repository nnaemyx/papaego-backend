import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getCommissions,
    getCommission,
    getCommissionStats,
    updateCommissionStatus,
    addCommissionNote,
    exportCommissions
} from "./commission.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// Commission routes
router.get("/", getCommissions);
router.get("/stats", getCommissionStats);
router.get("/export", exportCommissions);
router.get("/:id", getCommission);
router.patch("/:id/status", updateCommissionStatus);
router.post("/:id/notes", addCommissionNote);

export default router;
