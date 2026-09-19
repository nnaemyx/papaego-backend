/**
 * DuckCheck Compliance Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the FV Bank compliance adapter for KYC and KYB verification.
 *
 * DuckCheck is an AI-powered identity & corporate verification platform
 * (https://www.duckcheck.com) used for:
 *   • KYC: BVN, NIN, Passport, Driver's License, Liveness/Selfie verification
 *   • KYB: CAC registration, RC number, TIN, Directors & UBO screening
 *
 * Auth: OAuth2 client_credentials grant → short-lived Bearer token
 * Credentials (add to your .env and Render Dashboard):
 *   DUCKCHECK_CLIENT_ID     = a3f41341-1078-47fe-9e6c-9a00440e8829
 *   DUCKCHECK_CLIENT_SECRET = 09f24b0f-6666-4054-8e43-32015c7d3792
 *   DUCKCHECK_BASE_URL      = https://api.duckcheck.com   (confirm with DuckCheck)
 *
 * When credentials are absent the adapter returns stub responses so the full
 * workflow can be tested end-to-end without live credentials.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DUCKCHECK_BASE_URL  = (process.env.DUCKCHECK_BASE_URL  || "").replace(/\/$/, "");
const DUCKCHECK_CLIENT_ID     = process.env.DUCKCHECK_CLIENT_ID     || "";
const DUCKCHECK_CLIENT_SECRET = process.env.DUCKCHECK_CLIENT_SECRET || "";

const STUB_MODE = !DUCKCHECK_CLIENT_ID || !DUCKCHECK_CLIENT_SECRET || !DUCKCHECK_BASE_URL;

if (STUB_MODE) {
    console.warn(
        "⚠️  DuckCheck adapter running in STUB MODE. " +
        "Set DUCKCHECK_CLIENT_ID, DUCKCHECK_CLIENT_SECRET, and DUCKCHECK_BASE_URL to enable live verification."
    );
} else {
    console.log(`🔌 DuckCheck adapter initialized → ${DUCKCHECK_BASE_URL}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Cache (in-process; reuse until 60s before expiry)
// ─────────────────────────────────────────────────────────────────────────────
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
    if (STUB_MODE) return "stub_duckcheck_token";

    const now = Math.floor(Date.now() / 1000);
    if (_cachedToken && _tokenExpiresAt > now + 60) return _cachedToken;

    const body = new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     DUCKCHECK_CLIENT_ID,
        client_secret: DUCKCHECK_CLIENT_SECRET,
    });

    const res = await fetch(`${DUCKCHECK_BASE_URL}/oauth/token`, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`DuckCheck auth failed (${res.status}): ${text}`);
    }

    const data: any = await res.json();
    _cachedToken     = data.access_token;
    _tokenExpiresAt  = now + (data.expires_in || 3600);

    if (!_cachedToken) throw new Error("DuckCheck: missing access_token in auth response");
    return _cachedToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal HTTP helper
// ─────────────────────────────────────────────────────────────────────────────
async function dcRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (STUB_MODE) {
        return generateStubResponse(path) as T;
    }

    const token = await getAccessToken();
    const res = await fetch(`${DUCKCHECK_BASE_URL}${path}`, {
        method,
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
            "X-Partner-ID":  "PAPA_EGO",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const err: any = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(`DuckCheck API error (${res.status}): ${err.message || res.statusText}`);
    }

    return res.json() as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub response generator
// ─────────────────────────────────────────────────────────────────────────────
function generateStubResponse(path: string): unknown {
    const stubId = `dc_stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (path.includes("/kyc")) {
        return {
            applicationId: stubId,
            status:        "PROCESSING",
            message:       "KYC verification initiated (STUB MODE)",
            submittedAt:   new Date().toISOString(),
        };
    }
    if (path.includes("/kyb")) {
        return {
            applicationId: stubId,
            status:        "PROCESSING",
            message:       "KYB verification initiated (STUB MODE)",
            submittedAt:   new Date().toISOString(),
        };
    }
    if (path.includes("/documents")) {
        return {
            documentId: stubId,
            status:     "UPLOADED",
            message:    "Document received (STUB MODE)",
        };
    }
    if (path.includes("/status") || path.includes("/" + stubId.split("_")[2])) {
        return {
            applicationId: stubId,
            status:        "PROCESSING",
            updatedAt:     new Date().toISOString(),
        };
    }

    return { stubId, status: "OK" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared response types (drop-in replacement for FvApplicationResponse)
// ─────────────────────────────────────────────────────────────────────────────
export interface DcApplicationResponse {
    applicationId: string;
    status: string;
    message?: string;
    submittedAt: string;
}

export interface DcDocumentResponse {
    documentId: string;
    status: string;
    message?: string;
}

export interface DcStatusResponse {
    applicationId: string;
    status: string;
    rejectionReason?: string;
    additionalInfoNote?: string;
    updatedAt: string;
}

// Keep backward-compat alias so controllers don't need touching
export type FvApplicationResponse = DcApplicationResponse;
export type FvDocumentResponse    = DcDocumentResponse;
export type FvStatusResponse      = DcStatusResponse;

// ─────────────────────────────────────────────────────────────────────────────
// KYC: Submit director / customer identity verification
// ─────────────────────────────────────────────────────────────────────────────
export interface DcKycPayload {
    partnerApplicationId: string;   // PapaEgo KycRequest.id
    fullName: string;
    dateOfBirth: string;            // ISO date string  e.g. "1990-01-15"
    nationality: string;            // ISO-3166-1 alpha-2 e.g. "NG"
    residentialAddress: string;
    phone: string;
    email: string;
    idType: string;                 // "BVN" | "NIN" | "PASSPORT" | "DRIVERS_LICENSE"
    idNumber?: string;              // The actual BVN/NIN/passport number
    selfieUrl?: string;             // Cloudinary URL of uploaded selfie
    partnerOrgId: string;
}

// Keep backward-compat alias for kyc.controller.ts
export type FvKycPayload = DcKycPayload;

export async function submitKycApplication(payload: DcKycPayload): Promise<DcApplicationResponse> {
    return dcRequest<DcApplicationResponse>("POST", "/v1/kyc/verifications", {
        reference:           payload.partnerApplicationId,
        partner_org_id:      payload.partnerOrgId,
        full_name:           payload.fullName,
        date_of_birth:       payload.dateOfBirth,
        nationality:         payload.nationality,
        residential_address: payload.residentialAddress,
        phone:               payload.phone,
        email:               payload.email,
        id_type:             payload.idType,
        id_number:           payload.idNumber,
        selfie_url:          payload.selfieUrl,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// KYB: Submit corporate/business verification (CAC, directors, UBOs)
// ─────────────────────────────────────────────────────────────────────────────
export interface DcKybPayload {
    partnerApplicationId: string;   // PapaEgo KybRequest.id
    companyName: string;
    registrationNumber: string;     // CAC RC number
    countryOfIncorporation: string;
    businessAddress: string;
    taxIdentification?: string;     // TIN
    directors?: unknown[];
    ubos?: unknown[];
    partnerOrgId: string;
}

// Keep backward-compat alias for kyb.controller.ts
export type FvKybPayload = DcKybPayload;

export async function submitKybApplication(payload: DcKybPayload): Promise<DcApplicationResponse> {
    return dcRequest<DcApplicationResponse>("POST", "/v1/kyb/verifications", {
        reference:                 payload.partnerApplicationId,
        partner_org_id:            payload.partnerOrgId,
        company_name:              payload.companyName,
        registration_number:       payload.registrationNumber,
        country_of_incorporation:  payload.countryOfIncorporation,
        business_address:          payload.businessAddress,
        tax_identification:        payload.taxIdentification,
        directors:                 payload.directors ?? [],
        ubos:                      payload.ubos ?? [],
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents: Upload supporting document (Passport, CAC cert, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export async function uploadDocument(
    applicationId: string,
    applicationType: "KYC" | "KYB",
    documentType: string,
    fileUrl: string,
    fileName: string
): Promise<DcDocumentResponse> {
    return dcRequest<DcDocumentResponse>("POST", "/v1/documents", {
        application_id:   applicationId,
        application_type: applicationType,
        document_type:    documentType,
        file_url:         fileUrl,
        file_name:        fileName,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status: Poll verification status
// ─────────────────────────────────────────────────────────────────────────────
export async function getVerificationStatus(
    applicationId: string,
    applicationType: "KYC" | "KYB"
): Promise<DcStatusResponse> {
    const path = applicationType === "KYC"
        ? `/v1/kyc/verifications/${applicationId}`
        : `/v1/kyb/verifications/${applicationId}`;
    return dcRequest<DcStatusResponse>("GET", path);
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook: Verify HMAC signature from DuckCheck
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret  = process.env.DUCKCHECK_WEBHOOK_SECRET;
    const isProd  = process.env.NODE_ENV === "production";

    if (!secret) {
        if (isProd) {
            console.error("❌ DUCKCHECK_WEBHOOK_SECRET is not set in production. Rejecting compliance webhook.");
            return false;
        }
        console.warn("⚠️  DUCKCHECK_WEBHOOK_SECRET not set — skipping webhook signature verification (dev/stub mode).");
        return true;
    }

    if (!signature) {
        console.error("❌ Missing compliance webhook signature while DUCKCHECK_WEBHOOK_SECRET is configured.");
        return false;
    }

    try {
        const expectedSig = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");

        const sigBuffer      = Buffer.from(signature);
        const expectedBuffer = Buffer.from(`sha256=${expectedSig}`);

        if (sigBuffer.length !== expectedBuffer.length) return false;
        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
        return false;
    }
}

