import { Request, Response } from "express";
import prisma from "../../config/db";
import { createNotification } from "../notifications/notification.service";

/**
 * GET /api/admin/trade-requests
 * Admin views ALL trade requests across all customers
 */
export async function getAdminTradeRequests(req: Request, res: Response) {
    try {
        const { status } = req.query;

        const where: any = {};
        if (status && status !== "ALL") {
            // Include both PENDING and POOL under the PENDING tab for backwards compat
            if (status === "PENDING") {
                where.status = { in: ["PENDING", "POOL"] };
            } else {
                where.status = status;
            }
        }

        const requests = await prisma.tradeRequest.findMany({
            where,
            include: {
                customer: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                    },
                },
                agent: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        const formatted = requests.map((r: any) => ({
            id: r.id,
            amount: r.amount.toString(),
            sendCurrency: r.sendCurrency,
            receiveCurrency: r.receiveCurrency,
            purpose: r.purpose,
            tradeType: r.tradeType,
            status: r.status,
            createdAt: r.createdAt,
            customer: {
                id: r.customer.id,
                firstName: r.customer.fullName.split(" ")[0] || "",
                lastName: r.customer.fullName.split(" ").slice(1).join(" ") || "",
                email: r.customer.email || "",
                phone: r.customer.phone || "",
            },
            assignedAgent: r.agent
                ? {
                      id: r.agent.id,
                      firstName: r.agent.firstName || "",
                      lastName: r.agent.lastName || "",
                      email: r.agent.email || "",
                  }
                : null,
            supplierDetails: {
                businessName: r.supplierBusinessName,
                bankName: r.supplierBankName,
                accountNumber: r.supplierAccountNumber,
                sector: r.supplierSector,
                address: r.supplierAddress,
            },
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching admin trade requests:", error);
        res.status(500).json({ error: "Failed to fetch trade requests" });
    }
}

/**
 * PATCH /api/admin/trade-requests/:id/assign
 * Admin assigns an agent to a trade request
 */
export async function assignAgentToRequest(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { agentId } = req.body;

        if (!agentId) return res.status(400).json({ error: "agentId is required" });

        const request = await prisma.tradeRequest.findUnique({ where: { id } });
        if (!request) return res.status(404).json({ error: "Trade request not found" });

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: { agentId, status: "ASSIGNED" },
            include: {
                customer: { select: { fullName: true, email: true } },
                agent: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
        });

        // Notify the assigned agent
        await createNotification(
            agentId,
            "New Trade Request Assigned",
            `You have been assigned a trade request from ${(updated as any).customer.fullName}. Amount: ${request.amount} ${request.sendCurrency}.`,
            "INFO"
        );

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "TRADE_REQUEST_ASSIGNED",
                entity: "TradeRequest",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json(updated);
    } catch (error) {
        console.error("Error assigning agent:", error);
        res.status(500).json({ error: "Failed to assign agent" });
    }
}

/**
 * PATCH /api/admin/trade-requests/:id/approve
 * Admin approves a trade request
 */
export async function approveTradeRequest(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({ where: { id } });
        if (!request) return res.status(404).json({ error: "Trade request not found" });

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: { status: "PROCESSED" },
        });

        // Notify customer
        const customer = await prisma.customer.findUnique({ where: { id: request.customerId } });
        if (customer?.userId) {
            await createNotification(
                customer.userId,
                "Trade Request Approved",
                `Your trade request for ${request.amount} ${request.sendCurrency} has been approved and is being processed.`,
                "SUCCESS"
            );
        }

        res.json(updated);
    } catch (error) {
        console.error("Error approving trade request:", error);
        res.status(500).json({ error: "Failed to approve trade request" });
    }
}

/**
 * PATCH /api/admin/trade-requests/:id/reject
 * Admin rejects a trade request
 */
export async function rejectTradeRequest(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const request = await prisma.tradeRequest.findUnique({ where: { id } });
        if (!request) return res.status(404).json({ error: "Trade request not found" });

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: { status: "REJECTED" },
        });

        // Notify customer
        const customer = await prisma.customer.findUnique({ where: { id: request.customerId } });
        if (customer?.userId) {
            await createNotification(
                customer.userId,
                "Trade Request Rejected",
                `Your trade request for ${request.amount} ${request.sendCurrency} has been rejected.${reason ? " Reason: " + reason : ""}`,
                "ERROR"
            );
        }

        res.json(updated);
    } catch (error) {
        console.error("Error rejecting trade request:", error);
        res.status(500).json({ error: "Failed to reject trade request" });
    }
}

