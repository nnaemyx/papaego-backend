import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Get trade requests: either assigned to agent or in the global pool
 * GET /api/agent/trade-requests
 */
export async function getAgentTradeRequests(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { status = "PENDING" } = req.query;

        const requests = await prisma.tradeRequest.findMany({
            where: { 
                OR: [
                    { agentId, status: status as string },
                    { status: "POOL" } // Requests in the global queue
                ]
            },
            include: {
                customer: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        bankDetails: true
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        });

        res.json(requests);
    } catch (error) {
        console.error("Error fetching agent trade requests:", error);
        res.status(500).json({ error: "Failed to fetch trade requests" });
    }
}

/**
 * Claim a trade request from the POOL
 * PATCH /api/agent/trade-requests/:id/claim
 */
export async function claimTradeRequest(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({
            where: { id }
        });

        if (!request) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        if (request.status !== "POOL") {
            return res.status(400).json({ error: "Request is already claimed or processed" });
        }

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: { 
                agentId,
                status: "PENDING" // Move to pending for this specific agent
            }
        });

        res.json(updated);
    } catch (error) {
        console.error("Error claiming trade request:", error);
        res.status(500).json({ error: "Failed to claim request" });
    }
}

/**
 * Reject a trade request
 * PATCH /api/agent/trade-requests/:id/reject
 */
export async function rejectTradeRequest(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findFirst({
            where: { id, agentId }
        });

        if (!request) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: { status: "REJECTED" }
        });

        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: "Failed to reject request" });
    }
}
