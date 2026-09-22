import { Request, Response } from "express";
import {
    getCustomerRate,
    getAllCustomerRates,
    getProviderRate,
    getAllProviderRates,
    ingestProviderRate,
    getMarkupConfig,
    getAllMarkupConfigs,
    upsertMarkupConfig,
    deactivateMarkup,
    getRateLogs,
    getProviderRateHistory,
    getLiveTradeQuote,
} from "./exchange-rate.service";
import { getLatestSanityResults, getSanityHistory } from "./rate.sanity.service";
import { triggerRateRefresh } from "../../jobs/rate.refresh.job";
import { MarkupType } from "@prisma/client";

// ─── Customer Rate Endpoints (Public to auth'd users) ─────────────────────────

/**
 * GET /exchange-rate
 * Get customer rates for all pairs, or a specific pair.
 * Query: ?base=USD&quote=NGN
 * NEVER returns provider rate.
 */
export async function getRate(req: Request, res: Response) {
    try {
        const { base, quote } = req.query;
        const user = (req as any).user;

        if (base && quote) {
            const rate = await getCustomerRate(base as string, quote as string, user?.id);
            if (!rate) {
                return res.status(404).json({ error: `No rate available for ${base}/${quote}` });
            }
            return res.json({ rate });
        }

        // Return all available rates
        const rates = await getAllCustomerRates(user?.id);
        res.json({ rates });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Provider Rate Endpoints (Admin only) ─────────────────────────────────────

/**
 * GET /exchange-rate/provider
 * Get full rate details including provider rate (admin only).
 * Query: ?base=USD&quote=NGN
 */
export async function getProviderRates(req: Request, res: Response) {
    try {
        const { base, quote } = req.query;

        if (base && quote) {
            const rate = await getProviderRate(base as string, quote as string);
            if (!rate) {
                return res.status(404).json({ error: `No provider rate found for ${base}/${quote}` });
            }
            return res.json({ rate });
        }

        const rates = await getAllProviderRates();
        res.json({ rates });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /exchange-rate/ingest
 * Ingest a new provider rate (append-only). For manual entry or webhook.
 * Body: { providerName, baseCurrency, quoteCurrency, providerRate }
 */
export async function ingestRate(req: Request, res: Response) {
    try {
        const { providerName, baseCurrency, quoteCurrency, providerRate } = req.body;
        if (!providerName || !baseCurrency || !quoteCurrency || providerRate === undefined) {
            return res.status(400).json({
                error: "providerName, baseCurrency, quoteCurrency, and providerRate are required",
            });
        }
        const rate = await ingestProviderRate({
            providerName,
            baseCurrency,
            quoteCurrency,
            providerRate: Number(providerRate),
        });
        res.status(201).json({ success: true, rate });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * GET /exchange-rate/provider/history
 * Get historical provider rates for a pair.
 */
export async function getProviderHistory(req: Request, res: Response) {
    try {
        const { base, quote, limit } = req.query;
        if (!base || !quote) {
            return res.status(400).json({ error: "base and quote query params required" });
        }
        const history = await getProviderRateHistory(base as string, quote as string, limit ? Number(limit) : 50);
        res.json({ history });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Markup Configuration Endpoints ──────────────────────────────────────────

/**
 * GET /exchange-rate/markup
 * Get all markup configurations, or a specific pair.
 * Query: ?base=USD&quote=NGN
 */
export async function getMarkup(req: Request, res: Response) {
    try {
        const { base, quote } = req.query;

        if (base && quote) {
            const config = await getMarkupConfig(base as string, quote as string);
            return res.json({ markup: config });
        }

        const configs = await getAllMarkupConfigs();
        res.json({ markups: configs });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /exchange-rate/markup
 * Create or update markup configuration for a currency pair.
 * Changes take effect immediately without deployment.
 * Body: { baseCurrency, quoteCurrency, markupType, markupValue }
 */
export async function setMarkup(req: Request, res: Response) {
    try {
        const { baseCurrency, quoteCurrency, markupType, markupValue } = req.body;
        const user = (req as any).user;

        if (!baseCurrency || !quoteCurrency || !markupType || markupValue === undefined) {
            return res.status(400).json({
                error: "baseCurrency, quoteCurrency, markupType, and markupValue are required",
            });
        }

        if (!Object.values(MarkupType).includes(markupType)) {
            return res.status(400).json({ error: `markupType must be FIXED or PERCENTAGE` });
        }

        if (Number(markupValue) < 0) {
            return res.status(400).json({ error: "markupValue cannot be negative" });
        }

        const config = await upsertMarkupConfig(
            {
                baseCurrency,
                quoteCurrency,
                markupType: markupType as MarkupType,
                markupValue: Number(markupValue),
            },
            user.id
        );

        res.json({ success: true, markup: config });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * DELETE /exchange-rate/markup
 * Deactivate markup for a pair (resets to 0).
 * Body: { baseCurrency, quoteCurrency }
 */
export async function removeMarkup(req: Request, res: Response) {
    try {
        const { baseCurrency, quoteCurrency } = req.body;
        if (!baseCurrency || !quoteCurrency) {
            return res.status(400).json({ error: "baseCurrency and quoteCurrency are required" });
        }
        await deactivateMarkup(baseCurrency, quoteCurrency);
        res.json({ success: true, message: "Markup deactivated" });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

// ─── Rate Log Endpoints ───────────────────────────────────────────────────────

/**
 * GET /exchange-rate/logs
 * Get audit trail of all generated customer quotes.
 */
export async function getRateAuditLogs(req: Request, res: Response) {
    try {
        const { base, quote, startDate, endDate, page, limit } = req.query;
        const result = await getRateLogs({
            baseCurrency: base as string,
            quoteCurrency: quote as string,
            startDate: startDate ? new Date(startDate as string) : undefined,
            endDate: endDate ? new Date(endDate as string) : undefined,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 50,
        });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Trade Quote & Breakdown Endpoints ────────────────────────────────────────

/**
 * POST /exchange-rate/quote
 * Customer-facing quote generation.
 * Input: { baseCurrency: "NGN", quoteCurrency: "USD", amount: 3000000 }
 *
 * NOTE: As requested by Pascal / product team, the customer MUST NEVER see:
 * - raw provider/market rate
 * - PapaEgo spread/markup
 * - PapaEgo FX margin
 *
 * They ONLY see:
 * - customerRate (e.g. 1595)
 * - customerNgnAmount (e.g. 3,000,000)
 * - supplierAmount (e.g. 1880.88)
 * - quoteExpiresAt (expiry timer)
 */
export async function createTradeQuote(req: Request, res: Response) {
    try {
        const { baseCurrency, quoteCurrency, amount } = req.body;
        const user = (req as any).user;

        if (!baseCurrency || !quoteCurrency || amount === undefined) {
            return res.status(400).json({
                error: "baseCurrency, quoteCurrency, and amount are required",
            });
        }

        const numericAmount = Number(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: "amount must be a positive number" });
        }

        const breakdown = await getLiveTradeQuote(
            baseCurrency as string,
            quoteCurrency as string,
            numericAmount,
            user?.id
        );

        // Filter response strictly for customer view
        res.json({
            pair: breakdown.pair,
            direction: breakdown.direction,
            customerRate: breakdown.customerRate,
            customerNgnAmount: breakdown.customerNgnAmount,
            supplierAmount: breakdown.supplierAmount,
            fetchedAt: breakdown.fetchedAt,
            quoteExpiresAt: breakdown.quoteExpiresAt,
            rateSource: breakdown.rateSource,
        });
    } catch (err: any) {
        console.error("[createTradeQuote] Error:", err);
        res.status(500).json({ error: err.message || "Failed to generate quote" });
    }
}

/**
 * POST /exchange-rate/breakdown
 * Admin-only inspection of quote breakdown.
 * Returns full internal accounting breakdown:
 * - providerRate (e.g. 1580)
 * - markupApplied (e.g. 15)
 * - customerRate (e.g. 1595)
 * - supplierAmount (e.g. 1880.88)
 * - underlyingMarketValue (e.g. 2,971,790.40)
 * - papaEgoFxMargin (e.g. 28,209.60)
 */
export async function getTradeBreakdownInternal(req: Request, res: Response) {
    try {
        const { baseCurrency, quoteCurrency, amount } = req.body;
        const user = (req as any).user;

        if (!baseCurrency || !quoteCurrency || amount === undefined) {
            return res.status(400).json({
                error: "baseCurrency, quoteCurrency, and amount are required",
            });
        }

        const numericAmount = Number(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: "amount must be a positive number" });
        }

        const breakdown = await getLiveTradeQuote(
            baseCurrency as string,
            quoteCurrency as string,
            numericAmount,
            user?.id
        );

        res.json({ breakdown });
    } catch (err: any) {
        console.error("[getTradeBreakdownInternal] Error:", err);
        res.status(500).json({ error: err.message || "Failed to calculate breakdown" });
    }
}

/**
 * GET /exchange-rate/health
 * Admin-only: get latest sanity checks between OneLiquidity and OKX for all pairs.
 */
export async function getRateHealth(req: Request, res: Response) {
    try {
        const results = await getLatestSanityResults();
        res.json({ health: results });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /exchange-rate/refresh
 * Admin-only: trigger immediate background refresh of all rates from OneLiquidity & OKX.
 */
export async function triggerManualRateRefresh(req: Request, res: Response) {
    try {
        await triggerRateRefresh();
        res.json({ success: true, message: "Rate refresh triggered successfully" });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}
