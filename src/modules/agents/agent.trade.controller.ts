import { Request, Response } from "express";
import prisma from "../../config/db";
import { assertTransition } from "../../utils/stateMachine";
import { getLockedRate } from "../fx/fx.service";
import { randomUUID } from "node:crypto";

export async function createTrade(req: Request, res: Response) {
    const agentId = (req as any).user.id;
    const {
        // Legacy field: if a real UUID customer ID is passed, use it directly
        customerId: rawCustomerId,
        // New fields from the trade form
        customerName,
        customerEmail,
        customerPhone,
        customerCountry,
        amount,
        sendCurrency,
        receiveCurrency,
        // New fields
        paymentMethod,
        paymentSource,
        payoutMethod,
        recipientName,
        recipientDetails,
        payoutAmount,
        paymentProofUrl,
    } = req.body;

    let resolvedCustomerId: string | null = null;

    // Validate rawCustomerId if provided
    if (rawCustomerId && rawCustomerId !== 'temp-customer-id' && rawCustomerId.length > 20) {
        resolvedCustomerId = rawCustomerId;
    }

    // If no valid ID, find or create
    if (!resolvedCustomerId) {
        // 1. Try to find existing customer profile by email
        if (customerEmail) {
            const existingCustomer = await prisma.customer.findFirst({
                where: { email: { equals: customerEmail, mode: 'insensitive' } }
            });

            if (existingCustomer) {
                resolvedCustomerId = existingCustomer.id;
            }
        }

        // 2. If still no customer, check if a User exists with this email
        if (!resolvedCustomerId && customerEmail) {
            const existingUser = await prisma.user.findUnique({
                where: { email: customerEmail }
            });

            if (existingUser) {
                // User exists, see if they have a customer profile or create one
                const customerProfile = await prisma.customer.findUnique({
                    where: { userId: existingUser.id }
                });

                if (customerProfile) {
                    resolvedCustomerId = customerProfile.id;
                } else {
                    const newCustomer = await prisma.customer.create({
                        data: {
                            userId: existingUser.id,
                            fullName: customerName || `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() || 'Unknown',
                            bvn: 'PENDING',
                            email: customerEmail,
                            phone: customerPhone || existingUser.phone || null,
                        }
                    });
                    resolvedCustomerId = newCustomer.id;
                }
            }
        }

        // 3. Finally, create a new User and Customer if none found
        if (!resolvedCustomerId) {
            const generatedUserId = randomUUID();
            const newUser = await prisma.user.create({
                data: {
                    id: generatedUserId,
                    role: "CUSTOMER",
                    phone: customerPhone || "N/A",
                    password: randomUUID(), // Locked account
                    firstName: customerName?.split(" ")[0] || customerName || "Unknown",
                    lastName: customerName?.split(" ").slice(1).join(" ") || "",
                    email: customerEmail || null,
                }
            });

            const newCustomer = await prisma.customer.create({
                data: {
                    userId: newUser.id,
                    fullName: customerName || "Unknown Customer",
                    bvn: "PENDING",
                    email: customerEmail || null,
                    phone: customerPhone || null,
                    verified: false,
                }
            });

            resolvedCustomerId = newCustomer.id;
        }
    }

    // Resolve countryId: use first available country if not specified
    let resolvedCountryId = req.body.countryId;
    if (!resolvedCountryId) {
        const firstCountry = await prisma.country.findFirst();
        resolvedCountryId = firstCountry?.id || randomUUID(); // fallback
    }

    const trade = await prisma.trade.create({
        data: {
            agentId,
            customerId: resolvedCustomerId,
            countryId: resolvedCountryId,
            amount: parseFloat(String(amount)) || 0,
            sendCurrency,
            receiveCurrency,
            status: "INITIATED",
            paymentMethod,
            paymentSource,
            payoutMethod,
            recipientName,
            recipientDetails,
            payoutAmount,
            paymentProofUrl,
        }
    });

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

    res.json(trade);
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
        where: { id: req.params.id }
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
        where: { id: req.params.id }
    });

    if (!trade) throw new Error("Trade not found");

    assertTransition(trade.status, "SENT_TO_CUSTOMER");

    await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "SENT_TO_CUSTOMER" }
    });

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
    const trade = await prisma.trade.findUnique({
        where: { id: req.params.id }
    });

    if (!trade) throw new Error("Trade not found");

    if (trade.status !== "PAYMENT_CONFIRMED") {
        return res.status(403).json({ error: "Payment not verified" });
    }

    await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "COMPLETED" }
    });

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

    res.json({ completed: true });
}
