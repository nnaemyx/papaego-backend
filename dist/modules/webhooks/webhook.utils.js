"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWebhook = verifyWebhook;
const crypto_1 = __importDefault(require("crypto"));
function verifyWebhook(payload, signature, secret) {
    const hash = crypto_1.default
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
    return hash === signature;
}
