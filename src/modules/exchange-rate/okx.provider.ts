/**
 * OKX Public Spot Rate Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches reference spot rates from OKX's public ticker API (no API key needed).
 * Used as a sanity-check reference source only — NOT for executing trades.
 *
 * IMPORTANT: This is SPOT market pricing, NOT P2P pricing.
 * Spot and P2P rates can differ materially — they must not be confused.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const OKX_BASE_URL = "https://www.okx.com";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OkxRate {
    /** e.g. "NGN" */
    baseCurrency: string;
    /** e.g. "USD" */
    quoteCurrency: string;
    /** OKX instrument ID e.g. "NGN-USD" */
    instId: string;
    /** Best bid price */
    bid: number;
    /** Best ask price */
    ask: number;
    /** Mid-market rate = (bid + ask) / 2 */
    mid: number;
    /** 24h last traded price */
    last: number;
    /** Always "SPOT" — not P2P */
    venue: "SPOT";
    source: "OKX";
    fetchedAt: Date;
    isStub: boolean;
}

// ─── Instrument ID Mapping ─────────────────────────────────────────────────────
// OKX uses different pair naming conventions than standard FX.
// Some NGN pairs may not exist on OKX spot; we use USDT as a bridge.
//
// NGN/USD: Try "NGN-USDT" first (USDT ≈ USD on OKX spot)
// NGN/CNY: No direct OKX pair — derive as (NGN/USDT) × (USDT/CNY) or use CNY-USDT

const OKX_INSTRUMENT_MAP: Record<string, string> = {
    "NGN/USD":  "NGN-USDT",   // USDT used as USD proxy on OKX spot
    "NGN/USDT": "NGN-USDT",
    "NGN/CNY":  "USDT-CNY",   // Proxy: get USDT/CNY; multiply by NGN/USDT mid
    "NGN/GBP":  "GBP-USDT",   // Proxy: inverse
    "NGN/EUR":  "EUR-USDT",   // Proxy: inverse
    "NGN/CNH":  "USDT-CNY",   // CNH ≈ CNY offshore
};

// ─── Stub data ─────────────────────────────────────────────────────────────────

const STUB_OKX_RATES: Record<string, { bid: number; ask: number; last: number }> = {
    "NGN-USDT": { bid: 1572, ask: 1577, last: 1574 },
    "USDT-CNY": { bid: 7.27, ask: 7.29, last: 7.28 },
    "GBP-USDT": { bid: 1.268, ask: 1.271, last: 1.270 },
    "EUR-USDT": { bid: 1.090, ask: 1.092, last: 1.091 },
};

// ─── Fetch from OKX ───────────────────────────────────────────────────────────

