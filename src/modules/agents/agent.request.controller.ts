import { Request, Response } from "express";
import prisma from "../../config/db";
import { sendSupplierConfirmedEmail } from "../../services/email.service";
import { releaseReservation } from "../wallet/wallet.service";

// Trade request states in which wallet funds are reserved (held). Used to
// decide whether rejecting a request should release a held reservation.
const RESERVED_STATES = ["PENDING", "POOL", "ASSIGNED", "QUOTED"] as const;


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

        // Rejecting releases any held wallet funds back to available, atomically
        // with the status change so the ledger never drifts from the request.
        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.tradeRequest.update({
                where: { id },
                data: { status: "REJECTED" }
            });

            if ((RESERVED_STATES as readonly string[]).includes(request.status)) {
                await releaseReservation(
                    request.customerId,
                    Number(request.amount),
                    {
                        description: `Funds released after agent rejected trade request ${request.id.slice(0, 8).toUpperCase()}`,
                        tradeRequestId: request.id,
                        actorId: agentId,
                    },
                    tx
                );
            }

            return u;
        });

        res.json(updated);
    } catch (error) {
        console.error("Error rejecting trade request:", error);
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
            },
            include: {
                customer: { include: { user: true } }
            }
        });

        // --- Email & In-App Notifications ---
        try {
            const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, email: true } });
            const adminEmails = admins.map((a: any) => a.email).filter((e: any): e is string => !!e);

            const customerEmail = updated.customer?.email || updated.customer?.user?.email;
            const customerName = updated.customer?.fullName || "Customer";
            const tradeRef = updated.id.slice(0, 8).toUpperCase();

            if (customerEmail) {
                await sendSupplierConfirmedEmail({
                    customerEmail,
                    customerName,
                    tradeId: tradeRef,
                    amount: updated.amount.toString(),
                    currency: updated.sendCurrency,
                    fxRate: updated.fxRate?.toString(),
                    payoutAmount: updated.payoutAmount?.toString(),
                    receiveCurrency: updated.receiveCurrency,
                    dashboardLink: `${process.env.FRONTEND_URL}/customer/trade-requests/${updated.id}`,
                    adminEmails,
                });
            }

            // In-app notifications for admins
            await Promise.allSettled(
                admins.map((admin: any) =>
                    prisma.notification.create({
                        data: {
                            userId: admin.id,
                            title: "Agent Set Exchange Rate",
                            message: `Agent has quoted a rate for trade request #${tradeRef}.`,
                            type: "INFO",
                        },
                    })
                )
            );
        } catch (notifyError) {
            // Don't fail the whole request if notifications error out
            console.error("Error sending quote notifications:", notifyError);
        }

        res.json(updated);
    } catch (error) {
        console.error("Error setting trade request rate:", error);
        res.status(500).json({ error: "Failed to set rate" });
    }
}
