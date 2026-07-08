import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Request cashout of pending commission balance (Agent)
 * POST /api/agent/cashout/request
 */
export async function requestCashout(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;

        // Check if today is Friday (Day 5) or bypass is enabled
        const isFriday = new Date().getDay() === 5;
        const bypassFriday = process.env.BYPASS_FRIDAY_CHECK === 'true';
        if (!isFriday && !bypassFriday) {
            return res.status(400).json({ error: "Cashout requests are only available on Fridays" });
        }

        // Check if agent already has an active cashout request
        const existingRequest = await prisma.cashoutRequest.findFirst({
            where: {
                agentId,
                status: {
                    in: ['PENDING', 'APPROVED']
                }
            }
        });
        if (existingRequest) {
            return res.status(400).json({ error: "You already have an active cashout request" });
        }

        // Fetch user info for name
        const user = await prisma.user.findUnique({
            where: { id: agentId },
            select: { firstName: true, lastName: true, role: true }
        });
        if (!user || user.role !== 'AGENT') {
            return res.status(403).json({ error: "Unauthorized access" });
        }

        // Calculate available balance (pending commissions)
        const commissions = await prisma.commission.findMany({
            where: {
                agentId,
                status: 'PENDING'
            }
        });
        const availableBalance = commissions.reduce((sum, c) => sum + Number(c.amount), 0);
        if (availableBalance <= 0) {
            return res.status(400).json({ error: "No available commission balance for cashout" });
        }

        const agentName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Agent';

        // Create cashout request
        const cashout = await prisma.cashoutRequest.create({
            data: {
                agentId,
                agentName,
                amount: availableBalance,
                status: 'PENDING'
            }
        });

        // Log audit trail
        await prisma.auditLog.create({
            data: {
                actorId: agentId,
                role: 'AGENT',
                action: 'CASHOUT_REQUEST_CREATED',
                entity: 'CashoutRequest',
                entityId: cashout.id,
                ip: req.ip || '127.0.0.1'
            }
        });

        return res.status(201).json(cashout);
    } catch (error) {
        console.error("Error creating cashout request:", error);
        return res.status(500).json({ error: "Failed to create cashout request" });
    }
}

/**
 * Get the latest cashout request for the logged-in agent (Agent)
 * GET /api/agent/cashout/status
 */
export async function getAgentCashoutStatus(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const lastRequest = await prisma.cashoutRequest.findFirst({
            where: { agentId },
            orderBy: { createdAt: 'desc' }
        });
        return res.json({ lastRequest });
    } catch (error) {
        console.error("Error fetching agent cashout status:", error);
        return res.status(500).json({ error: "Failed to fetch cashout status" });
    }
}

/**
 * List all cashout requests (Admin)
 * GET /api/admin/cashouts
 */
export async function listAllCashouts(req: Request, res: Response) {
    try {
        const cashouts = await prisma.cashoutRequest.findMany({
            orderBy: { createdAt: 'desc' }
        });
        return res.json(cashouts);
    } catch (error) {
        console.error("Error fetching cashout requests for admin:", error);
        return res.status(500).json({ error: "Failed to fetch cashout requests" });
    }
}

/**
 * Update cashout status (Admin)
 * PATCH /api/admin/cashouts/:id/status
 */
export async function updateCashoutStatus(req: Request, res: Response) {
    try {
        const actorId = (req as any).user.id;
        const { id } = req.params;
        const { status, notes } = req.body;

        if (!['APPROVED', 'REJECTED', 'PAID'].includes(status)) {
            return res.status(400).json({ error: "Invalid status update" });
        }

        const cashout = await prisma.cashoutRequest.findUnique({
            where: { id }
        });
        if (!cashout) {
            return res.status(404).json({ error: "Cashout request not found" });
        }

        const updatedCashout = await prisma.$transaction(async (tx) => {
            const updated = await tx.cashoutRequest.update({
                where: { id },
                data: {
                    status: status as any,
                    notes,
                    updatedAt: new Date()
                }
            });

            if (status === 'PAID') {
                // Bulk update PENDING commissions for this agent to PAID
                await tx.commission.updateMany({
                    where: {
                        agentId: cashout.agentId,
                        status: 'PENDING'
                    },
                    data: {
                        status: 'PAID',
                        paidAt: new Date(),
                        notes: `Paid via Cashout Request ${id}`
                    }
                });
            }

            return updated;
        });

        // Log audit trail
        await prisma.auditLog.create({
            data: {
                actorId,
                role: 'ADMIN',
                action: `CASHOUT_STATUS_UPDATED_${status}`,
                entity: 'CashoutRequest',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });

        return res.json(updatedCashout);
    } catch (error) {
        console.error("Error updating cashout status:", error);
        return res.status(500).json({ error: "Failed to update cashout status" });
    }
}
