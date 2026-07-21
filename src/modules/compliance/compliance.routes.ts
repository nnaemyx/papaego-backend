import { Router } from "express";
import { getComplianceFlags, createComplianceReport, getReports } from "./compliance.controller";
import { requireRole } from "../../middlewares/rbac.middleware";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { uploadMiddleware } from "../../middlewares/upload.middleware";

// Sprint 1: KYC / KYB / Compliance
import { submitKyc, getKycStatus } from "./kyc.controller";
import { submitKyb, getKybStatus } from "./kyb.controller";
import { uploadDocument } from "./document.controller";
import { getStatus, getHistory } from "./status.controller";
import { handleFvBankWebhook } from "./webhook.controller";
import { kycSubmitSchema, kybSubmitSchema, documentUploadSchema } from "./compliance.schema";

const router = Router();

// ─────────────────────────────────────────────────────
// PUBLIC: FV Bank webhook (no auth — HMAC verified inside)
// ─────────────────────────────────────────────────────
router.post("/webhook", handleFvBankWebhook);

// ─────────────────────────────────────────────────────
// AUTHENTICATED: KYC routes
// ─────────────────────────────────────────────────────
router.post("/kyc", auth, validate(kycSubmitSchema), submitKyc);
router.get("/kyc/status", auth, getKycStatus);

// ─────────────────────────────────────────────────────
// AUTHENTICATED: KYB routes
// ─────────────────────────────────────────────────────
router.post("/kyb", auth, validate(kybSubmitSchema), submitKyb);
router.get("/kyb/status", auth, getKybStatus);

// ─────────────────────────────────────────────────────
// AUTHENTICATED: Document upload
// ─────────────────────────────────────────────────────
router.post("/documents", auth, uploadMiddleware.single("file"), uploadDocument);

// ─────────────────────────────────────────────────────
// AUTHENTICATED: Status & History
// ─────────────────────────────────────────────────────
router.get("/status", auth, getStatus);
router.get("/history", auth, getHistory);

// ─────────────────────────────────────────────────────
// ADMIN / COMPLIANCE ONLY: Legacy trade-compliance routes
// ─────────────────────────────────────────────────────
router.get("/flags", auth, requireRole("COMPLIANCE", "ADMIN"), getComplianceFlags);
router.get("/reports", auth, requireRole("COMPLIANCE", "ADMIN"), getReports);
router.post("/reports", auth, requireRole("COMPLIANCE", "ADMIN"), createComplianceReport);

export default router;
