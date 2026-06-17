import { Request, Response } from "express";
import prisma from "../../config/db";

// Get all audit logs with filters
export async function getAuditLogs(req: Request, res: Response) {
    try {
        const { role, action, entity, search } = req.query;
        const where: any = {};

        if (role && role !== 'all') {
            where.role = role;
        }

        if (action) {
            where.action = { contains: action as string };
        }

        if (entity) {
            where.entity = entity;
        }

        if (search) {
            where.OR = [
                { action: { contains: search as string, mode: 'insensitive' } },
                { entity: { contains: search as string, mode: 'insensitive' } },
                { entityId: { contains: search as string } }
            ];
        }

        const logs = await prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 100 // Limit to prevent overload
        });

        // Determine severity from action name
        const getSeverity = (action: string) => {
            if (['AGENT_DELETED', 'USER_ROLE_CHANGED'].includes(action)) return 'Critical';
            if (['AGENT_SUSPENDED', 'COMMISSION_STATUS_UPDATED', 'AGENT_VERIFICATION_UPDATED'].includes(action)) return 'Warning';
            return 'Info';
        };

        // Map role to actorType
        const getActorType = (role: string): 'Admin' | 'Agent' | 'System' => {
            if (role === 'ADMIN') return 'Admin';
            if (role === 'AGENT') return 'Agent';
            return 'System';
        };

        const formattedLogs = logs.map(log => ({
            id: log.id,
            logId: `#LOG-${log.id.slice(0, 5).toUpperCase()}`,
            actor: log.actorId, // Will be enriched with user name in future
            actorType: getActorType(log.role),
            action: log.action.replace(/_/g, ' '),
            targetType: log.entity,
            targetId: log.entityId || '—',
            ipAddress: log.ip,
            timestamp: `${log.createdAt.toLocaleDateString()} ${log.createdAt.toLocaleTimeString()}`,
            severity: getSeverity(log.action),
            createdAt: log.createdAt
        }));

        res.json(formattedLogs);
    } catch (error) {
        console.error("Error fetching audit logs:", error);
        res.status(500).json({ error: "Failed to fetch audit logs" });
    }
}

// Get audit log statistics
export async function getAuditLogStats(req: Request, res: Response) {
    try {
        const [totalLogs, adminActions, agentActions, systemEvents] = await Promise.all([
            prisma.auditLog.count(),
            prisma.auditLog.count({ where: { role: 'ADMIN' } }),
            prisma.auditLog.count({ where: { role: 'AGENT' } }),
            prisma.auditLog.count({ where: { role: { notIn: ['ADMIN', 'AGENT'] } } }),
        ]);

        res.json({
            totalLogs,
            adminActions,
            agentActions,
            systemEvents
        });
    } catch (error) {
        console.error("Error fetching audit log stats:", error);
        res.status(500).json({ error: "Failed to fetch audit log stats" });
    }
}

// Export audit logs to CSV
export async function exportAuditLogs(req: Request, res: Response) {
    try {
        const logs = await prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' }
        });

        const csvData = logs.map(log => ({
            'Date': log.createdAt.toLocaleDateString(),
            'Time': log.createdAt.toLocaleTimeString(),
            'User': log.actorId,
            'Role': log.role,
            'Event Type': log.action,
            'Resource': log.entity,
            'IP Address': log.ip,
            'Status': 'Success'
        }));

        // Generate CSV
        const headers = ['Date', 'Time', 'User', 'Role', 'Event Type', 'Resource', 'IP Address', 'Status'];
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
        res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (error) {
        console.error("Error exporting audit logs:", error);
        res.status(500).json({ error: "Failed to export audit logs" });
    }
}

// ─── Negotiation Logs (Immutable) ────────────────────────────────────────────

/**
 * GET /api/admin/audit-logs/negotiations
 * Returns all negotiation action logs — immutable audit trail.
 */
