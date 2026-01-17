"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgent = createAgent;
exports.suspendAgent = suspendAgent;
exports.setFxMargin = setFxMargin;
exports.listAllTrades = listAllTrades;
exports.approveOverride = approveOverride;
const db_1 = __importDefault(require("../../config/db"));
async function createAgent(req, res) {
    const { email, phone, countryId, licenseId } = req.body;
    const user = await db_1.default.user.create({
        data: {
            email,
            phone,
            role: "AGENT",
            password: "TEMP_PASSWORD" // In real app, this should be hashed
        }
    });
    await db_1.default.agentProfile.create({
        data: {
            userId: user.id,
            countryId,
            licenseId,
            lga: "Default", // Missing in snippet but required by schema
            dailyLimit: 50000,
            monthlyLimit: 500000
        }
    });
    res.json(user);
}
async function suspendAgent(req, res) {
    await db_1.default.user.update({
        where: { id: req.params.id },
        data: { isActive: false }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "ADMIN",
            action: "AGENT_SUSPENDED",
            entity: "User",
            entityId: req.params.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ suspended: true });
}
async function setFxMargin(req, res) {
    const { countryId, margin } = req.body;
    await db_1.default.fxMargin.upsert({
        where: { countryId },
        update: { margin },
        create: { countryId, margin }
    });
    res.json({ updated: true });
}
async function listAllTrades(req, res) {
    const trades = await db_1.default.trade.findMany({
        orderBy: { createdAt: "desc" }
    });
    res.json(trades);
}
async function approveOverride(req, res) {
    const override = await db_1.default.overrideApproval.findUnique({
        where: { id: req.params.id }
    });
    if (!override)
        return res.status(404).json({ error: "Override not found" });
    if (override.requestedBy === req.user.id) {
        return res.status(403).json({ error: "Maker cannot approve" });
    }
    await db_1.default.overrideApproval.update({
        where: { id: override.id },
        data: {
            status: "APPROVED",
            approvedBy: req.user.id
        }
    });
    res.json({ approved: true });
}
