import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getRate,
    getProviderRates,
    ingestRate,
    getProviderHistory,
    getMarkup,
    setMarkup,
    removeMarkup,
    getRateAuditLogs,
    createTradeQuote,
    getTradeBreakdownInternal,
    getRateHealth,
    triggerManualRateRefresh,
} from "./exchange-rate.controller";

const router = Router();

// All exchange-rate routes require authentication
router.use(auth);

// ── Public (any authenticated user) ──────────────────────────────────────────
// Customer rate — never reveals provider rate
router.get("/", getRate);
// Customer-facing quote generation (only returns customerRate, supplierAmount, expiry)
router.post("/quote", createTradeQuote);

// ── Admin only routes ─────────────────────────────────────────────────────────
router.get("/provider", requireRole("ADMIN"), getProviderRates);
router.get("/provider/history", requireRole("ADMIN"), getProviderHistory);
router.post("/ingest", requireRole("ADMIN"), ingestRate);

router.get("/markup", requireRole("ADMIN"), getMarkup);
router.post("/markup", requireRole("ADMIN"), setMarkup);
router.delete("/markup", requireRole("ADMIN"), removeMarkup);

router.get("/logs", requireRole("ADMIN"), getRateAuditLogs);

// Admin inspection: full internal breakdown with margin & underlying cost
router.post("/breakdown", requireRole("ADMIN"), getTradeBreakdownInternal);
// Admin inspection: health & divergence between OneLiquidity and OKX
router.get("/health", requireRole("ADMIN"), getRateHealth);
// Admin trigger: immediately refresh all live rates
router.post("/refresh", requireRole("ADMIN"), triggerManualRateRefresh);

export default router;
