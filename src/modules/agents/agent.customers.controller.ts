import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Get all customers connected to the agent
 * GET /api/agent/customers
 */
export async function getAgentCustomers(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { search, status, type, activity, dateJoined } = req.query;

        // 1. Find all trades for this agent to get their customers
        const trades = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true, createdAt: true }
        });

        if (trades.length === 0) {
            return res.json([]);
        }

        const customerIds = [...new Set(trades.map(t => t.customerId))];

        // 2. Fetch customers
        const where: any = {
            id: { in: customerIds }
        };

        if (search) {
            where.OR = [
                { fullName: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
                { bvn: { contains: search as string } }
            ];
        }

        if (status && status !== 'All') {
            if (status === 'Verified') where.verified = true;
            if (status === 'Pending' || status === 'Failed') where.verified = false;
        }

        if (dateJoined) {
            const dateStr = dateJoined as string;
            if (dateStr === 'today') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                where.createdAt = { gte: today };
            } else if (dateStr === 'thisWeek') {
                const weekStr = new Date();
                weekStr.setDate(weekStr.getDate() - 7);
                where.createdAt = { gte: weekStr };
            }
        }

        const customers = await prisma.customer.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        // Calculate metadata (trades count, volume) per customer to match frontend UI requirements
        const customerTradesMap = trades.reduce((acc, trade) => {
            if (!acc[trade.customerId]) acc[trade.customerId] = 0;
            acc[trade.customerId]++;
            return acc;
        }, {} as Record<string, number>);

        const formatted = customers.map(c => {
            return {
                id: c.id,
                customerId: `#CUS-${c.id.slice(0, 5).toUpperCase()}`,
                name: c.fullName,
                email: c.email || 'N/A',
                phone: c.phone || 'N/A',
                joinDate: new Date(c.createdAt).toLocaleDateString('en-GB'),
                totalTrades: customerTradesMap[c.id] || 0,
                totalVolume: '$0', // Requires summing amounts if needed
                verificationStatus: c.verified ? 'Verified' : 'Pending',
                customerType: 'Individual', // Add enum if needed in DB
                lastActive: new Date(c.createdAt).toLocaleDateString('en-GB'), // Use latest trade date
                riskLevel: 'Low',
                notes: []
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching agent customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
}

/**
 * Get single customer details
 * GET /api/agent/customers/:id
 */
export async function getAgentCustomer(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const agentId = (req as any).user.id;

        // Verify the customer belongs to the agent
        const tradeExists = await prisma.trade.findFirst({
            where: { customerId: id, agentId }
        });

        if (!tradeExists) {
            return res.status(403).json({ error: "Access denied or customer not found" });
        }

        const customer = await prisma.customer.findUnique({
            where: { id }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        const tradesCount = await prisma.trade.count({
            where: { customerId: id, agentId }
        });

        const formatted = {
            id: customer.id,
            customerId: `#CUS-${customer.id.slice(0, 5).toUpperCase()}`,
            name: customer.fullName,
            email: customer.email || 'N/A',
            phone: customer.phone || 'N/A',
            joinDate: new Date(customer.createdAt).toLocaleDateString('en-GB'),
            totalTrades: tradesCount,
            totalVolume: '$0',
            verificationStatus: customer.verified ? 'Verified' : 'Pending',
            customerType: 'Individual',
            lastActive: new Date(customer.createdAt).toLocaleDateString('en-GB'),
            riskLevel: 'Low',
            notes: []
        };

        res.json(formatted);

    } catch (error) {
        console.error("Error fetching customer details:", error);
        res.status(500).json({ error: "Failed to fetch customer details" });
    }
}

/**
 * Get stats for agent customers
 * GET /api/agent/customers/stats
 */
export async function getAgentCustomerStats(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        const trades = await prisma.trade.findMany({
            where: { agentId },
            select: { customerId: true, createdAt: true }
        });

        const customerIds = [...new Set(trades.map(t => t.customerId))];

        if (customerIds.length === 0) {
            return res.json({
                totalCustomers: 0,
                verifiedCustomers: 0,
                highValueCustomers: 0,
                activeCustomersToday: 0
            });
        }

        const customers = await prisma.customer.findMany({
            where: { id: { in: customerIds } }
        });

        const verifiedCustomers = customers.filter(c => c.verified).length;

        // Active today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeToday = trades.filter(t => new Date(t.createdAt) >= today).map(t => t.customerId);
        const uniqueActiveToday = new Set(activeToday).size;

        res.json({
            totalCustomers: customers.length,
            verifiedCustomers,
            highValueCustomers: 0, // Implement high value logic if trade amounts are queried
            activeCustomersToday: uniqueActiveToday
        });

    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
}
