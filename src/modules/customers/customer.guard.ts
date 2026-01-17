import prisma from "../../config/db";

export async function assertCustomerTradeAccess(customerId: string, tradeId: string) {
    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });

    if (!trade || trade.customerId !== customerId) {
        throw new Error("Forbidden");
    }

    return trade;
}