export async function getNegotiationLogs(req: Request, res: Response) {
    try {
        const { tradeId, userId, page = '1', limit = '50' } = req.query;
        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const where: any = {};
        if (tradeId) where.tradeId = tradeId;
        if (userId) where.userId = userId;

        const [logs, total] = await Promise.all([
            prisma.negotiationLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            prisma.negotiationLog.count({ where }),
        ]);

        const formatted = logs.map(log => ({
            id: log.id,
            tradeId: log.tradeId,
            userId: log.userId,
            originalRate: Number(log.originalRate),
            newRate: Number(log.newRate),
            discount: Number(log.discount),
            timestamp: log.createdAt.toISOString(),
        }));

        res.json({ logs: formatted, total, page: parseInt(page as string, 10), limit: take });
    } catch (error) {
        console.error("Error fetching negotiation logs:", error);
        res.status(500).json({ error: "Failed to fetch negotiation logs" });
    }
}

// ─── Rate Change Logs ────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-logs/rate-changes
 * Returns all FX rate change logs with before/after values.
 */
export async function getRateChangeLogs(req: Request, res: Response) {
    try {
        const { pair, changedBy, page = '1', limit = '50' } = req.query;
        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const where: any = {};
        if (pair) where.pair = pair;
        if (changedBy) where.changedBy = changedBy;

        const [logs, total] = await Promise.all([
            prisma.rateChangeLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            prisma.rateChangeLog.count({ where }),
        ]);

        const formatted = logs.map(log => ({
            id: log.id,
            pair: log.pair,
            previousBuy: Number(log.previousBuy),
            previousSell: Number(log.previousSell),
            newBuy: Number(log.newBuy),
            newSell: Number(log.newSell),
            changedBy: log.changedBy,
            reason: log.reason,
            timestamp: log.createdAt.toISOString(),
        }));

        res.json({ logs: formatted, total, page: parseInt(page as string, 10), limit: take });
    } catch (error) {
        console.error("Error fetching rate change logs:", error);
        res.status(500).json({ error: "Failed to fetch rate change logs" });
    }
}

// ─── Payment Approval Logs ───────────────────────────────────────────────────

/**
 * GET /api/admin/audit-logs/payments
 * Returns payment-related audit log entries.
 */
export async function getPaymentLogs(req: Request, res: Response) {
    try {
        const { page = '1', limit = '50' } = req.query;
        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const paymentActions = [
            'TRADE_AWAITING_PAYMENT',
            'TRADE_PAYMENT_UPLOADED',
            'TRADE_PAYMENT_CONFIRMED',
            'PAYMENT_RECEIPT_UPLOADED',
            'PAYOUT_CONFIRMED',
        ];

        const where = {
            action: { in: paymentActions },
        };

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            prisma.auditLog.count({ where }),
        ]);

        const formatted = logs.map(log => ({
            id: log.id,
            logId: `#PAY-${log.id.slice(0, 5).toUpperCase()}`,
            actor: log.actorId,
            role: log.role,
            action: log.action.replace(/_/g, ' '),
            tradeId: log.entityId,
            ipAddress: log.ip,
            metadata: log.metadata,
            timestamp: log.createdAt.toISOString(),
        }));

        res.json({ logs: formatted, total, page: parseInt(page as string, 10), limit: take });
    } catch (error) {
        console.error("Error fetching payment logs:", error);
        res.status(500).json({ error: "Failed to fetch payment logs" });
    }
}

// ─── Trade Audit Logs ────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-logs/trades
 * Returns trade-related audit log entries (approvals, updates, status changes).
 */
export async function getTradeAuditLogs(req: Request, res: Response) {
    try {
        const { tradeId, page = '1', limit = '50' } = req.query;
        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const where: any = {
            entity: 'Trade',
        };

        if (tradeId) where.entityId = tradeId;

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            prisma.auditLog.count({ where }),
        ]);

        const formatted = logs.map(log => ({
            id: log.id,
            logId: `#TRD-${log.id.slice(0, 5).toUpperCase()}`,
            actor: log.actorId,
            role: log.role,
            action: log.action.replace(/_/g, ' '),
            tradeId: log.entityId,
            ipAddress: log.ip,
            metadata: log.metadata,
            timestamp: log.createdAt.toISOString(),
        }));

        res.json({ logs: formatted, total, page: parseInt(page as string, 10), limit: take });
    } catch (error) {
        console.error("Error fetching trade audit logs:", error);
        res.status(500).json({ error: "Failed to fetch trade audit logs" });
    }
}
