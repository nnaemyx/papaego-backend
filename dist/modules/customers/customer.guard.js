"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCustomerTradeAccess = assertCustomerTradeAccess;
const db_1 = __importDefault(require("../../config/db"));
async function assertCustomerTradeAccess(customerId, tradeId) {
    const trade = await db_1.default.trade.findUnique({ where: { id: tradeId } });
    if (!trade || trade.customerId !== customerId) {
        throw new Error("Forbidden");
    }
    return trade;
}
