import prisma from "../../config/db";
import { LedgerEntryType, AccountStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReserveRequest {
    accountId: string;
    currency: string;
    amount: number;
    description: string;
    metadata?: Record<string, unknown>;
}

export interface ReleaseRequest {
    accountId: string;
    currency: string;
    amount: number;
    description: string;
    metadata?: Record<string, unknown>;
}

export interface SettleRequest {
    accountId: string;
    currency: string;
    amount: number;
    description: string;
    metadata?: Record<string, unknown>;
}

export interface DepositRequest {
    accountId: string;
    currency: string;
    amount: number;
    description: string;
    metadata?: Record<string, unknown>;
}

// ─── Helper: Create Ledger Entry (immutable) ─────────────────────────────────

async function createLedgerEntry(
    type: LedgerEntryType,
    amount: number | Decimal,
    currency: string,
    description: string,
    options?: {
        debitAccountId?: string;
        creditAccountId?: string;
        metadata?: Record<string, unknown>;
    }
) {
    return prisma.ledgerEntry.create({
        data: {
            transactionType: type,
            amount,
            currency,
            description,
            debitAccountId: options?.debitAccountId ?? null,
            creditAccountId: options?.creditAccountId ?? null,
            metadata: (options?.metadata ?? undefined) as any,
        },
    });
}

// ─── Get All Treasury Balances (aggregated by currency) ──────────────────────

/**
 * Aggregate balances across all accounts, grouped by currency.
 * This is the "Total Treasury Position" view.
 */
export async function getAllBalances() {
    const balances = await prisma.treasuryBalance.findMany({
        include: {
            account: {
                select: {
                    id: true,
                    accountName: true,
                    provider: true,
                    accountType: true,
                    status: true,
                },
            },
        },
        orderBy: [{ currency: "asc" }],
    });

    // Aggregate totals by currency
    const aggregated: Record<
        string,
        {
            currency: string;
            totalAvailable: Decimal;
            totalReserved: Decimal;
            totalBalance: Decimal;
            accounts: typeof balances;
        }
    > = {};

    for (const b of balances) {
        if (!aggregated[b.currency]) {
            aggregated[b.currency] = {
                currency: b.currency,
                totalAvailable: new Decimal(0),
                totalReserved: new Decimal(0),
                totalBalance: new Decimal(0),
                accounts: [],
            };
        }
        aggregated[b.currency].totalAvailable = aggregated[b.currency].totalAvailable.plus(b.availableBalance);
        aggregated[b.currency].totalReserved = aggregated[b.currency].totalReserved.plus(b.reservedBalance);
        aggregated[b.currency].totalBalance = aggregated[b.currency].totalBalance.plus(b.totalBalance);
        aggregated[b.currency].accounts.push(b);
    }

    return Object.values(aggregated);
}

// ─── Get Balance by Currency ──────────────────────────────────────────────────

export async function getBalanceByCurrency(currency: string) {
    const balances = await prisma.treasuryBalance.findMany({
        where: { currency: currency.toUpperCase() },
        include: {
            account: {
                select: {
                    id: true,
                    accountName: true,
                    provider: true,
                    accountType: true,
                    status: true,
                },
            },
        },
    });

    if (balances.length === 0) {
        return {
            currency: currency.toUpperCase(),
            totalAvailable: new Decimal(0),
            totalReserved: new Decimal(0),
            totalBalance: new Decimal(0),
            accounts: [],
        };
    }

    const totalAvailable = balances.reduce((sum, b) => sum.plus(b.availableBalance), new Decimal(0));
    const totalReserved = balances.reduce((sum, b) => sum.plus(b.reservedBalance), new Decimal(0));
    const totalBalance = balances.reduce((sum, b) => sum.plus(b.totalBalance), new Decimal(0));

    return {
        currency: currency.toUpperCase(),
        totalAvailable,
        totalReserved,
        totalBalance,
        accounts: balances,
    };
}

// ─── Get Balance by Account ───────────────────────────────────────────────────

export async function getBalanceByAccount(accountId: string) {
    return prisma.treasuryBalance.findMany({
        where: { accountId },
        include: { account: true },
    });
}

// ─── Record Deposit ───────────────────────────────────────────────────────────

/**
 * Record an incoming deposit into a treasury account.
 * Increases Available Balance and Total Balance.
 */
export async function recordDeposit(req: DepositRequest) {
    const { accountId, currency, amount, description, metadata } = req;

    if (amount <= 0) throw new Error("Deposit amount must be positive");

    // Verify account is active
    const account = await prisma.treasuryAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error("Treasury account not found");
    if (account.status !== AccountStatus.ACTIVE) throw new Error("Treasury account is not active");

    const result = await prisma.$transaction(async (tx) => {
        // Upsert balance record
        const balance = await tx.treasuryBalance.upsert({
            where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
            update: {
                availableBalance: { increment: amount },
                totalBalance: { increment: amount },
            },
            create: {
                accountId,
                currency: currency.toUpperCase(),
                availableBalance: amount,
                reservedBalance: 0,
                totalBalance: amount,
            },
        });

        // Create immutable ledger entry
        const entry = await tx.ledgerEntry.create({
            data: {
                transactionType: LedgerEntryType.DEPOSIT,
                creditAccountId: accountId,
                amount,
                currency: currency.toUpperCase(),
                description,
                metadata: (metadata ?? undefined) as any,
            },
        });

        return { balance, ledgerEntry: entry };
    });

    return result;
}

// ─── Reserve Funds ────────────────────────────────────────────────────────────

/**
 * Reserve funds for a pending settlement.
 * Reduces Available Balance, Increases Reserved Balance.
 * Total Balance unchanged.
 */
export async function reserveFunds(req: ReserveRequest) {
    const { accountId, currency, amount, description, metadata } = req;

    if (amount <= 0) throw new Error("Reservation amount must be positive");

    const balance = await prisma.treasuryBalance.findUnique({
        where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
    });

    if (!balance) throw new Error(`No balance found for account ${accountId} in ${currency}`);

    if (balance.availableBalance.lessThan(amount)) {
        throw new Error(
            `Insufficient available balance. Available: ${balance.availableBalance}, Requested: ${amount}`
        );
    }

    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.treasuryBalance.update({
            where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
            data: {
                availableBalance: { decrement: amount },
                reservedBalance: { increment: amount },
            },
        });

        const entry = await tx.ledgerEntry.create({
            data: {
                transactionType: LedgerEntryType.RESERVATION,
                debitAccountId: accountId,
                amount,
                currency: currency.toUpperCase(),
                description,
                metadata: (metadata ?? undefined) as any,
            },
        });

        return { balance: updated, ledgerEntry: entry };
    });

    return result;
}

