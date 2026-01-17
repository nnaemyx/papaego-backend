"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanTrade = scanTrade;
const db_1 = __importDefault(require("../../config/db"));
const largeAmount_1 = require("./rules/largeAmount");
const rules = [new largeAmount_1.LargeAmountRule()];
async function scanTrade(tradeId) {
    const trade = await db_1.default.trade.findUnique({ where: { id: tradeId } });
    if (!trade)
        return;
    for (const rule of rules) {
        if (rule.evaluate(trade)) {
            await db_1.default.complianceFlag.create({
                data: {
                    tradeId,
                    reason: rule.code,
                    severity: "HIGH"
                }
            });
            await db_1.default.trade.update({
                where: { id: tradeId },
                data: { status: "FLAGGED" }
            });
        }
    }
}
