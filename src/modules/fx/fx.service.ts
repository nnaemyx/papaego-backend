import { RealFxProvider } from "./fx.provider";
import prisma from "../../config/db";
import { RATE_LOCK_DURATION_MS, computeLockedUntil } from "../../utils/checkRateExpiry";

const fx = new RealFxProvider();

export interface RateQuote {
    rate: number;
    expiresAt: Date;
    expiresInSeconds: number;
    lockDurationMinutes: number;
}

/**
 * Get a locked rate with validity window metadata.
 * The rate includes margin and comes with an expiry timestamp.
 */
export async function getLockedRate(
    base: string,
    quote: string,
    country: string
): Promise<number> {
    const rawRate = await fx.getRate(base, quote, country);

    // Fetch margin configuration
    const marginConfig = await prisma.fxMargin.findUnique({
        where: { countryId: country }
    });

    const margin = marginConfig ? Number(marginConfig.margin) : 0;

    // Apply margin (e.g., add margin to rate)
    return rawRate + margin;
}

/**
 * Get a rate quote with full validity metadata.
 * Used when quoting rates that need to show expiry timers.
 */
export async function getLockedRateWithExpiry(
    base: string,
    quote: string,
    country: string
): Promise<RateQuote> {
    const rate = await getLockedRate(base, quote, country);
    const expiresAt = computeLockedUntil();
    const expiresInSeconds = Math.ceil(RATE_LOCK_DURATION_MS / 1000);

    return {
        rate,
        expiresAt,
        expiresInSeconds,
        lockDurationMinutes: Math.ceil(RATE_LOCK_DURATION_MS / 60000),
    };
}
