import { Request, Response } from "express";
import { getLockedRate, getLockedRateWithExpiry } from "./fx.service";

/**
 * GET /api/fx/rate
 * Returns an FX rate with validity/expiry metadata.
 */
export async function getRate(req: Request, res: Response) {
    try {
        const { base, quote, countryId } = req.query;

        if (!base || !quote || !countryId) {
            return res.status(400).json({ error: "base, quote, and countryId are required" });
        }

        const rateQuote = await getLockedRateWithExpiry(
            base as string,
            quote as string,
            countryId as string
        );

        res.json({
            rate: rateQuote.rate,
            expiresAt: rateQuote.expiresAt.toISOString(),
            expiresInSeconds: rateQuote.expiresInSeconds,
            lockDurationMinutes: rateQuote.lockDurationMinutes,
        });
    } catch (error) {
        console.error("Error fetching FX rate:", error);
        res.status(500).json({ error: "Failed to fetch exchange rate" });
    }
}
