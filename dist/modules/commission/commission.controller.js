"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommissions = getCommissions;
exports.getCommissionStats = getCommissionStats;
exports.getCommission = getCommission;
exports.updateCommissionStatus = updateCommissionStatus;
exports.addCommissionNote = addCommissionNote;
exports.exportCommissions = exportCommissions;
const db_1 = __importDefault(require("../../config/db"));
// Get all commissions with filters
async function getCommissions(req, res) {
    try {
        const { status, type, dateRange, search } = req.query;
        const where = {};
        if (status && status !== 'all') {
            where.status = status;
        }
        if (type && type !== 'all') {
            where.type = type;
        }
        if (search) {
            where.OR = [
                { reference: { contains: search } },
                { agent: { email: { contains: search, mode: 'insensitive' } } }
            ];
        }
        const commissions = await db_1.default.commission.findMany({
            where,
            include: {
                agent: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                },
                trade: {
                    select: {
                        id: true,
                        createdAt: true,
                        amount: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        const formattedCommissions = commissions.map(commission => ({
            id: commission.id,
            reference: commission.reference,
            date: commission.createdAt.toLocaleDateString(),
            agent: commission.agent.firstName && commission.agent.lastName
                ? `${commission.agent.firstName} ${commission.agent.lastName}`
                : commission.agent.email,
            agentId: commission.agentId,
            commissionType: commission.type,
            amount: `₦${Number(commission.amount).toLocaleString()}`,
            status: commission.status,
            createdAt: commission.createdAt
        }));
        res.json(formattedCommissions);
    }
    catch (error) {
        console.error("Error fetching commissions:", error);
        res.status(500).json({ error: "Failed to fetch commissions" });
    }
}
// Get commission statistics
async function getCommissionStats(req, res) {
    try {
        const commissions = await db_1.default.commission.findMany();
        const totalGenerated = commissions.reduce((sum, c) => sum + Number(c.amount), 0);
        const pending = commissions
            .filter(c => c.status === 'PENDING')
            .reduce((sum, c) => sum + Number(c.amount), 0);
        const paid = commissions
            .filter(c => c.status === 'PAID')
            .reduce((sum, c) => sum + Number(c.amount), 0);
        const disputed = commissions
            .filter(c => c.status === 'DISPUTED')
            .reduce((sum, c) => sum + Number(c.amount), 0);
        res.json({
            totalCommissions: `₦${totalGenerated.toLocaleString()}`,
            totalPaid: `₦${paid.toLocaleString()}`,
            pendingPayouts: `₦${pending.toLocaleString()}`,
            disputedCommissions: `₦${disputed.toLocaleString()}`
        });
    }
    catch (error) {
        console.error("Error fetching commission stats:", error);
        res.status(500).json({ error: "Failed to fetch commission stats" });
    }
}
// Get single commission details
async function getCommission(req, res) {
    try {
        const { id } = req.params;
        const commission = await db_1.default.commission.findUnique({
            where: { id },
            include: {
                agent: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                        agentProfile: {
                            select: {
                                region: true,
                                licenseId: true
                            }
                        }
                    }
                },
                trade: {
                    select: {
                        id: true,
                        sendCurrency: true,
                        receiveCurrency: true,
                        amount: true,
                        status: true,
                        createdAt: true
                    }
                },
                activities: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });
        if (!commission) {
            return res.status(404).json({ error: "Commission not found" });
        }
        res.json({
            ...commission,
            agentName: commission.agent.firstName && commission.agent.lastName
                ? `${commission.agent.firstName} ${commission.agent.lastName}`
                : commission.agent.email
        });
    }
    catch (error) {
        console.error("Error fetching commission:", error);
        res.status(500).json({ error: "Failed to fetch commission" });
    }
}
// Update commission status
async function updateCommissionStatus(req, res) {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        const actorId = req.user.id;
        if (!['PENDING', 'PAID', 'DISPUTED'].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        const commission = await db_1.default.commission.update({
            where: { id },
            data: {
                status,
                paidAt: status === 'PAID' ? new Date() : undefined,
                notes
            }
        });
        // Log activity
        await db_1.default.commissionActivity.create({
            data: {
                commissionId: id,
                action: `STATUS_CHANGED_TO_${status}`,
                actorId,
                description: `Commission status changed to ${status}${notes ? `: ${notes}` : ''}`
            }
        });
        // Create audit log
        await db_1.default.auditLog.create({
            data: {
                actorId,
                role: 'ADMIN',
                action: 'COMMISSION_STATUS_UPDATED',
                entity: 'Commission',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });
        res.json(commission);
    }
    catch (error) {
        console.error("Error updating commission status:", error);
        res.status(500).json({ error: "Failed to update commission status" });
    }
}
// Add commission note
async function addCommissionNote(req, res) {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const actorId = req.user.id;
        if (!content) {
            return res.status(400).json({ error: "Note content is required" });
        }
        await db_1.default.commissionActivity.create({
            data: {
                commissionId: id,
                action: 'NOTE_ADDED',
                actorId,
                description: content
            }
        });
        const commission = await db_1.default.commission.findUnique({
            where: { id },
            include: {
                activities: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });
        res.json(commission);
    }
    catch (error) {
        console.error("Error adding commission note:", error);
        res.status(500).json({ error: "Failed to add note" });
    }
}
// Export commissions to CSV
async function exportCommissions(req, res) {
    try {
        const commissions = await db_1.default.commission.findMany({
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
        const csvData = commissions.map(commission => ({
            'Reference': commission.reference,
            'Date': commission.createdAt.toLocaleDateString(),
            'Agent': commission.agent.firstName && commission.agent.lastName
                ? `${commission.agent.firstName} ${commission.agent.lastName}`
                : commission.agent.email,
            'Type': commission.type,
            'Amount': Number(commission.amount).toFixed(2),
            'Currency': commission.currency,
            'Status': commission.status,
            'Paid At': commission.paidAt ? commission.paidAt.toLocaleDateString() : ''
        }));
        // Generate CSV
        const headers = ['Reference', 'Date', 'Agent', 'Type', 'Amount', 'Currency', 'Status', 'Paid At'];
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
        res.setHeader('Content-Disposition', `attachment; filename=commissions-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    }
    catch (error) {
        console.error("Error exporting commissions:", error);
        res.status(500).json({ error: "Failed to export commissions" });
    }
}
