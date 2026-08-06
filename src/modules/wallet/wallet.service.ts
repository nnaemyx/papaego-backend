/**
 * Customer Wallet Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns the authoritative ledger balance for each customer.
 *
 * Design rules:
 *  - Every balance change is written as an immutable WalletTransaction row and
 *    the CustomerWallet balance is updated in the SAME database transaction.
 *  - Debits can never take availableBalance below zero.
 *  - Reservations move funds from available → reserved (for in-flight trades);
 *    settle removes from reserved, release returns to available.
 *  - Callers may pass an existing Prisma transaction client (tx) so wallet
 *    operations compose atomically with higher-level operations (e.g. approving
 *    a deposit, or debiting for a trade).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Prisma, WalletTransactionType } from "@prisma/client";
import prisma from "../../config/db";

type Db = Prisma.TransactionClient | typeof prisma;

export class InsufficientFundsError extends Error {
    constructor(available: string, requested: string) {
        super(`Insufficient wallet balance. Available: ${available}, Requested: ${requested}`);
        this.name = "InsufficientFundsError";
    }
}

/**
 * Get (or lazily create) a customer's wallet.
 */
export async function getOrCreateWallet(customerId: string, db: Db = prisma) {
    const existing = await db.customerWallet.findUnique({ where: { customerId } });
    if (existing) return existing;
    return db.customerWallet.create({ data: { customerId } });
}

export async function getWalletSummary(customerId: string) {
    const wallet = await getOrCreateWallet(customerId);
    const transactions = await prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: 50,
    });
    return { wallet, transactions };
}

interface LedgerOptions {
    description: string;
    depositRequestId?: string;
    tradeId?: string;
    tradeRequestId?: string;
    actorId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Credit funds into a customer's available balance.
 * Used by: approved deposits, trade refunds, positive adjustments.
 */
export async function creditWallet(
    customerId: string,
    amount: number | Prisma.Decimal,
    type: WalletTransactionType,
    options: LedgerOptions,
    db: Db = prisma
) {
    const amt = new Prisma.Decimal(amount);
    if (amt.lessThanOrEqualTo(0)) {
        throw new Error("Credit amount must be positive");
    }

    const run = async (tx: Prisma.TransactionClient) => {
        const wallet = await tx.customerWallet.findUnique({ where: { customerId } });
        const current = wallet ?? (await tx.customerWallet.create({ data: { customerId } }));

        const newAvailable = current.availableBalance.plus(amt);
        const newTotalDeposited =
            type === "DEPOSIT" ? current.totalDeposited.plus(amt) : current.totalDeposited;

        const updated = await tx.customerWallet.update({
            where: { id: current.id },
            data: { availableBalance: newAvailable, totalDeposited: newTotalDeposited },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: current.id,
                customerId,
                type,
                amount: amt,
                currency: current.currency,
                balanceAfter: newAvailable,
                description: options.description,
                depositRequestId: options.depositRequestId,
                tradeId: options.tradeId,
                tradeRequestId: options.tradeRequestId,
                actorId: options.actorId,
                metadata: (options.metadata ?? undefined) as Prisma.InputJsonValue,
            },
        });

        return updated;
    };

    // If a transaction client was supplied, reuse it; otherwise open our own.
    if (db === prisma) {
        return prisma.$transaction(run);
    }
    return run(db as Prisma.TransactionClient);
}

/**
 * Debit funds from a customer's available balance.
 * Guards against overdraft. Used by: trade processing, negative adjustments.
 */
export async function debitWallet(
    customerId: string,
    amount: number | Prisma.Decimal,
    type: WalletTransactionType,
    options: LedgerOptions,
    db: Db = prisma
) {
    const amt = new Prisma.Decimal(amount);
    if (amt.lessThanOrEqualTo(0)) {
        throw new Error("Debit amount must be positive");
    }

    const run = async (tx: Prisma.TransactionClient) => {
        const current = await tx.customerWallet.findUnique({ where: { customerId } });
        if (!current) {
            throw new InsufficientFundsError("0", amt.toString());
        }
        if (current.availableBalance.lessThan(amt)) {
            throw new InsufficientFundsError(current.availableBalance.toString(), amt.toString());
        }

        const newAvailable = current.availableBalance.minus(amt);

        const updated = await tx.customerWallet.update({
            where: { id: current.id },
            data: { availableBalance: newAvailable },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: current.id,
                customerId,
                type,
                amount: amt.negated(),
                currency: current.currency,
                balanceAfter: newAvailable,
                description: options.description,
                depositRequestId: options.depositRequestId,
                tradeId: options.tradeId,
                tradeRequestId: options.tradeRequestId,
                actorId: options.actorId,
                metadata: (options.metadata ?? undefined) as Prisma.InputJsonValue,
            },
        });

        return updated;
    };

    if (db === prisma) {
        return prisma.$transaction(run);
    }
    return run(db as Prisma.TransactionClient);
}

/**
 * Assert that a customer has at least `amount` available. Throws otherwise.
 */
export async function assertSufficientBalance(
    customerId: string,
    amount: number | Prisma.Decimal,
    db: Db = prisma
) {
    const amt = new Prisma.Decimal(amount);
    const wallet = await (db as typeof prisma).customerWallet.findUnique({ where: { customerId } });
    const available = wallet?.availableBalance ?? new Prisma.Decimal(0);
    if (available.lessThan(amt)) {
        throw new InsufficientFundsError(available.toString(), amt.toString());
    }
    return true;
}

