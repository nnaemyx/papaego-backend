import { Request, Response } from "express";
import prisma from "../../config/db";
import { sendTradeInitiatedEmail } from "../../services/email.service";

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
            agentId, // Now optional
            purpose,
            tradeType, // BUY or SELL
            receiptUrl // Uploaded receipt URL
        } = req.body;

        if (!amount) {
            return res.status(400).json({ error: "Amount is required" });
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
                status: agentId ? "PENDING" : "POOL"
            },
            include: {
                customer: true,
                agent: true
            }
        });

        // Notify Agent via Email if specifically assigned
        if ((tradeRequest as any).agent?.email) {
            await sendTradeInitiatedEmail({
                agentEmail: (tradeRequest as any).agent.email,
                agentName: (tradeRequest as any).agent.firstName || "Agent",
                customerName: (tradeRequest as any).customer.fullName,
                amount: amount.toString(),
                currency: sendCurrency,
                tradeId: (tradeRequest as any).id.slice(0, 8).toUpperCase()
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
            orderBy: { createdAt: "desc" }
        });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch trade requests" });
    }
}
