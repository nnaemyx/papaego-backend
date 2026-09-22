import prisma from "../../config/db";
import { MarkupType } from "@prisma/client";
import { getOneLiquidityRate, OneLiquidityProviderError } from "./oneliquidity.provider";
import { getOkxReferenceRate } from "./okx.provider";
import { compareRates, logSanityResult } from "./rate.sanity.service";
import { RATE_LOCK_DURATION_MS, computeLockedUntil } from "../../utils/checkRateExpiry";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuoteResult {
    baseCurrency: string;
    quoteCurrency: string;
    pair: string;
    providerRate: number;
    markupType: string;
    markupApplied: number;
    customerRate: number;
    fetchedAt: Date;
}

export interface MarkupConfig {
    baseCurrency: string;
    quoteCurrency: string;
    markupType: MarkupType;
    markupValue: number;
}

// ─── Rate Calculation Engine ──────────────────────────────────────────────────

/**
 * Calculate customer rate from provider rate + markup config.
 *
 * FIXED:      customerRate = providerRate + markupValue
 * PERCENTAGE: customerRate = providerRate × (1 + markupValue / 100)
 */
export function calculateCustomerRate(
    providerRate: number,
    markupType: MarkupType,
    markupValue: number
): { customerRate: number; markupApplied: number } {
    if (markupType === MarkupType.FIXED) {
        const markupApplied = markupValue;
        return {
            customerRate: providerRate + markupApplied,
            markupApplied,
        };
    } else {
        // PERCENTAGE
        const markupApplied = providerRate * (markupValue / 100);
        return {
            customerRate: providerRate + markupApplied,
            markupApplied,
        };
    }
}

// ─── Get Customer Rate ────────────────────────────────────────────────────────

/**
 * Fetch the latest customer rate for a currency pair.
 * This is the ONLY rate customers ever see.
 * Provider rate is NOT included in the response.
 */
export async function getCustomerRate(
    baseCurrency: string,
    quoteCurrency: string,
    requestedBy?: string
): Promise<{ pair: string; customerRate: number; markupType: string; createdAt: Date } | null> {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    // Get the latest provider rate for this pair
    const providerRecord = await prisma.exchangeRateProvider.findFirst({
        where: { baseCurrency: base, quoteCurrency: quote },
        orderBy: { fetchedAt: "desc" },
    });

    if (!providerRecord) return null;

    // Get the configured markup (or use defaults: FIXED 0)
    const markup = await prisma.exchangeRateMarkup.findUnique({
        where: { baseCurrency_quoteCurrency: { baseCurrency: base, quoteCurrency: quote } },
    });

    const markupType = markup?.markupType ?? MarkupType.FIXED;
    const markupValue = markup ? Number(markup.markupValue) : 0;
    const providerRate = Number(providerRecord.providerRate);

    const { customerRate, markupApplied } = calculateCustomerRate(providerRate, markupType, markupValue);

    // Create audit log (non-blocking)
    const log = await prisma.exchangeRateLog.create({
        data: {
            providerName: providerRecord.providerName,
            baseCurrency: base,
            quoteCurrency: quote,
            providerRate,
            markupType: markupType.toString(),
            markupApplied,
            customerRate,
            requestedBy: requestedBy ?? null,
        },
    });

    return {
        pair: `${base}/${quote}`,
        customerRate,
        markupType: markupType.toString(),
        createdAt: log.createdAt,
    };
}

/**
 * Get customer rates for ALL configured currency pairs.
 */
export async function getAllCustomerRates(requestedBy?: string): Promise<
    Array<{ pair: string; customerRate: number; markupType: string; createdAt: Date }>> {
    // Get latest provider rate per pair
    const providers = await prisma.exchangeRateProvider.findMany({
        distinct: ["baseCurrency", "quoteCurrency"],
        orderBy: { fetchedAt: "desc" },
    });

    const rates = await Promise.all(
        providers.map(async (p) => {
            const result = await getCustomerRate(p.baseCurrency, p.quoteCurrency, requestedBy);
            return result;
        })
    );

    return rates.filter(Boolean) as Array<{
        pair: string;
        customerRate: number;
        markupType: string;
        createdAt: Date;
    }>;
}

