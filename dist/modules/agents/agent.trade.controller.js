"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTrade = createTrade;
exports.verifyCustomer = verifyCustomer;
exports.quoteTrade = quoteTrade;
exports.sendToCustomer = sendToCustomer;
exports.confirmPayout = confirmPayout;
const db_1 = __importDefault(require("../../config/db"));
const stateMachine_1 = require("../../utils/stateMachine");
const fx_service_1 = require("../fx/fx.service");
async function createTrade(req, res) {
    const agentId = req.user.id;
    const { customerId, amount, sendCurrency, receiveCurrency, countryId } = req.body;
    const trade = await db_1.default.trade.create({
        data: {
            agentId,
            customerId,
            countryId,
            amount,
            sendCurrency,
            receiveCurrency,
            status: "INITIATED"
        }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: agentId,
            role: "AGENT",
            action: "TRADE_CREATED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json(trade);
}
async function verifyCustomer(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "CUSTOMER_VERIFIED");
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "CUSTOMER_VERIFIED" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "CUSTOMER_VERIFIED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ verified: true });
}
async function quoteTrade(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "QUOTED");
    const fxRate = await (0, fx_service_1.getLockedRate)(trade.sendCurrency, trade.receiveCurrency, trade.countryId);
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: {
            fxRate,
            lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
            status: "QUOTED"
        }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "FX_QUOTED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ fxRate });
}
async function sendToCustomer(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "SENT_TO_CUSTOMER");
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "SENT_TO_CUSTOMER" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "SENT_TO_CUSTOMER",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ sent: true });
}
async function confirmPayout(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    if (trade.status !== "PAYMENT_CONFIRMED") {
        return res.status(403).json({ error: "Payment not verified" });
    }
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "COMPLETED" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "PAYOUT_CONFIRMED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ completed: true });
}
