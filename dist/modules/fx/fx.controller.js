"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRate = getRate;
const fx_service_1 = require("./fx.service");
async function getRate(req, res) {
    try {
        const { base, quote, countryId } = req.query;
        if (!base || !quote || !countryId) {
            return res.status(400).json({ error: "base, quote, and countryId are required" });
        }
        const rate = await (0, fx_service_1.getLockedRate)(base, quote, countryId);
        res.json({ rate });
    }
    catch (error) {
        console.error("Error fetching FX rate:", error);
        res.status(500).json({ error: "Failed to fetch exchange rate" });
    }
}
