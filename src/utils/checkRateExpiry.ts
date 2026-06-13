import { Trade, TradeStatus } from "@prisma/client";

export const RATE_LOCK_DURATION_MS = 10 * 60 * 1000;

const RATE_LOCKED_STATUSES: TradeStatus[] = ["QUOTED", "SENT_TO_CUSTOMER"];

export class RateExpiredError extends Error {
  readonly code = "RATE_EXPIRED";
  readonly statusCode = 410;

  constructor(message = "The quoted rate has expired. Please request a new quote.") {
    super(message);
    this.name = "RateExpiredError";
  }
}

export function isRateLockedStatus(status: TradeStatus | string): boolean {
  return RATE_LOCKED_STATUSES.includes(status as TradeStatus);
}

export function isRateExpired(trade: {
  lockedUntil: Date | null;
  status: TradeStatus | string;
}): boolean {
  if (trade.status === "EXPIRED") return true;
  if (!isRateLockedStatus(trade.status)) return false;
  if (!trade.lockedUntil) return false;
  return trade.lockedUntil.getTime() <= Date.now();
}

export function rateExpiresInSeconds(lockedUntil: Date | null): number | null {
  if (!lockedUntil) return null;
  const seconds = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
  return Math.max(0, seconds);
}

export function assertRateNotExpired(trade: {
  lockedUntil: Date | null;
  status: TradeStatus | string;
}): void {
  if (isRateExpired(trade)) {
    throw new RateExpiredError();
  }
}

export function computeLockedUntil(from: Date = new Date()): Date {
  return new Date(from.getTime() + RATE_LOCK_DURATION_MS);
}
