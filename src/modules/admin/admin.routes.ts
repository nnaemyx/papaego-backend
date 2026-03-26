import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import { uploadToCloudinary } from "../../middlewares/upload.middleware";
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
import {
    getSuppliers,
    getSupplier,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    linkCustomerToSupplier,
    unlinkCustomerFromSupplier,
    getSuppliersByCustomer,
} from "./admin.supplier.controller";
import {
    getAdminTradeRequests,
    getAdminTradeRequest,
    assignAgentToRequest,
    approveTradeRequest,
    rejectTradeRequest,
    processTradeRequest,
    deleteTradeRequest,
} from "./admin.tradeRequest.controller";
import { uploadTradeReceipt } from "./admin.receipt.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// ── Agents ──────────────────────────────────────────────────────────────────
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

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get("/dashboard/stats", getDashboardStats);

// ── Transactions ─────────────────────────────────────────────────────────────
router.get("/transactions", listAllTrades);
router.get("/transactions/:id", getAdminTransaction);
router.delete("/transactions/:id", deleteTransaction);
router.patch("/transactions/:id/freeze", freezeCommission);
router.patch("/transactions/:id/unfreeze", unfreezeCommission);
router.patch("/transactions/:id/receipt", uploadToCloudinary.single("receipt"), uploadTradeReceipt);

// ── Trade Requests (Admin) ───────────────────────────────────────────────────
router.get("/trade-requests", getAdminTradeRequests);
router.get("/trade-requests/:id", getAdminTradeRequest);
router.patch("/trade-requests/:id/assign", assignAgentToRequest);
router.patch("/trade-requests/:id/approve", approveTradeRequest);
router.patch("/trade-requests/:id/reject", rejectTradeRequest);
router.patch("/trade-requests/:id/process", processTradeRequest);
router.delete("/trade-requests/:id", deleteTradeRequest);

// ── Suppliers ────────────────────────────────────────────────────────────────
router.get("/suppliers/by-customer/:customerId", getSuppliersByCustomer);
router.get("/suppliers", getSuppliers);
router.post("/suppliers", createSupplier);
router.get("/suppliers/:id", getSupplier);
router.patch("/suppliers/:id", updateSupplier);
router.delete("/suppliers/:id", deleteSupplier);
router.post("/suppliers/:id/link-customer", linkCustomerToSupplier);
router.delete("/suppliers/:id/link-customer/:customerId", unlinkCustomerFromSupplier);

// ── Other ─────────────────────────────────────────────────────────────────────
router.get("/fx-margins", getFxMargin);
router.post("/fx-margins", setFxMargin);
router.post("/overrides/:id/approve", approveOverride);

export default router;
// this is handled inline - just verify file exists
