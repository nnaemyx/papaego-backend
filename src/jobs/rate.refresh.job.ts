/**
 * Rate Refresh Background Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs every 5 minutes to:
 *   1. Fetch live rates from OneLiquidity for all supported pairs
 *   2. Ingest them into ExchangeRateProvider (append-only)
 *   3. Fetch OKX reference rate for each pair
 *   4. Run sanity check and log the result
 *   5. Log a health summary to the console
 *
 * Import and call startRateRefreshJob() once on server startup.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
    getOneLiquidityRate,
    SUPPORTED_PAIRS,
    OneLiquidityProviderError,
} from "../modules/exchange-rate/oneliquidity.provider";
import { getOkxReferenceRate }        from "../modules/exchange-rate/okx.provider";
import { ingestProviderRate }         from "../modules/exchange-rate/exchange-rate.service";
import { compareRates, logSanityResult } from "../modules/exchange-rate/rate.sanity.service";

const REFRESH_INTERVAL_MS = Number(process.env.RATE_REFRESH_INTERVAL_MS || 5 * 60_000); // 5 minutes

let jobTimer: NodeJS.Timeout | null = null;

// ─── Single Refresh Cycle ──────────────────────────────────────────────────────

async function refreshAllRates(): Promise<void> {
    console.log(`[RateRefreshJob] Starting rate refresh at ${new Date().toISOString()}`);

    const results: Array<{
        pair: string;
        olRate?: number;
        okxRate?: number;
        status: string;
        error?: string;
    }> = [];

    for (const { base, quote } of SUPPORTED_PAIRS) {
        const pair = `${base}/${quote}`;

        try {
            // 1. Fetch from OneLiquidity (primary)
            const olRate = await getOneLiquidityRate(base, quote);

            // 2. Ingest into ExchangeRateProvider DB
            await ingestProviderRate({
                providerName:  olRate.isStub ? "OneLiquidity-STUB" : "OneLiquidity",
                baseCurrency:  base,
                quoteCurrency: quote,
                providerRate:  olRate.mid,
            });

            // 3. Fetch OKX reference (non-blocking — failure doesn't block)
            let okxMid: number | undefined;
            try {
                const okxRate = await getOkxReferenceRate(base, quote);
                if (okxRate) {
                    okxMid = okxRate.mid;

                    // 4. Sanity check
                    const sanity = compareRates(
                        pair,
                        "OneLiquidity",
                        olRate.mid,
                        "OKX",
                        okxRate.mid
                    );
                    await logSanityResult(sanity);

                    results.push({
                        pair,
                        olRate:  olRate.mid,
                        okxRate: okxMid,
                        status:  sanity.status,
                    });

                    if (sanity.status === "CRITICAL") {
                        console.error(`[RateRefreshJob] ⚠️  CRITICAL divergence on ${pair}: ${sanity.message}`);
                    } else if (sanity.status === "WARNING") {
                        console.warn(`[RateRefreshJob] ⚡ WARNING divergence on ${pair}: ${sanity.message}`);
                    }
                } else {
                    results.push({ pair, olRate: olRate.mid, status: "HEALTHY (no OKX ref)" });
                }
            } catch (okxErr: any) {
                console.warn(`[RateRefreshJob] OKX reference failed for ${pair}: ${okxErr.message}`);
                results.push({ pair, olRate: olRate.mid, status: "HEALTHY (OKX unavailable)" });
            }

        } catch (err: any) {
            const isTransient = err instanceof OneLiquidityProviderError ? err.isTransient : true;
            console.error(`[RateRefreshJob] ❌ Failed to fetch ${pair}: ${err.message} (transient=${isTransient})`);
            results.push({ pair, error: err.message, status: "FAILED" });
        }
    }

    // 5. Log summary
    const healthy  = results.filter(r => r.status.startsWith("HEALTHY")).length;
    const warning  = results.filter(r => r.status === "WARNING").length;
    const critical = results.filter(r => r.status === "CRITICAL").length;
    const failed   = results.filter(r => r.status === "FAILED").length;

    console.log(
        `[RateRefreshJob] Complete — ` +
        `✅ ${healthy} healthy, ⚡ ${warning} warning, ⚠️ ${critical} critical, ❌ ${failed} failed`
    );

    // Print rate table
    console.table(
        results.map(r => ({
            Pair:      r.pair,
            "OL Rate": r.olRate ? r.olRate.toFixed(4) : "—",
            "OKX Ref": r.okxRate ? r.okxRate.toFixed(4) : "—",
            Status:    r.status,
            Error:     r.error || "",
        }))
    );
}

// ─── Job Control ───────────────────────────────────────────────────────────────

/**
 * Start the rate refresh background job.
 * Runs once immediately, then every RATE_REFRESH_INTERVAL_MS milliseconds.
 * Call this once on server startup in app.ts or server.ts.
 */
export function startRateRefreshJob(): void {
    if (jobTimer) {
        console.warn("[RateRefreshJob] Already running — skipping duplicate start");
        return;
    }

    console.log(`[RateRefreshJob] Starting — will refresh rates every ${REFRESH_INTERVAL_MS / 60_000} minutes`);

    // Run immediately on startup, then on interval
    refreshAllRates().catch(err =>
        console.error("[RateRefreshJob] Initial refresh failed:", err)
    );

    jobTimer = setInterval(() => {
        refreshAllRates().catch(err =>
            console.error("[RateRefreshJob] Scheduled refresh failed:", err)
        );
    }, REFRESH_INTERVAL_MS);

    // Prevent timer from blocking process exit
    if (jobTimer.unref) jobTimer.unref();
}

/**
 * Stop the rate refresh job (useful for tests).
 */
export function stopRateRefreshJob(): void {
    if (jobTimer) {
        clearInterval(jobTimer);
        jobTimer = null;
        console.log("[RateRefreshJob] Stopped");
    }
}

/**
 * Manually trigger a single refresh cycle (useful for admin-triggered refresh).
 */
export async function triggerRateRefresh(): Promise<void> {
    await refreshAllRates();
}