// ─── Release Reservation ──────────────────────────────────────────────────────

/**
 * Release previously reserved funds back to available.
 * Called when a settlement fails.
 */
export async function releaseFunds(req: ReleaseRequest) {
    const { accountId, currency, amount, description, metadata } = req;

    if (amount <= 0) throw new Error("Release amount must be positive");

    const balance = await prisma.treasuryBalance.findUnique({
        where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
    });

    if (!balance) throw new Error(`No balance found for account ${accountId} in ${currency}`);
    if (balance.reservedBalance.lessThan(amount)) {
        throw new Error(`Cannot release more than reserved. Reserved: ${balance.reservedBalance}, Requested: ${amount}`);
    }

    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.treasuryBalance.update({
            where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
            data: {
                reservedBalance: { decrement: amount },
                availableBalance: { increment: amount },
            },
        });

        const entry = await tx.ledgerEntry.create({
            data: {
                transactionType: LedgerEntryType.RELEASE,
                creditAccountId: accountId,
                amount,
                currency: currency.toUpperCase(),
                description,
                metadata: (metadata ?? undefined) as any,
            },
        });

        return { balance: updated, ledgerEntry: entry };
    });

    return result;
}

// ─── Complete Settlement ──────────────────────────────────────────────────────

/**
 * Complete a settlement after successful transaction.
 * Reduces Reserved Balance and Total Balance.
 * Available Balance unchanged (already reduced during reservation).
 */
export async function completeSettlement(req: SettleRequest) {
    const { accountId, currency, amount, description, metadata } = req;

    if (amount <= 0) throw new Error("Settlement amount must be positive");

    const balance = await prisma.treasuryBalance.findUnique({
        where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
    });

    if (!balance) throw new Error(`No balance found for account ${accountId} in ${currency}`);
    if (balance.reservedBalance.lessThan(amount)) {
        throw new Error(`Cannot settle more than reserved. Reserved: ${balance.reservedBalance}, Requested: ${amount}`);
    }

    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.treasuryBalance.update({
            where: { accountId_currency: { accountId, currency: currency.toUpperCase() } },
            data: {
                reservedBalance: { decrement: amount },
                totalBalance: { decrement: amount },
            },
        });

        const entry = await tx.ledgerEntry.create({
            data: {
                transactionType: LedgerEntryType.SETTLEMENT,
                debitAccountId: accountId,
                amount,
                currency: currency.toUpperCase(),
                description,
                metadata: (metadata ?? undefined) as any,
            },
        });

        return { balance: updated, ledgerEntry: entry };
    });

    return result;
}

