import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    submitApplication,
    getApplications,
    getApplication,
    updateApplicationStatus,
    getApplicationStats,
} from "./agent-application.controller";

const router = Router();

// ── Public routes (no auth required) ─────────────────────────────────────────
router.post("/", submitApplication);

// ── Admin-only routes ─────────────────────────────────────────────────────────
router.use(auth);
router.use(requireRole("ADMIN"));

router.get("/stats", getApplicationStats);
router.get("/", getApplications);
router.get("/:id", getApplication);
router.patch("/:id/status", updateApplicationStatus);

export default router;
