"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const customer_controller_1 = require("./customer.controller");
const customer_trade_controller_1 = require("./customer.trade.controller");
const router = (0, express_1.Router)();
// Middleware
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("CUSTOMER"));
// KYC
router.post("/kyc/start", customer_controller_1.startKyc);
router.post("/kyc/confirm", customer_controller_1.confirmKyc);
// Trades
router.get("/trades/:id", customer_trade_controller_1.getCustomerTrade);
router.get("/trades/:id/summary", customer_trade_controller_1.getTradeSummary);
router.post("/trades/:id/confirm-supplier", customer_trade_controller_1.confirmSupplier);
router.post("/trades/:id/confirm-payment", customer_trade_controller_1.confirmPayment);
exports.default = router;
