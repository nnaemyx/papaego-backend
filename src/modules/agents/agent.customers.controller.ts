import { Request, Response } from "express";
import prisma from "../../config/db";

/** Compute last-transaction date label and activity status bucket */
function getActivityStatus(lastTradedAt: Date | null): {
    lastTransactionAt: string | null;
    lastTransactionAgo: string;
    activityStatus: "Active" | "Inactive" | "Dormant";
} {
    if (!lastTradedAt) {
        return {
            lastTransactionAt: null,
            lastTransactionAgo: "Never",
            activityStatus: "Dormant",
        };
    }

    const now = Date.now();
    const diff = now - lastTradedAt.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    let lastTransactionAgo: string;
    if (days === 0) lastTransactionAgo = "Today";
    else if (days === 1) lastTransactionAgo = "Yesterday";
    else if (days < 7) lastTransactionAgo = `${days} days ago`;
    else if (days < 30) lastTransactionAgo = `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
    else lastTransactionAgo = `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;

    let activityStatus: "Active" | "Inactive" | "Dormant";
    if (days <= 30) activityStatus = "Active";
    else if (days <= 90) activityStatus = "Inactive";
    else activityStatus = "Dormant";

    return {
        lastTransactionAt: lastTradedAt.toISOString(),
        lastTransactionAgo,
        activityStatus,
    };
}

/**
 * Get customers referred by (or traded with) this agent.
 * Scope: customers whose referringAgentId === agentId OR who have trades with this agent.
 * GET /api/agent/customers
 */
export async function getAgentCustomers(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { search, status, activity, dateJoined } = req.query;

        // Customers linked to this agent via referral OR trades
        const tradeCustomerIds = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true },
            distinct: ["customerId"],
        });
        const tradeIds = tradeCustomerIds.map((t) => t.customerId);

        const where: any = {
            OR: [
                { referringAgentId: agentId },
                { id: { in: tradeIds } },
            ],
        };

        if (search) {
            where.AND = [
                {
                    OR: [
                        { fullName: { contains: search as string, mode: "insensitive" } },
                        { email: { contains: search as string, mode: "insensitive" } },
                        { bvn: { contains: search as string } },
                    ],
                },
            ];
        }

        if (status && status !== "All") {
            if (!where.AND) where.AND = [];
            if (status === "Verified") where.AND.push({ verified: true });
            if (status === "Pending") where.AND.push({ verified: false });
        }

        if (dateJoined) {
            const dateStr = dateJoined as string;
            const cutoff = new Date();
            if (dateStr === "today") cutoff.setHours(0, 0, 0, 0);
            else if (dateStr === "thisWeek") cutoff.setDate(cutoff.getDate() - 7);
            else if (dateStr === "thisMonth") cutoff.setDate(cutoff.getDate() - 30);
            if (!where.AND) where.AND = [];
            where.AND.push({ createdAt: { gte: cutoff } });
        }

        const customers = await prisma.customer.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });

        // Fetch last trade date per customer in bulk
        const customerIds = customers.map((c) => c.id);
        const lastTrades = await prisma.trade.findMany({
            where: { customerId: { in: customerIds } },
            orderBy: { createdAt: "desc" },
            select: { customerId: true, createdAt: true },
        });

        // Build: customerId -> { count, latestDate }
        const tradeStats: Record<string, { count: number; latestDate: Date | null }> = {};
        for (const t of lastTrades) {
            if (!tradeStats[t.customerId]) {
                tradeStats[t.customerId] = { count: 0, latestDate: null };
            }
            tradeStats[t.customerId].count++;
            if (!tradeStats[t.customerId].latestDate || t.createdAt > tradeStats[t.customerId].latestDate!) {
                tradeStats[t.customerId].latestDate = t.createdAt;
            }
        }

        let formatted = customers.map((c) => {
            const stats = tradeStats[c.id] || { count: 0, latestDate: null };
            const activity = getActivityStatus(stats.latestDate);
            return {
                id: c.id,
                customerId: `#CUS-${c.id.slice(0, 5).toUpperCase()}`,
                name: c.fullName,
                email: c.email || "N/A",
                phone: c.phone || "N/A",
                joinDate: new Date(c.createdAt).toLocaleDateString("en-GB"),
                totalTrades: stats.count,
                verificationStatus: c.verified ? "Verified" : "Pending",
                customerType: "Individual",
                ...activity,
                riskLevel: "Low",
                referredByThisAgent: c.referringAgentId === agentId,
                notes: [],
            };
        });

        // Apply activity filter after formatting (client-friendly)
        if (activity && activity !== "All") {
            formatted = formatted.filter((c) => c.activityStatus === activity);
        }

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching agent customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
}

