"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const upload_middleware_1 = require("../../middlewares/upload.middleware");
const agent_trade_controller_1 = require("./agent.trade.controller");
const agent_controller_1 = require("./agent.controller");
const agent_customers_controller_1 = require("./agent.customers.controller");
const agent_documents_controller_1 = require("./agent.documents.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("AGENT"));
// Dashboard
router.get("/dashboard/stats", agent_controller_1.getDashboardStats);
// Profile
const agent_profile_controller_1 = require("./agent.profile.controller");
router.get("/profile", agent_profile_controller_1.getAgentProfile);
router.put("/profile", agent_profile_controller_1.updateAgentProfile);
router.put("/profile/password", agent_profile_controller_1.updateAgentPassword);
router.post("/profile/avatar", upload_middleware_1.upload.single("avatar"), agent_profile_controller_1.uploadProfileAvatar);
// Customers
router.get("/customers", agent_customers_controller_1.getAgentCustomers);
router.get("/customers/stats", agent_customers_controller_1.getAgentCustomerStats);
router.get("/customers/:id", agent_customers_controller_1.getAgentCustomer);
// Documents
router.get("/documents", agent_documents_controller_1.getAgentDocuments);
router.get("/documents/:id", agent_documents_controller_1.getAgentDocument);
router.post("/documents", agent_documents_controller_1.uploadAgentDocument);
router.patch("/documents/:id", agent_documents_controller_1.updateDocumentStatus);
router.delete("/documents/:id", agent_documents_controller_1.deleteDocument);
// Trades
router.get("/trades", agent_controller_1.getAgentTrades);
router.get("/trades/:id", agent_controller_1.getAgentTrade);
router.post("/trades", upload_middleware_1.upload.single("paymentProof"), agent_trade_controller_1.createTrade);
router.post("/trades/:id/verify-customer", agent_trade_controller_1.verifyCustomer);
router.post("/trades/:id/quote", agent_trade_controller_1.quoteTrade);
router.post("/trades/:id/send", agent_trade_controller_1.sendToCustomer);
router.post("/trades/:id/confirm-payout", agent_trade_controller_1.confirmPayout);
exports.default = router;
