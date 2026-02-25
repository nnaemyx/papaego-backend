import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getAuditLogs,
    getAuditLogStats,
    exportAuditLogs
} from "./audit.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// Audit log routes
router.get("/", getAuditLogs);
router.get("/stats", getAuditLogStats);
router.get("/export", exportAuditLogs);

export default router;
