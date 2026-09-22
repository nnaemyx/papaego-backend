/**
 * OneLiquidity Rate Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches live FX rates from OneLiquidity (primary liquidity source).
 *
 * Environment variables:
 *   ONELIQUIDITY_API_KEY   — your OneLiquidity API key
 *   ONELIQUIDITY_BASE_URL  — base URL (default: https://api.oneliquidity.com)
 *
 * Stub mode: when ONELIQUIDITY_API_KEY is absent, returns realistic fake rates
 * so the full flow can be exercised without live credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const OL_BASE_URL = (process.env.ONELIQUIDITY_BASE_URL || "https://api.oneliquidity.technology").replace(/\/$/, "");
const OL_API_KEY  = process.env.ONELIQUIDITY_API_KEY || "";
const STUB_MODE   = !OL_API_KEY;

if (STUB_MODE) {
    console.warn("[OneLiquidity] ONELIQUIDITY_API_KEY not set — running in STUB mode. Rates are simulated.");
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OneLiquidityRate {
    /** The currency being priced against the quote currency (e.g. "NGN") */
    baseCurrency: string;
    /** The pricing currency (e.g. "USD", "CNY") */
    quoteCurrency: string;
    /** Bid price (provider buys base at this price) */
    bid: number;
    /** Ask price (provider sells base at this price) */
    ask: number;
    /** Mid-market rate = (bid + ask) / 2 */
    mid: number;
    /**
     * Rate type from OneLiquidity.
     * Typically "INDICATIVE" for live streaming rates or "FIRM" for executable quotes.
     */
    rateType: "INDICATIVE" | "FIRM" | "SPOT" | string;
    /**
     * Direction convention: "BASE_PER_QUOTE" means rate = how many NGN per 1 USD.
     * e.g. mid = 1580 means ₦1,580 per $1 USD.
     */
    direction: "BASE_PER_QUOTE" | "QUOTE_PER_BASE";
    /** When this rate was fetched from the provider */
    fetchedAt: Date;
    /**
     * When this quote expires. OneLiquidity indicative rates
     * are typically valid for 60 seconds; firm quotes may be shorter.
     */
    validUntil: Date;
    /** True when running in stub/test mode */
    isStub: boolean;
    /** Raw provider response (for audit purposes) */
    raw?: any;
}

export interface OneLiquidityError {
    code: string;
    message: string;
    isTransient: boolean; // true = retry may help; false = config/credential issue
}

// ─── Stub Rates ────────────────────────────────────────────────────────────────
// Realistic market reference values used when running in stub mode.
// These are NOT used as fallback rates in production — see fx.provider.ts.

const STUB_RATES: Record<string, { bid: number; ask: number }> = {
    "NGN/USD": { bid: 1578,  ask: 1582  },  // ₦/$ 
    "NGN/CNY": { bid: 215.5, ask: 216.5 },  // ₦/¥
    "NGN/GBP": { bid: 1990,  ask: 1998  },  // ₦/£
    "NGN/EUR": { bid: 1718,  ask: 1724  },  // ₦/€
    "NGN/AED": { bid: 432,   ask: 436   },  // ₦/AED
    "NGN/CAD": { bid: 1148,  ask: 1154  },  // ₦/CAD
};

function buildStubRate(baseCurrency: string, quoteCurrency: string): OneLiquidityRate {
    const pair = `${baseCurrency.toUpperCase()}/${quoteCurrency.toUpperCase()}`;
    const stub = STUB_RATES[pair];
    if (!stub) {
        throw new OneLiquidityProviderError({
            code: "PAIR_NOT_SUPPORTED",
            message: `OneLiquidity stub does not have a rate for ${pair}. Add it to STUB_RATES or provide live credentials.`,
            isTransient: false,
        });
    }

    const mid = (stub.bid + stub.ask) / 2;
    const now = new Date();
    const validUntil = new Date(now.getTime() + 60_000); // 60-second validity

    return {
        baseCurrency: baseCurrency.toUpperCase(),
        quoteCurrency: quoteCurrency.toUpperCase(),
        bid: stub.bid,
        ask: stub.ask,
        mid: parseFloat(mid.toFixed(4)),
        rateType: "INDICATIVE",
        direction: "BASE_PER_QUOTE",
        fetchedAt: now,
        validUntil,
        isStub: true,
    };
}

// ─── Error Class ───────────────────────────────────────────────────────────────

export class OneLiquidityProviderError extends Error {
    public readonly code: string;
    public readonly isTransient: boolean;

    constructor(err: OneLiquidityError) {
        super(err.message);
        this.name = "OneLiquidityProviderError";
        this.code = err.code;
        this.isTransient = err.isTransient;
    }
}

// ─── Live API Call ─────────────────────────────────────────────────────────────

