import prisma from "../../config/db";
import { BalanceSyncStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { LedgerEntryType } from "@prisma/client";

/**
 * Treasury Sync Service
 *
 * Responsible for synchronizing balances from external providers
 * into the Treasury Ledger.
 *
 * Architecture:
 * - Each provider implements the `ProviderAdapter` interface.
 * - On sync, balances are fetched and compared to current ledger state.
 * - If fetch succeeds, balance is updated and a sync log is created.
 * - If fetch fails, the existing balance is NEVER overwritten. A FAILED log is created.
 * - Every balance change creates an immutable ledger entry (SYNC_ADJUSTMENT).
 *
 * Currently supported providers:
 * - MANUAL (direct database entry — used for testing and manual overrides)
 *
 * Future providers to plug in:
 * - GTBank API
 * - Flutterwave Balance API
 * - Binance Balance API
 * - OKX Balance API
 * - Coinbase Balance API
 */

// ─── Provider Adapter Interface ───────────────────────────────────────────────

export interface ProviderBalanceResult {
    accountId: string;
    currency: string;
    balance: number;
    provider: string;
}

export interface ProviderAdapter {
    name: string;
    fetchBalances(accountIds: string[]): Promise<ProviderBalanceResult[]>;
}

// ─── MANUAL Provider (for testing & manual overrides) ────────────────────────

export class ManualProvider implements ProviderAdapter {
    name = "MANUAL";

    async fetchBalances(_accountIds: string[]): Promise<ProviderBalanceResult[]> {
        // Manual provider does not fetch from external — used for direct writes
        return [];
    }
}

// ─── Provider Registry ────────────────────────────────────────────────────────

const REGISTERED_PROVIDERS: Record<string, ProviderAdapter> = {
    MANUAL: new ManualProvider(),
    // Future: GTBANK, BINANCE, OKX, etc.
};

export function getProvider(name: string): ProviderAdapter | null {
    return REGISTERED_PROVIDERS[name.toUpperCase()] ?? null;
}

export function listProviders(): string[] {
    return Object.keys(REGISTERED_PROVIDERS);
}

// ─── Core Sync Logic ──────────────────────────────────────────────────────────

/**
 * Sync all active treasury accounts.
 * Returns summary of what was synced and any failures.
 */
export async function syncAllAccounts(): Promise<{
    synced: number;
    failed: number;
    skipped: number;
    results: SyncResult[];
}> {
    const accounts = await prisma.treasuryAccount.findMany({
        where: { status: "ACTIVE" },
        include: { balances: true },
    });

    const results: SyncResult[] = [];
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const account of accounts) {
        try {
            const result = await syncSingleAccount(account.id, account.provider);
            results.push(result);
            if (result.status === "SUCCESS") synced++;
            else if (result.status === "FAILED") failed++;
            else skipped++;
        } catch (err: any) {
            failed++;
            results.push({
                accountId: account.id,
                provider: account.provider,
                status: "FAILED",
                error: err.message,
            });
        }
    }

    return { synced, failed, skipped, results };
}

export interface SyncResult {
    accountId: string;
    provider: string;
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    currency?: string;
    previousBalance?: number;
    newBalance?: number;
    adjustment?: number;
    error?: string;
}

/**
 * Sync a single treasury account.
 * Safe: on failure, existing balance is left unchanged.
 */
