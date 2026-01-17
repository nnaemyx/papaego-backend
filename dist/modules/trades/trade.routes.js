"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const trade_controller_1 = require("./trade.controller");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const trade_service_1 = require("./trade.service");
const db_1 = __importDefault(require("../../config/db"));
const router = (0, express_1.Router)();
router.post("/agent/trades/:id/quote", auth_middleware_1.auth, (0, rbac_middleware_1.requireRole)("AGENT"), trade_controller_1.quoteTrade);
router.post("/customer/trades/:id/confirm", auth_middleware_1.auth, (0, rbac_middleware_1.requireRole)("CUSTOMER"), async (req, res) => {
    await (0, trade_service_1.updateTradeStatus)(req.params.id, "CUSTOMER_CONFIRMED", req.user);
    res.json({ success: true });
});
router.post("/compliance/trades/:id/flag", auth_middleware_1.auth, (0, rbac_middleware_1.requireRole)("COMPLIANCE"), async (req, res) => {
    await (0, trade_service_1.updateTradeStatus)(req.params.id, "FLAGGED", req.user);
    res.json({ flagged: true });
});
router.post("/admin/agents/:id/suspend", auth_middleware_1.auth, (0, rbac_middleware_1.requireRole)("ADMIN"), async (req, res) => {
    await db_1.default.user.update({
        where: { id: req.params.id },
        data: { isActive: false }
    });
    res.json({ suspended: true });
});
exports.default = router;
