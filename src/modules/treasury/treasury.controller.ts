import { Request, Response } from "express";
import {
    getAllBalances,
    getBalanceByCurrency,
    getLedgerEntries,
    reserveFunds,
    releaseFunds,
    completeSettlement,
    recordDeposit,
    getTreasuryAccounts,
    createTreasuryAccount,
    updateTreasuryAccount,
    getSyncLogs,
} from "./treasury.service";
import {
    syncAllAccounts,
    syncSingleAccount,
    manualBalanceSync,
    listProviders,
} from "./treasury.sync.service";
import { LedgerEntryType, AccountStatus } from "@prisma/client";

// ─── Balance Endpoints ────────────────────────────────────────────────────────

/**
 * GET /treasury/balances
 * Returns all treasury balances aggregated by currency.
 */
export async function getBalances(req: Request, res: Response) {
    try {
        const balances = await getAllBalances();
        res.json({ balances });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /treasury/balance/:currency
 * Returns balance breakdown for a specific currency.
 */
export async function getBalanceForCurrency(req: Request, res: Response) {
    try {
        const { currency } = req.params;
        const balance = await getBalanceByCurrency(currency);
        res.json(balance);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Fund Movement Endpoints ──────────────────────────────────────────────────

/**
 * POST /treasury/deposit
 * Record an incoming deposit to a treasury account.
 * Body: { accountId, currency, amount, description, metadata? }
 */
export async function deposit(req: Request, res: Response) {
    try {
        const { accountId, currency, amount, description, metadata } = req.body;
        if (!accountId || !currency || !amount || !description) {
            return res.status(400).json({ error: "accountId, currency, amount, and description are required" });
        }
        const result = await recordDeposit({ accountId, currency, amount: Number(amount), description, metadata });
        res.status(201).json({ success: true, ...result });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * POST /treasury/reserve
 * Reserve funds before a settlement. Prevents double-spending.
 * Body: { accountId, currency, amount, description, metadata? }
 */
export async function reserve(req: Request, res: Response) {
    try {
        const { accountId, currency, amount, description, metadata } = req.body;
        if (!accountId || !currency || !amount || !description) {
            return res.status(400).json({ error: "accountId, currency, amount, and description are required" });
        }
        const result = await reserveFunds({ accountId, currency, amount: Number(amount), description, metadata });
        res.status(201).json({ success: true, ...result });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * POST /treasury/release
 * Release a previously reserved amount back to available.
 * Called when a settlement fails.
 * Body: { accountId, currency, amount, description, metadata? }
 */
export async function release(req: Request, res: Response) {
    try {
        const { accountId, currency, amount, description, metadata } = req.body;
        if (!accountId || !currency || !amount || !description) {
            return res.status(400).json({ error: "accountId, currency, amount, and description are required" });
        }
        const result = await releaseFunds({ accountId, currency, amount: Number(amount), description, metadata });
        res.status(201).json({ success: true, ...result });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * POST /treasury/settle
 * Complete a settlement, deducting from reserved and total balances.
 * Body: { accountId, currency, amount, description, metadata? }
 */
export async function settle(req: Request, res: Response) {
    try {
        const { accountId, currency, amount, description, metadata } = req.body;
        if (!accountId || !currency || !amount || !description) {
            return res.status(400).json({ error: "accountId, currency, amount, and description are required" });
        }
        const result = await completeSettlement({ accountId, currency, amount: Number(amount), description, metadata });
        res.status(201).json({ success: true, ...result });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

// ─── Sync Endpoints ───────────────────────────────────────────────────────────

/**
 * POST /treasury/sync
 * Trigger balance synchronization from all providers.
 */
export async function sync(req: Request, res: Response) {
    try {
        const { accountId, currency, balance, manual } = req.body;

        // Manual single-account sync
        if (manual && accountId && currency && balance !== undefined) {
            const user = (req as any).user;
            const result = await manualBalanceSync(accountId, currency, Number(balance), user.id);
            return res.json({ success: true, result });
        }

        // Sync a single account
        if (accountId) {
            const account = await import("../../config/db").then((m) =>
                m.default.treasuryAccount.findUnique({ where: { id: accountId } })
            );
            if (!account) return res.status(404).json({ error: "Account not found" });
            const result = await syncSingleAccount(accountId, account.provider);
            return res.json({ success: true, result });
        }

        // Sync all accounts
        const summary = await syncAllAccounts();
        res.json({ success: true, summary });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /treasury/sync/logs
 * Get sync history.
 */
export async function syncLogs(req: Request, res: Response) {
    try {
        const { accountId, provider, limit } = req.query;
        const logs = await getSyncLogs({
            accountId: accountId as string,
            provider: provider as string,
            limit: limit ? Number(limit) : 100,
        });
        res.json({ logs });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /treasury/providers
 * List all available sync providers.
 */
export async function getProviders(_req: Request, res: Response) {
    res.json({ providers: listProviders() });
}

// ─── Ledger Endpoints ─────────────────────────────────────────────────────────

/**
 * GET /ledger/entries
 * Get paginated, filterable ledger entries.
 */
export async function getLedger(req: Request, res: Response) {
    try {
        const { currency, transactionType, accountId, startDate, endDate, page, limit } = req.query;

        const result = await getLedgerEntries({
            currency: currency as string,
            transactionType: transactionType as LedgerEntryType,
            accountId: accountId as string,
            startDate: startDate ? new Date(startDate as string) : undefined,
            endDate: endDate ? new Date(endDate as string) : undefined,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 50,
        });

        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Account Management Endpoints ────────────────────────────────────────────

/**
 * GET /treasury/accounts
 * Get all treasury accounts.
 */
export async function getAccounts(req: Request, res: Response) {
    try {
        const { status, accountType, currency } = req.query;
        const accounts = await getTreasuryAccounts({
            status: status as AccountStatus,
            accountType: accountType as string,
            currency: currency as string,
        });
        res.json({ accounts });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /treasury/accounts
 * Create a new treasury account.
 */
export async function createAccount(req: Request, res: Response) {
    try {
        const { accountName, provider, currency, accountType, initialBalance, accountNumber, metadata } = req.body;
        if (!accountName || !provider || !currency || !accountType) {
            return res.status(400).json({ error: "accountName, provider, currency, and accountType are required" });
        }
        const account = await createTreasuryAccount({
            accountName,
            provider,
            currency,
            accountType,
            initialBalance,
            accountNumber,
            metadata
        });
        res.status(201).json({ account });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * PATCH /treasury/accounts/:id
 * Update a treasury account (name, provider, status).
 */
export async function updateAccount(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { accountName, provider, status, metadata } = req.body;
        const account = await updateTreasuryAccount(id, { accountName, provider, status, metadata });
        res.json({ account });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}

/**
 * DELETE /treasury/accounts/:id
 * Delete a treasury account and its balances.
 */
export async function deleteAccount(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { deleteTreasuryAccount } = await import("./treasury.service");
        await deleteTreasuryAccount(id);
        res.json({ success: true, message: "Treasury account deleted successfully" });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}
