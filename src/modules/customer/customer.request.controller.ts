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
            // Supplier details (new)
            businessName,
            bankName,
            accountNumber,
            sector,
            address,
        } = req.body;

        if (!amount) {
            return res.status(400).json({ error: "Amount is required" });
        }

        if (businessName && bankName && accountNumber) {
            try {
                const existingLink = await prisma.supplierCustomer.findFirst({
                    where: {
                        customerId,
                        supplier: { bankName, accountNumber }
                    }
                });
                if (!existingLink) {
                    // Check if a supplier with this bank+account already exists (avoid duplicates)
                    const existingSupplier = await prisma.supplier.findFirst({
                        where: { bankName, accountNumber }
                    });
                    if (existingSupplier) {
                        // Just link this customer to the existing supplier
                        await prisma.supplierCustomer.create({
                            data: { supplierId: existingSupplier.id, customerId }
                        });
                    } else {
                        await prisma.supplier.create({
                            data: {
                                businessName,
                                bankName,
                                accountNumber,
                                sector: sector || "Other",
                                address: address || null,
                                linkedCustomers: {
                                    create: { customerId }
                                }
                            }
                        });
                    }
                }
            } catch (supplierErr) {
                // Non-fatal — supplier linking fails silently, trade request still goes through
                console.error("Supplier creation/linking failed (non-fatal):", supplierErr);
            }
        }

        const tradeRequest = await (prisma.tradeRequest as any).create({
            data: {
                customerId,
                agentId: agentId || null,
                amount: parseFloat(String(amount)),
                sendCurrency,
                receiveCurrency,
                purpose,
                tradeType: tradeType || "BUY",
                receiptUrl,
                status: "PENDING", // Admin sees all PENDING requests
                // Store supplier details on the request
                supplierBusinessName: businessName || null,
                supplierBankName: bankName || null,
                supplierAccountNumber: accountNumber || null,
                supplierSector: sector || null,
                supplierAddress: address || null,
            } as any,
            include: {
                customer: true,
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
                    `Customer ${(tradeRequest as any).customer.fullName} has submitted a trade request for ${amount} ${sendCurrency} → ${receiveCurrency}.`,
                    "INFO"
                )
            )
        );

        // Also notify agent and admins via email
        const adminEmails = admins.map(a => a.email).filter((e): e is string => !!e);
        if ((tradeRequest as any).agent?.email) {
            await sendTradeInitiatedEmail({
                agentEmail: (tradeRequest as any).agent.email,
                agentName: (tradeRequest as any).agent.firstName || "Agent",
                customerName: (tradeRequest as any).customer.fullName,
                amount: amount.toString(),
                currency: sendCurrency,
                tradeId: (tradeRequest as any).id.slice(0, 8).toUpperCase(),
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
