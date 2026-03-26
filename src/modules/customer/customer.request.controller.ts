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
            const existingLink = await prisma.supplierCustomer.findFirst({
                where: {
                    customerId,
                    supplier: { bankName, accountNumber }
                }
            });
            if (!existingLink) {
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

        // Also notify agent via email if specifically assigned
        if ((tradeRequest as any).agent?.email) {
            await sendTradeInitiatedEmail({
                agentEmail: (tradeRequest as any).agent.email,
                agentName: (tradeRequest as any).agent.firstName || "Agent",
                customerName: (tradeRequest as any).customer.fullName,
                amount: amount.toString(),
                currency: sendCurrency,
                tradeId: (tradeRequest as any).id.slice(0, 8).toUpperCase(),
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
        const requests = await prisma.tradeRequest.findMany({
            where: { customerId },
            orderBy: { createdAt: "desc" },
        });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch trade requests" });
    }
}
