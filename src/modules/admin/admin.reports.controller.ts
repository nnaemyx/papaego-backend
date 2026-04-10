import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * GET /admin/reports/productivity
 * Agent productivity metrics
 */
export async function getProductivityReport(req: Request, res: Response) {
    try {
        const { startDate, endDate, agentId } = req.query;

        const dateFilter: any = {};
        if (startDate) dateFilter.gte = new Date(startDate as string);
        if (endDate) dateFilter.lte = new Date(endDate as string);
        const hasDateFilter = Object.keys(dateFilter).length > 0;

        // Get all agents
        const agents = await prisma.user.findMany({
            where: {
                role: "AGENT",
                ...(agentId ? { id: agentId as string } : {}),
            },
            include: { agentProfile: true },
        });

        const result = await Promise.all(agents.map(async (agent) => {
            const tradeWhere: any = { agentId: agent.id };
            if (hasDateFilter) tradeWhere.createdAt = dateFilter;

            const [trades, commissions, customerCount] = await Promise.all([
                prisma.trade.findMany({ where: tradeWhere, select: { amount: true } }),
                prisma.commission.findMany({ where: { agentId: agent.id, ...(hasDateFilter ? { createdAt: dateFilter } : {}) } }),
                prisma.customer.count({ where: { userId: agent.id } }),
            ]);

            const totalVolume = trades.reduce((s, t) => s + Number(t.amount), 0);
            const totalCommission = commissions.reduce((s, c) => s + Number(c.amount), 0);

            return {
                agentId: `#PE-${agent.id.slice(0, 5).toUpperCase()}`,
                agentName: agent.firstName && agent.lastName ? `${agent.firstName} ${agent.lastName}` : agent.email?.split("@")[0] || "Unknown",
                email: agent.email || "",
                region: agent.agentProfile?.region || "N/A",
                customersOnboarded: customerCount,
                transactionCount: trades.length,
                transactionVolume: totalVolume,
                commissionEarned: `₦${totalCommission.toLocaleString()}`,
                status: agent.isActive ? "Active" : "Inactive",
            };
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching productivity report:", error);
        res.status(500).json({ error: "Failed to fetch productivity report" });
    }
}

/**
 * GET /admin/reports/kya
 * Know Your Agents report
 */
export async function getKYAReport(req: Request, res: Response) {
    try {
        const { region, status } = req.query;

        const agents = await prisma.user.findMany({
            where: {
                role: "AGENT",
                ...(status === "Active" ? { isActive: true } : status === "Inactive" ? { isActive: false } : {}),
            },
            include: { agentProfile: true },
        });

        const result = await Promise.all(agents.map(async (agent) => {
            const ap = agent.agentProfile;
            if (region && ap?.region !== region) return null;

            const activeTrades = await prisma.trade.count({
                where: { agentId: agent.id, status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] } },
            });

            return {
                agentId: `#PE-${agent.id.slice(0, 5).toUpperCase()}`,
                agentName: agent.firstName && agent.lastName ? `${agent.firstName} ${agent.lastName}` : agent.email?.split("@")[0] || "Unknown",
                email: agent.email || "",
                phone: agent.phone || "N/A",
                region: ap?.region || "N/A",
                licenseId: ap?.licenseId || "N/A",
                kycStatus: ap?.governmentIdUrl && ap?.proofOfAddressUrl ? "Verified" : "Pending",
                onboardingStatus: ap?.onboardingStatus || "PENDING",
                activeTrades,
                joinedDate: agent.createdAt.toLocaleDateString("en-GB"),
                status: agent.isActive ? "Active" : "Inactive",
            };
        }));

        res.json(result.filter(Boolean));
    } catch (error) {
        console.error("Error fetching KYA report:", error);
        res.status(500).json({ error: "Failed to fetch KYA report" });
    }
}

/**
 * GET /admin/reports/oversight
 * Aged/overdue transactions
 */
export async function getOversightReport(req: Request, res: Response) {
    try {
        const { startDate, endDate } = req.query;

        const where: any = {
            status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] },
        };
        if (startDate) where.createdAt = { gte: new Date(startDate as string) };

        const trades = await prisma.trade.findMany({
            where,
            orderBy: { createdAt: "asc" },
            take: 200,
        });

        const agentIds = [...new Set(trades.map(t => t.agentId))];
        const customerIds = [...new Set(trades.map(t => t.customerId))];

        const [agentUsers, customers] = await Promise.all([
            prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, firstName: true, lastName: true, email: true } }),
            prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, fullName: true, email: true } }),
        ]);

        const agentMap: Record<string, string> = {};
        agentUsers.forEach(u => { agentMap[u.id] = u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email?.split("@")[0] || "Agent"; });
        const customerMap: Record<string, string> = {};
        customers.forEach(c => { customerMap[c.id] = c.fullName || c.email || "Customer"; });

        const now = Date.now();
        const OVERDUE_HOURS = 24;

        const result = trades
            .filter(t => {
                if (endDate && new Date(t.createdAt) > new Date(endDate as string)) return false;
                return true;
            })
            .map(trade => {
                const ageMs = now - new Date(trade.createdAt).getTime();
                const ageInHours = ageMs / 3_600_000;
                const ageInDays = Math.floor(ageMs / 86_400_000);
                return {
                    tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
                    customer: customerMap[trade.customerId] || "N/A",
                    agent: agentMap[trade.agentId] || "N/A",
                    amount: `₦${Number(trade.amount).toLocaleString()}`,
                    currency: trade.sendCurrency,
                    status: trade.status,
                    createdAt: trade.createdAt.toLocaleDateString("en-GB"),
                    ageInDays,
                    isOverdue: ageInHours > OVERDUE_HOURS,
                    lastUpdate: trade.createdAt.toLocaleString("en-NG"),
                };
            });

        res.json(result);
    } catch (error) {
        console.error("Error fetching oversight report:", error);
        res.status(500).json({ error: "Failed to fetch oversight report" });
    }
}

