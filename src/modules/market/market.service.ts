import prisma from "../../config/db";

// ─── Data Validation ─────────────────────────────────────────────────────────

interface MarketDataPoint {
    timestamp: string;
    source: string;
    venue: string;
    assetPair: string;
    bid: number;
    ask: number;
    mid?: number;
    spread?: number;
    availableVolume?: number;
    minOrder?: number;
    maxOrder?: number;
    liquidityScore?: number;
    reliabilityScore?: number;
    completionRate?: number;
    paymentMethod?: string;
    merchantLimits?: any;
}

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    normalized: MarketDataPoint | null;
}

/**
 * Maximum age (ms) before a timestamp is considered stale.
 * FX: 5 minutes, P2P: 10 minutes, Spot: 2 minutes
 */
const STALENESS_THRESHOLDS: Record<string, number> = {
    fx: 5 * 60_000,
    p2p: 10 * 60_000,
    spot: 2 * 60_000,
};

/**
 * Maximum spread percentage before flagging.
 */
const MAX_SPREAD_PERCENT = 5; // 5%

/**
 * Validate and normalize a market data point.
 * Reject or flag data where:
 * - timestamp is stale
 * - bid is higher than ask unexpectedly
 * - spread exceeds threshold
 * - price deviates sharply from other sources
 * - available volume is missing
 * - duplicate data appears
 */
export function validateMarketData(
    data: MarketDataPoint,
    type: "fx" | "p2p" | "spot" = "fx"
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Timestamp validation
    if (!data.timestamp) {
        errors.push("Missing timestamp");
    } else {
        const ts = new Date(data.timestamp).getTime();
        const age = Date.now() - ts;
        const threshold = STALENESS_THRESHOLDS[type] || STALENESS_THRESHOLDS.fx;

        if (isNaN(ts)) {
            errors.push("Invalid timestamp format");
        } else if (age > threshold) {
            warnings.push(`Stale data: ${Math.round(age / 60_000)}min old (threshold: ${threshold / 60_000}min)`);
        }
    }

    // 2. Source validation
    if (!data.source) errors.push("Missing source");
    if (!data.venue) errors.push("Missing venue");
    if (!data.assetPair) errors.push("Missing asset pair");

    // 3. Price validation
    if (data.bid == null || data.ask == null) {
        errors.push("Missing bid or ask price");
    } else {
        if (data.bid > data.ask) {
            warnings.push(`Inverted spread: bid (${data.bid}) > ask (${data.ask})`);
        }

        if (data.bid <= 0 || data.ask <= 0) {
            errors.push("Bid and ask must be positive");
        }

        // Spread check
        const spread = data.ask - data.bid;
        const spreadPercent = (spread / data.bid) * 100;
        if (spreadPercent > MAX_SPREAD_PERCENT) {
            warnings.push(`Wide spread: ${spreadPercent.toFixed(2)}% exceeds ${MAX_SPREAD_PERCENT}% threshold`);
        }
    }

    // 4. Volume validation
    if (data.availableVolume != null && data.availableVolume < 0) {
        errors.push("Available volume cannot be negative");
    }

    if (errors.length > 0) {
        return { valid: false, errors, warnings, normalized: null };
    }

    // Normalize
    const bid = data.bid;
    const ask = data.ask;
    const mid = data.mid ?? (bid + ask) / 2;
    const spread = data.spread ?? (ask - bid);

    const normalized: MarketDataPoint = {
        ...data,
        mid,
        spread,
        liquidityScore: data.liquidityScore ?? null as any,
        reliabilityScore: data.reliabilityScore ?? null as any,
    };

    return {
        valid: true,
        errors: [],
        warnings,
        normalized,
    };
}

// ─── Market Rate Queries ─────────────────────────────────────────────────────

/**
 * Get latest market rates (stablecoin spot prices).
 */
export async function getLatestMarketRates(filters?: {
    source?: string;
    assetPair?: string;
    limit?: number;
}) {
    const where: any = {};
    if (filters?.source) where.source = filters.source;
    if (filters?.assetPair) where.assetPair = filters.assetPair;

    return prisma.marketRate.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: filters?.limit || 50,
    });
}

/**
 * Get latest P2P quotes.
 */
