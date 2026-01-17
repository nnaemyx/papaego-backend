"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLockedRate = getLockedRate;
const fx_provider_1 = require("./fx.provider");
const db_1 = __importDefault(require("../../config/db"));
const fx = new fx_provider_1.MockFxProvider();
async function getLockedRate(base, quote, country) {
    const rawRate = await fx.getRate(base, quote, country);
    // Fetch margin configuration
    const marginConfig = await db_1.default.fxMargin.findUnique({
        where: { countryId: country }
    });
    const margin = marginConfig ? Number(marginConfig.margin) : 0;
    // Apply margin (e.g., add margin to rate)
    return rawRate + margin;
}