async function fetchOkxTicker(instId: string): Promise<{
    bid: number; ask: number; last: number;
}> {
    const url = `${OKX_BASE_URL}/api/v5/market/ticker?instId=${instId}`;

    if (!process.env.ONELIQUIDITY_API_KEY && !process.env.OKX_LIVE) {
        // In stub mode, use fake data
        const stub = STUB_OKX_RATES[instId];
        if (!stub) throw new Error(`No OKX stub data for instrument: ${instId}`);
        return stub;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    let res: Response;
    try {
        res = await fetch(url, {
            headers: { "Accept": "application/json" },
            signal: controller.signal,
        });
    } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") throw new Error("OKX ticker request timed out after 8 seconds");
        throw new Error(`OKX network error: ${err.message}`);
    } finally {
        clearTimeout(timeout);
    }

    if (!res.ok) {
        throw new Error(`OKX returned HTTP ${res.status} for ${instId}`);
    }

    const body = await res.json();
    if (!body.data || body.data.length === 0) {
        throw new Error(`OKX returned empty data for instrument: ${instId}`);
    }

    const d = body.data[0];
    return {
        bid:  parseFloat(d.bidPx),
        ask:  parseFloat(d.askPx),
        last: parseFloat(d.last),
    };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the OKX spot reference rate for a currency pair.
 *
 * This is a REFERENCE RATE only — used for sanity checking OneLiquidity rates.
 * Do NOT use this rate for executing customer trades.
 *
 * @param baseCurrency  e.g. "NGN"
 * @param quoteCurrency e.g. "USD" or "CNY"
 * @returns OkxRate with mid price, or null if the pair is not available on OKX
 */
export async function getOkxReferenceRate(
    baseCurrency: string,
    quoteCurrency: string
): Promise<OkxRate | null> {
    const base  = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    const pairKey = `${base}/${quote}`;

    const instId = OKX_INSTRUMENT_MAP[pairKey];
    if (!instId) {
        console.warn(`[OKX] No instrument mapping for pair ${pairKey} — skipping OKX reference check`);
        return null;
    }

    const isStub = !process.env.ONELIQUIDITY_API_KEY && !process.env.OKX_LIVE;
    const now = new Date();

    try {
        // For NGN/CNY, we need a two-step derivation:
        // NGN/USDT × USDT/CNY = NGN/CNY (approximately)
        // For NGN/CNY, we derive through USDT bridge:
        // 1 USDT = ngnUsdtMid NGN (e.g. 1574.5 NGN)
        // 1 USDT = usdtCnyMid CNY (e.g. 7.28 CNY)
        // 1 CNY = (1574.5 / 7.28) ≈ 216.28 NGN
        if (pairKey === "NGN/CNY" || pairKey === "NGN/CNH") {
            const [ngnUsdt, usdtCny] = await Promise.all([
                fetchOkxTicker("NGN-USDT"),
                fetchOkxTicker("USDT-CNY"),
            ]);

            const ngnUsdtMid = (ngnUsdt.bid + ngnUsdt.ask) / 2;
            const usdtCnyMid = (usdtCny.bid + usdtCny.ask) / 2;

            const ngnPerCny = usdtCnyMid > 0 ? ngnUsdtMid / usdtCnyMid : 0;
            const mid = parseFloat(ngnPerCny.toFixed(4));

            return {
                baseCurrency: base,
                quoteCurrency: quote,
                instId: "NGN-USDT × USDT-CNY (derived)",
                bid:  parseFloat((mid * 0.998).toFixed(4)),
                ask:  parseFloat((mid * 1.002).toFixed(4)),
                mid,
                last: mid,
                venue: "SPOT",
                source: "OKX",
                fetchedAt: now,
                isStub,
            };
        }

        // For NGN/GBP or NGN/EUR — derived through USDT:
        // 1 GBP = fiatUsdtMid USDT (e.g. 1.27 USDT)
        // 1 USDT = ngnUsdtMid NGN (e.g. 1574.5 NGN)
        // 1 GBP = 1.27 × 1574.5 ≈ 1999.6 NGN
        if (pairKey === "NGN/GBP" || pairKey === "NGN/EUR") {
            const [ngnUsdt, fiatUsdt] = await Promise.all([
                fetchOkxTicker("NGN-USDT"),
                fetchOkxTicker(instId),
            ]);
            const ngnUsdtMid  = (ngnUsdt.bid + ngnUsdt.ask) / 2;
            const fiatUsdtMid = (fiatUsdt.bid + fiatUsdt.ask) / 2;
            const mid = parseFloat((fiatUsdtMid * ngnUsdtMid).toFixed(4));

            return {
                baseCurrency: base,
                quoteCurrency: quote,
                instId: `NGN-USDT × ${instId} (derived)`,
                bid:  parseFloat((mid * 0.998).toFixed(4)),
                ask:  parseFloat((mid * 1.002).toFixed(4)),
                mid,
                last: mid,
                venue: "SPOT",
                source: "OKX",
                fetchedAt: now,
                isStub,
            };
        }

        // Direct pair (NGN/USD via NGN-USDT: represents NGN per 1 USDT/USD)
        const ticker = await fetchOkxTicker(instId);
        const mid    = parseFloat(((ticker.bid + ticker.ask) / 2).toFixed(4));

        return {
            baseCurrency: base,
            quoteCurrency: quote,
            instId,
            bid:  ticker.bid,
            ask:  ticker.ask,
            mid,
            last: ticker.last,
            venue: "SPOT",
            source: "OKX",
            fetchedAt: now,
            isStub,
        };
    } catch (err: any) {
        console.error(`[OKX] Failed to fetch reference rate for ${pairKey}:`, err.message);
        return null; // Reference failure should never block primary rate
    }
}