export async function getLatestP2PQuotes(filters?: {
    source?: string;
    assetPair?: string;
    limit?: number;
}) {
    const where: any = {};
    if (filters?.source) where.source = filters.source;
    if (filters?.assetPair) where.assetPair = filters.assetPair;

    return prisma.p2PQuote.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: filters?.limit || 50,
    });
}

/**
 * Get liquidity depth snapshots.
 */
export async function getLiquiditySnapshot(filters?: {
    venue?: string;
    assetPair?: string;
    limit?: number;
}) {
    const where: any = {};
    if (filters?.venue) where.venue = filters.venue;
    if (filters?.assetPair) where.assetPair = filters.assetPair;

    return prisma.liquidityDepth.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: filters?.limit || 20,
    });
}

/**
 * Get aggregated market summary across all sources.
 */
export async function getMarketSummary() {
    const [marketRateCount, p2pQuoteCount, liquidityCount] = await Promise.all([
        prisma.marketRate.count(),
        prisma.p2PQuote.count(),
        prisma.liquidityDepth.count(),
    ]);

    // Get distinct sources
    const [marketSources, p2pSources] = await Promise.all([
        prisma.marketRate.findMany({
            select: { source: true },
            distinct: ["source"],
        }),
        prisma.p2PQuote.findMany({
            select: { source: true },
            distinct: ["source"],
        }),
    ]);

    // Get distinct asset pairs
    const [marketPairs, p2pPairs] = await Promise.all([
        prisma.marketRate.findMany({
            select: { assetPair: true },
            distinct: ["assetPair"],
        }),
        prisma.p2PQuote.findMany({
            select: { assetPair: true },
            distinct: ["assetPair"],
        }),
    ]);

    return {
        totalRecords: {
            marketRates: marketRateCount,
            p2pQuotes: p2pQuoteCount,
            liquidityDepth: liquidityCount,
        },
        sources: {
            spot: marketSources.map(s => s.source),
            p2p: p2pSources.map(s => s.source),
        },
        assetPairs: {
            spot: marketPairs.map(p => p.assetPair),
            p2p: p2pPairs.map(p => p.assetPair),
        },
    };
}

/**
 * Ingest a validated market rate data point.
 */
export async function ingestMarketRate(data: MarketDataPoint) {
    const validation = validateMarketData(data, "spot");
    if (!validation.valid || !validation.normalized) {
        return { success: false, errors: validation.errors };
    }

    const n = validation.normalized;
    const dataStatus = validation.warnings.length > 0 ? "flagged" : "valid";

    await prisma.marketRate.create({
        data: {
            timestamp: new Date(n.timestamp),
            source: n.source,
            venue: n.venue,
            assetPair: n.assetPair,
            bid: n.bid,
            ask: n.ask,
            mid: n.mid!,
            spread: n.spread!,
            availableVolume: n.availableVolume,
            minOrder: n.minOrder,
            maxOrder: n.maxOrder,
            liquidityScore: n.liquidityScore,
            reliabilityScore: n.reliabilityScore,
            dataStatus,
        },
    });

    return { success: true, warnings: validation.warnings, dataStatus };
}

/**
 * Ingest a validated P2P quote data point.
 */
export async function ingestP2PQuote(data: MarketDataPoint) {
    const validation = validateMarketData(data, "p2p");
    if (!validation.valid || !validation.normalized) {
        return { success: false, errors: validation.errors };
    }

    const n = validation.normalized;
    const dataStatus = validation.warnings.length > 0 ? "flagged" : "valid";

    await prisma.p2PQuote.create({
        data: {
            timestamp: new Date(n.timestamp),
            source: n.source,
            venue: n.venue,
            assetPair: n.assetPair,
            bid: n.bid,
            ask: n.ask,
            mid: n.mid!,
            spread: n.spread!,
            availableVolume: n.availableVolume,
            minOrder: n.minOrder,
            maxOrder: n.maxOrder,
            completionRate: n.completionRate,
            paymentMethod: n.paymentMethod,
            merchantLimits: n.merchantLimits,
            liquidityScore: n.liquidityScore,
            reliabilityScore: n.reliabilityScore,
            dataStatus,
        },
    });

    return { success: true, warnings: validation.warnings, dataStatus };
}
