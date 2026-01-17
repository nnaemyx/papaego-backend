import { TradeStatus } from "@prisma/client";
import { assertTransition } from "../../utils/stateMachine";
import prisma from "../../config/db";
import { getLockedRate } from "../fx/fx.service";

// Kept for backward compatibility if needed, or replace entirely. 
// User snippet replaces it with quoteTrade, but the controller uses updateTradeStatus in some places.
// Actually, the user snippet for trade.service.ts ONLY showed quoteTrade.
// But the controller from Step 155 uses updateTradeStatus for other actions.
// So I should keep updateTradeStatus AND add quoteTrade, or refactor.
// Let's add quoteTrade export.

export async function updateTradeStatus(tradeId: string, newStatus: TradeStatus, actor: any) {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });

  if (!trade) {
    throw new Error("Trade not found");
  }

  assertTransition(trade.status, newStatus);

  await prisma.trade.update({
    where: { id: tradeId },
    data: { status: newStatus }
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      role: actor.role,
      action: `TRADE_${newStatus}`,
      entity: "Trade",
      entityId: tradeId,
      ip: actor.ip || "127.0.0.1"
    }
  });
}

export async function quoteTrade(tradeId: string, actor: any) {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });

  if (!trade) throw new Error("Trade not found");

  assertTransition(trade.status, "QUOTED");

  const fxRate = await getLockedRate(
    trade.sendCurrency,
    trade.receiveCurrency,
    trade.countryId
  );

  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      fxRate,
      status: "QUOTED",
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      role: actor.role,
      action: "TRADE_QUOTED",
      entity: "Trade",
      entityId: tradeId,
      ip: actor.ip || "127.0.0.1"
    }
  });
}
