/**
 * FV Bank Banking API Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Encapsulates all FV Bank Banking operations (Managed Account Provisioning,
 * Account Details, Status Polling, Synchronization, Webhooks).
 *
 * Configured via environment variables:
 *   FV_BANK_API_URL        - Base URL of FV Bank API
 *   FV_BANK_API_KEY        - API key for authentication
 *   FV_BANK_WEBHOOK_SECRET - Webhook HMAC signing secret
 *
 * Runs in STUB MODE when FV_BANK_API_URL is missing, allowing offline end-to-end
 * testing with realistic U.S. banking credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from "crypto";

const FV_BANK_API_URL = process.env.FV_BANK_API_URL || "";
const FV_BANK_API_KEY = process.env.FV_BANK_API_KEY || "";
const STUB_MODE = !FV_BANK_API_URL;

if (STUB_MODE) {
    console.warn("⚠️  FV Bank Banking Adapter running in STUB MODE (Mock U.S. Bank Accounts).");
}

async function fvBankingRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (STUB_MODE) {
        return generateBankingStubResponse(method, path, body) as T;
    }

    const res = await fetch(`${FV_BANK_API_URL}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${FV_BANK_API_KEY}`,
            "X-Partner-ID": "PAPA_EGO"
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(`FV Bank API error (${res.status}): ${(err as any).message || res.statusText}`);
    }

    return res.json() as T;
}

function generateBankingStubResponse(method: string, path: string, body: unknown): unknown {
    const timestamp = Date.now();
    const stubAccountId = `fv_acc_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
    const randomAccNum = Math.floor(1000000000 + Math.random() * 9000000000).toString();

    const bodyData = (body as any) || {};

    if (path.includes("/accounts/managed") && method === "POST") {
        return {
            fvAccountId: stubAccountId,
            accountNumber: randomAccNum,
            routingNumber: "021000021", // Standard U.S. Routing Number format
            accountHolder: bodyData.accountHolderName || bodyData.companyName || "Papa Ego Customer",
            bankName: "FV Bank",
            currency: "USD",
            country: "United States",
            swiftBic: "FVBKUS33XXX",
            accountReference: `REF-${timestamp.toString().slice(-6)}`,
            status: "ACTIVE",
            message: "Managed U.S. bank account provisioned successfully (STUB MODE)",
            createdAt: new Date().toISOString()
        };
    }

    if (path.includes("/status")) {
        return {
            fvAccountId: stubAccountId,
            status: "ACTIVE",
            restrictions: [],
            isFrozen: false,
            isSuspended: false,
            updatedAt: new Date().toISOString()
        };
    }

    if (path.includes("/sync")) {
        return {
            fvAccountId: stubAccountId,
            status: "ACTIVE",
            hasChanges: false,
            syncedAt: new Date().toISOString()
        };
    }

    return {
        fvAccountId: stubAccountId,
        accountNumber: randomAccNum,
        routingNumber: "021000021",
        bankName: "FV Bank",
        currency: "USD",
        status: "ACTIVE"
    };
}

export interface FvCreateAccountPayload {
    organizationId: string;
    companyName: string;
    accountHolderName: string;
    businessType: string;
    countryOfRegistration: string;
    registrationNumber?: string;
    taxIdentification?: string;
    contactEmail: string;
}

export interface FvCreateAccountResponse {
    fvAccountId: string;
    accountNumber: string;
    routingNumber: string;
    accountHolder: string;
    bankName: string;
    currency: string;
    country?: string;
    swiftBic?: string;
    accountReference?: string;
    status: string;
    message?: string;
    createdAt: string;
}

export interface FvAccountDetailsResponse {
    fvAccountId: string;
    accountNumber: string;
    routingNumber: string;
    accountHolder: string;
    bankName: string;
    currency: string;
    status: string;
    country?: string;
    swiftBic?: string;
    accountReference?: string;
}

export interface FvAccountStatusResponse {
    fvAccountId: string;
    status: string;
    restrictions?: string[];
    isFrozen?: boolean;
    isSuspended?: boolean;
    updatedAt: string;
}

export async function requestManagedAccount(payload: FvCreateAccountPayload): Promise<FvCreateAccountResponse> {
    return fvBankingRequest<FvCreateAccountResponse>("POST", "/accounts/managed", payload);
}

export async function getAccountDetails(fvAccountId: string): Promise<FvAccountDetailsResponse> {
    return fvBankingRequest<FvAccountDetailsResponse>("GET", `/accounts/managed/${fvAccountId}`);
}

export async function getAccountStatus(fvAccountId: string): Promise<FvAccountStatusResponse> {
    return fvBankingRequest<FvAccountStatusResponse>("GET", `/accounts/managed/${fvAccountId}/status`);
}

export async function syncAccountData(fvAccountId: string): Promise<unknown> {
    return fvBankingRequest<unknown>("POST", `/accounts/managed/${fvAccountId}/sync`);
}

export function verifyBankingWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = process.env.FV_BANK_WEBHOOK_SECRET;
    const isProd = process.env.NODE_ENV === "production";

    if (!secret) {
        // In production a missing secret is a misconfiguration — fail closed.
        if (isProd) {
            console.error("❌ FV_BANK_WEBHOOK_SECRET is not set in production. Rejecting banking webhook.");
            return false;
        }
        console.warn("⚠️  FV_BANK_WEBHOOK_SECRET not set — skipping banking webhook signature verification (dev/stub mode).");
        return true;
    }

    // A secret is configured, so a signature is now mandatory in every environment.
    if (!signature) {
        console.error("❌ Missing banking webhook signature while FV_BANK_WEBHOOK_SECRET is configured.");
        return false;
    }

    try {
        const expectedSig = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");

        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSig);

        // timingSafeEqual throws on length mismatch — guard first.
        if (sigBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
        return false;
    }
}

