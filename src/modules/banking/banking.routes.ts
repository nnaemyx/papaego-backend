/**
 * Banking API Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Route declarations for Papa Ego Managed Banking Layer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import {
    getEligibility,
    createAccount,
    getAccount,
    getAccountStatus,
    syncAccount,
    handleBankingWebhook
} from "./banking.controller";

const router = Router();

// Public webhook endpoint from FV Bank
router.post("/webhook", handleBankingWebhook);

// Protected routes (Require Authentication)
router.use(auth);

router.get("/eligibility", getEligibility);
router.post("/account", createAccount);
router.get("/account", getAccount);
router.get("/account/status", getAccountStatus);
router.post("/sync", syncAccount);

export default router;
