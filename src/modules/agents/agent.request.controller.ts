import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Get trade requests: either assigned to agent or in the global pool
 * GET /api/agent/trade-requests
 */
export async function getAgentTradeRequests(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { status } = req.query;

        let statusQuery: any = status || "PENDING";

        // "PENDING" tab should show both PENDING and ASSIGNED for this agent
        // "ASSIGNED" tab should also show ASSIGNED for this agent
        // Other statuses (PROCESSED, REJECTED) are passed through as-is
        if (statusQuery === "PENDING") {
            statusQuery = { in: ["PENDING", "ASSIGNED"] };
        }

        console.log(`🔍 Fetching trade requests for Agent ID: ${agentId}, Status: ${status}`);

        const where: any = {};
        if (statusQuery === "POOL") {
            where.status = "POOL";
        } else if (status === "ASSIGNED") {
            where.agentId = agentId;
            where.status = "ASSIGNED";
        } else {
            where.OR = [
                { agentId, status: statusQuery },
                { status: "POOL" } 
            ];
        }

        console.log("🛠 Query Where Clause:", JSON.stringify(where, null, 2));

        const requests = await prisma.tradeRequest.findMany({
            where,
            include: {
                customer: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        });

        console.log(`✅ Found ${requests.length} requests for agent ${agentId}`);

        // Format response to match what the frontend expects
        const formatted = requests.map((r: any) => {
            const customer = r.customer || {};
            const fullName = customer.fullName || "";
            
            return {
                ...r,
                amount: r.amount ? r.amount.toString() : "0",
                customer: {
                    ...customer,
                    firstName: customer.firstName || fullName.split(" ")[0] || "Customer",
                    lastName: customer.lastName || fullName.split(" ").slice(1).join(" ") || "",
                }
            };
        });

        res.json(formatted);
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

/**
 * Set a rate for a trade request (Quote)
 * PATCH /api/agent/trade-requests/:id/set-rate
 */
export async function setTradeRequestRate(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const { id } = req.params;
        const { fxRate, payoutAmount } = req.body;

        if (!fxRate || !payoutAmount) {
            return res.status(400).json({ error: "FX Rate and Payout Amount are required" });
        }

        const request = await prisma.tradeRequest.findFirst({
            where: { 
                id, 
                OR: [
                    { agentId },
                    { status: "POOL" }
                ]
            }
        });

        if (!request) {
            return res.status(404).json({ error: "Trade request not found or not accessible" });
        }

        const updated = await (prisma.tradeRequest as any).update({
            where: { id },
            data: { 
                agentId,
                fxRate,
                payoutAmount,
                status: "QUOTED",
                quotedAt: new Date()
            }
        });

        res.json(updated);
    } catch (error) {
        console.error("Error setting trade request rate:", error);
        res.status(500).json({ error: "Failed to set rate" });
    }
}
