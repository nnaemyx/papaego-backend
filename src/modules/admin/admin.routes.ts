import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    createAgent,
    suspendAgent,
    activateAgent,
    setFxMargin,
    listAllTrades,
    approveOverride,
    getAgents,
    getAgent,
    deleteAgent,
    updateAgent,
    updateAgentVerification,
    getAgentActivities,
    getAgentTransactions,
    exportAgents,
    getDashboardStats,
    getAdminTransaction,
    deleteTransaction,
    getFxMargin,
} from "./admin.controller";
import { freezeCommission, unfreezeCommission } from "./admin.trade.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// Agents
router.get("/agents", getAgents);
router.get("/agents/export", exportAgents);
router.post("/agents", createAgent);
router.get("/agents/:id", getAgent);
router.delete("/agents/:id", deleteAgent);
router.patch("/agents/:id", updateAgent);
router.post("/agents/:id/suspend", suspendAgent);
router.post("/agents/:id/activate", activateAgent);
router.post("/agents/:id/verify", updateAgentVerification);
router.get("/agents/:id/activities", getAgentActivities);
router.get("/agents/:id/transactions", getAgentTransactions);

// Dashboard
router.get("/dashboard/stats", getDashboardStats);

// Transactions
router.get("/transactions", listAllTrades);
router.get("/transactions/:id", getAdminTransaction);
router.delete("/transactions/:id", deleteTransaction);
router.patch("/transactions/:id/freeze", freezeCommission);
router.patch("/transactions/:id/unfreeze", unfreezeCommission);

// Other
router.get("/fx-margins", getFxMargin);
router.post("/fx-margins", setFxMargin);
router.post("/overrides/:id/approve", approveOverride);

export default router;
