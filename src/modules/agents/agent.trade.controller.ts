import { Request, Response } from "express";
import prisma from "../../config/db";
import { assertTransition } from "../../utils/stateMachine";
import { getLockedRate } from "../fx/fx.service";
import { randomUUID } from "node:crypto";
import { sendSupplierConfirmedEmail, sendTradeCompletionEmail, sendTradeCancelledEmail } from "../../services/email.service";

export async function createTrade(req: Request, res: Response) {
    try {
        const agentId = (req as any).user.id;
        const file = (req as any).file;
        const {
            customerId: rawCustomerId,
            amount,
            sendCurrency,
            receiveCurrency,
            paymentMethod,
            paymentSource,
            payoutMethod,
            recipientName,
            recipientDetails,
            payoutAmount,
            tradeRequestId, // Optional link to request
        } = req.body;

        if (!rawCustomerId || rawCustomerId === 'temp-customer-id') {
            return res.status(400).json({ error: "A valid Customer must be selected to create a trade." });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: rawCustomerId }
        });

        if (!customer) {
            return res.status(404).json({ error: "Selected customer not found." });
        }

        // Cloudinary URL if uploaded
        const proofUrl = file ? file.path : null;

        // Resolve countryId: use first available country if not specified
        let resolvedCountryId = req.body.countryId;
        if (!resolvedCountryId) {
            const firstCountry = await prisma.country.findFirst();
            resolvedCountryId = firstCountry?.id || randomUUID(); // fallback
        }

        const trade = await prisma.trade.create({
            data: {
                agentId,
                customerId: customer.id,
                countryId: resolvedCountryId,
                amount: parseFloat(String(amount)) || 0,
                sendCurrency,
                receiveCurrency,
                status: proofUrl ? "PAYMENT_CONFIRMED" : "INITIATED",
                paymentMethod,
                paymentSource,
                payoutMethod,
                recipientName,
                recipientDetails,
                payoutAmount,
                paymentProofUrl: proofUrl,
            }
        });

        // If linked to a request, mark request as PROCESSED
        if (tradeRequestId) {
            await prisma.tradeRequest.updateMany({
                where: { id: tradeRequestId, agentId },
                data: { status: "PROCESSED" }
            });
        }

        await prisma.auditLog.create({
            data: {
                actorId: agentId,
                role: "AGENT",
                action: "TRADE_CREATED",
                entity: "Trade",
                entityId: trade.id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.status(201).json(trade);
    } catch (error: any) {
        const errorMsg = error?.message || "Unknown Error";
        console.error("Error creating trade!!", errorMsg, error);
        res.status(500).json({
            error: "Failed to create trade",
            message: errorMsg,
            details: error || {},
            requestBody: req.body
        });
    }
}

export async function verifyCustomer(req: Request, res: Response) {
    const trade = await prisma.trade.findUnique({
        where: { id: req.params.id }
    });

    if (!trade) throw new Error("Trade not found");

    assertTransition(trade.status, "CUSTOMER_VERIFIED");

    await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "CUSTOMER_VERIFIED" }
    });

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "AGENT",
            action: "CUSTOMER_VERIFIED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ verified: true });
}

export async function quoteTrade(req: Request, res: Response) {
    const trade = await prisma.trade.findUnique({
        where: { id: req.params.id },
        include: { customer: { include: { user: true } } }
    });

    if (!trade) throw new Error("Trade not found");

    assertTransition(trade.status, "QUOTED");

    const fxRate = await getLockedRate(
        trade.sendCurrency,
        trade.receiveCurrency,
        trade.countryId
    );

    await prisma.trade.update({
        where: { id: trade.id },
        data: {
            fxRate,
            lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
            status: "QUOTED"
        }
    });

    // Notify customer
    if (trade.customer?.email) {
        await sendSupplierConfirmedEmail({
            customerEmail: trade.customer.email,
            customerName: trade.customer.fullName,
            tradeId: trade.id.slice(0, 8).toUpperCase(),
            amount: trade.amount.toString(),
            currency: trade.sendCurrency,
            dashboardLink: `${process.env.FRONTEND_URL}/customer/trades/${trade.id}`
        });
    }

    // Notify admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
        await prisma.notification.create({
            data: {
                userId: admin.id,
                title: 'Agent Set Exchange Rate',
                message: `Agent has set the exchange rate for trade #${trade.id.slice(0, 8).toUpperCase()}.`,
                type: 'INFO',
            }
        });
    }

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "AGENT",
            action: "FX_QUOTED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ fxRate });
}

export async function sendToCustomer(req: Request, res: Response) {
    const trade = await prisma.trade.findUnique({
        where: { id: req.params.id },
        include: { customer: true }
    });

    if (!trade) throw new Error("Trade not found");

    assertTransition(trade.status, "SENT_TO_CUSTOMER");

    await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "SENT_TO_CUSTOMER" }
    });

    // Notify customer (if not already notified by QUOTED status, or as a follow up)
    if (trade.customer?.email) {
        await sendSupplierConfirmedEmail({
            customerEmail: trade.customer.email,
            customerName: trade.customer.fullName,
            tradeId: trade.id.slice(0, 8).toUpperCase(),
            amount: trade.amount.toString(),
            currency: trade.sendCurrency,
            dashboardLink: `${process.env.FRONTEND_URL}/customer/trades/${trade.id}`
        });
    }

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "AGENT",
            action: "SENT_TO_CUSTOMER",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ sent: true });
}

export async function confirmPayout(req: Request, res: Response) {
    try {
        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id },
            include: { customer: true }
        });

        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        if (trade.status !== "PAYMENT_CONFIRMED") {
            return res.status(403).json({ error: "Payment not verified" });
        }

        await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "COMPLETED" }
        });

        // Notify Customer
        if (trade.customer?.email) {
            await sendTradeCompletionEmail({
                email: trade.customer.email,
                customerName: trade.customer.fullName,
                tradeId: trade.id.slice(0, 8).toUpperCase(),
                amount: trade.amount.toString(),
                fromCurrency: trade.sendCurrency,
                toCurrency: trade.receiveCurrency,
                loginLink: `${process.env.FRONTEND_URL}/login`
            });
        }

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "AGENT",
                action: "PAYOUT_CONFIRMED",
                entity: "Trade",
                entityId: trade.id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, status: "COMPLETED" });
    } catch (error) {
        console.error("Error confirming payout:", error);
        res.status(500).json({ error: "Failed to confirm payout" });
    }
}

/**
 * Cancel or Reject a trade
 * POST /api/agent/trades/:id/cancel
 */
export async function cancelTrade(req: Request, res: Response) {
    try {
        const { reason } = req.body;
        const trade = await prisma.trade.findUnique({
            where: { id: req.params.id },
            include: { customer: true }
        });

        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CANCELLED" }
        });

        // Notify Customer
        if (trade.customer?.email) {
            await sendTradeCancelledEmail({
                customerEmail: trade.customer.email,
                customerName: trade.customer.fullName,
                tradeId: trade.id.slice(0, 8).toUpperCase(),
                reason,
                dashboardLink: `${process.env.FRONTEND_URL}/login`
            });
        }

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "AGENT",
                action: "TRADE_CANCELLED",
                entity: "Trade",
                entityId: trade.id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, status: "CANCELLED" });
    } catch (error) {
        console.error("Error cancelling trade:", error);
        res.status(500).json({ error: "Failed to cancel trade" });
    }
}
