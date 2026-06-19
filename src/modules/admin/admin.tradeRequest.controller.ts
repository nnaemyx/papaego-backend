import { Request, Response } from "express";
import prisma from "../../config/db";
import { createNotification } from "../notifications/notification.service";
import { sendPaymentDetailsEmail, sendRateQuotedEmail } from "../../services/email.service";

/**
 * GET /api/admin/trade-requests
 * Admin views ALL trade requests across all customers
 */
export async function getAdminTradeRequests(req: Request, res: Response) {
    try {
        const { status, page = 1, limit = 20, search } = req.query;

        const where: any = {};
        if (status && status !== "ALL") {
            // Include both PENDING and POOL under the PENDING tab for backwards compat
            if (status === "PENDING") {
                where.status = { in: ["PENDING", "POOL"] };
            } else {
                where.status = status;
            }
        }

        if (search) {
            const cleanSearch = (search as string).trim().toLowerCase();
            const rawIdSearch = cleanSearch.replace("#pe-", "").replace("pe-", "");
            where.OR = [
                { id: { contains: rawIdSearch } },
                { sendCurrency: { contains: cleanSearch, mode: 'insensitive' } },
                { receiveCurrency: { contains: cleanSearch, mode: 'insensitive' } },
                { purpose: { contains: cleanSearch, mode: 'insensitive' } },
                { supplierBusinessName: { contains: cleanSearch, mode: 'insensitive' } },
                {
                    customer: {
                        fullName: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    customer: {
                        email: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    agent: {
                        firstName: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    agent: {
                        lastName: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    agent: {
                        email: { contains: cleanSearch, mode: 'insensitive' }
                    }
                }
            ];
        }

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const [requests, total] = await Promise.all([
            prisma.tradeRequest.findMany({
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
                skip,
                take,
            }),
            prisma.tradeRequest.count({ where })
        ]);

        const formatted = requests.map((r: any) => ({
            id: r.id,
            amount: r.amount.toString(),
            sendCurrency: r.sendCurrency,
            receiveCurrency: r.receiveCurrency,
            purpose: r.purpose,
            tradeType: r.tradeType,
            status: r.status,
            createdAt: r.createdAt,
            fxRate: r.fxRate ? r.fxRate.toString() : null,
            payoutAmount: r.payoutAmount ? r.payoutAmount.toString() : null,
            quotedAt: r.quotedAt,
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
                invoiceUrl: r.invoiceUrl,
            },
            negotiatedRate: r.negotiatedRate ? r.negotiatedRate.toString() : null,
            originalFxRate: r.originalFxRate ? r.originalFxRate.toString() : null,
            negotiationUsed: r.negotiationUsed,
        }));

        res.json({ requests: formatted, total, page: Number(page), limit: Number(limit) });
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
        const { paymentAccountName, paymentAccountNumber, paymentBankName, paymentAmount } = req.body;

        const request = await prisma.tradeRequest.findUnique({
            where: { id },
            include: { customer: true },
        });
        if (!request) return res.status(404).json({ error: "Trade request not found" });
        if (request.status === "PROCESSED") {
            return res.status(400).json({ error: "Request already processed" });
        }

        // Process the trade with agent attribution: use referring agent if available
        const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        const referringAgentId = request.customer?.referringAgentId;
        const agentId = request.agentId || referringAgentId || adminUser?.id;

        // Resolve countryId (optional — Trade.countryId is now nullable)
        const firstCountry = await prisma.country.findFirst();
        const countryId = firstCountry?.id ?? null;

        // Create the trade
        const trade = await (prisma.trade as any).create({
            data: {
                agentId,
                customerId: request.customerId,
                countryId,
                tradeType: request.tradeType || "BUY",
                sendCurrency: request.sendCurrency,
                receiveCurrency: request.receiveCurrency,
                amount: request.amount,
                fxRate: (request as any).fxRate ?? null,
                payoutAmount: (request as any).payoutAmount ? String((request as any).payoutAmount) : null,
                tradeRequestId: request.id,
                // Copy supplier details from request
                supplierBusinessName: (request as any).supplierBusinessName ?? null,
                supplierBankName: (request as any).supplierBankName ?? null,
                supplierAccountNumber: (request as any).supplierAccountNumber ?? null,
                supplierSector: (request as any).supplierSector ?? null,
                supplierAddress: (request as any).supplierAddress ?? null,

                paymentAccountName: paymentAccountName || null,
                paymentAccountNumber: paymentAccountNumber || null,
                paymentBankName: paymentBankName || null,
                paymentAmount: paymentAmount ? Number(paymentAmount) : null,
                status: paymentAccountNumber ? "AWAITING_PAYMENT" : "INITIATED",
                lockedUntil: (request as any).fxRate ? new Date(Date.now() + 10 * 60 * 1000) : null,
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
                "Payment Details Ready",
                `Your trade #${trade.id.slice(0, 8).toUpperCase()} has been processed. Payment details have been provided.`,
                "SUCCESS"
            );
            
            if (paymentAccountNumber && paymentAccountName && paymentBankName) {
                await sendPaymentDetailsEmail({
                    customerEmail: request.customer.email as string,
                    customerName: request.customer.fullName as string,
                    tradeId: trade.id.slice(0, 8).toUpperCase(),
                    amount: paymentAmount ? String(paymentAmount) : String(request.amount),
                    currency: request.sendCurrency,
                    paymentBankName: String(paymentBankName),
                    paymentAccountName: String(paymentAccountName),
                    paymentAccountNumber: String(paymentAccountNumber),
                    dashboardLink: `${process.env.FRONTEND_URL || "http://localhost:3000"}/customer/trades/${trade.id}`,
                });
            }
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
                    select: { id: true, fullName: true, email: true, phone: true, referringAgentId: true },
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
                paymentProofUrl: true,
                paymentBankName: true,
                paymentAccountNumber: true,
                paymentAccountName: true,
                createdAt: true,
                agentId: true,
                agent: { select: { id: true, firstName: true, lastName: true } },
            },
        });

        let resolvedLinkedTradeAgent = linkedTrade?.agent || null;
        if (linkedTrade && request?.customer?.referringAgentId) {
            const referringAgentUser = await prisma.user.findUnique({
                where: { id: request.customer.referringAgentId },
                select: { id: true, firstName: true, lastName: true }
            });
            if (referringAgentUser) {
                resolvedLinkedTradeAgent = referringAgentUser;
            }
        }

        res.json({
            id: request.id,
            amount: request.amount.toString(),
            sendCurrency: request.sendCurrency,
            receiveCurrency: request.receiveCurrency,
            purpose: request.purpose,
            tradeType: request.tradeType,
            status: request.status,
            createdAt: request.createdAt,
            fxRate: (request as any).fxRate ? (request as any).fxRate.toString() : null,
            payoutAmount: (request as any).payoutAmount ? (request as any).payoutAmount.toString() : null,
            quotedAt: (request as any).quotedAt,
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
                invoiceUrl: (request as any).invoiceUrl,
            },
            negotiatedRate: request.negotiatedRate ? request.negotiatedRate.toString() : null,
            originalFxRate: request.originalFxRate ? request.originalFxRate.toString() : null,
            negotiationUsed: request.negotiationUsed,
            linkedTrade: linkedTrade
                ? {
                    id: linkedTrade.id,
                    status: linkedTrade.status,
                    fxRate: linkedTrade.fxRate ? linkedTrade.fxRate.toString() : null,
                    payoutAmount: linkedTrade.payoutAmount,
                    receiptUrl: (linkedTrade as any).receiptUrl,
                    paymentProofUrl: (linkedTrade as any).paymentProofUrl,
                    paymentBankName: (linkedTrade as any).paymentBankName,
                    paymentAccountNumber: (linkedTrade as any).paymentAccountNumber,
                    paymentAccountName: (linkedTrade as any).paymentAccountName,
                    createdAt: linkedTrade.createdAt,
                    agent: resolvedLinkedTradeAgent,
                }
                : null,
        });
    } catch (error) {
        console.error("Error fetching trade request:", error);
        res.status(500).json({ error: "Failed to fetch trade request" });
    }
}

/**
 * DELETE /api/admin/trade-requests/:id
 * Admin deletes a trade request
 */
export async function deleteTradeRequest(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const request = await prisma.tradeRequest.findUnique({ where: { id } });
        if (!request) return res.status(404).json({ error: "Trade request not found" });

        await prisma.tradeRequest.delete({ where: { id } });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "TRADE_REQUEST_DELETED",
                entity: "TradeRequest",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true, message: "Trade request deleted successfully" });
    } catch (error) {
        console.error("Error deleting trade request:", error);
        res.status(500).json({ error: "Failed to delete trade request" });
    }
}

