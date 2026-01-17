"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTradeStatus = updateTradeStatus;
exports.quoteTrade = quoteTrade;
const stateMachine_1 = require("../../utils/stateMachine");
const db_1 = __importDefault(require("../../config/db"));
const fx_service_1 = require("../fx/fx.service");
// Kept for backward compatibility if needed, or replace entirely. 
// User snippet replaces it with quoteTrade, but the controller uses updateTradeStatus in some places.
// Actually, the user snippet for trade.service.ts ONLY showed quoteTrade.
// But the controller from Step 155 uses updateTradeStatus for other actions.
// So I should keep updateTradeStatus AND add quoteTrade, or refactor.
// Let's add quoteTrade export.
async function updateTradeStatus(tradeId, newStatus, actor) {
    const trade = await db_1.default.trade.findUnique({ where: { id: tradeId } });
    if (!trade) {
        throw new Error("Trade not found");
    }
    (0, stateMachine_1.assertTransition)(trade.status, newStatus);
    await db_1.default.trade.update({
        where: { id: tradeId },
        data: { status: newStatus }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: actor.id,
            role: actor.role,
            action: `TRADE_${newStatus}`,
            entity: "Trade",
            entityId: tradeId,
            ip: actor.ip || "127.0.0.1"
        }
    });
}
async function quoteTrade(tradeId, actor) {
    const trade = await db_1.default.trade.findUnique({ where: { id: tradeId } });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "QUOTED");
    const fxRate = await (0, fx_service_1.getLockedRate)(trade.sendCurrency, trade.receiveCurrency, trade.countryId);
    await db_1.default.trade.update({
        where: { id: tradeId },
        data: {
            fxRate,
            status: "QUOTED",
            lockedUntil: new Date(Date.now() + 10 * 60 * 1000)
        }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: actor.id,
            role: actor.role,
            action: "TRADE_QUOTED",
            entity: "Trade",
            entityId: tradeId,
            ip: actor.ip || "127.0.0.1"
        }
    });
}
