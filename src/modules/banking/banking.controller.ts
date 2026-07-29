/**
 * Banking API Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP request handlers for Banking Eligibility, Account Provisioning,
 * Profile Fetching, Status Polling, Synchronization, and Inbound Webhooks.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import { checkBankingEligibility } from "./banking.eligibility.service";
import { provisionManagedAccount } from "./banking.provisioning.service";
import { syncBankAccount } from "./banking.sync.service";
import { getBankingProfile } from "./banking.profile.service";
import { processBankingWebhook } from "./banking.webhook.service";

async function getOrgIdForUser(userId: string, requestedOrgId?: string): Promise<string> {
    if (requestedOrgId) {
        // Validate user membership
        const member = await prisma.organizationMember.findFirst({
            where: { organizationId: requestedOrgId, userId }
        });
        if (!member) {
            throw new Error("Access denied to requested organization.");
        }
        return requestedOrgId;
    }

    const member = await prisma.organizationMember.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" }
    });

    if (!member) {
        throw new Error("User does not belong to any organization.");
    }

    return member.organizationId;
}

// ─────────────────────────────────────────────────────
// GET /banking/eligibility
// ─────────────────────────────────────────────────────
export async function getEligibility(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const orgId = await getOrgIdForUser(userId, req.query.organizationId as string);

        const eligibility = await checkBankingEligibility(orgId);
        res.json(eligibility);
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────────────
// POST /banking/account
// ─────────────────────────────────────────────────────
export async function createAccount(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const orgId = await getOrgIdForUser(userId, req.body.organizationId);

        const result = await provisionManagedAccount(orgId, userId);
        res.status(201).json({
            message: "Managed U.S. bank account provisioned successfully.",
            bankAccount: result.bankAccount,
            bankingProfile: result.bankingProfile
        });
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────────────
// GET /banking/account
// ─────────────────────────────────────────────────────
export async function getAccount(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const orgId = await getOrgIdForUser(userId, req.query.organizationId as string);

        const profile = await getBankingProfile(orgId);
        if (!profile) {
            return res.status(404).json({
                error: "No banking profile found. Account may not be provisioned yet.",
                organizationId: orgId
            });
        }

        res.json({ profile });
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────────────
// GET /banking/account/status
// ─────────────────────────────────────────────────────
export async function getAccountStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const orgId = await getOrgIdForUser(userId, req.query.organizationId as string);

        const bankAccount = await prisma.bankAccount.findUnique({
            where: { organizationId: orgId }
        });

        if (!bankAccount) {
            const eligibility = await checkBankingEligibility(orgId);
            return res.json({
                hasAccount: false,
                status: "PENDING_CREATION",
                isEligible: eligibility.isEligible,
                reasons: eligibility.reasons
            });
        }

        res.json({
            hasAccount: true,
            status: bankAccount.status,
            accountNumber: bankAccount.accountNumber,
            routingNumber: bankAccount.routingNumber,
            bankName: bankAccount.bankName,
            currency: bankAccount.currency,
            createdAt: bankAccount.createdAt
        });
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────────────
// POST /banking/sync
// ─────────────────────────────────────────────────────
export async function syncAccount(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const orgId = await getOrgIdForUser(userId, req.body.organizationId);

        const bankAccount = await prisma.bankAccount.findUnique({
            where: { organizationId: orgId }
        });

        if (!bankAccount) {
            return res.status(404).json({ error: "No bank account found to synchronize." });
        }

        const result = await syncBankAccount(bankAccount.id, "MANUAL");
        res.json({
            message: "Account synchronized with FV Bank.",
            ...result
        });
    } catch (err) {
        next(err);
    }
}

// ─────────────────────────────────────────────────────
// POST /banking/webhook (Public HMAC endpoint)
// ─────────────────────────────────────────────────────
export async function handleBankingWebhook(req: Request, res: Response, next: NextFunction) {
    try {
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);
        const signature = req.headers["x-fvbank-signature"] as string | undefined;

        const result = await processBankingWebhook(rawBody, signature, req.body);
        res.json({ status: "OK", ...result });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}
