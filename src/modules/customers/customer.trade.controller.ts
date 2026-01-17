import { Request, Response } from "express";
import prisma from "../../config/db";
import { assertTransition } from "../../utils/stateMachine";
import { assertCustomerTradeAccess } from "./customer.guard";

export async function confirmSupplier(req: Request, res: Response) {
    const trade = await assertCustomerTradeAccess(
        (req as any).user.customerId,
        req.params.id
    );

    assertTransition(trade.status, "CUSTOMER_CONFIRMED");

    await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "CUSTOMER_CONFIRMED" }
    });

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "CUSTOMER",
            action: "SUPPLIER_CONFIRMED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ confirmed: true });
}

export async function getTradeSummary(req: Request, res: Response) {
    const trade = await assertCustomerTradeAccess(
        (req as any).user.customerId,
        req.params.id
    );

    res.json({
        amount: trade.amount,
        fxRate: trade.fxRate,
        total: Number(trade.amount) * Number(trade.fxRate ?? 0),
        expiresAt: trade.lockedUntil,
        supplierAccount: "****1234"
    });
}

export async function confirmPayment(req: Request, res: Response) {
    const trade = await assertCustomerTradeAccess(
        (req as any).user.customerId,
        req.params.id
    );

    assertTransition(trade.status, "AWAITING_PAYMENT");

    await prisma.trade.update({
        where: { id: trade.id },
        data: { status: "AWAITING_PAYMENT" }
    });

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "CUSTOMER",
            action: "PAYMENT_DECLARED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ awaitingVerification: true });
}

export async function getCustomerTrade(req: Request, res: Response) {
    const trade = await assertCustomerTradeAccess(
        (req as any).user.customerId,
        req.params.id
    );

    res.json({
        status: trade.status,
        reference: trade.id,
        receiptAvailable: trade.status === "COMPLETED"
    });
}
