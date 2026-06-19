import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Get agent dashboard statistics
 * GET /api/agent/dashboard/stats
 */
export async function getDashboardStats(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        // Get all trades for this agent (either handled by agent or performed by referred customers)
        const trades = await prisma.trade.findMany({
            where: {
                OR: [
                    { agentId },
                    { customer: { referringAgentId: agentId } }
                ]
            }
        });

        // Calculate trade stats
        const activeTrades = trades.filter(t =>
            !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(t.status)
        ).length;

        const completedTrades = trades.filter(t =>
            t.status === 'COMPLETED'
        ).length;

        // Get commissions for this agent
        const commissions = await prisma.commission.findMany({
            where: { agentId }
        });

        const totalCommissions = commissions.reduce((sum, c) =>
            sum + Number(c.amount), 0
        );

        const thisMonthStart = new Date();
        thisMonthStart.setDate(1);
        thisMonthStart.setHours(0, 0, 0, 0);

        const monthlyCommissions = commissions
            .filter(c => new Date(c.createdAt) >= thisMonthStart)
            .reduce((sum, c) => sum + Number(c.amount), 0);

        // Get pending documents count
        const pendingDocuments = await prisma.customer.count({
            where: { verified: false }
        });

        // --- Customer engagement stats ---
        // Customers referred by this agent via referral link
        const referredCustomerIds = await prisma.customer.findMany({
            where: { referringAgentId: agentId },
            select: { id: true },
        }).then(rows => rows.map(r => r.id));

        // Customers who have traded with this agent
        const tradeCustomerIds = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true },
            distinct: ["customerId"],
        }).then(rows => rows.map(r => r.customerId));

        const allCustomerIds = [...new Set([...referredCustomerIds, ...tradeCustomerIds])];
        const totalCustomers = allCustomerIds.length;
        const referredCustomers = referredCustomerIds.length;

        // Active customers = those who traded with this agent in the last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const activeCustomerIds = await prisma.trade.findMany({
            where: {
                OR: [
                    { agentId },
                    { customer: { referringAgentId: agentId } }
                ],
                createdAt: { gte: thirtyDaysAgo },
            },
            select: { customerId: true },
            distinct: ["customerId"],
        }).then(rows => rows.map(r => r.customerId));

        const activeCustomers = activeCustomerIds.length;

        res.json({
            activeTrades,
            completedTrades,
            totalCommissions: `₦${totalCommissions.toLocaleString()}`,
            monthlyCommissions: `₦${monthlyCommissions.toLocaleString()}`,
            pendingDocuments,
            totalTrades: trades.length,
            totalCustomers,
            activeCustomers,
            referredCustomers,
        });
    } catch (error) {
        console.error("Error fetching agent dashboard stats:", error);
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
}

/**
 * Get agent's trades
 * GET /api/agent/trades
 */
export async function getAgentTrades(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { status, limit = '50', page = '1' } = req.query;

        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const where: any = {
            OR: [
                { agentId },
                { customer: { referringAgentId: agentId } }
            ]
        };
        if (status && status !== 'All') {
            where.status = (status as string).toUpperCase();
        }

        const [trades, total] = await Promise.all([
            prisma.trade.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip
            }),
            prisma.trade.count({ where })
        ]);

        // Fetch customers in bulk
        const customerIds = [...new Set(trades.map(t => t.customerId).filter(Boolean))];
        const customers = await prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, fullName: true, email: true }
        });

        const customerMap: Record<string, string> = {};
        customers.forEach(c => {
            customerMap[c.id] = c.fullName || c.email || 'Customer';
        });

        // Format trades
        const formatted = trades.map(trade => {
            const customerName = customerMap[trade.customerId] || 'N/A';
            const dateObj = new Date(trade.createdAt);

            const statusMap: Record<string, string> = {
                COMPLETED: 'Completed',
                CANCELLED: 'Cancelled',
                AWAITING_PAYMENT: 'Pending',
                PAYMENT_CONFIRMED: 'In Progress',
                FLAGGED: 'Pending',
                UNDER_REVIEW: 'Pending',
                INITIATED: 'Pending',
                QUOTED: 'Pending',
                SENT_TO_CUSTOMER: 'Pending',
                CUSTOMER_CONFIRMED: 'Pending',
                CUSTOMER_VERIFIED: 'Pending',
                EXPIRED: 'Cancelled'
            };

            return {
                id: trade.id,
                tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
                date: dateObj.toLocaleDateString('en-GB'),
                time: dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                customer: customerName,
                transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
                amount: `₦${Number(trade.amount).toLocaleString()}`,
                status: statusMap[trade.status] || trade.status,
                verification: 'Verified'
            };
        });

        res.json({ trades: formatted, total, page: parseInt(page as string, 10), limit: take });
    } catch (error) {
        console.error("Error fetching agent trades:", error);
        res.status(500).json({ error: "Failed to fetch trades" });
    }
}

/**
 * Get single trade details
 * GET /api/agent/trades/:id
 */
