"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmSupplier = confirmSupplier;
exports.getTradeSummary = getTradeSummary;
exports.confirmPayment = confirmPayment;
exports.getCustomerTrade = getCustomerTrade;
const db_1 = __importDefault(require("../../config/db"));
const stateMachine_1 = require("../../utils/stateMachine");
const customer_guard_1 = require("./customer.guard");
async function confirmSupplier(req, res) {
    const trade = await (0, customer_guard_1.assertCustomerTradeAccess)(req.user.customerId, req.params.id);
    (0, stateMachine_1.assertTransition)(trade.status, "CUSTOMER_CONFIRMED");
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "CUSTOMER_CONFIRMED" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "CUSTOMER",
            action: "SUPPLIER_CONFIRMED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ confirmed: true });
}
async function getTradeSummary(req, res) {
    const trade = await (0, customer_guard_1.assertCustomerTradeAccess)(req.user.customerId, req.params.id);
    res.json({
        amount: trade.amount,
        fxRate: trade.fxRate,
        total: Number(trade.amount) * Number(trade.fxRate ?? 0),
        expiresAt: trade.lockedUntil,
        supplierAccount: "****1234"
    });
}
async function confirmPayment(req, res) {
    const trade = await (0, customer_guard_1.assertCustomerTradeAccess)(req.user.customerId, req.params.id);
    (0, stateMachine_1.assertTransition)(trade.status, "AWAITING_PAYMENT");
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "AWAITING_PAYMENT" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "CUSTOMER",
            action: "PAYMENT_DECLARED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ awaitingVerification: true });
}
async function getCustomerTrade(req, res) {
    const trade = await (0, customer_guard_1.assertCustomerTradeAccess)(req.user.customerId, req.params.id);
    res.json({
        status: trade.status,
        reference: trade.id,
        receiptAvailable: trade.status === "COMPLETED"
    });
}
