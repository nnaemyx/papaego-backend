import { TradeStatus } from "@prisma/client";
import prisma from "../config/db";
import { isRateExpired } from "../utils/checkRateExpiry";

type RateLockedTrade = {
  id: string;
  status: TradeStatus;
  lockedUntil: Date | null;
};

async function markTradeExpired(trade: RateLockedTrade): Promise<void> {
  await prisma.$transaction([
    prisma.trade.update({
      where: { id: trade.id },
      data: { status: "EXPIRED" },
    }),
    prisma.auditLog.create({
      data: {
        actorId: "SYSTEM",
        role: "ADMIN",
        action: "RATE_EXPIRED",
        entity: "Trade",
        entityId: trade.id,
        ip: "127.0.0.1",
        metadata: {
          previousStatus: trade.status,
          lockedUntil: trade.lockedUntil?.toISOString() ?? null,
        },
      },
    }),
  ]);
}

/** Expire a single trade on read if its lock window has passed. */
export async function expireTradeIfNeeded<T extends RateLockedTrade>(
  trade: T
): Promise<T & { status: TradeStatus }> {
  if (!isRateExpired(trade)) return trade;

  await markTradeExpired(trade);
  return { ...trade, status: "EXPIRED" };
}

const EXPIRY_INTERVAL_MS = 60_000;

export async function expireStaleQuotedTrades(): Promise<number> {
  const now = new Date();
  const candidates = await prisma.trade.findMany({
    where: {
      status: { in: ["QUOTED", "SENT_TO_CUSTOMER"] },
      lockedUntil: { lt: now },
    },
    select: {
      id: true,
      status: true,
      lockedUntil: true,
    },
  });

  let expiredCount = 0;

  for (const trade of candidates) {
    if (!isRateExpired(trade)) continue;
    await markTradeExpired(trade);
    expiredCount++;
  }

  return expiredCount;
}

export function startJobs() {
  void expireStaleQuotedTrades();

  setInterval(() => {
    expireStaleQuotedTrades().catch((error) => {
      console.error("Trade expiration job failed:", error);
    });
  }, EXPIRY_INTERVAL_MS);
}
