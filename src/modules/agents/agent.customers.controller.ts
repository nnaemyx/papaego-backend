import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Classify a customer's activity status based on their last trade date.
 * Active: 0–30 days since last trade
 * Inactive: 31–90 days since last trade
 * Dormant: 90+ days since last trade (or never traded)
 */
function classifyActivityStatus(lastTradeDate: Date | null): string {
    if (!lastTradeDate) return "Dormant";

    const daysSinceLast = Math.floor(
        (Date.now() - lastTradeDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLast <= 30) return "Active";
    if (daysSinceLast <= 90) return "Inactive";
    return "Dormant";
}

/**
 * Compute a human-readable "time ago" string from a date.
 */
function timeAgo(date: Date | null): string {
    if (!date) return "Never";

    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
    if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
    return `${Math.floor(diffMonths / 12)} year${Math.floor(diffMonths / 12) === 1 ? "" : "s"} ago`;
}

/**
 * Get all customers assigned to the agent.
 * Scoped: Agents only see customers who:
 *   1. Were referred by this agent (referringAgentId)
 *   2. Have trades assigned to this agent
 * 
 * Data restrictions:
 *   - Transaction COUNT visible (not amounts)
 *   - Last transaction date with relative time
 *   - Activity status classification
 * 
 * GET /api/agent/customers
 */
export async function getAgentCustomers(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { search, status, activity, dateJoined } = req.query;

        // Step 1: Get customer IDs scoped to this agent
        // Customers who were referred by this agent
        const referredCustomerIds = await prisma.customer.findMany({
            where: { referringAgentId: agentId },
            select: { id: true },
        }).then(rows => rows.map(r => r.id));

        // Customers who have trades with this agent
        const tradeCustomerIds = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true },
            distinct: ["customerId"],
        }).then(rows => rows.map(r => r.customerId));

        // Merge unique customer IDs
        const allCustomerIds = [...new Set([...referredCustomerIds, ...tradeCustomerIds])];

        if (allCustomerIds.length === 0) {
            return res.json([]);
        }

        // Step 2: Build query filters
        const where: any = {
            id: { in: allCustomerIds },
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
            if (status === "Pending" || status === "Failed") where.AND.push({ verified: false });
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

        // Step 3: Fetch customers
        const customers = await prisma.customer.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });

        // Step 4: Get trade counts (NOT amounts) and last trade dates per customer
        const customerIds = customers.map(c => c.id);

        const tradeCounts = await prisma.trade.groupBy({
            by: ["customerId"],
            _count: { id: true },
            _max: { createdAt: true },
            where: {
                customerId: { in: customerIds },
                agentId, // Only count trades with THIS agent
            },
        });

        const tradeCountMap: Record<string, number> = {};
        const lastTradeDateMap: Record<string, Date | null> = {};

        tradeCounts.forEach((tc) => {
            tradeCountMap[tc.customerId] = tc._count.id;
            lastTradeDateMap[tc.customerId] = tc._max.createdAt;
        });

        // Step 5: Format response — NO amounts, only counts
        let formatted = customers.map((c) => {
            const lastTradeDate = lastTradeDateMap[c.id] || null;
            const activityStatus = classifyActivityStatus(lastTradeDate);

            return {
                id: c.id,
                customerId: `#CUS-${c.id.slice(0, 5).toUpperCase()}`,
                name: c.fullName,
                email: c.email || "N/A",
                phone: c.phone || "N/A",
                joinDate: new Date(c.createdAt).toLocaleDateString("en-GB"),
                totalTrades: tradeCountMap[c.id] || 0,
                // NO totalVolume — agents cannot see transaction amounts
                verificationStatus: c.verified ? "Verified" : "Pending",
                customerType: "Individual",
                lastActive: timeAgo(lastTradeDate),
                lastTransactionAt: lastTradeDate?.toISOString() || null,
                activityStatus, // Active | Inactive | Dormant
                riskLevel: "Low",
                referredByThisAgent: c.referringAgentId === agentId,
                notes: [],
            };
        });

        // Filter by activity status if requested
        if (activity && activity !== "All") {
            formatted = formatted.filter(c => c.activityStatus === activity);
        }

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching agent customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
}

/**
 * Get single customer details (scoped to agent's customers).
 * GET /api/agent/customers/:id
 */
