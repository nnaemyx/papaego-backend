import { Request, Response } from "express";
import { updateTradeStatus } from "./trade.service";

export async function quoteTrade(req: Request, res: Response) {
  const { tradeId } = req.params;

  await updateTradeStatus(tradeId, "QUOTED", (req as any).user);

  res.json({ success: true });
}
