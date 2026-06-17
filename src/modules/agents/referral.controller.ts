import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * GET /api/agent/referral-link
 * Returns the agent's unique referral URL and code.
 */
export async function getAgentReferralLink(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        const agentProfile = await prisma.agentProfile.findUnique({
            where: { userId: agentId },
        });

        if (!agentProfile) {
            return res.status(404).json({ error: "Agent profile not found" });
        }

        if (!agentProfile.referralCode) {
            return res.status(404).json({ error: "No referral code assigned. Contact admin." });
        }

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const referralLink = `${frontendUrl}/customer-auth/signup?ref=${agentProfile.referralCode}`;

        res.json({
            referralCode: agentProfile.referralCode,
            referralLink,
        });
    } catch (error) {
        console.error("Error fetching referral link:", error);
        res.status(500).json({ error: "Failed to fetch referral link" });
    }
}

/**
 * GET /api/agent/referrals
 * List all customers referred by this agent.
 */
export async function getAgentReferrals(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        const referredCustomers = await prisma.customer.findMany({
            where: { referringAgentId: agentId },
            orderBy: { createdAt: "desc" },
            include: {
                user: {
                    select: {
                        email: true,
                        firstName: true,
                        lastName: true,
                        createdAt: true,
                    },
                },
            },
        });

        // Get trade counts for referred customers
        const customerIds = referredCustomers.map((c) => c.id);
        const tradeCounts = await prisma.trade.groupBy({
            by: ["customerId"],
            _count: { id: true },
            where: { customerId: { in: customerIds } },
        });

        const tradeCountMap: Record<string, number> = {};
        tradeCounts.forEach((tc) => {
            tradeCountMap[tc.customerId] = tc._count.id;
        });

        const formatted = referredCustomers.map((c) => ({
            id: c.id,
            customerId: `#CUS-${c.id.slice(0, 5).toUpperCase()}`,
            name: c.fullName,
            email: c.email || c.user?.email || "N/A",
            phone: c.phone || "N/A",
            joinDate: c.createdAt.toLocaleDateString("en-GB"),
            totalTrades: tradeCountMap[c.id] || 0,
            verified: c.verified,
            referralType: c.referralType || "AGENT",
        }));

        res.json({
            totalReferrals: formatted.length,
            referrals: formatted,
        });
    } catch (error) {
        console.error("Error fetching referrals:", error);
        res.status(500).json({ error: "Failed to fetch referrals" });
    }
}
