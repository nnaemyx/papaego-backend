import { Request, Response } from "express";
import prisma from "../../config/db";
import { assertTransition } from "../../utils/stateMachine";
import { getLockedRate } from "../fx/fx.service";

export async function createTrade(req: Request, res: Response) {
    const agentId = (req as any).user.id;
    const {
        customerId,
        amount,
        sendCurrency,
        receiveCurrency,
        countryId
    } = req.body;

    const trade = await prisma.trade.create({
        data: {
            agentId,
            customerId,
            countryId,
            amount,
            sendCurrency,
            receiveCurrency,
            status: "INITIATED"
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
