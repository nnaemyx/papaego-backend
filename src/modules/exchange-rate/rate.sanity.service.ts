/**
 * Rate Sanity Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Compares the primary rate (OneLiquidity) against a reference rate (OKX spot)
 * and flags large divergences.
 *
 * Status rules:
 *   HEALTHY  — divergence < WARN threshold (default 2%)
 *   WARNING  — divergence >= WARN and < CRITICAL threshold (default 5%)
 *   CRITICAL — divergence >= CRITICAL threshold
 *
 * CRITICAL rates should NOT be served to customers until an admin clears them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";

const WARN_THRESHOLD_PCT     = Number(process.env.RATE_DIVERGENCE_WARN_PCT     || 2);
const CRITICAL_THRESHOLD_PCT = Number(process.env.RATE_DIVERGENCE_CRITICAL_PCT || 5);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RateSanityStatus = "HEALTHY" | "WARNING" | "CRITICAL";

export interface SanityResult {
    pair: string;
    primarySource: string;
    primaryRate: number;
    referenceSource: string;
    referenceRate: number;
    divergencePct: number;
    status: RateSanityStatus;
    message: string;
    checkedAt: Date;
}

// ─── Core Comparison ───────────────────────────────────────────────────────────

/**
 * Compare a primary rate against a reference rate.
 * Returns a SanityResult describing whether the rates are reasonably aligned.
 *
 * @param pair          e.g. "NGN/USD"
 * @param primarySource e.g. "OneLiquidity"
 * @param primaryRate   The rate from the primary source (e.g. 1580)
 * @param refSource     e.g. "OKX"
 * @param refRate       The reference rate (e.g. 1572)
 */
export function compareRates(
    pair: string,
    primarySource: string,
    primaryRate: number,
    refSource: string,
    refRate: number
): SanityResult {
    const checkedAt = new Date();

    if (refRate <= 0) {
        return {
            pair,
            primarySource,
            primaryRate,
            referenceSource: refSource,
            referenceRate: refRate,
            divergencePct: 0,
            status: "HEALTHY",
            message: `Reference rate from ${refSource} unavailable — skipping sanity check`,
            checkedAt,
        };
    }

    const divergencePct = Math.abs((primaryRate - refRate) / refRate) * 100;
    const divergenceStr = divergencePct.toFixed(2);

    let status: RateSanityStatus;
    let message: string;

    if (divergencePct >= CRITICAL_THRESHOLD_PCT) {
        status  = "CRITICAL";
        message = `${pair}: ${primarySource} (${primaryRate}) vs ${refSource} (${refRate}) diverges by ${divergenceStr}% — exceeds CRITICAL threshold of ${CRITICAL_THRESHOLD_PCT}%. Rate blocked until admin review.`;
    } else if (divergencePct >= WARN_THRESHOLD_PCT) {
        status  = "WARNING";
        message = `${pair}: ${primarySource} (${primaryRate}) vs ${refSource} (${refRate}) diverges by ${divergenceStr}% — exceeds WARNING threshold of ${WARN_THRESHOLD_PCT}%.`;
    } else {
        status  = "HEALTHY";
        message = `${pair}: ${primarySource} (${primaryRate}) vs ${refSource} (${refRate}) divergence is ${divergenceStr}% — within tolerance.`;
    }

    if (status !== "HEALTHY") {
        console.warn(`[RateSanity] ${message}`);
    }

    return {
        pair,
        primarySource,
        primaryRate,
        referenceSource: refSource,
        referenceRate: refRate,
        divergencePct: parseFloat(divergenceStr),
        status,
        message,
        checkedAt,
    };
}

/**
 * Persist a sanity check result to the database for admin visibility.
 */
export async function logSanityResult(result: SanityResult): Promise<void> {
    try {
        await prisma.rateSanityLog.create({
            data: {
                pair:           result.pair,
                primarySource:  result.primarySource,
                primaryRate:    result.primaryRate,
                referenceSource: result.referenceSource,
                referenceRate:  result.referenceRate,
                divergencePct:  result.divergencePct,
                status:         result.status,
            },
        });
    } catch (err: any) {
        // Non-fatal — don't let logging failure block rate serving
        console.error("[RateSanity] Failed to log sanity result to DB:", err.message);
    }
}

/**
 * Get the latest sanity check results for all pairs.
 * Used by the admin rate health dashboard.
 */
export async function getLatestSanityResults(): Promise<any[]> {
    // Get most recent entry per pair
    const pairs = await prisma.rateSanityLog.findMany({
        distinct: ["pair"],
        orderBy:  { createdAt: "desc" },
    });
    return pairs;
}

/**
 * Get sanity log history for a specific pair.
 */
export async function getSanityHistory(pair: string, limit = 20): Promise<any[]> {
    return prisma.rateSanityLog.findMany({
        where:   { pair },
        orderBy: { createdAt: "desc" },
        take:    limit,
    });
}

