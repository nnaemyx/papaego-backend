import prisma from "../../config/db";
import { MarkupType } from "@prisma/client";

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