/**
 * Reserve funds for an in-flight trade: moves `amount` from availableBalance
 * into reservedBalance. Guards against reserving more than is available.
 * A negative-signed ledger row of type TRADE_DEBIT is written so the customer's
 * transaction history reflects that the money is committed (held) for a trade.
 *
 * Reserve → (settle | release) is the lifecycle:
 *   - settleReservation: money actually leaves the wallet (outbound settlement)
 *   - releaseReservation: money returns to availableBalance (trade rejected/cancelled)
 */
export async function reserveFunds(
    customerId: string,
    amount: number | Prisma.Decimal,
    options: LedgerOptions,
    db: Db = prisma
) {
    const amt = new Prisma.Decimal(amount);
    if (amt.lessThanOrEqualTo(0)) {
        throw new Error("Reserve amount must be positive");
    }

    const run = async (tx: Prisma.TransactionClient) => {
        const current = await tx.customerWallet.findUnique({ where: { customerId } });
        if (!current) {
            throw new InsufficientFundsError("0", amt.toString());
        }
        if (current.availableBalance.lessThan(amt)) {
            throw new InsufficientFundsError(current.availableBalance.toString(), amt.toString());
        }

        const newAvailable = current.availableBalance.minus(amt);
        const newReserved = current.reservedBalance.plus(amt);

        const updated = await tx.customerWallet.update({
            where: { id: current.id },
            data: { availableBalance: newAvailable, reservedBalance: newReserved },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: current.id,
                customerId,
                type: "TRADE_DEBIT",
                amount: amt.negated(),
                currency: current.currency,
                balanceAfter: newAvailable,
                description: options.description,
                depositRequestId: options.depositRequestId,
                tradeId: options.tradeId,
                tradeRequestId: options.tradeRequestId,
                actorId: options.actorId,
                metadata: { ...(options.metadata ?? {}), phase: "RESERVE" } as Prisma.InputJsonValue,
            },
        });

        return updated;
    };

    if (db === prisma) {
        return prisma.$transaction(run);
    }
    return run(db as Prisma.TransactionClient);
}

/**
 * Settle a reservation: the reserved funds actually leave the wallet permanently
 * (money sent outbound to the supplier). Removes `amount` from reservedBalance.
 * No availableBalance change and no new negative ledger row (the debit already
 * happened at reserve time) — instead we record a settlement marker row of
 * amount 0 for a complete audit trail.
 */
export async function settleReservation(
    customerId: string,
    amount: number | Prisma.Decimal,
    options: LedgerOptions,
    db: Db = prisma
) {
    const amt = new Prisma.Decimal(amount);
    if (amt.lessThanOrEqualTo(0)) {
        throw new Error("Settle amount must be positive");
    }

    const run = async (tx: Prisma.TransactionClient) => {
        const current = await tx.customerWallet.findUnique({ where: { customerId } });
        if (!current) throw new Error("Wallet not found for settlement");

        // Clamp to available reserved to avoid negative reserved balances.
        const settleAmt = current.reservedBalance.lessThan(amt) ? current.reservedBalance : amt;
        const newReserved = current.reservedBalance.minus(settleAmt);

        const updated = await tx.customerWallet.update({
            where: { id: current.id },
            data: { reservedBalance: newReserved },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: current.id,
                customerId,
                type: "TRADE_DEBIT",
                amount: new Prisma.Decimal(0),
                currency: current.currency,
                balanceAfter: updated.availableBalance,
                description: options.description,
                depositRequestId: options.depositRequestId,
                tradeId: options.tradeId,
                tradeRequestId: options.tradeRequestId,
                actorId: options.actorId,
                metadata: {
                    ...(options.metadata ?? {}),
                    phase: "SETTLE",
                    settledAmount: settleAmt.toString(),
                } as Prisma.InputJsonValue,
            },
        });

        return updated;
    };

    if (db === prisma) {
        return prisma.$transaction(run);
    }
    return run(db as Prisma.TransactionClient);
}

/**
 * Release a reservation: return held funds to availableBalance (trade rejected
 * or cancelled before settlement). Writes a positive TRADE_REFUND ledger row.
 */
export async function releaseReservation(
    customerId: string,
    amount: number | Prisma.Decimal,
    options: LedgerOptions,
    db: Db = prisma
) {
    const amt = new Prisma.Decimal(amount);
    if (amt.lessThanOrEqualTo(0)) {
        throw new Error("Release amount must be positive");
    }

    const run = async (tx: Prisma.TransactionClient) => {
        const current = await tx.customerWallet.findUnique({ where: { customerId } });
        if (!current) throw new Error("Wallet not found for release");

        // Clamp to available reserved to avoid negative reserved balances.
        const releaseAmt = current.reservedBalance.lessThan(amt) ? current.reservedBalance : amt;
        const newReserved = current.reservedBalance.minus(releaseAmt);
        const newAvailable = current.availableBalance.plus(releaseAmt);

        const updated = await tx.customerWallet.update({
            where: { id: current.id },
            data: { availableBalance: newAvailable, reservedBalance: newReserved },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: current.id,
                customerId,
                type: "TRADE_REFUND",
                amount: releaseAmt,
                currency: current.currency,
                balanceAfter: newAvailable,
                description: options.description,
                depositRequestId: options.depositRequestId,
                tradeId: options.tradeId,
                tradeRequestId: options.tradeRequestId,
                actorId: options.actorId,
                metadata: { ...(options.metadata ?? {}), phase: "RELEASE" } as Prisma.InputJsonValue,
            },
        });

        return updated;
    };

    if (db === prisma) {
        return prisma.$transaction(run);
    }
    return run(db as Prisma.TransactionClient);
}


