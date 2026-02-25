"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomers = getCustomers;
exports.getCustomerStats = getCustomerStats;
exports.getCustomer = getCustomer;
exports.addCustomerNote = addCustomerNote;
exports.getCustomerTransactions = getCustomerTransactions;
exports.exportCustomers = exportCustomers;
const db_1 = __importDefault(require("../../config/db"));
// Get all customers with filters
async function getCustomers(req, res) {
    try {
        const { status, search, type, activityLevel } = req.query;
        const where = {};
        // Add search functionality
        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { bvn: { contains: search } }
            ];
        }
        if (status === 'verified') {
            where.verified = true;
        }
        else if (status === 'unverified') {
            where.verified = false;
        }
        const customers = await db_1.default.customer.findMany({
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
        const customersWithTrades = await Promise.all(customers.map(async (customer) => {
            const trades = await db_1.default.trade.findMany({
                where: { customerId: customer.id },
                select: {
                    id: true,
                    createdAt: true,
                    status: true
                }
            });
            const lastTrade = trades.length > 0
                ? trades.reduce((latest, trade) => trade.createdAt > latest.createdAt ? trade : latest)
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
        }));
        res.json(customersWithTrades);
    }
    catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
}
// Get customer statistics
async function getCustomerStats(req, res) {
    try {
        const totalCustomers = await db_1.default.customer.count();
        const verifiedCustomers = await db_1.default.customer.count({
            where: { verified: true }
        });
        // Get high-value customers (those with > 5 trades)
        const allCustomers = await db_1.default.customer.findMany({
            select: { id: true }
        });
        const highValueCount = await Promise.all(allCustomers.map(async (customer) => {
            const tradeCount = await db_1.default.trade.count({
                where: { customerId: customer.id }
            });
            return tradeCount > 5 ? 1 : 0;
        }));
        const highValueCustomers = highValueCount.reduce((sum, val) => sum + val, 0);
        // Get active customers today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeTodayIds = await db_1.default.trade.findMany({
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
    }
    catch (error) {
        console.error("Error fetching customer stats:", error);
        res.status(500).json({ error: "Failed to fetch customer stats" });
    }
}
// Get single customer details
async function getCustomer(req, res) {
    try {
        const { id } = req.params;
        const customer = await db_1.default.customer.findUnique({
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
        const trades = await db_1.default.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        // Calculate trade statistics
        const totalTrades = trades.length;
        const allTrades = await db_1.default.trade.findMany({
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
    }
    catch (error) {
        console.error("Error fetching customer:", error);
        res.status(500).json({ error: "Failed to fetch customer" });
    }
}
// Add customer note
async function addCustomerNote(req, res) {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const agentId = req.user.id;
        if (!content) {
            return res.status(400).json({ error: "Note content is required" });
        }
        const note = await db_1.default.customerNote.create({
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
    }
    catch (error) {
        console.error("Error adding customer note:", error);
        res.status(500).json({ error: "Failed to add note" });
    }
}
// Get customer transactions
async function getCustomerTransactions(req, res) {
    try {
        const { id } = req.params;
        const trades = await db_1.default.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' }
        });
        res.json(trades);
    }
    catch (error) {
        console.error("Error fetching customer transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
}
// Export customers to CSV
async function exportCustomers(req, res) {
    try {
        const customers = await db_1.default.customer.findMany({
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
                const value = row[h];
                return value?.toString() || '';
            });
            csvRows.push(values.join(','));
        });
        const csv = csvRows.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=customers-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    }
    catch (error) {
        console.error("Error exporting customers:", error);
        res.status(500).json({ error: "Failed to export customers" });
    }
}