/**
 * Fetch a live rate from OneLiquidity.
 *
 * OneLiquidity API endpoint (standard FX quote):
 *   GET /v1/rates?base={base}&quote={quote}
 *
 * Expected response shape:
 *   {
 *     "pair": "NGN/USD",
 *     "bid": 1578.50,
 *     "ask": 1581.75,
 *     "mid": 1580.13,
 *     "type": "INDICATIVE",
 *     "timestamp": "2026-09-22T23:00:00Z",
 *     "validUntil": "2026-09-22T23:01:00Z"
 *   }
 *
 * NOTE: Adjust endpoint path and response field names once you confirm with
 * OneLiquidity's technical team the exact API spec for your account tier.
 */
async function fetchLiveRate(baseCurrency: string, quoteCurrency: string): Promise<OneLiquidityRate> {
    const base  = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    const url   = `${OL_BASE_URL}/v1/rates?base=${base}&quote=${quote}`;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    let res: Response;
    try {
        res = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${OL_API_KEY}`,
                "Accept":        "application/json",
                "X-Client-ID":   "PapaEgo",
            },
            signal: controller.signal,
        });
    } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
            throw new OneLiquidityProviderError({
                code: "TIMEOUT",
                message: "OneLiquidity did not respond within 10 seconds",
                isTransient: true,
            });
        }
        throw new OneLiquidityProviderError({
            code: "NETWORK_ERROR",
            message: `Network error fetching OneLiquidity rate: ${err.message}`,
            isTransient: true,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (res.status === 401 || res.status === 403) {
        throw new OneLiquidityProviderError({
            code: "AUTH_FAILURE",
            message: "OneLiquidity rejected the API key — check ONELIQUIDITY_API_KEY",
            isTransient: false,
        });
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OneLiquidityProviderError({
            code: `HTTP_${res.status}`,
            message: `OneLiquidity returned HTTP ${res.status}: ${body.slice(0, 200)}`,
            isTransient: res.status >= 500,
        });
    }

    let data: any;
    try {
        data = await res.json();
    } catch {
        throw new OneLiquidityProviderError({
            code: "PARSE_ERROR",
            message: "OneLiquidity returned non-JSON response",
            isTransient: false,
        });
    }

    // Validate required fields
    const bid = Number(data.bid);
    const ask = Number(data.ask);
    if (!bid || !ask || bid <= 0 || ask <= 0) {
        throw new OneLiquidityProviderError({
            code: "INVALID_RATE",
            message: `OneLiquidity returned invalid bid/ask: bid=${data.bid}, ask=${data.ask}`,
            isTransient: false,
        });
    }

    if (bid > ask) {
        throw new OneLiquidityProviderError({
            code: "INVERTED_SPREAD",
            message: `OneLiquidity returned inverted spread: bid (${bid}) > ask (${ask})`,
            isTransient: false,
        });
    }

    const mid        = data.mid ? Number(data.mid) : (bid + ask) / 2;
    const fetchedAt  = new Date();
    const validUntil = data.validUntil
        ? new Date(data.validUntil)
        : new Date(fetchedAt.getTime() + 60_000);

    return {
        baseCurrency: base,
        quoteCurrency: quote,
        bid,
        ask,
        mid: parseFloat(mid.toFixed(4)),
        rateType: data.type || data.rateType || "INDICATIVE",
        direction: "BASE_PER_QUOTE",
        fetchedAt,
        validUntil,
        isStub: false,
        raw: data,
    };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the live rate from OneLiquidity for a currency pair.
 *
 * @param baseCurrency  The base currency (e.g. "NGN")
 * @param quoteCurrency The quote currency (e.g. "USD", "CNY")
 * @returns OneLiquidityRate with bid, ask, mid, rateType, fetchedAt, validUntil
 * @throws OneLiquidityProviderError on any failure
 */
export async function getOneLiquidityRate(
    baseCurrency: string,
    quoteCurrency: string
): Promise<OneLiquidityRate> {
    if (STUB_MODE) {
        console.debug(`[OneLiquidity] STUB: returning simulated rate for ${baseCurrency}/${quoteCurrency}`);
        return buildStubRate(baseCurrency, quoteCurrency);
    }

    console.debug(`[OneLiquidity] Fetching live rate for ${baseCurrency}/${quoteCurrency}`);
    const rate = await fetchLiveRate(baseCurrency, quoteCurrency);
    console.debug(`[OneLiquidity] Rate fetched: ${baseCurrency}/${quoteCurrency} = ${rate.mid} (bid=${rate.bid}, ask=${rate.ask})`);
    return rate;
}

/**
 * Supported currency pairs for auto-refresh.
 * These are fetched every 5 minutes by the rate refresh job.
 */
export const SUPPORTED_PAIRS: Array<{ base: string; quote: string }> = [
    { base: "NGN", quote: "USD" },
    { base: "NGN", quote: "CNY" },
    { base: "NGN", quote: "GBP" },
    { base: "NGN", quote: "EUR" },
    { base: "NGN", quote: "AED" },
    { base: "NGN", quote: "CAD" },
];

