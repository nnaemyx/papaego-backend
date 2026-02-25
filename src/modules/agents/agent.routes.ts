import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    createTrade,
    verifyCustomer,
    quoteTrade,
    sendToCustomer,
    confirmPayout
} from "./agent.trade.controller";
import {
    getDashboardStats,
    getAgentTrades,
    getAgentTrade
} from "./agent.controller";

const router = Router();

router.use(auth);
router.use(requireRole("AGENT"));

// Dashboard
router.get("/dashboard/stats", getDashboardStats);

// Trades
router.get("/trades", getAgentTrades);
router.get("/trades/:id", getAgentTrade);
router.post("/trades", createTrade);
router.post("/trades/:id/verify-customer", verifyCustomer);
router.post("/trades/:id/quote", quoteTrade);
router.post("/trades/:id/send", sendToCustomer);
router.post("/trades/:id/confirm-payout", confirmPayout);

export default router;
