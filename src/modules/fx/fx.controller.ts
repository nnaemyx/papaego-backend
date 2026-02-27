import { Request, Response } from "express";
import { getLockedRate } from "./fx.service";

export async function getRate(req: Request, res: Response) {
    try {
        const { base, quote, countryId } = req.query;

        if (!base || !quote || !countryId) {
            return res.status(400).json({ error: "base, quote, and countryId are required" });
        }

        const rate = await getLockedRate(
            base as string,
            quote as string,
            countryId as string
        );

        res.json({ rate });
    } catch (error) {
        console.error("Error fetching FX rate:", error);
        res.status(500).json({ error: "Failed to fetch exchange rate" });
    }
}