export async function getAgentCustomer(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { id } = req.params;

        // Verify this customer belongs to the agent
        const isReferredCustomer = await prisma.customer.findFirst({
            where: { id, referringAgentId: agentId },
        });

        const hasTradeWithAgent = await prisma.trade.findFirst({
            where: { customerId: id, agentId },
        });

        if (!isReferredCustomer && !hasTradeWithAgent) {
            return res.status(403).json({ error: "You do not have access to this customer" });
        }

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: { bankDetails: true },
        });
        if (!customer) return res.status(404).json({ error: "Customer not found" });

        // Only count trades with this agent
        const tradesCount = await prisma.trade.count({
            where: { customerId: id, agentId },
        });

        // Get last trade date
        const lastTrade = await prisma.trade.findFirst({
            where: { customerId: id, agentId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        });

        const lastTradeDate = lastTrade?.createdAt || null;

        // Get recent trades — count only, no amounts
        const recentTrades = await prisma.trade.findMany({
            where: { customerId: customer.id, agentId },
            take: 5,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                status: true,
                sendCurrency: true,
                receiveCurrency: true,
                createdAt: true,
                // Deliberately excluding: amount, fxRate, payoutAmount
            },
        });

        const formatted = {
            id: customer.id,
            customerId: `#CUS-${customer.id.slice(0, 5).toUpperCase()}`,
            name: customer.fullName,
            email: customer.email || "N/A",
            phone: customer.phone || "N/A",
            dateJoined: customer.createdAt.toISOString(),
            joinDate: new Date(customer.createdAt).toLocaleDateString("en-GB"),
            totalTransactions: tradesCount,
            totalTrades: tradesCount,
            activityLevel: tradesCount > 10 ? "High" : tradesCount > 4 ? "Medium" : "Low",
            activityStatus: classifyActivityStatus(lastTradeDate),
            lastActive: timeAgo(lastTradeDate),
            lastTransactionAt: lastTradeDate?.toISOString() || null,
            recentTrades,
            verificationStatus: customer.verified ? "Verified" : "Pending",
            customerType: "Individual",
            riskLevel: "Low",
            referredByThisAgent: customer.referringAgentId === agentId,
            bankDetails: customer.bankDetails,
            notes: [],
        };

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching customer details:", error);
        res.status(500).json({ error: "Failed to fetch customer details" });
    }
}

/**
 * Get stats for agent's customers only (scoped, not global).
 * GET /api/agent/customers/stats
 */
export async function getAgentCustomerStats(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        // Get customer IDs scoped to this agent
        const referredCustomerIds = await prisma.customer.findMany({
            where: { referringAgentId: agentId },
            select: { id: true },
        }).then(rows => rows.map(r => r.id));

        const tradeCustomerIds = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true },
            distinct: ["customerId"],
        }).then(rows => rows.map(r => r.customerId));

        const allCustomerIds = [...new Set([...referredCustomerIds, ...tradeCustomerIds])];

        const [totalCustomers, verifiedCustomers] = await Promise.all([
            prisma.customer.count({ where: { id: { in: allCustomerIds } } }),
            prisma.customer.count({ where: { id: { in: allCustomerIds }, verified: true } }),
        ]);

        // Active today: customers with trades today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const activeTodayCount = await prisma.trade.groupBy({
            by: ["customerId"],
            where: {
                agentId,
                createdAt: { gte: today },
            },
        }).then(rows => rows.length);

        // Classify customers by activity
        const tradeDates = await prisma.trade.groupBy({
            by: ["customerId"],
            _max: { createdAt: true },
            where: {
                customerId: { in: allCustomerIds },
                agentId,
            },
        });

        let activeCount = 0;
        let inactiveCount = 0;
        let dormantCount = 0;

        tradeDates.forEach(td => {
            const status = classifyActivityStatus(td._max.createdAt);
            if (status === "Active") activeCount++;
            else if (status === "Inactive") inactiveCount++;
            else dormantCount++;
        });

        // Customers with no trades are Dormant
        const customersWithTrades = new Set(tradeDates.map(td => td.customerId));
        const customersWithoutTrades = allCustomerIds.filter(id => !customersWithTrades.has(id));
        dormantCount += customersWithoutTrades.length;

        res.json({
            totalCustomers,
            verifiedCustomers,
            activeCustomersToday: activeTodayCount,
            activityBreakdown: {
                active: activeCount,
                inactive: inactiveCount,
                dormant: dormantCount,
            },
        });
    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
}