// ─── Get Provider Rate (admin only) ──────────────────────────────────────────

/**
 * Get the raw provider rate for a currency pair.
 * MUST only be exposed to admin users.
 */
export async function getProviderRate(
    baseCurrency: string,
    quoteCurrency: string
): Promise<{
    pair: string;
    providerRate: number;
    providerName: string;
    fetchedAt: Date;
    markupType: string;
    markupValue: number;
    customerRate: number;
} | null> {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    const providerRecord = await prisma.exchangeRateProvider.findFirst({
        where: { baseCurrency: base, quoteCurrency: quote },
        orderBy: { fetchedAt: "desc" },
    });

    if (!providerRecord) return null;

    const markup = await prisma.exchangeRateMarkup.findUnique({
        where: { baseCurrency_quoteCurrency: { baseCurrency: base, quoteCurrency: quote } },
    });

    const markupType = markup?.markupType ?? MarkupType.FIXED;
    const markupValue = markup ? Number(markup.markupValue) : 0;
    const providerRate = Number(providerRecord.providerRate);
    const { customerRate } = calculateCustomerRate(providerRate, markupType, markupValue);

    return {
        pair: `${base}/${quote}`,
        providerRate,
        providerName: providerRecord.providerName,
        fetchedAt: providerRecord.fetchedAt,
        markupType: markupType.toString(),
        markupValue,
        customerRate,
    };
}

/**
 * Get all provider rates with their markups (admin full view).
 */
export async function getAllProviderRates(): Promise<Array<{
    pair: string;
    providerRate: number;
    providerName: string;
    fetchedAt: Date;
    markupType: string;
    markupValue: number;
    customerRate: number;
}>> {
    const providers = await prisma.exchangeRateProvider.findMany({
        distinct: ["baseCurrency", "quoteCurrency"],
        orderBy: { fetchedAt: "desc" },
    });

    const results = await Promise.all(
        providers.map(async (p) => getProviderRate(p.baseCurrency, p.quoteCurrency))
    );

    return results.filter(Boolean) as any[];
}

// ─── Ingest Provider Rate (manual / webhook) ──────────────────────────────────

/**
 * Ingest a new provider rate (append-only — existing records never modified).
 */
export async function ingestProviderRate(data: {
    providerName: string;
    baseCurrency: string;
    quoteCurrency: string;
    providerRate: number;
}): Promise<{ id: string; pair: string; providerRate: number; fetchedAt: Date }> {
    if (data.providerRate <= 0) throw new Error("Provider rate must be positive");

    const record = await prisma.exchangeRateProvider.create({
        data: {
            providerName: data.providerName,
            baseCurrency: data.baseCurrency.toUpperCase(),
            quoteCurrency: data.quoteCurrency.toUpperCase(),
            providerRate: data.providerRate,
        },
    });

    return {
        id: record.id,
        pair: `${record.baseCurrency}/${record.quoteCurrency}`,
        providerRate: Number(record.providerRate),
        fetchedAt: record.fetchedAt,
    };
}

// ─── Markup Configuration ─────────────────────────────────────────────────────

/**
 * Get markup configuration for a currency pair.
 */
export async function getMarkupConfig(baseCurrency: string, quoteCurrency: string) {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    return prisma.exchangeRateMarkup.findUnique({
        where: { baseCurrency_quoteCurrency: { baseCurrency: base, quoteCurrency: quote } },
    });
}

/**
 * Get all markup configurations.
 */
export async function getAllMarkupConfigs() {
    return prisma.exchangeRateMarkup.findMany({
        orderBy: [{ baseCurrency: "asc" }, { quoteCurrency: "asc" }],
    });
}

/**
 * Create or update markup config for a currency pair.
 * Takes effect immediately — no restart required.
 */
