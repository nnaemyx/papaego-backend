"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../../config/db"));
const webhook_utils_1 = require("./webhook.utils");
const router = (0, express_1.Router)();
router.post("/payment", async (req, res) => {
    const signature = req.headers["x-signature"];
    const rawBody = req.rawBody; // Need to ensure rawBody is available
    if (!(0, webhook_utils_1.verifyWebhook)(rawBody, signature, process.env.PSP_SECRET)) {
        return res.status(401).end();
    }
    const { tradeId } = req.body;
    await db_1.default.trade.update({
        where: { id: tradeId },
        data: { status: "PAYMENT_CONFIRMED" }
    });
    res.sendStatus(200);
});
exports.default = router;