/**
 * GET /admin/reports/corridors
 * FX pair corridor distribution
 */
export async function getCorridorReport(req: Request, res: Response) {
    try {
        const { startDate, endDate } = req.query;

        const where: any = {};
        if (startDate) where.createdAt = { ...(where.createdAt ?? {}), gte: new Date(startDate as string) };
        if (endDate) where.createdAt = { ...(where.createdAt ?? {}), lte: new Date(endDate as string) };

        const trades = await prisma.trade.findMany({
            where,
            select: { sendCurrency: true, receiveCurrency: true, amount: true, createdAt: true },
        });

        // Aggregate by corridor
        const corridorMap: Record<string, { count: number; volume: number; lastTrade: Date }> = {};
        trades.forEach(t => {
            const key = `${t.sendCurrency}/${t.receiveCurrency}`;
            if (!corridorMap[key]) corridorMap[key] = { count: 0, volume: 0, lastTrade: t.createdAt };
            corridorMap[key].count += 1;
            corridorMap[key].volume += Number(t.amount);
            if (t.createdAt > corridorMap[key].lastTrade) corridorMap[key].lastTrade = t.createdAt;
        });

        const totalTrades = trades.length || 1;
        const result = Object.entries(corridorMap).map(([corridor, data]) => {
            const [sendCurrency, receiveCurrency] = corridor.split("/");
            return {
                corridor,
                sendCurrency: sendCurrency ?? corridor,
                receiveCurrency: receiveCurrency ?? "NGN",
                totalCount: data.count,
                totalVolume: data.volume,
                percentShare: Math.round((data.count / totalTrades) * 100),
                avgAmount: Math.round(data.volume / data.count),
                lastTrade: data.lastTrade.toLocaleDateString("en-GB"),
            };
        }).sort((a, b) => b.totalCount - a.totalCount);

        res.json(result);
    } catch (error) {
        console.error("Error fetching corridor report:", error);
        res.status(500).json({ error: "Failed to fetch corridor report" });
    }
}

/**
 * GET /admin/reports/export
 * CSV export for any report type
 */
export async function exportReport(req: Request, res: Response) {
    try {
        const { type, startDate, endDate, agentId } = req.query;
        const filters = { startDate, endDate, agentId } as any;

        let rows: string[][] = [];
        let filename = "report";

        if (type === "productivity") {
            const fakeReq = { query: filters } as any;
            const fakeRes = {
                json: (data: any[]) => {
                    rows = [
                        ["Agent", "Email", "Region", "Customers", "Transactions", "Volume", "Commission", "Status"],
                        ...data.map(r => [r.agentName, r.email, r.region, r.customersOnboarded, r.transactionCount, r.transactionVolume, r.commissionEarned, r.status]),
                    ].map(r => r.map(String));
                    filename = "productivity-report";
                },
                status: () => fakeRes,
            } as any;
            await getProductivityReport(fakeReq, fakeRes);
        } else if (type === "kya") {
            rows = [["AgentID", "Name", "Email", "Phone", "Region", "LicenseID", "KYC", "Onboarding", "ActiveTrades", "Status"]];
            filename = "kya-report";
        } else if (type === "oversight") {
            rows = [["TradeID", "Customer", "Agent", "Amount", "Currency", "Status", "CreatedAt", "AgeDays", "Overdue"]];
            filename = "oversight-report";
        } else if (type === "corridors") {
            rows = [["Corridor", "Count", "Volume", "PercentShare", "AvgAmount", "LastTrade"]];
            filename = "corridor-report";
        }

        const csv = rows.map(r => r.join(",")).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
        res.send(csv);
    } catch (error) {
        console.error("Error exporting report:", error);
        res.status(500).json({ error: "Failed to export report" });
    }
}
