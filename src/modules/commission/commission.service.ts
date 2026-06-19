import prisma from "../../config/db";

const DEFAULT_COMMISSION_RATE = 2.5; // 2.5%

export async function triggerTradeCommission(tradeId: string) {
    try {
        const trade = await prisma.trade.findUnique({
            where: { id: tradeId },
            include: { agent: { include: { agentProfile: true } } }
        });

        if (!trade || trade.status !== "COMPLETED") {
            return;
        }

        // Resolve agent to credit: prioritize customer's referring agent, fallback to trade's executing agent
        const customer = await prisma.customer.findUnique({
            where: { id: trade.customerId },
            select: { referringAgentId: true }
        });

        const targetAgentId = customer?.referringAgentId || trade.agentId;
        if (!targetAgentId) {
            return;
        }

        // Verify that targetAgentId is actually an AGENT, not an ADMIN or other role
        const agentUser = await prisma.user.findUnique({
            where: { id: targetAgentId },
            select: { role: true }
        });

        if (!agentUser || agentUser.role !== "AGENT") {
            // Do not generate commission for admin/compliance
            return;
        }

        // Check if commission already exists for this trade
        const existingCommission = await prisma.commission.findFirst({
            where: { tradeId }
        });

        if (existingCommission) {
            return; // Already processed
        }

        // Calculate amount
        const amountNum = Number(trade.amount);
        if (isNaN(amountNum) || amountNum <= 0) return;

        const commissionAmount = (amountNum * DEFAULT_COMMISSION_RATE) / 100;
        const reference = `COM-${trade.id.slice(0, 5).toUpperCase()}-${Date.now().toString().slice(-4)}`;

        const commission = await prisma.commission.create({
            data: {
                reference,
                agentId: targetAgentId,
                tradeId: trade.id,
                type: "TRANSACTION",
                amount: commissionAmount,
                currency: trade.sendCurrency,
                rate: DEFAULT_COMMISSION_RATE,
                status: "PENDING"
            }
        });

        await prisma.commissionActivity.create({
            data: {
                commissionId: commission.id,
                action: "SYSTEM_GENERATED",
                description: `Auto-generated ${DEFAULT_COMMISSION_RATE}% commission for trade ${trade.id.slice(0, 8)}`
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: "SYSTEM",
                role: "ADMIN",
                action: "COMMISSION_GENERATED",
                entity: "Commission",
                entityId: commission.id,
                ip: "127.0.0.1"
            }
        });

        console.log(`Generated commission ${reference} for trade ${tradeId}`);
        return commission;
    } catch (error) {
        console.error("Failed to generate trade commission:", error);
    }
}
