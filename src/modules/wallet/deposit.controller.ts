/**
 * Deposit Request Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Customer submits a deposit request (with optional proof of payment) after
 * transferring funds to a Papa Ego treasury account. An admin reviews and either
 * approves (crediting the wallet) or rejects the request.
 *
 * Funds only ever reach a customer's wallet through an APPROVED deposit here,
 * so the admin approval is the single trusted gate for money entering the ledger.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Request, Response } from "express";
import prisma from "../../config/db";
import { creditWallet } from "./wallet.service";
import { createNotification } from "../notifications/notification.service";

// ── CUSTOMER ────────────────────────────────────────────────────────────────

/**
 * POST /customer/portal/wallet/deposits
 * Customer creates a new deposit request.
 * Body: { amount, method?, depositBank?, note? }  (proof uploaded via file field "proof")
 */
export async function createDepositRequest(req: Request, res: Response) {
    try {
        const customer = (req as any).user.customer;
        if (!customer) return res.status(403).json({ error: "Customer profile not found" });

        const { amount, method, depositBank, note } = req.body;
        const proofUrl = (req as any).file?.path || req.body.proofUrl || null;

        const parsedAmount = parseFloat(String(amount));
        if (!parsedAmount || parsedAmount <= 0) {
            return res.status(400).json({ error: "A valid deposit amount is required" });
        }

        const deposit = await prisma.depositRequest.create({
            data: {
                customerId: customer.id,
                amount: parsedAmount,
                method: method || "BANK_TRANSFER",
                depositBank: depositBank || null,
                note: note || null,
                proofUrl,
                status: "PENDING",
            },
        });

        // Notify admins of the pending deposit
        const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
        await Promise.allSettled(
            admins.map((admin) =>
                createNotification(
                    admin.id,
                    "New Deposit Request",
                    `${customer.fullName || "A customer"} submitted a deposit of ₦${parsedAmount.toLocaleString()} awaiting confirmation.`,
                    "INFO"
                )
            )
        );

        res.status(201).json(deposit);
    } catch (error) {
        console.error("Error creating deposit request:", error);
        res.status(500).json({ error: "Failed to create deposit request" });
    }
}

/**
 * GET /customer/portal/wallet/deposits
 * Customer lists their own deposit requests.
 */
export async function getCustomerDeposits(req: Request, res: Response) {
    try {
        const customer = (req as any).user.customer;
        const deposits = await prisma.depositRequest.findMany({
            where: { customerId: customer.id },
            orderBy: { createdAt: "desc" },
        });
        res.json(deposits);
    } catch (error) {
        console.error("Error fetching deposits:", error);
        res.status(500).json({ error: "Failed to fetch deposits" });
    }
}

/**
 * PATCH /customer/portal/wallet/deposits/:id/cancel
 * Customer cancels a deposit request that has not yet been reviewed.
 */