/**
 * PATCH /api/admin/trade-requests/:id/process
 * Admin processes (creates trade from) the request
 */
export async function processTradeRequest(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({
            where: { id },
            include: { customer: true },
        });
        if (!request) return res.status(404).json({ error: "Trade request not found" });
        if (request.status === "PROCESSED") {
            return res.status(400).json({ error: "Request already processed" });
        }

        // Assign to system agent or admin if no agent
        const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        const agentId = request.agentId || adminUser?.id;

        if (!agentId) {
            return res.status(400).json({ error: "No agent available to process this request" });
        }

        // Resolve countryId
        const firstCountry = await prisma.country.findFirst();
        const countryId = firstCountry?.id || "ng";

        // Create the trade
        const trade = await prisma.trade.create({
            data: {
                agentId,
                customerId: request.customerId,
                countryId,
                tradeType: request.tradeType,
                sendCurrency: request.sendCurrency,
                receiveCurrency: request.receiveCurrency,
                amount: request.amount,
                status: "INITIATED",
                tradeRequestId: request.id,
                // Copy supplier details from request
                supplierBusinessName: request.supplierBusinessName,
                supplierBankName: request.supplierBankName,
                supplierAccountNumber: request.supplierAccountNumber,
                supplierSector: request.supplierSector,
                supplierAddress: request.supplierAddress,
            } as any,
        });

        // Mark request as processed
        await prisma.tradeRequest.update({
            where: { id },
            data: { status: "PROCESSED" },
        });

        // Notify customer
        if (request.customer?.userId) {
            await createNotification(
                request.customer.userId,
                "Trade Created",
                `Your trade request has been processed. Trade ID: ${trade.id.slice(0, 8).toUpperCase()}. Admin will contact you with payment details shortly.`,
                "SUCCESS"
            );
        }

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "TRADE_REQUEST_PROCESSED",
                entity: "Trade",
                entityId: trade.id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ trade, tradeRequest: { id, status: "PROCESSED" } });
    } catch (error) {
        console.error("Error processing trade request:", error);
        res.status(500).json({ error: "Failed to process trade request" });
    }
}

/**
 * GET /api/admin/trade-requests/:id
 * Get a single trade request with linked Trade (if processed) and agent rate
 */
export async function getAdminTradeRequest(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({
            where: { id },
            include: {
                customer: {
                    select: { id: true, fullName: true, email: true, phone: true },
                },
                agent: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
            },
        });

        if (!request) return res.status(404).json({ error: "Trade request not found" });

        // Find linked Trade (created from this request)
        const linkedTrade = await (prisma.trade as any).findFirst({
            where: { tradeRequestId: id },
            select: {
                id: true,
                status: true,
                fxRate: true,
                payoutAmount: true,
                receiptUrl: true,
                createdAt: true,
                agentId: true,
                agent: { select: { id: true, firstName: true, lastName: true } },
            },
        });

        res.json({
            id: request.id,
            amount: request.amount.toString(),
            sendCurrency: request.sendCurrency,
            receiveCurrency: request.receiveCurrency,
            purpose: request.purpose,
            tradeType: request.tradeType,
            status: request.status,
            createdAt: request.createdAt,
            customer: {
                id: (request as any).customer.id,
                firstName: (request as any).customer.fullName.split(" ")[0] || "",
                lastName: (request as any).customer.fullName.split(" ").slice(1).join(" ") || "",
                email: (request as any).customer.email || "",
                phone: (request as any).customer.phone || "",
            },
            assignedAgent: (request as any).agent
                ? {
                    id: (request as any).agent.id,
                    firstName: (request as any).agent.firstName || "",
                    lastName: (request as any).agent.lastName || "",
                    email: (request as any).agent.email || "",
                }
                : null,
            supplierDetails: {
                businessName: (request as any).supplierBusinessName,
                bankName: (request as any).supplierBankName,
                accountNumber: (request as any).supplierAccountNumber,
                sector: (request as any).supplierSector,
                address: (request as any).supplierAddress,
            },
            linkedTrade: linkedTrade
                ? {
                    id: linkedTrade.id,
                    status: linkedTrade.status,
                    fxRate: linkedTrade.fxRate ? linkedTrade.fxRate.toString() : null,
                    payoutAmount: linkedTrade.payoutAmount,
                    receiptUrl: linkedTrade.receiptUrl,
                    createdAt: linkedTrade.createdAt,
                    agent: linkedTrade.agent,
                }
                : null,
        });
    } catch (error) {
        console.error("Error fetching trade request:", error);
        res.status(500).json({ error: "Failed to fetch trade request" });
    }
}