export async function syncSingleAccount(accountId: string, providerName: string): Promise<SyncResult> {
    const account = await prisma.treasuryAccount.findUnique({
        where: { id: accountId },
        include: { balances: true },
    });

    if (!account) {
        return { accountId, provider: providerName, status: "FAILED", error: "Account not found" };
    }

    const provider = getProvider(providerName);
    if (!provider || providerName.toUpperCase() === "MANUAL") {
        // Manual accounts are synced only via manual deposit/withdrawal entries
        return { accountId, provider: providerName, status: "SKIPPED" };
    }

    try {
        const results = await provider.fetchBalances([accountId]);
        if (!results.length) {
            return { accountId, provider: providerName, status: "SKIPPED" };
        }

        const providerResult = results[0];
        const currency = providerResult.currency.toUpperCase();
        const newBalance = providerResult.balance;

        // Find current balance
        const currentBalance = account.balances.find((b) => b.currency === currency);
        const previousBalance = currentBalance ? Number(currentBalance.totalBalance) : 0;
        const adjustment = newBalance - previousBalance;

        // Only update if there's a meaningful change
        if (Math.abs(adjustment) < 0.000001) {
            await prisma.balanceSyncLog.create({
                data: {
                    provider: providerName.toUpperCase(),
                    accountId,
                    currency,
                    syncedBalance: newBalance,
                    previousBalance,
                    status: BalanceSyncStatus.SUCCESS,
                },
            });
            return { accountId, provider: providerName, status: "SUCCESS", currency, previousBalance, newBalance, adjustment: 0 };
        }

        // Apply sync adjustment in a transaction
        await prisma.$transaction(async (tx) => {
            await tx.treasuryBalance.upsert({
                where: { accountId_currency: { accountId, currency } },
                update: {
                    totalBalance: newBalance,
                    availableBalance: {
                        increment: adjustment,
                    },
                },
                create: {
                    accountId,
                    currency,
                    availableBalance: newBalance,
                    reservedBalance: 0,
                    totalBalance: newBalance,
                },
            });

            // Immutable ledger entry for the sync adjustment
            await tx.ledgerEntry.create({
                data: {
                    transactionType: LedgerEntryType.SYNC_ADJUSTMENT,
                    creditAccountId: adjustment > 0 ? accountId : undefined,
                    debitAccountId: adjustment < 0 ? accountId : undefined,
                    amount: Math.abs(adjustment),
                    currency,
                    description: `Balance sync from ${providerName}: ${previousBalance} → ${newBalance}`,
                    metadata: { providerName, previousBalance, newBalance, adjustment },
                },
            });

            await tx.balanceSyncLog.create({
                data: {
                    provider: providerName.toUpperCase(),
                    accountId,
                    currency,
                    syncedBalance: newBalance,
                    previousBalance,
                    status: BalanceSyncStatus.SUCCESS,
                },
            });
        });

        return {
            accountId,
            provider: providerName,
            status: "SUCCESS",
            currency,
            previousBalance,
            newBalance,
            adjustment,
        };
    } catch (err: any) {
        // CRITICAL: On failure, do NOT touch balances. Log failure only.
        await prisma.balanceSyncLog.create({
            data: {
                provider: providerName.toUpperCase(),
                accountId,
                currency: account.currency,
                syncedBalance: null,
                previousBalance: null,
                status: BalanceSyncStatus.FAILED,
                errorMessage: err.message,
            },
        });

        return {
            accountId,
            provider: providerName,
            status: "FAILED",
            error: err.message,
        };
    }
}

/**
 * Manual balance override — for admin/testing purposes.
 * Creates a SYNC_ADJUSTMENT ledger entry.
 */
export async function manualBalanceSync(
    accountId: string,
    currency: string,
    newTotalBalance: number,
    adminUserId: string
): Promise<SyncResult> {
    const account = await prisma.treasuryAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error("Treasury account not found");

    const uppercaseCurrency = currency.toUpperCase();

    const currentBalance = await prisma.treasuryBalance.findUnique({
        where: { accountId_currency: { accountId, currency: uppercaseCurrency } },
    });

    const previousBalance = currentBalance ? Number(currentBalance.totalBalance) : 0;
    const reserved = currentBalance ? Number(currentBalance.reservedBalance) : 0;
    const adjustment = newTotalBalance - previousBalance;
    const newAvailable = Math.max(0, newTotalBalance - reserved);

    await prisma.$transaction(async (tx) => {
        await tx.treasuryBalance.upsert({
            where: { accountId_currency: { accountId, currency: uppercaseCurrency } },
            update: {
                totalBalance: newTotalBalance,
                availableBalance: newAvailable,
            },
            create: {
                accountId,
                currency: uppercaseCurrency,
                availableBalance: newTotalBalance,
                reservedBalance: 0,
                totalBalance: newTotalBalance,
            },
        });

        await tx.ledgerEntry.create({
            data: {
                transactionType: LedgerEntryType.SYNC_ADJUSTMENT,
                creditAccountId: adjustment >= 0 ? accountId : undefined,
                debitAccountId: adjustment < 0 ? accountId : undefined,
                amount: Math.abs(adjustment),
                currency: uppercaseCurrency,
                description: `Manual balance sync by admin: ${previousBalance} → ${newTotalBalance}`,
                metadata: { adminUserId, previousBalance, newTotalBalance, adjustment },
            },
        });

        await tx.balanceSyncLog.create({
            data: {
                provider: "MANUAL",
                accountId,
                currency: uppercaseCurrency,
                syncedBalance: newTotalBalance,
                previousBalance,
                status: BalanceSyncStatus.SUCCESS,
            },
        });
    });

    return {
        accountId,
        provider: "MANUAL",
        status: "SUCCESS",
        currency: uppercaseCurrency,
        previousBalance,
        newBalance: newTotalBalance,
        adjustment,
    };
}