/**
 * Get single customer details (scoped to agent)
 * GET /api/agent/customers/:id
 */
export async function getAgentCustomer(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { id } = req.params;

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: { bankDetails: true },
        });
        if (!customer) return res.status(404).json({ error: "Customer not found" });

        const trades = await prisma.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: "desc" },
            take: 5,
        });

        const lastTrade = trades[0] ?? null;
        const activity = getActivityStatus(lastTrade ? new Date(lastTrade.createdAt) : null);

        const safeTrades = trades.map((t) => ({
            id: t.id,
            sendCurrency: t.sendCurrency,
            receiveCurrency: t.receiveCurrency,
            status: t.status,
            createdAt: t.createdAt.toISOString(),
        }));

        res.json({
            id: customer.id,
            customerId: `#CUS-${customer.id.slice(0, 5).toUpperCase()}`,
            name: customer.fullName,
            email: customer.email || "N/A",
            phone: customer.phone || "N/A",
            dateJoined: customer.createdAt.toISOString(),
            joinDate: new Date(customer.createdAt).toLocaleDateString("en-GB"),
            totalTransactions: trades.length,
            totalTrades: trades.length,
            recentTrades: safeTrades,
            verificationStatus: customer.verified ? "Verified" : "Pending",
            customerType: "Individual",
            ...activity,
            riskLevel: "Low",
            referredByThisAgent: customer.referringAgentId === agentId,
            bankDetails: customer.bankDetails,
            notes: [],
        });
    } catch (error) {
        console.error("Error fetching customer details:", error);
        res.status(500).json({ error: "Failed to fetch customer details" });
    }
}

/**
 * Get stats for agent's scoped customers
 * GET /api/agent/customers/stats
 */
export async function getAgentCustomerStats(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        // Customers linked to this agent
        const tradeCustomerIds = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true },
            distinct: ["customerId"],
        });
        const tradeIds = tradeCustomerIds.map((t) => t.customerId);

        const customerIds = await prisma.customer.findMany({
            where: {
                OR: [{ referringAgentId: agentId }, { id: { in: tradeIds } }],
            },
            select: { id: true, verified: true },
        });

        const totalCustomers = customerIds.length;
        const verifiedCustomers = customerIds.filter((c) => c.verified).length;

        // Activity buckets
        const ids = customerIds.map((c) => c.id);
        const lastTrades = await prisma.trade.findMany({
            where: { customerId: { in: ids } },
            orderBy: { createdAt: "desc" },
            select: { customerId: true, createdAt: true },
        });

        const latestByCustomer: Record<string, Date> = {};
        for (const t of lastTrades) {
            if (!latestByCustomer[t.customerId]) latestByCustomer[t.customerId] = t.createdAt;
        }

        let active = 0, inactive = 0, dormant = 0;
        for (const c of customerIds) {
            const last = latestByCustomer[c.id] || null;
            const { activityStatus } = getActivityStatus(last);
            if (activityStatus === "Active") active++;
            else if (activityStatus === "Inactive") inactive++;
            else dormant++;
        }

        res.json({
            totalCustomers,
            verifiedCustomers,
            activeCustomers: active,
            inactiveCustomers: inactive,
            dormantCustomers: dormant,
        });
    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
}
