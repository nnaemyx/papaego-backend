import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getBalances,
    getBalanceForCurrency,
    deposit,
    reserve,
    release,
    settle,
    sync,
    syncLogs,
    getProviders,
    getLedger,
    getAccounts,
    createAccount,
    updateAccount,
} from "./treasury.controller";

const router = Router();

// All treasury routes require authentication + ADMIN role
router.use(auth);
router.use(requireRole("ADMIN"));

// ── Balance Routes ────────────────────────────────────────────────────────────
router.get("/balances", getBalances);
router.get("/balance/:currency", getBalanceForCurrency);

// ── Fund Movement Routes ──────────────────────────────────────────────────────
router.post("/deposit", deposit);
router.post("/reserve", reserve);
router.post("/release", release);
router.post("/settle", settle);

// ── Sync Routes ───────────────────────────────────────────────────────────────
router.post("/sync", sync);
router.get("/sync/logs", syncLogs);
router.get("/providers", getProviders);

// ── Account Management ────────────────────────────────────────────────────────
router.get("/accounts", getAccounts);
router.post("/accounts", createAccount);
router.patch("/accounts/:id", updateAccount);

// ── Ledger alias (also accessible as /ledger/entries via main router) ─────────
router.get("/entries", getLedger);

export default router;
