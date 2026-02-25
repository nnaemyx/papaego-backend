"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgent = createAgent;
exports.getAgents = getAgents;
exports.activateAgent = activateAgent;
exports.suspendAgent = suspendAgent;
exports.setFxMargin = setFxMargin;
exports.listAllTrades = listAllTrades;
exports.approveOverride = approveOverride;
exports.getDashboardStats = getDashboardStats;
exports.getAdminTransaction = getAdminTransaction;
exports.getAgent = getAgent;
exports.deleteAgent = deleteAgent;
exports.updateAgent = updateAgent;
exports.updateAgentVerification = updateAgentVerification;
exports.getAgentActivities = getAgentActivities;
exports.getAgentTransactions = getAgentTransactions;
exports.exportAgents = exportAgents;
const db_1 = __importDefault(require("../../config/db"));
const generateLicenseId_1 = require("../../utils/generateLicenseId");
const generateOnboardingToken_1 = require("../../utils/generateOnboardingToken");
const email_service_1 = require("../../services/email.service");
async function createAgent(req, res) {
    const { email, phone, region, firstName, lastName } = req.body;
    // Validate required fields
    if (!email) {
        return res.status(400).json({ error: "email is required" });
    }
    if (!region) {
        return res.status(400).json({ error: "region is required" });
    }
    try {
        // Check if email already exists
        const existingUser = await db_1.default.user.findFirst({
            where: { email }
        });
        if (existingUser) {
            return res.status(400).json({ error: "Email already exists. Each agent must have a unique email address." });
        }
        // Auto-generate license ID and onboarding token
        const licenseId = await (0, generateLicenseId_1.generateLicenseId)();
        const onboardingToken = (0, generateOnboardingToken_1.generateOnboardingToken)();
        const onboardingTokenExpiry = (0, generateOnboardingToken_1.getOnboardingTokenExpiry)();
        // Create user and agent profile in a single transaction using nested create
        const user = await db_1.default.user.create({
            data: {
                email,
                phone: phone || "+234000000000", // Temporary phone until onboarding
                role: "AGENT",
                password: "TEMP_PASSWORD", // Will be set during onboarding
                firstName: firstName || null,
                lastName: lastName || null,
                agentProfile: {
                    create: {
                        region,
                        licenseId,
                        lga: "Default",
                        dailyLimit: 50000,
                        monthlyLimit: 500000,
                        onboardingToken,
                        onboardingTokenExpiry
                    }
                }
            },
            include: {
                agentProfile: true
            }
        });
        // Generate onboarding link (updated to match frontend routes)
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const onboardingLink = `${frontendUrl}/onboarding?token=${onboardingToken}`;
        // Send invitation email
        try {
            await (0, email_service_1.sendAgentInvitation)({
                email: user.email,
                agentName: user.firstName || user.email.split('@')[0],
                licenseId,
                onboardingLink
            });
            console.log(`✅ Agent invitation email sent to: ${user.email}`);
        }
        catch (emailError) {
            console.error("❌ Failed to send invitation email:", emailError);
            // Don't fail the entire request if email fails
            // You might want to log this to a monitoring service
        }
        res.json({
            success: true,
            user,
            message: "Agent created successfully. Invitation email sent.",
            onboardingLink // Include this in dev/testing, remove in production
        });
    }
    catch (error) {
        console.error("❌ Error creating agent:", error);
        res.status(500).json({ error: "Failed to create agent" });
    }
}
async function getAgents(req, res) {
    const { status, role, region, search } = req.query;
    const where = {};
    if (status)
        where.status = status;
    if (role)
        where.role = role;
    // Add search functionality
    if (search) {
        where.OR = [
            { email: { contains: search } },
            { phone: { contains: search } }
        ];
    }
    const users = await db_1.default.user.findMany({
        where: {
            role: "AGENT",
            ...where
        },
        include: {
            agentProfile: true
        }
    });
    // Transform to match frontend format
    const agents = users.map(user => ({
        id: user.id,
        agentId: `#PE-${user.id.slice(0, 5).toUpperCase()}`,
        name: user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user.email || 'Unknown',
        email: user.email,
        role: user.role,
        region: user.agentProfile?.region || "N/A",
        activeTrades: 0, // Calculate from trades table
        status: user.isActive ? "Active" : "Inactive",
        phone: user.phone,
        createdAt: user.createdAt
    }));
    res.json(agents);
}
async function activateAgent(req, res) {
    await db_1.default.user.update({
        where: { id: req.params.id },
        data: { isActive: true }
    });
    res.json({ success: true });
}
async function suspendAgent(req, res) {
    await db_1.default.user.update({
        where: { id: req.params.id },
        data: { isActive: false }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "ADMIN",
            action: "AGENT_SUSPENDED",
            entity: "User",
            entityId: req.params.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ suspended: true });
}
async function setFxMargin(req, res) {
    const { countryId, margin } = req.body;
    await db_1.default.fxMargin.upsert({
        where: { countryId },
        update: { margin },
        create: { countryId, margin }
    });
    res.json({ updated: true });
}
async function listAllTrades(req, res) {
    try {
        const { status, search, limit = '50', page = '1' } = req.query;
        const take = parseInt(limit, 10);
        const skip = (parseInt(page, 10) - 1) * take;
        const where = {};
        if (status && status !== 'All')
            where.status = status.toUpperCase();
        const [trades, total] = await Promise.all([
            db_1.default.trade.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip
            }),
            db_1.default.trade.count({ where })
        ]);
        // Fetch agents + customers in bulk to avoid N+1
        const agentIds = [...new Set(trades.map(t => t.agentId).filter(Boolean))];
        const customerIds = [...new Set(trades.map(t => t.customerId).filter(Boolean))];
        const [agentUsers, customerRecords] = await Promise.all([
            db_1.default.user.findMany({
                where: { id: { in: agentIds } },
                select: { id: true, firstName: true, lastName: true, email: true }
            }),
            db_1.default.customer.findMany({
                where: { id: { in: customerIds } },
                select: { id: true, fullName: true, email: true }
            })
        ]);
        const agentMap = {};
        agentUsers.forEach(u => {
            agentMap[u.id] = u.firstName && u.lastName
                ? `${u.firstName} ${u.lastName}`
                : u.email?.split('@')[0] || 'Agent';
        });
        const customerMap = {};
        customerRecords.forEach(c => {
            customerMap[c.id] = c.fullName || c.email || 'Customer';
        });
        // Filter by search on formatted data if needed
        let formatted = trades.map(trade => {
            const agentName = agentMap[trade.agentId] || 'N/A';
            const customerName = customerMap[trade.customerId] || 'N/A';
            const dateObj = new Date(trade.createdAt);
            const statusMap = {
                COMPLETED: 'Completed', CANCELLED: 'Cancelled',
                AWAITING_PAYMENT: 'Pending', PAYMENT_CONFIRMED: 'In Progress',
                FLAGGED: 'Pending', UNDER_REVIEW: 'Pending',
                INITIATED: 'Pending', QUOTED: 'Pending',
                SENT_TO_CUSTOMER: 'Pending', CUSTOMER_CONFIRMED: 'Pending',
                CUSTOMER_VERIFIED: 'Pending', EXPIRED: 'Cancelled'
            };
            return {
                id: trade.id,
                tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
                date: dateObj.toLocaleDateString('en-GB'),
                time: dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                customer: customerName,
                agent: agentName,
                agentId: trade.agentId ? `#PE-${trade.agentId.slice(0, 5).toUpperCase()}` : '—',
                transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
                amount: `₦${Number(trade.amount).toLocaleString()}`,
                status: statusMap[trade.status] || trade.status,
                verification: 'Verified',
                createdAt: trade.createdAt
            };
        });
        if (search) {
            const s = search.toLowerCase();
            formatted = formatted.filter(t => t.tradeId.toLowerCase().includes(s) ||
                t.agent.toLowerCase().includes(s) ||
                t.customer.toLowerCase().includes(s));
        }
        res.json({ trades: formatted, total, page: parseInt(page, 10), limit: take });
    }
    catch (error) {
        console.error("Error fetching trades:", error);
        res.status(500).json({ error: "Failed to fetch trades" });
    }
}
async function approveOverride(req, res) {
    const override = await db_1.default.overrideApproval.findUnique({
        where: { id: req.params.id }
    });
    if (!override)
        return res.status(404).json({ error: "Override not found" });
    if (override.requestedBy === req.user.id) {
        return res.status(403).json({ error: "Maker cannot approve" });
    }
    await db_1.default.overrideApproval.update({
        where: { id: override.id },
        data: {
            status: "APPROVED",
            approvedBy: req.user.id
        }
    });
    res.json({ approved: true });
}
// Dashboard Statistics
async function getDashboardStats(req, res) {
    try {
        const totalTransactions = await db_1.default.trade.count();
        const activeAgents = await db_1.default.user.count({
            where: { role: "AGENT", isActive: true }
        });
        const pendingReviews = await db_1.default.complianceFlag.count({
            where: {
                createdAt: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
            }
        });
        // Calculate trade volume
        const trades = await db_1.default.trade.findMany({
            select: { amount: true }
        });
        const tradeVolume = trades.reduce((sum, trade) => sum + Number(trade.amount), 0);
        res.json({
            totalTransactions,
            tradeVolume,
            activeAgents,
            pendingReviews
        });
    }
    catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
}
// Get Admin Transaction Details
async function getAdminTransaction(req, res) {
    try {
        const { id } = req.params;
        const trade = await db_1.default.trade.findUnique({
            where: { id }
        });
        if (!trade) {
            return res.status(404).json({ error: "Transaction not found" });
        }
        res.json(trade);
    }
    catch (error) {
        console.error("Error fetching transaction:", error);
        res.status(500).json({ error: "Failed to fetch transaction" });
    }
}
// Get single agent details
async function getAgent(req, res) {
    try {
        const { id } = req.params;
        const user = await db_1.default.user.findUnique({
            where: { id },
            include: {
                agentProfile: true
            }
        });
        if (!user || user.role !== 'AGENT') {
            return res.status(404).json({ error: "Agent not found" });
        }
        // Get agent statistics
        const trades = await db_1.default.trade.findMany({
            where: { agentId: id }
        });
        const totalTrades = trades.length;
        const activeTrades = trades.filter(t => !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(t.status)).length;
        const completedTrades = trades.filter(t => t.status === 'COMPLETED').length;
        // Get compliance flags
        const flags = await db_1.default.complianceFlag.findMany({
            where: {
                tradeId: { in: trades.map(t => t.id) }
            }
        });
        res.json({
            ...user,
            agentId: `#PE-${user.id.slice(0, 5).toUpperCase()}`,
            name: user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.firstName || user.lastName || user.email?.split('@')[0] || 'Agent',
            status: user.isActive ? 'Active' : 'Inactive',
            region: user.agentProfile?.region || 'N/A',
            licenseId: user.agentProfile?.licenseId || 'N/A',
            onboardingStatus: user.agentProfile?.onboardingStatus || 'PENDING',
            statistics: {
                totalTrades,
                activeTrades,
                completedTrades,
                flaggedTransactions: flags.length
            }
        });
    }
    catch (error) {
        console.error("Error fetching agent:", error);
        res.status(500).json({ error: "Failed to fetch agent" });
    }
}
// Delete agent
async function deleteAgent(req, res) {
    try {
        const { id } = req.params;
        // Check if agent exists
        const user = await db_1.default.user.findUnique({
            where: { id },
            include: { agentProfile: true }
        });
        if (!user || user.role !== 'AGENT') {
            return res.status(404).json({ error: "Agent not found" });
        }
        // Delete agent profile first (due to foreign key constraint)
        if (user.agentProfile) {
            await db_1.default.agentProfile.delete({
                where: { userId: id }
            });
        }
        // Delete user
        await db_1.default.user.delete({
            where: { id }
        });
        // Create audit log
        await db_1.default.auditLog.create({
            data: {
                actorId: req.user.id,
                role: 'ADMIN',
                action: 'AGENT_DELETED',
                entity: 'User',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });
        res.json({ success: true, message: "Agent deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting agent:", error);
        res.status(500).json({ error: "Failed to delete agent" });
    }
}
// Update agent details
async function updateAgent(req, res) {
    try {
        const { id } = req.params;
        const { firstName, lastName, phone, region, isActive } = req.body;
        const updateData = {};
        if (firstName !== undefined)
            updateData.firstName = firstName;
        if (lastName !== undefined)
            updateData.lastName = lastName;
        if (phone !== undefined)
            updateData.phone = phone;
        if (isActive !== undefined)
            updateData.isActive = isActive;
        const user = await db_1.default.user.update({
            where: { id },
            data: updateData,
            include: { agentProfile: true }
        });
        // Update agent profile if region is provided
        if (region && user.agentProfile) {
            await db_1.default.agentProfile.update({
                where: { userId: id },
                data: { region }
            });
        }
        res.json(user);
    }
    catch (error) {
        console.error("Error updating agent:", error);
        res.status(500).json({ error: "Failed to update agent" });
    }
}
// Update agent verification status
async function updateAgentVerification(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const agent = await db_1.default.agentProfile.update({
            where: { userId: id },
            data: { onboardingStatus: status }
        });
        await db_1.default.auditLog.create({
            data: {
                actorId: req.user.id,
                role: 'ADMIN',
                action: 'AGENT_VERIFICATION_UPDATED',
                entity: 'AgentProfile',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });
        res.json(agent);
    }
    catch (error) {
        console.error("Error updating verification:", error);
        res.status(500).json({ error: "Failed to update verification" });
    }
}
// Get agent activities
async function getAgentActivities(req, res) {
    try {
        const { id } = req.params;
        const activities = await db_1.default.auditLog.findMany({
            where: { actorId: id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        const formattedActivities = activities.map(activity => ({
            date: activity.createdAt.toLocaleDateString(),
            time: activity.createdAt.toLocaleTimeString(),
            transaction: activity.action,
            reference: activity.entityId || '—'
        }));
        res.json(formattedActivities);
    }
    catch (error) {
        console.error("Error fetching agent activities:", error);
        res.status(500).json({ error: "Failed to fetch activities" });
    }
}
// Get agent transactions
async function getAgentTransactions(req, res) {
    try {
        const { id } = req.params;
        const trades = await db_1.default.trade.findMany({
            where: { agentId: id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        const formattedTrades = trades.map(trade => ({
            id: trade.id,
            tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
            date: trade.createdAt.toLocaleDateString(),
            time: trade.createdAt.toLocaleTimeString(),
            transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
            amount: `₦${Number(trade.amount).toLocaleString()}`,
            status: trade.status
        }));
        res.json(formattedTrades);
    }
    catch (error) {
        console.error("Error fetching agent transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
}
// Export agents to CSV
async function exportAgents(req, res) {
    try {
        const users = await db_1.default.user.findMany({
            where: { role: 'AGENT' },
            include: { agentProfile: true }
        });
        const csvData = users.map(user => {
            const activeTrades = 0; // This would require counting trades
            return {
                'Agent ID': `#PE-${user.id.slice(0, 5).toUpperCase()}`,
                'Name': user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.email || '',
                'Email': user.email || '',
                'Phone': user.phone,
                'Role': user.role,
                'Region': user.agentProfile?.region || 'N/A',
                'Active Trades': activeTrades,
                'Status': user.isActive ? 'Active' : 'Inactive',
                'Date Joined': user.createdAt.toLocaleDateString()
            };
        });
        // Generate CSV
        const headers = ['Agent ID', 'Name', 'Email', 'Phone', 'Role', 'Region', 'Active Trades', 'Status', 'Date Joined'];
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
        res.setHeader('Content-Disposition', `attachment; filename=agents-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    }
    catch (error) {
        console.error("Error exporting agents:", error);
        res.status(500).json({ error: "Failed to export agents" });
    }
}
