"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const admin_controller_1 = require("./admin.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("ADMIN"));
// Agents
router.get("/agents", admin_controller_1.getAgents);
router.get("/agents/export", admin_controller_1.exportAgents);
router.post("/agents", admin_controller_1.createAgent);
router.get("/agents/:id", admin_controller_1.getAgent);
router.delete("/agents/:id", admin_controller_1.deleteAgent);
router.patch("/agents/:id", admin_controller_1.updateAgent);
router.post("/agents/:id/suspend", admin_controller_1.suspendAgent);
router.post("/agents/:id/activate", admin_controller_1.activateAgent);
router.post("/agents/:id/verify", admin_controller_1.updateAgentVerification);
router.get("/agents/:id/activities", admin_controller_1.getAgentActivities);
router.get("/agents/:id/transactions", admin_controller_1.getAgentTransactions);
// Dashboard
router.get("/dashboard/stats", admin_controller_1.getDashboardStats);
// Transactions
router.get("/transactions", admin_controller_1.listAllTrades);
router.get("/transactions/:id", admin_controller_1.getAdminTransaction);
// Other
router.post("/fx-margins", admin_controller_1.setFxMargin);
router.post("/overrides/:id/approve", admin_controller_1.approveOverride);
exports.default = router;