export async function cancelDepositRequest(req: Request, res: Response) {
    try {
        const customer = (req as any).user.customer;
        const { id } = req.params;

        const deposit = await prisma.depositRequest.findUnique({ where: { id } });
        if (!deposit || deposit.customerId !== customer.id) {
            return res.status(404).json({ error: "Deposit request not found" });
        }
        if (deposit.status !== "PENDING" && deposit.status !== "UNDER_REVIEW") {
            return res.status(400).json({ error: `Cannot cancel a ${deposit.status} deposit` });
        }

        const updated = await prisma.depositRequest.update({
            where: { id },
            data: { status: "CANCELLED" },
        });
        res.json(updated);
    } catch (error) {
        console.error("Error cancelling deposit:", error);
        res.status(500).json({ error: "Failed to cancel deposit" });
    }
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────

/**
 * GET /admin/deposits
 * Admin lists deposit requests (optionally filtered by status).
 */
export async function getAdminDeposits(req: Request, res: Response) {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const where: any = {};
        if (status && status !== "ALL") where.status = status;

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const [deposits, total] = await Promise.all([
            prisma.depositRequest.findMany({
                where,
                include: {
                    customer: { select: { id: true, fullName: true, email: true } },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.depositRequest.count({ where }),
        ]);

        res.json({ deposits, total, page: Number(page), limit: Number(limit) });
    } catch (error) {
        console.error("Error fetching admin deposits:", error);
        res.status(500).json({ error: "Failed to fetch deposits" });
    }
}

/**
 * PATCH /admin/deposits/:id/approve
 * Admin approves a deposit; credits the customer's wallet atomically.
 * Body: { creditedAmount? } — allows crediting a corrected amount.
 */
export async function approveDeposit(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const adminId = (req as any).user.id;
        const { creditedAmount } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const deposit = await tx.depositRequest.findUnique({ where: { id } });
            if (!deposit) throw new Error("NOT_FOUND");
            if (deposit.status === "APPROVED") throw new Error("ALREADY_APPROVED");
            if (deposit.status === "REJECTED" || deposit.status === "CANCELLED") {
                throw new Error("INVALID_STATUS");
            }

            const amountToCredit =
                creditedAmount !== undefined ? parseFloat(String(creditedAmount)) : Number(deposit.amount);

            const updatedDeposit = await tx.depositRequest.update({
                where: { id },
                data: {
                    status: "APPROVED",
                    reviewedBy: adminId,
                    reviewedAt: new Date(),
                    creditedAmount: amountToCredit,
                },
            });

            // Credit wallet inside the same transaction (immutable ledger entry).
            await creditWallet(
                deposit.customerId,
                amountToCredit,
                "DEPOSIT",
                {
                    description: `Deposit approved (ref ${deposit.reference})`,
                    depositRequestId: deposit.id,
                    actorId: adminId,
                    metadata: { requestedAmount: Number(deposit.amount), method: deposit.method },
                },
                tx
            );

            return updatedDeposit;
        });

        // Notify the customer
        const customer = await prisma.customer.findUnique({ where: { id: result.customerId } });
        if (customer?.userId) {
            await createNotification(
                customer.userId,
                "Deposit Approved 🎉",
                `Your wallet has been credited with ₦${Number(result.creditedAmount).toLocaleString()}.`,
                "SUCCESS"
            );
        }

        await prisma.auditLog.create({
            data: {
                actorId: adminId,
                role: "ADMIN",
                action: "DEPOSIT_APPROVED",
                entity: "DepositRequest",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true, deposit: result });
    } catch (error: any) {
        if (error.message === "NOT_FOUND") return res.status(404).json({ error: "Deposit request not found" });
        if (error.message === "ALREADY_APPROVED") return res.status(400).json({ error: "Deposit already approved" });
        if (error.message === "INVALID_STATUS") return res.status(400).json({ error: "Deposit cannot be approved in its current status" });
        console.error("Error approving deposit:", error);
        res.status(500).json({ error: "Failed to approve deposit" });
    }
}

/**
 * PATCH /admin/deposits/:id/reject
 * Admin rejects a deposit. No funds are credited.
 * Body: { reason? }
 */
export async function rejectDeposit(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const adminId = (req as any).user.id;
        const { reason } = req.body;

        const deposit = await prisma.depositRequest.findUnique({ where: { id } });
        if (!deposit) return res.status(404).json({ error: "Deposit request not found" });
        if (deposit.status === "APPROVED") {
            return res.status(400).json({ error: "Cannot reject an already-approved deposit" });
        }

        const updated = await prisma.depositRequest.update({
            where: { id },
            data: {
                status: "REJECTED",
                reviewedBy: adminId,
                reviewedAt: new Date(),
                rejectionReason: reason || null,
            },
        });

        const customer = await prisma.customer.findUnique({ where: { id: deposit.customerId } });
        if (customer?.userId) {
            await createNotification(
                customer.userId,
                "Deposit Rejected",
                `Your deposit of ₦${Number(deposit.amount).toLocaleString()} was rejected.${reason ? " Reason: " + reason : ""}`,
                "ERROR"
            );
        }

        await prisma.auditLog.create({
            data: {
                actorId: adminId,
                role: "ADMIN",
                action: "DEPOSIT_REJECTED",
                entity: "DepositRequest",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true, deposit: updated });
    } catch (error) {
        console.error("Error rejecting deposit:", error);
        res.status(500).json({ error: "Failed to reject deposit" });
    }
}

/**
 * DELETE /admin/deposits/:id
 * Admin permanently deletes a deposit/funding event record.
 */
export async function deleteDeposit(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const adminId = (req as any).user?.id || "ADMIN";

        const deposit = await prisma.depositRequest.findUnique({ where: { id } });
        if (!deposit) return res.status(404).json({ error: "Deposit request not found" });

        // Unlink or nullify any related wallet transactions depositRequestId
        await prisma.walletTransaction.updateMany({
            where: { depositRequestId: id },
            data: { depositRequestId: null }
        });

        await prisma.depositRequest.delete({ where: { id } });

        await prisma.auditLog.create({
            data: {
                actorId: adminId,
                role: "ADMIN",
                action: "DEPOSIT_DELETED",
                entity: "DepositRequest",
                entityId: id,
                ip: req.ip || "127.0.0.1",
                metadata: { reference: deposit.reference, amount: deposit.amount.toString() }
            },
        });

        res.json({ success: true, message: "Funding event deleted successfully" });
    } catch (error) {
        console.error("Error deleting deposit:", error);
        res.status(500).json({ error: "Failed to delete deposit event" });
    }
}