/**
 * PATCH /api/admin/trade-requests/:id/set-rate
 * Admin sets the FX rate for a trade request
 */
export async function setTradeRequestRate(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { fxRate, payoutAmount } = req.body;

        if (!fxRate || !payoutAmount) {
            return res.status(400).json({ error: "fxRate and payoutAmount are required" });
        }

        const request = await prisma.tradeRequest.findUnique({
            where: { id },
            include: { customer: true },
        });

        if (!request) return res.status(404).json({ error: "Trade request not found" });

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: {
                fxRate: Number(fxRate),
                payoutAmount: Number(payoutAmount),
                status: "QUOTED", // Optional: Update status or leave as PENDING
                quotedAt: new Date(),
            },
        });

        // Notify customer
        if (request.customer?.userId) {
            await createNotification(
                request.customer.userId,
                "Exchange Rate Set",
                `The exchange rate for your trade request has been set to 1 ${request.sendCurrency === 'NGN' ? request.receiveCurrency : request.sendCurrency} = ${fxRate} NGN.`,
                "SUCCESS"
            );
            
            await sendRateQuotedEmail({
                customerEmail: request.customer.email as string,
                customerName: request.customer.fullName as string,
                tradeId: id.slice(0, 8).toUpperCase(),
                amount: String(request.amount),
                currency: request.sendCurrency,
                fxRate: String(fxRate),
                payoutAmount: String(payoutAmount),
                receiveCurrency: request.receiveCurrency,
                dashboardLink: `${process.env.FRONTEND_URL || "http://localhost:3000"}/customer/trade-requests/${id}`,
            });
        }

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "TRADE_REQUEST_RATE_SET",
                entity: "TradeRequest",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json(updated);
    } catch (error) {
        console.error("Error setting trade request rate:", error);
        res.status(500).json({ error: "Failed to set exchange rate" });
    }
}
