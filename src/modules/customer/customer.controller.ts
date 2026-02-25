import { Request, Response } from "express";
import prisma from "../../config/db";

// Get all customers with filters
export async function getCustomers(req: Request, res: Response) {
    try {
        const { status, search, type, activityLevel } = req.query;
        const where: any = {};

        // Add search functionality
        if (search) {
            where.OR = [
                { fullName: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
                { bvn: { contains: search as string } }
            ];
        }

        if (status === 'verified') {
            where.verified = true;
        } else if (status === 'unverified') {
            where.verified = false;
        }

        const customers = await prisma.customer.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        phone: true,
                        isActive: true,
                        createdAt: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Get transaction counts for each customer
        const customersWithTrades = await Promise.all(
            customers.map(async (customer) => {
                const trades = await prisma.trade.findMany({
                    where: { customerId: customer.id },
                    select: {
                        id: true,
                        createdAt: true,
                        status: true
                    }
                });

                const lastTrade = trades.length > 0
                    ? trades.reduce((latest, trade) =>
                        trade.createdAt > latest.createdAt ? trade : latest
                    )
                    : null;

                return {
                    id: customer.id,
                    customerId: `PE-${customer.id.slice(0, 6).toUpperCase()}`,
                    customerName: customer.fullName,
                    lastTrade: lastTrade ? lastTrade.createdAt.toISOString() : null,
                    totalTransactions: trades.length,
                    verification: customer.verified ? 'Verified' : 'Pending',
                    email: customer.email,
                    phone: customer.phone || customer.user.phone,
                    createdAt: customer.createdAt
                };
            })
        );

        res.json(customersWithTrades);
    } catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
}

// Get customer statistics
export async function getCustomerStats(req: Request, res: Response) {
    try {
        const totalCustomers = await prisma.customer.count();
        const verifiedCustomers = await prisma.customer.count({
            where: { verified: true }
        });

        // Get high-value customers (those with > 5 trades)
        const allCustomers = await prisma.customer.findMany({
            select: { id: true }
        });

        const highValueCount = await Promise.all(
            allCustomers.map(async (customer) => {
                const tradeCount = await prisma.trade.count({
                    where: { customerId: customer.id }
                });
                return tradeCount > 5 ? 1 : 0;
            })
        );

        const highValueCustomers = highValueCount.reduce((sum: number, val) => sum + val, 0);

        // Get active customers today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const activeTodayIds = await prisma.trade.findMany({
            where: {
                createdAt: {
                    gte: today
                }
            },
            select: { customerId: true },
            distinct: ['customerId']
        });

        res.json({
            totalCustomers,
            verifiedCustomers,
            highValueCustomers,
            activeCustomersToday: activeTodayIds.length
        });
    } catch (error) {
        console.error("Error fetching customer stats:", error);
        res.status(500).json({ error: "Failed to fetch customer stats" });
    }
}

// Get single customer details
export async function getCustomer(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: {
                user: true,
                notes: {
                    include: {
                        agent: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        // Get customer trades
        const trades = await prisma.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        // Calculate trade statistics
        const totalTrades = trades.length;
        const allTrades = await prisma.trade.findMany({
            where: { customerId: id }
        });

        const buyTrades = allTrades.filter(t => t.sendCurrency === 'NGN').length;
        const sellTrades = allTrades.filter(t => t.receiveCurrency === 'NGN').length;

        const totalVolume = allTrades.reduce((sum, trade) => sum + Number(trade.amount), 0);

        const lastTrade = trades.length > 0 ? trades[0] : null;

        res.json({
            ...customer,
            customerId: `PE-${customer.id.slice(0, 6).toUpperCase()}`,
            statistics: {
                totalTransactions: totalTrades,
                buyTrades,
                sellTrades,
                totalVolume,
                lastTransaction: lastTrade?.createdAt
            },
            recentTrades: trades.map(trade => ({
                id: trade.id,
                tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
                date: trade.createdAt.toLocaleDateString(),
                time: trade.createdAt.toLocaleTimeString(),
                transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
                amount: `₦${Number(trade.amount).toLocaleString()}`,
                status: trade.status
            }))
        });
    } catch (error) {
        console.error("Error fetching customer:", error);
        res.status(500).json({ error: "Failed to fetch customer" });
    }
}

// Add customer note
export async function addCustomerNote(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const agentId = (req as any).user.id;

        if (!content) {
            return res.status(400).json({ error: "Note content is required" });
        }

        const note = await prisma.customerNote.create({
            data: {
                customerId: id,
                agentId,
                content
            },
            include: {
                agent: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            }
        });

        res.json(note);
    } catch (error) {
        console.error("Error adding customer note:", error);
        res.status(500).json({ error: "Failed to add note" });
    }
}

// Get customer transactions
export async function getCustomerTransactions(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const trades = await prisma.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' }
        });

        res.json(trades);
    } catch (error) {
        console.error("Error fetching customer transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
}

// Export customers to CSV
export async function exportCustomers(req: Request, res: Response) {
    try {
        const customers = await prisma.customer.findMany({
            include: {
                user: true
            }
        });

        const csvData = customers.map(customer => ({
            'Customer ID': `PE-${customer.id.slice(0, 6).toUpperCase()}`,
            'Name': customer.fullName,
            'Email': customer.email || '',
            'Phone': customer.phone || customer.user.phone,
            'BVN': customer.bvn,
            'Verification': customer.verified ? 'Verified' : 'Pending',
            'Date Joined': customer.createdAt.toLocaleDateString()
        }));

        // Generate CSV
        const headers = ['Customer ID', 'Name', 'Email', 'Phone', 'BVN', 'Verification', 'Date Joined'];
        const csvRows = [headers.join(',')];

        csvData.forEach(row => {
            const values = headers.map(h => {
                const value = row[h as keyof typeof row];
                return value?.toString() || '';
            });
            csvRows.push(values.join(','));
        });

        const csv = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=customers-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (error) {
        console.error("Error exporting customers:", error);
        res.status(500).json({ error: "Failed to export customers" });
    }
}
