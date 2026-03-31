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
                status: "PENDING",
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
        const { page = 1, limit = 20 } = req.query;

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const [requests, total] = await Promise.all([
            prisma.tradeRequest.findMany({
                where: { customerId },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.tradeRequest.count({ where: { customerId } })
        ]);

        res.json({ requests, total, page: Number(page), limit: Number(limit) });
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

        res.json(request);
    } catch (error) {
        console.error("Error fetching trade request by ID:", error);
        res.status(500).json({ error: "Failed to fetch trade request" });
    }
}