// ─── Get Ledger Entries ───────────────────────────────────────────────────────

export async function getLedgerEntries(filters?: {
    currency?: string;
    transactionType?: LedgerEntryType;
    accountId?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
}) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters?.currency) where.currency = filters.currency.toUpperCase();
    if (filters?.transactionType) where.transactionType = filters.transactionType;
    if (filters?.accountId) {
        where.OR = [
            { debitAccountId: filters.accountId },
            { creditAccountId: filters.accountId },
        ];
    }
    if (filters?.startDate || filters?.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [entries, total] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where,
            include: {
                debitAccount: { select: { id: true, accountName: true, provider: true, accountType: true } },
                creditAccount: { select: { id: true, accountName: true, provider: true, accountType: true } },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip,
        }),
        prisma.ledgerEntry.count({ where }),
    ]);

    return { entries, total, page, limit };
}

// ─── Treasury Accounts CRUD ───────────────────────────────────────────────────

export async function getTreasuryAccounts(filters?: {
    status?: AccountStatus;
    accountType?: string;
    currency?: string;
}) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.accountType) where.accountType = filters.accountType;
    if (filters?.currency) where.currency = filters.currency.toUpperCase();

    return prisma.treasuryAccount.findMany({
        where,
        include: { balances: true },
        orderBy: { createdAt: "desc" },
    });
}

export async function createTreasuryAccount(data: {
    accountName: string;
    provider: string;
    currency: string;
    accountType: string;
    initialBalance?: number | string;
    accountNumber?: string;
    metadata?: Record<string, unknown>;
}) {
    const account = await prisma.treasuryAccount.create({
        data: {
            accountName: data.accountName,
            provider: data.provider,
            currency: data.currency.toUpperCase(),
            accountType: data.accountType as any,
            metadata: {
                ...(data.metadata || {}),
                accountNumber: data.accountNumber || undefined
            } as any,
        },
        include: { balances: true },
    });

    const initBal = Number(data.initialBalance) || 0;
    const balance = await prisma.treasuryBalance.create({
        data: {
            accountId: account.id,
            currency: account.currency,
            availableBalance: new Decimal(initBal),
            reservedBalance: new Decimal(0),
        }
    });

    return { ...account, balances: [balance] };
}

export async function updateTreasuryAccount(
    id: string,
    data: Partial<{
        accountName: string;
        provider: string;
        status: AccountStatus;
        metadata: Record<string, unknown>;
    }>
) {
    return prisma.treasuryAccount.update({
        where: { id },
        data: { ...data, metadata: data.metadata as any },
        include: { balances: true },
    });
}

export async function deleteTreasuryAccount(id: string) {
    // Delete associated balances and sync logs first
    await prisma.treasuryBalance.deleteMany({ where: { accountId: id } });
    await prisma.balanceSyncLog.deleteMany({ where: { accountId: id } });
    
    // Nullify debit/credit account references in ledger entries
    await prisma.ledgerEntry.updateMany({
        where: { debitAccountId: id },
        data: { debitAccountId: null }
    });
    await prisma.ledgerEntry.updateMany({
        where: { creditAccountId: id },
        data: { creditAccountId: null }
    });

    return prisma.treasuryAccount.delete({ where: { id } });
}

// ─── Sync Logs ────────────────────────────────────────────────────────────────

export async function getSyncLogs(filters?: {
    accountId?: string;
    provider?: string;
    limit?: number;
}) {
    const where: any = {};
    if (filters?.accountId) where.accountId = filters.accountId;
    if (filters?.provider) where.provider = filters.provider;

    return prisma.balanceSyncLog.findMany({
        where,
        include: {
            account: {
                select: { id: true, accountName: true, provider: true, accountType: true },
            },
        },
        orderBy: { syncedAt: "desc" },
        take: filters?.limit ?? 100,
    });
}
