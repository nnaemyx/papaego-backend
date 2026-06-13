import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getAuditLogs,
    getAuditLogStats,
    exportAuditLogs,
    getNegotiationLogs,
    getRateChangeLogs,
    getPaymentLogs,
    getTradeAuditLogs,
} from "./audit.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// General audit logs
router.get("/", getAuditLogs);
router.get("/stats", getAuditLogStats);
router.get("/export", exportAuditLogs);

// Specialized audit log views
router.get("/negotiations", getNegotiationLogs);
router.get("/rate-changes", getRateChangeLogs);
router.get("/payments", getPaymentLogs);
router.get("/trades", getTradeAuditLogs);

export default router;
