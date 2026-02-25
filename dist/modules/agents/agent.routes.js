"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const agent_trade_controller_1 = require("./agent.trade.controller");
const agent_controller_1 = require("./agent.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("AGENT"));
// Dashboard
router.get("/dashboard/stats", agent_controller_1.getDashboardStats);
// Trades
router.get("/trades", agent_controller_1.getAgentTrades);
router.get("/trades/:id", agent_controller_1.getAgentTrade);
router.post("/trades", agent_trade_controller_1.createTrade);
router.post("/trades/:id/verify-customer", agent_trade_controller_1.verifyCustomer);
router.post("/trades/:id/quote", agent_trade_controller_1.quoteTrade);
router.post("/trades/:id/send", agent_trade_controller_1.sendToCustomer);
router.post("/trades/:id/confirm-payout", agent_trade_controller_1.confirmPayout);
exports.default = router;
