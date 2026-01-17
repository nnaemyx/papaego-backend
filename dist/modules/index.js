"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const trade_routes_1 = __importDefault(require("./trades/trade.routes"));
const webhook_routes_1 = __importDefault(require("./webhooks/webhook.routes"));
const customer_routes_1 = __importDefault(require("./customers/customer.routes"));
const agent_routes_1 = __importDefault(require("./agents/agent.routes"));
const admin_routes_1 = __importDefault(require("./admin/admin.routes"));
const auth_routes_1 = __importDefault(require("./auth/auth.routes"));
const compliance_routes_1 = __importDefault(require("./compliance/compliance.routes"));
const router = (0, express_1.Router)();
router.use("/auth", auth_routes_1.default);
router.use("/trades", trade_routes_1.default); // Keeping original trade routes for now, though logic might be moving to specific role routes
router.use("/webhooks", webhook_routes_1.default);
router.use("/customer", customer_routes_1.default);
router.use("/agent", agent_routes_1.default);
router.use("/admin", admin_routes_1.default);
router.use("/compliance", compliance_routes_1.default);
exports.default = router;
