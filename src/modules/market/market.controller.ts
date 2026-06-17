import { Request, Response } from "express";
import {
    getLatestMarketRates,
    getLatestP2PQuotes,
    getLiquiditySnapshot,
    getMarketSummary,
    ingestMarketRate,
    ingestP2PQuote,
} from "./market.service";

/**
 * GET /api/admin/market/summary
 * Overview of all market data — record counts, sources, asset pairs.
 */
export async function getMarketDataSummary(req: Request, res: Response) {
    try {
        const summary = await getMarketSummary();
        res.json(summary);
    } catch (error) {
        console.error("Error fetching market summary:", error);
        res.status(500).json({ error: "Failed to fetch market summary" });
    }
}

/**
 * GET /api/admin/market/rates
 * Latest stablecoin spot prices (USDT/USD, USDC/USD, etc.).
 */
export async function getMarketRates(req: Request, res: Response) {
    try {
        const { source, assetPair, limit } = req.query;
        const rates = await getLatestMarketRates({
            source: source as string,
            assetPair: assetPair as string,
            limit: limit ? parseInt(limit as string, 10) : undefined,
        });

        const formatted = rates.map(r => ({
            id: r.id,
            timestamp: r.timestamp.toISOString(),
            source: r.source,
            venue: r.venue,
            assetPair: r.assetPair,
            bid: Number(r.bid),
            ask: Number(r.ask),
            mid: Number(r.mid),
            spread: Number(r.spread),
            availableVolume: r.availableVolume ? Number(r.availableVolume) : null,
            liquidityScore: r.liquidityScore ? Number(r.liquidityScore) : null,
            reliabilityScore: r.reliabilityScore ? Number(r.reliabilityScore) : null,
            dataStatus: r.dataStatus,
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching market rates:", error);
        res.status(500).json({ error: "Failed to fetch market rates" });
    }
}

/**
 * GET /api/admin/market/p2p
 * Latest P2P quotes (NGN/USDT, GBP/USDT, EUR/USDT).
 */
export async function getP2PQuotes(req: Request, res: Response) {
    try {
        const { source, assetPair, limit } = req.query;
        const quotes = await getLatestP2PQuotes({
            source: source as string,
            assetPair: assetPair as string,
            limit: limit ? parseInt(limit as string, 10) : undefined,
        });

        const formatted = quotes.map(q => ({
            id: q.id,
            timestamp: q.timestamp.toISOString(),
            source: q.source,
            venue: q.venue,
            assetPair: q.assetPair,
            bid: Number(q.bid),
            ask: Number(q.ask),
            mid: Number(q.mid),
            spread: Number(q.spread),
            availableVolume: q.availableVolume ? Number(q.availableVolume) : null,
            completionRate: q.completionRate ? Number(q.completionRate) : null,
            paymentMethod: q.paymentMethod,
            liquidityScore: q.liquidityScore ? Number(q.liquidityScore) : null,
            reliabilityScore: q.reliabilityScore ? Number(q.reliabilityScore) : null,
            dataStatus: q.dataStatus,
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching P2P quotes:", error);
        res.status(500).json({ error: "Failed to fetch P2P quotes" });
    }
}

/**
 * GET /api/admin/market/liquidity
 * Liquidity depth and venue ranking.
 */
export async function getLiquidity(req: Request, res: Response) {
    try {
        const { venue, assetPair, limit } = req.query;
        const depths = await getLiquiditySnapshot({
            venue: venue as string,
            assetPair: assetPair as string,
            limit: limit ? parseInt(limit as string, 10) : undefined,
        });

        const formatted = depths.map(d => ({
            id: d.id,
            timestamp: d.timestamp.toISOString(),
            venue: d.venue,
            assetPair: d.assetPair,
            executableVolume: Number(d.executableVolume),
            bidDepth: d.bidDepth,
            askDepth: d.askDepth,
            venueRanking: d.venueRanking,
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching liquidity:", error);
        res.status(500).json({ error: "Failed to fetch liquidity data" });
    }
}

/**
 * POST /api/admin/market/rates
 * Manually ingest a market rate data point.
 * Used for testing or manual data entry; real collectors will call the service directly.
 */
export async function ingestRate(req: Request, res: Response) {
    try {
        const result = await ingestMarketRate(req.body);
        if (!result.success) {
            return res.status(400).json({ error: "Validation failed", errors: result.errors });
        }
        res.json(result);
    } catch (error) {
        console.error("Error ingesting market rate:", error);
        res.status(500).json({ error: "Failed to ingest rate" });
    }
}

/**
 * POST /api/admin/market/p2p
 * Manually ingest a P2P quote data point.
 */
export async function ingestP2P(req: Request, res: Response) {
    try {
        const result = await ingestP2PQuote(req.body);
        if (!result.success) {
            return res.status(400).json({ error: "Validation failed", errors: result.errors });
        }
        res.json(result);
    } catch (error) {
        console.error("Error ingesting P2P quote:", error);
        res.status(500).json({ error: "Failed to ingest P2P quote" });
    }
}
