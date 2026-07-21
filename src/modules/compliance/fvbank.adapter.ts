/**
 * FV Bank Compliance API Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * All FV Bank HTTP interactions are encapsulated here.
 * No other module should call FV Bank APIs directly.
 *
 * Configured via environment variables:
 *   FV_BANK_API_URL      - Base URL of FV Bank compliance API
 *   FV_BANK_API_KEY      - API key for authentication
 *   FV_BANK_WEBHOOK_SECRET - Webhook HMAC signing secret
 *
 * When FV_BANK_API_URL is not set, the adapter returns STUBBED responses
 * so the full workflow can be tested end-to-end without live credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from "crypto";

const FV_BANK_API_URL = process.env.FV_BANK_API_URL || "";
const FV_BANK_API_KEY = process.env.FV_BANK_API_KEY || "";
const STUB_MODE = !FV_BANK_API_URL;

if (STUB_MODE) {
    console.warn("⚠️  FV Bank adapter running in STUB MODE. Set FV_BANK_API_URL and FV_BANK_API_KEY to enable live compliance.");
}

// ─────────────────────────────────────────────────────
// Internal: HTTP request helper
// ─────────────────────────────────────────────────────
async function fvRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (STUB_MODE) {
        return generateStubResponse(method, path, body) as T;
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

// ─────────────────────────────────────────────────────
// Stub response generator (used when no live API configured)
// ─────────────────────────────────────────────────────
function generateStubResponse(method: string, path: string, _body: unknown): unknown {
    const stubId = `stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (path.includes("/kyc")) {
        return {
            applicationId: stubId,
            status: "PROCESSING",
            message: "KYC application received (STUB MODE)",
            submittedAt: new Date().toISOString()
        };
    }
    if (path.includes("/kyb")) {
        return {
            applicationId: stubId,
            status: "PROCESSING",
            message: "KYB application received (STUB MODE)",
            submittedAt: new Date().toISOString()
        };
    }
    if (path.includes("/documents")) {
        return {
            documentId: stubId,
            status: "UPLOADED",
            message: "Document uploaded (STUB MODE)"
        };
    }
    if (path.includes("/status")) {
        return {
            applicationId: stubId,
            status: "PROCESSING",
            updatedAt: new Date().toISOString()
        };
    }

    return { stubId, status: "OK" };
}

// ─────────────────────────────────────────────────────
// KYC: Submit a KYC application to FV Bank
// ─────────────────────────────────────────────────────
export interface FvKycPayload {
    partnerApplicationId: string;  // Our KycRequest.id
    fullName: string;
    dateOfBirth: string;           // ISO date string
    nationality: string;
    residentialAddress: string;
    phone: string;
    email: string;
    idType: string;
    partnerOrgId: string;
}

export interface FvApplicationResponse {
    applicationId: string;
    status: string;
    message?: string;
    submittedAt: string;
}

export async function submitKycApplication(payload: FvKycPayload): Promise<FvApplicationResponse> {
    return fvRequest<FvApplicationResponse>("POST", "/kyc/applications", payload);
}

// ─────────────────────────────────────────────────────
// KYB: Submit a KYB application to FV Bank
// ─────────────────────────────────────────────────────
export interface FvKybPayload {
    partnerApplicationId: string;  // Our KybRequest.id
    companyName: string;
    registrationNumber: string;
    countryOfIncorporation: string;
    businessAddress: string;
    taxIdentification?: string;
    directors?: unknown[];
    ubos?: unknown[];
    partnerOrgId: string;
}

export async function submitKybApplication(payload: FvKybPayload): Promise<FvApplicationResponse> {
    return fvRequest<FvApplicationResponse>("POST", "/kyb/applications", payload);
}

// ─────────────────────────────────────────────────────
// Documents: Upload a supporting document to FV Bank
// ─────────────────────────────────────────────────────
export interface FvDocumentResponse {
    documentId: string;
    status: string;
    message?: string;
}

export async function uploadDocument(
    applicationId: string,
    applicationType: "KYC" | "KYB",
    documentType: string,
    fileUrl: string,
    fileName: string
): Promise<FvDocumentResponse> {
    return fvRequest<FvDocumentResponse>("POST", "/documents", {
        applicationId,
        applicationType,
        documentType,
        fileUrl,
        fileName
    });
}

// ─────────────────────────────────────────────────────
// Status: Poll verification status from FV Bank
// ─────────────────────────────────────────────────────
export interface FvStatusResponse {
    applicationId: string;
    status: string;
    rejectionReason?: string;
    additionalInfoNote?: string;
    updatedAt: string;
}

export async function getVerificationStatus(
    applicationId: string,
    applicationType: "KYC" | "KYB"
): Promise<FvStatusResponse> {
    const path = applicationType === "KYC"
        ? `/kyc/applications/${applicationId}`
        : `/kyb/applications/${applicationId}`;
    return fvRequest<FvStatusResponse>("GET", path);
}

// ─────────────────────────────────────────────────────
// Webhook: Verify HMAC signature from FV Bank
// ─────────────────────────────────────────────────────
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = process.env.FV_BANK_WEBHOOK_SECRET;
    if (!secret) {
        console.warn("⚠️  FV_BANK_WEBHOOK_SECRET not set — skipping webhook signature verification.");
        return true; // Allow in dev/stub mode
    }

    const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(`sha256=${expectedSig}`)
    );
}
