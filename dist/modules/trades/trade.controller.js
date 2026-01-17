"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteTrade = quoteTrade;
const trade_service_1 = require("./trade.service");
async function quoteTrade(req, res) {
    const { tradeId } = req.params;
    await (0, trade_service_1.updateTradeStatus)(tradeId, "QUOTED", req.user);
    res.json({ success: true });
}
