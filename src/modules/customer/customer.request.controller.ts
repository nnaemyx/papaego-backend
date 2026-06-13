import { Request, Response } from "express";
import prisma from "../../config/db";
import { sendTradeInitiatedEmail } from "../../services/email.service";
import { createNotification } from "../notifications/notification.service";

/**
 * Customer initiates a trade request
 * POST /api/customer/portal/trade-requests
 */
export async function createTradeRequest(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        if (!customerId) {
            return res.status(403).json({ error: "Customer profile not found" });
        }

        const {
            amount,
            sendCurrency,
            receiveCurrency,
            agentId,
            purpose,
            tradeType,
            receiptUrl,
            invoiceUrl,
            supplierId,
            // Fallback raw fields if supplierId is not used
            businessName,
            bankName,
            accountNumber,
            sector,
            address,
        } = req.body;

        if (!amount) {
            return res.status(400).json({ error: "Amount is required" });
        }

        let actualSupplierBusinessName = businessName || null;
        let actualSupplierBankName = bankName || null;
        let actualSupplierAccountNumber = accountNumber || null;
        let actualSupplierSector = sector || null;
        let actualSupplierAddress = address || null;

        if (supplierId) {
            const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
            if (supplier && supplier.customerId === customerId) {
                actualSupplierBusinessName = supplier.beneficiaryName;
                actualSupplierBankName = supplier.bankName;
                actualSupplierAccountNumber = supplier.accountNumber;
                actualSupplierSector = supplier.routingCode; // Using routing code as sector mapping fallback
                actualSupplierAddress = supplier.address;
            }
        }

        const tradeRequest = await prisma.tradeRequest.create({
            data: {
                customerId,
                agentId: agentId || null,
                amount: parseFloat(String(amount)),
                sendCurrency,
                receiveCurrency,
                purpose,
                tradeType: tradeType || "BUY",
                receiptUrl,
                status: req.body.status === "DRAFT" ? "DRAFT" : "PENDING",
                invoiceUrl,
                supplierId: supplierId || null,
                supplierBusinessName: actualSupplierBusinessName,
                supplierBankName: actualSupplierBankName,
                supplierAccountNumber: actualSupplierAccountNumber,
                supplierSector: actualSupplierSector,
                supplierAddress: actualSupplierAddress,
            },
            include: {
                customer: { include: { user: true } },
                agent: true,
            },
        });

        if (tradeRequest.status !== "DRAFT") {
            // Notify all ADMIN users about the new trade request
            const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
            await Promise.allSettled(
                admins.map((admin) =>
                    createNotification(
                        admin.id,
                        "New Trade Request",
                        `Customer ${tradeRequest.customer.fullName || 'Unknown'} has submitted a trade request for ${amount} ${sendCurrency} → ${receiveCurrency}.`,
                        "INFO"
                    )
                )
            );

            // Also notify agent and admins via email
            const adminEmails = admins.map(a => a.email).filter((e): e is string => !!e);
            if (tradeRequest.agent?.email) {
                await sendTradeInitiatedEmail({
                    agentEmail: tradeRequest.agent.email,
                    agentName: tradeRequest.agent.firstName || "Agent",
                    customerName: tradeRequest.customer.fullName || 'Unknown',
                    amount: amount.toString(),
                    currency: sendCurrency,
                    tradeId: tradeRequest.id.slice(0, 8).toUpperCase(),
                    adminEmails,
                });
            }
        }

        res.status(201).json(tradeRequest);
    } catch (error) {
        console.error("Error creating trade request:", error);
        res.status(500).json({ error: "Failed to initiate trade request" });
    }
}

/**
 * Get customer's trade requests
 * GET /api/customer/portal/trade-requests
 */
export async function getCustomerTradeRequests(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { page = 1, limit = 20, search } = req.query;

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const where: any = { customerId };
        if (search) {
            const cleanSearch = (search as string).trim().toLowerCase();
            const rawIdSearch = cleanSearch.replace("pe-", "");
            where.AND = [
                {
                    OR: [
                        { id: { contains: rawIdSearch } },
                        { supplierBusinessName: { contains: cleanSearch, mode: "insensitive" } },
                        { sendCurrency: { contains: cleanSearch, mode: "insensitive" } },
                        { receiveCurrency: { contains: cleanSearch, mode: "insensitive" } },
                    ]
                }
            ];
        }

        const [requests, total] = await Promise.all([
            prisma.tradeRequest.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.tradeRequest.count({ where })
        ]);

        // Fetch linked trades to find their IDs
        const requestIds = requests.map((r) => r.id);
        const linkedTrades = await prisma.trade.findMany({
            where: { tradeRequestId: { in: requestIds } },
            select: { id: true, tradeRequestId: true },
        });

        const tradeMap = new Map(
            linkedTrades.map((t) => [t.tradeRequestId, t.id])
        );

        const requestsWithLinkedTrade = requests.map((r) => ({
            ...r,
            linkedTradeId: tradeMap.get(r.id) || null,
        }));

        res.json({ requests: requestsWithLinkedTrade, total, page: Number(page), limit: Number(limit) });
    } catch (error) {
        console.error("Error fetching customer trade requests:", error);
        res.status(500).json({ error: "Failed to fetch trade requests" });
    }
}

