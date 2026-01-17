import prisma from "../../config/db";
import { LargeAmountRule } from "./rules/largeAmount";

const rules = [new LargeAmountRule()];

export async function scanTrade(tradeId: string) {
    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });

    if (!trade) return;

    for (const rule of rules) {
        if (rule.evaluate(trade)) {
            await prisma.complianceFlag.create({
                data: {
                    tradeId,
                    reason: rule.code,
                    severity: "HIGH"
                }
            });

            await prisma.trade.update({
                where: { id: tradeId },
                data: { status: "FLAGGED" }
            });
        }
    }
}