export async function upsertMarkupConfig(
    config: MarkupConfig,
    adminUserId: string
) {
    const base = config.baseCurrency.toUpperCase();
    const quote = config.quoteCurrency.toUpperCase();

    return prisma.exchangeRateMarkup.upsert({
        where: { baseCurrency_quoteCurrency: { baseCurrency: base, quoteCurrency: quote } },
        update: {
            markupType: config.markupType,
            markupValue: config.markupValue,
            isActive: true,
            updatedBy: adminUserId,
        },
        create: {
            baseCurrency: base,
            quoteCurrency: quote,
            markupType: config.markupType,
            markupValue: config.markupValue,
            isActive: true,
            updatedBy: adminUserId,
        },
    });
}

/**
 * Deactivate markup for a pair (resets to 0 markup).
 */
export async function deactivateMarkup(baseCurrency: string, quoteCurrency: string) {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    return prisma.exchangeRateMarkup.updateMany({
        where: { baseCurrency: base, quoteCurrency: quote },
        data: { isActive: false },
    });
}

// ─── Rate Audit Logs ──────────────────────────────────────────────────────────

/**
 * Get exchange rate logs (quote audit trail).
 */
export async function getRateLogs(filters?: {
    baseCurrency?: string;
    quoteCurrency?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
}) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters?.baseCurrency) where.baseCurrency = filters.baseCurrency.toUpperCase();
    if (filters?.quoteCurrency) where.quoteCurrency = filters.quoteCurrency.toUpperCase();
    if (filters?.startDate || filters?.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
        prisma.exchangeRateLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            skip,
        }),
        prisma.exchangeRateLog.count({ where }),
    ]);

    return { logs, total, page, limit };
}

// ─── Provider Rate History ────────────────────────────────────────────────────

export async function getProviderRateHistory(
    baseCurrency: string,
    quoteCurrency: string,
    limit = 50
) {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    return prisma.exchangeRateProvider.findMany({
        where: { baseCurrency: base, quoteCurrency: quote },
        orderBy: { fetchedAt: "desc" },
        take: limit,
    });
}

// ─── Live Rate + Trade Breakdown ──────────────────────────────────────────────

/**
 * The canonical FX breakdown used for all customer trade quotes.
 *
 * Internal values (never exposed to customers):
 *   providerRate      — raw OneLiquidity rate (e.g. ₦1,580/USD)
 *   markupApplied     — PapaEgo spread added (e.g. ₦15)
 *
 * Customer-visible values:
 *   customerRate      — what customer sees (e.g. ₦1,595/USD)
 *   supplierAmount    — what the supplier receives (e.g. $1,880.88)
 *
 * Internal reconciliation values:
 *   underlyingMarketValue — supplierAmount × providerRate (cost to PapaEgo at market rate)
 *   papaEgoFxMargin       — customerNgnAmount − underlyingMarketValue (gross FX profit)
 */
export interface TradeBreakdown {
    // Pair info
    baseCurrency: string;
    quoteCurrency: string;
    pair: string;
    direction: string;
    // Rate components (internal — never show to customer)
    providerRate: number;
    providerName: string;
    markupType: string;
    markupApplied: number;
    // Customer-visible
    customerRate: number;
    customerNgnAmount: number;
    supplierAmount: number;
    // Internal margin (admin only)
    underlyingMarketValue: number;
    papaEgoFxMargin: number;
    // Metadata
    fetchedAt: Date;
    quoteExpiresAt: Date;
    rateSource: string;
    isStub: boolean;
}

/**
 * Fetch a live rate from OneLiquidity, apply the configured markup,
 * and calculate the full trade breakdown for a given NGN amount.
 *
 * This is the single canonical function for all FX calculations.
 *
 * @param baseCurrency      e.g. "NGN"
 * @param quoteCurrency     e.g. "USD" or "CNY"
 * @param customerNgnAmount The NGN amount the customer is sending (e.g. 3_000_000)
 * @param requestedBy       Optional user ID for audit logging
 */