/**
 * Get a single customer trade request by ID
 * GET /api/customer/portal/trade-requests/:id
 */
export async function getTradeRequestById(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findFirst({
            where: { id, customerId },
        });

        if (!request) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        const linkedTrade = await prisma.trade.findFirst({
            where: { tradeRequestId: id },
            select: { id: true },
        });

        res.json({
            ...request,
            linkedTradeId: linkedTrade?.id || null,
        });
    } catch (error) {
        console.error("Error fetching trade request by ID:", error);
        res.status(500).json({ error: "Failed to fetch trade request" });
    }
}

/**
 * Update customer's trade request (draft or pending)
 * PUT /api/customer/portal/trade-requests/:id
 */
export async function updateCustomerTradeRequest(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({
            where: { id }
        });

        if (!request || request.customerId !== customerId) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        if (request.status !== "DRAFT" && request.status !== "PENDING" && request.status !== "POOL") {
            return res.status(400).json({ error: "Only draft, pending, or pool trade requests can be updated" });
        }

        const {
            amount,
            sendCurrency,
            receiveCurrency,
            purpose,
            tradeType,
            receiptUrl,
            invoiceUrl,
            supplierId,
            businessName,
            bankName,
            accountNumber,
            sector,
            address,
            status, // e.g. publish from DRAFT to PENDING
        } = req.body;

        let actualSupplierBusinessName = businessName !== undefined ? businessName : request.supplierBusinessName;
        let actualSupplierBankName = bankName !== undefined ? bankName : request.supplierBankName;
        let actualSupplierAccountNumber = accountNumber !== undefined ? accountNumber : request.supplierAccountNumber;
        let actualSupplierSector = sector !== undefined ? sector : request.supplierSector;
        let actualSupplierAddress = address !== undefined ? address : request.supplierAddress;

        if (supplierId) {
            const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
            if (supplier && supplier.customerId === customerId) {
                actualSupplierBusinessName = supplier.beneficiaryName;
                actualSupplierBankName = supplier.bankName;
                actualSupplierAccountNumber = supplier.accountNumber;
                actualSupplierSector = supplier.routingCode;
                actualSupplierAddress = supplier.address;
            }
        }

        const oldStatus = request.status;
        const newStatus = status === "PENDING" ? "PENDING" : request.status;

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: {
                amount: amount !== undefined ? parseFloat(String(amount)) : undefined,
                sendCurrency,
                receiveCurrency,
                purpose,
                tradeType,
                receiptUrl,
                invoiceUrl,
                supplierId: supplierId || undefined,
                supplierBusinessName: actualSupplierBusinessName,
                supplierBankName: actualSupplierBankName,
                supplierAccountNumber: actualSupplierAccountNumber,
                supplierSector: actualSupplierSector,
                supplierAddress: actualSupplierAddress,
                status: newStatus,
            },
            include: {
                customer: { include: { user: true } },
                agent: true,
            }
        });

        // If transitioning from DRAFT to PENDING, notify admins & agents
        if (oldStatus === "DRAFT" && newStatus === "PENDING") {
            const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
            await Promise.allSettled(
                admins.map((admin) =>
                    createNotification(
                        admin.id,
                        "New Trade Request (Published)",
                        `Customer ${updated.customer.fullName || 'Unknown'} has submitted a trade request for ${updated.amount} ${updated.sendCurrency} → ${updated.receiveCurrency}.`,
                        "INFO"
                    )
                )
            );

            const adminEmails = admins.map(a => a.email).filter((e): e is string => !!e);
            if (updated.agent?.email) {
                await sendTradeInitiatedEmail({
                    agentEmail: updated.agent.email,
                    agentName: updated.agent.firstName || "Agent",
                    customerName: updated.customer.fullName || 'Unknown',
                    amount: updated.amount.toString(),
                    currency: updated.sendCurrency,
                    tradeId: updated.id.slice(0, 8).toUpperCase(),
                    adminEmails,
                });
            }
        }

        res.json(updated);
    } catch (error) {
        console.error("Error updating trade request:", error);
        res.status(500).json({ error: "Failed to update trade request" });
    }
}

/**
 * Cancel customer's trade request
 * PATCH /api/customer/portal/trade-requests/:id/cancel
 */
export async function cancelCustomerTradeRequest(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({ where: { id } });
        if (!request || request.customerId !== customerId) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        if (request.status === "PROCESSED" || request.status === "REJECTED" || request.status === "CANCELLED") {
            return res.status(400).json({ error: `Cannot cancel request in ${request.status} status` });
        }

        const updated = await prisma.tradeRequest.update({
            where: { id },
            data: { status: "CANCELLED" }
        });

        // Notify assigned agent (if any) or admin
        if (request.agentId) {
            await createNotification(
                request.agentId,
                "Trade Request Cancelled",
                `Customer has cancelled their trade request #${request.id.slice(0, 8).toUpperCase()}.`,
                "WARNING"
            );
        }

        res.json(updated);
    } catch (error) {
        console.error("Error cancelling trade request:", error);
        res.status(500).json({ error: "Failed to cancel trade request" });
    }
}
