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

        // 1. Fetch all customers with optional filters
        const where: any = {};

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

        // Calculate statistics per customer
        const customerTrades = await prisma.trade.findMany({
            where: { customerId: { in: customers.map(c => c.id) } },
            select: { customerId: true }
        });

        const customerTradesMap = customerTrades.reduce((acc, trade) => {
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
        // Agents can now view any customer in the system to facilitate trade initiation

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: { bankDetails: true }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        const tradesCount = await prisma.trade.count({
            where: { customerId: id }
        });

        const formatted = {
            id: customer.id,
            customerId: `#CUS-${customer.id.slice(0, 5).toUpperCase()}`,
            name: customer.fullName,
            email: customer.email || 'N/A',
            phone: customer.phone || 'N/A',
            dateJoined: customer.createdAt.toISOString(),
            joinDate: new Date(customer.createdAt).toLocaleDateString('en-GB'),
            totalTransactions: tradesCount,
            totalTrades: tradesCount,
            activityLevel: tradesCount > 10 ? 'High' : tradesCount > 4 ? 'Medium' : 'Low',
            recentTrades: await prisma.trade.findMany({
                where: { customerId: customer.id },
                take: 5,
                orderBy: { createdAt: 'desc' }
            }),
            totalVolume: '$0',
            verificationStatus: customer.verified ? 'Verified' : 'Pending',
            customerType: 'Individual',
            lastActive: new Date(customer.createdAt).toLocaleDateString('en-GB'),
            riskLevel: 'Low',
            bankDetails: (customer as any).bankDetails,
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
        const [totalCustomers, verifiedCustomers] = await Promise.all([
            prisma.customer.count(),
            prisma.customer.count({ where: { verified: true } })
        ]);

        // Fetch high value (implementing real logic here: volume > 1,000,000 NGN)
        const highValueTrades = await prisma.trade.groupBy({
            by: ['customerId'],
            _sum: { amount: true },
            having: { amount: { _sum: { gt: 1000000 } } }
        });
        const highValueCount = highValueTrades.length;

        // Active today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeTodayCount = await prisma.trade.count({
            where: { createdAt: { gte: today } }
        });

        res.json({
            totalCustomers,
            verifiedCustomers,
            highValueCustomers: highValueCount,
            activeCustomersToday: activeTodayCount
        });

    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
}