export async function getLiveTradeQuote(
    baseCurrency: string,
    quoteCurrency: string,
    customerNgnAmount: number,
    requestedBy?: string
): Promise<TradeBreakdown> {
    const base  = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();

    // 1. Fetch live rate from OneLiquidity
    const olRate = await getOneLiquidityRate(base, quote);
    const providerRate = olRate.mid;

    // 2. Ingest into DB (keeps history fresh)
    await ingestProviderRate({
        providerName:  olRate.isStub ? "OneLiquidity-STUB" : "OneLiquidity",
        baseCurrency:  base,
        quoteCurrency: quote,
        providerRate,
    }).catch(err => console.warn("[getLiveTradeQuote] ingest warning:", err.message));

    // 3. Get markup configuration
    const markup     = await prisma.exchangeRateMarkup.findUnique({
        where: { baseCurrency_quoteCurrency: { baseCurrency: base, quoteCurrency: quote } },
    });
    const markupType  = markup?.markupType  ?? MarkupType.FIXED;
    const markupValue = markup ? Number(markup.markupValue) : 0;

    // 4. Calculate customer rate
    const { customerRate, markupApplied } = calculateCustomerRate(providerRate, markupType, markupValue);

    // 5. Calculate trade amounts
    // Direction: base=NGN → customer sends NGN, supplier receives quoteCurrency
    // customerNgnAmount ÷ customerRate = supplierAmount
    const supplierAmount        = parseFloat((customerNgnAmount / customerRate).toFixed(6));
    // Cost to PapaEgo at raw market rate
    const underlyingMarketValue = parseFloat((supplierAmount * providerRate).toFixed(2));
    // Gross FX margin = what customer paid - what it actually cost
    const papaEgoFxMargin       = parseFloat((customerNgnAmount - underlyingMarketValue).toFixed(2));

    // 6. Quote expiry
    const fetchedAt     = olRate.fetchedAt;
    const quoteExpiresAt = computeLockedUntil(); // 10-minute lock window

    // 7. Run OKX sanity check (non-blocking)
    getOkxReferenceRate(base, quote).then(async okxRate => {
        if (okxRate) {
            const sanity = compareRates(`${base}/${quote}`, "OneLiquidity", providerRate, "OKX", okxRate.mid);
            await logSanityResult(sanity).catch(() => {});
        }
    }).catch(() => {});

    // 8. Audit log (internal)
    await prisma.exchangeRateLog.create({
        data: {
            providerName:   olRate.isStub ? "OneLiquidity-STUB" : "OneLiquidity",
            baseCurrency:   base,
            quoteCurrency:  quote,
            providerRate,
            markupType:     markupType.toString(),
            markupApplied,
            customerRate,
            requestedBy:    requestedBy ?? null,
            quoteExpiresAt,
            rateSource:     "OneLiquidity",
        },
    }).catch(err => console.warn("[getLiveTradeQuote] log warning:", err.message));

    return {
        baseCurrency:   base,
        quoteCurrency:  quote,
        pair:           `${base}/${quote}`,
        direction:      `${base} → ${quote}`,
        providerRate,
        providerName:   olRate.isStub ? "OneLiquidity-STUB" : "OneLiquidity",
        markupType:     markupType.toString(),
        markupApplied,
        customerRate,
        customerNgnAmount,
        supplierAmount,
        underlyingMarketValue,
        papaEgoFxMargin,
        fetchedAt,
        quoteExpiresAt,
        rateSource:     "OneLiquidity",
        isStub:         olRate.isStub,
    };
}

/**
 * Fetch a live rate and ingest it without computing a trade breakdown.
 * Used by the rate refresh job.
 */
export async function fetchAndIngestLiveRate(baseCurrency: string, quoteCurrency: string) {
    const base  = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    const olRate = await getOneLiquidityRate(base, quote);
    return ingestProviderRate({
        providerName:  olRate.isStub ? "OneLiquidity-STUB" : "OneLiquidity",
        baseCurrency:  base,
        quoteCurrency: quote,
        providerRate:  olRate.mid,
    });
}
