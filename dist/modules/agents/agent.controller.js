"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardStats = getDashboardStats;
exports.getAgentTrades = getAgentTrades;
exports.getAgentTrade = getAgentTrade;
const db_1 = __importDefault(require("../../config/db"));
/**
 * Get agent dashboard statistics
 * GET /api/agent/dashboard/stats
 */
async function getDashboardStats(req, res) {
    try {
        const agentId = req.user.id;
        // Get all trades for this agent
        const trades = await db_1.default.trade.findMany({
            where: { agentId }
        });
        // Calculate stats
        const activeTrades = trades.filter(t => !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(t.status)).length;
        const completedTrades = trades.filter(t => t.status === 'COMPLETED').length;
        // Get commissions for this agent
        const commissions = await db_1.default.commission.findMany({
            where: { agentId }
        });
        const totalCommissions = commissions.reduce((sum, c) => sum + Number(c.amount), 0);
        const thisMonthStart = new Date();
        thisMonthStart.setDate(1);
        thisMonthStart.setHours(0, 0, 0, 0);
        const monthlyCommissions = commissions
            .filter(c => new Date(c.createdAt) >= thisMonthStart)
            .reduce((sum, c) => sum + Number(c.amount), 0);
        // Get pending documents count (mock for now)
        const pendingDocuments = 5;
        res.json({
            activeTrades,
            completedTrades,
            totalCommissions: `₦${totalCommissions.toLocaleString()}`,
            monthlyCommissions: `₦${monthlyCommissions.toLocaleString()}`,
            pendingDocuments,
            totalTrades: trades.length
        });
    }
    catch (error) {
        console.error("Error fetching agent dashboard stats:", error);
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
}
/**
 * Get agent's trades
 * GET /api/agent/trades
 */
async function getAgentTrades(req, res) {
    try {
        const agentId = req.user.id;
        const { status, limit = '50', page = '1' } = req.query;
        const take = parseInt(limit, 10);
        const skip = (parseInt(page, 10) - 1) * take;
        const where = { agentId };
        if (status && status !== 'All') {
            where.status = status.toUpperCase();
        }
        const [trades, total] = await Promise.all([
            db_1.default.trade.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip
            }),
            db_1.default.trade.count({ where })
        ]);
        // Fetch customers in bulk
        const customerIds = [...new Set(trades.map(t => t.customerId).filter(Boolean))];
        const customers = await db_1.default.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, fullName: true, email: true }
        });
        const customerMap = {};
        customers.forEach(c => {
            customerMap[c.id] = c.fullName || c.email || 'Customer';
        });
        // Format trades
        const formatted = trades.map(trade => {
            const customerName = customerMap[trade.customerId] || 'N/A';
            const dateObj = new Date(trade.createdAt);
            const statusMap = {
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
        res.json({ trades: formatted, total, page: parseInt(page, 10), limit: take });
    }
    catch (error) {
        console.error("Error fetching agent trades:", error);
        res.status(500).json({ error: "Failed to fetch trades" });
    }
}
/**
 * Get single trade details
 * GET /api/agent/trades/:id
 */
async function getAgentTrade(req, res) {
    try {
        const agentId = req.user.id;
        const { id } = req.params;
        const trade = await db_1.default.trade.findFirst({
            where: {
                id,
                agentId // Ensure agent can only access their own trades
            }
        });
        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }
        // Get customer details
        const customer = await db_1.default.customer.findUnique({
            where: { id: trade.customerId }
        });
        res.json({
            ...trade,
            customerDetails: customer
        });
    }
    catch (error) {
        console.error("Error fetching trade:", error);
        res.status(500).json({ error: "Failed to fetch trade" });
    }
}