export async function getAgentTrade(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { id } = req.params;

        const trade = await prisma.trade.findFirst({
            where: {
                id,
                OR: [
                    { agentId },
                    { customer: { referringAgentId: agentId } }
                ]
            }
        });

        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        // Get customer details
        const customer = await prisma.customer.findUnique({
            where: { id: trade.customerId }
        });

        res.json({
            ...trade,
            customerDetails: customer
        });
    } catch (error) {
        console.error("Error fetching trade:", error);
        res.status(500).json({ error: "Failed to fetch trade" });
    }
}

/**
 * Get commissions for current agent
 * GET /api/agent/commissions
 */
export async function getAgentCommissions(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const commissions = await prisma.commission.findMany({
            where: { agentId },
            include: {
                trade: {
                    select: {
                        id: true,
                        createdAt: true,
                        amount: true,
                        sendCurrency: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = commissions.map(c => ({
            id: c.id,
            reference: c.reference,
            date: c.createdAt.toLocaleDateString(),
            amount: `₦${Number(c.amount).toLocaleString()}`,
            status: c.status,
            tradeAmount: c.trade 
                ? `${Number(c.trade.amount).toLocaleString()} ${c.trade.sendCurrency}`
                : 'N/A',
            createdAt: c.createdAt
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching agent commissions:", error);
        res.status(500).json({ error: "Failed to fetch commissions" });
    }
}

/**
 * Get admin-configured FX rates (read-only view for agents)
 * GET /api/agent/fx-rates
 */
export async function getFxRatesForAgent(req: Request, res: Response) {
    try {
        const config = await prisma.systemConfig.findUnique({ where: { key: "fx_rates" } });
        const rates = config && Array.isArray(config.value) ? config.value : [];
        res.json(rates);
    } catch (error) {
        console.error("Error fetching FX rates for agent:", error);
        res.status(500).json({ error: "Failed to fetch FX rates" });
    }
}

/**
 * Get referral info for the logged-in agent
 * GET /api/agent/referral
 */
export async function getAgentReferral(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        const user = await prisma.user.findUnique({
            where: { id: agentId },
            include: { agentProfile: true }
        });

        if (!user || !user.agentProfile) {
            return res.status(404).json({ error: "Agent profile not found" });
        }

        // Referral code derived from licenseId (stable, readable)
        const referralCode = user.agentProfile.licenseId
            ? `REF-${user.agentProfile.licenseId}`
            : `REF-${agentId.slice(0, 8).toUpperCase()}`;

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const referralLink = `${frontendUrl}/customer-auth/signup?ref=${encodeURIComponent(referralCode)}`;

        // Fetch actual referred customers from DB
        const referredCustomers = await prisma.customer.findMany({
            where: { referringAgentId: agentId },
            orderBy: { createdAt: "desc" }
        });

        const totalReferred = referredCustomers.length;

        // Commission earned from referred customer trades
        const commissions = await prisma.commission.findMany({
            where: {
                agentId,
                trade: {
                    customer: { referringAgentId: agentId }
                }
            }
        });
        const commissionFromReferralsSum = commissions.reduce((sum, c) => sum + Number(c.amount), 0);

        const formattedCustomers = [];
        for (const customer of referredCustomers) {
            // Find all trades for this customer
            const trades = await prisma.trade.findMany({
                where: { customerId: customer.id }
            });
            const totalTrades = trades.length;

            // Total volume: sum of trade amounts
            const volume = trades.reduce((sum, t) => sum + Number(t.amount), 0);
            const totalVolume = `₦${volume.toLocaleString()}`;

            // Commission earned from this customer
            const customerCommissions = await prisma.commission.findMany({
                where: {
                    agentId,
                    trade: { customerId: customer.id }
                }
            });
            const commissionSum = customerCommissions.reduce((sum, c) => sum + Number(c.amount), 0);
            const commissionEarned = `₦${commissionSum.toLocaleString()}`;

            // Get last trade date
            const lastTradeDate = trades.length > 0 
                ? trades.reduce((max, t) => t.createdAt > max ? t.createdAt : max, trades[0].createdAt)
                : null;

            // Activity status
            let status = "Dormant";
            if (lastTradeDate) {
                const days = Math.floor((Date.now() - lastTradeDate.getTime()) / (1000 * 60 * 60 * 24));
                if (days <= 30) status = "Active";
                else if (days <= 90) status = "Inactive";
            }

            formattedCustomers.push({
                id: customer.id,
                name: customer.fullName,
                email: customer.email || "N/A",
                joinedDate: customer.createdAt.toISOString(),
                totalTrades,
                totalVolume,
                commissionEarned,
                status
            });
        }

        res.json({
            referralCode,
            referralLink,
            totalReferred,
            commissionFromReferrals: `₦${commissionFromReferralsSum.toLocaleString()}`,
            referredCustomers: formattedCustomers,
        });
    } catch (error) {
        console.error("Error fetching agent referral info:", error);
        res.status(500).json({ error: "Failed to fetch referral info" });
    }
}
