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

    // Direct token override if configured in .env
    if (process.env.DUCKCHECK_ACCESS_TOKEN) return process.env.DUCKCHECK_ACCESS_TOKEN;

    const now = Math.floor(Date.now() / 1000);
    if (_cachedToken && _tokenExpiresAt > now + 60) return _cachedToken;

    // Per DuckCheck Postman docs: POST /v1/auth/token with Basic Auth (clientId:clientSecret)
    const basicAuth = Buffer.from(`${DUCKCHECK_CLIENT_ID}:${DUCKCHECK_CLIENT_SECRET}`).toString("base64");
    const authCode = process.env.DUCKCHECK_AUTH_CODE || "";

    const res = await fetch(`${DUCKCHECK_BASE_URL}/v1/auth/token`, {
        method:  "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Basic ${basicAuth}`,
        },
        body: JSON.stringify({ authCode }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`DuckCheck auth failed (${res.status}): ${text}`);
    }

    const data: any = await res.json();
    _cachedToken     = data.accessToken || data.access_token;
    _tokenExpiresAt  = now + Math.floor((data.expireAt || 3600000) / 1000);

    if (!_cachedToken) throw new Error("DuckCheck: missing accessToken in auth response");
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

    if (path.includes("/idv") || path.includes("/kyc")) {
        return {
            applicationId: stubId,
            verificationId: stubId,
            status:        "PROCESSING",
            message:       "KYC identity verification initiated (STUB MODE)",
            submittedAt:   new Date().toISOString(),
        };
    }
    if (path.includes("/business") || path.includes("/kyb")) {
        return {
            applicationId: stubId,
            verificationId: stubId,
            status:        "PROCESSING",
            message:       "KYB business verification initiated (STUB MODE)",
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

    return { stubId, status: "OK" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared response types (drop-in replacement for FvApplicationResponse)
// ─────────────────────────────────────────────────────────────────────────────
export interface DcApplicationResponse {
    applicationId: string;
    status: string;
    verificationId?: string;
    url?: string;
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
// KYC: Submit customer identity verification (IDV Session)
// Per Postman endpoint: POST /v1/product/idv/session
// ─────────────────────────────────────────────────────────────────────────────
export interface DcKycPayload {
    partnerApplicationId: string;   // PapaEgo KycRequest.id
    fullName: string;
    dateOfBirth: string;            // ISO date string e.g. "1990-01-01"
    nationality: string;            // ISO-3166-1 alpha-2 e.g. "NG"
    residentialAddress: string;
    phone: string;
    email: string;
    idType: string;                 // "BVN" | "NIN" | "PASSPORT" | "DRIVERS_LICENSE"
    idNumber?: string;              // The actual document value
    selfieUrl?: string;             // Selfie URL
    partnerOrgId: string;
}

export type FvKycPayload = DcKycPayload;

export async function submitKycApplication(payload: DcKycPayload): Promise<DcApplicationResponse> {
    const parts = (payload.fullName || "").trim().split(" ");
    const firstName = parts[0] || "Customer";
    const lastName = parts.slice(1).join(" ") || firstName;

    const identityTypeMapping: Record<string, string> = {
        "NATIONAL_ID": "NIN",
        "PASSPORT": "PASSPORT",
        "DRIVERS_LICENSE": "DRIVERS_LICENSE",
        "BVN": "NIN"
    };

    const webhookUrl = process.env.DUCKCHECK_CALLBACK_URL || process.env.WEBHOOK_BASE_URL
        ? `${process.env.WEBHOOK_BASE_URL}/compliance/webhook`
        : "https://api.papaego.com/compliance/webhook";

    const response = await dcRequest<any>("POST", "/v1/product/idv/session", {
        callBack: webhookUrl,
        customer: {
            firstName,
            lastName,
            dateOfBirth: payload.dateOfBirth?.split("T")[0] || "1990-01-01",
            customerId: payload.partnerApplicationId,
            fullAddress: payload.residentialAddress,
            email: payload.email,
        },
        device: {
            ipAddress: "127.0.0.1",
            deviceFingerprint: "papaego-web"
        },
        document: {
            value: payload.idNumber || "PENDING",
            identityType: identityTypeMapping[payload.idType] || "PASSPORT",
            country: payload.nationality?.length === 2 ? payload.nationality : "NG"
        }
    });

    const verificationId = response?.verificationId || response?.sessionId || response?.applicationId || `dc_kyc_${Date.now()}`;

    return {
        applicationId: verificationId,
        verificationId,
        status: response?.status || "SUBMITTED",
        url: response?.url,
        submittedAt: new Date().toISOString(),
        message: "DuckCheck KYC session initiated"
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// KYB: Submit corporate verification (Business Verification)
// Per Postman endpoint: POST /v1/product/business/verification
// ─────────────────────────────────────────────────────────────────────────────
export interface DcKybPayload {
    partnerApplicationId: string;   // PapaEgo KybRequest.id
    companyName: string;
    registrationNumber: string;     // CAC RC number
    countryOfIncorporation: string;
    businessAddress: string;
    taxIdentification?: string;     // TIN
    directors?: any[];
    ubos?: any[];
    partnerOrgId: string;
}

export type FvKybPayload = DcKybPayload;

export async function submitKybApplication(payload: DcKybPayload): Promise<DcApplicationResponse> {
    const rawDirectors = payload.directors || [];
    const firstDirector = rawDirectors[0] || {};
    const dirParts = (firstDirector.name || "").trim().split(" ");
    const ownerFirst = dirParts[0] || "Director";
    const ownerLast = dirParts.slice(1).join(" ") || ownerFirst;

    const shareholders = rawDirectors.map(d => {
        const parts = (d.name || "").trim().split(" ");
        return {
            name: d.name,
            firstName: parts[0] || d.name,
            lastName: parts.slice(1).join(" ") || parts[0],
            nationality: d.nationality?.length === 2 ? d.nationality : "NG"
        };
    });

    const response = await dcRequest<any>("POST", "/v1/product/business/verification", {
        email: "compliance@papaego.com",
        phone: "+2348000000000",
        ownerInfo: {
            firstName: ownerFirst,
            lastName: ownerLast,
            dob: firstDirector.dateOfBirth?.split("T")[0] || "1990-01-01",
            citizenship: firstDirector.nationality?.length === 2 ? firstDirector.nationality : "NG",
            country: payload.countryOfIncorporation?.length === 2 ? payload.countryOfIncorporation : "NG",
            address: payload.businessAddress || "Lagos, Nigeria"
        },
        shareholders: shareholders.length ? shareholders : [{
            name: ownerFirst + " " + ownerLast,
            firstName: ownerFirst,
            lastName: ownerLast,
            nationality: "NG"
        }],
        documents: []
    });

    const verificationId = response?.verificationId || response?.requestId || response?.applicationId || `dc_kyb_${Date.now()}`;

    return {
        applicationId: verificationId,
        verificationId,
        status: response?.status || "SUBMITTED",
        submittedAt: new Date().toISOString(),
        message: "DuckCheck KYB verification initiated"
    };
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
    const secret = process.env.DUCKCHECK_WEBHOOK_SECRET || process.env.DUCKCHECK_CLIENT_SECRET;
    const isProd = process.env.NODE_ENV === "production";

    if (!secret) {
        if (isProd) {
            console.error("❌ DUCKCHECK_CLIENT_SECRET is not set in production. Rejecting compliance webhook.");
            return false;
        }
        console.warn("⚠️  DuckCheck secret not set — skipping webhook signature verification (dev/stub mode).");
        return true;
    }

    if (!signature) {
        console.error("❌ Missing compliance webhook signature (x-hmac-signature).");
        return false;
    }

    try {
        const expectedSig = crypto
            .createHmac("sha256", secret)
            .update(Buffer.from(rawBody, "utf8"))
            .digest("hex")
            .toLowerCase();

        const cleanSig = signature.trim().toLowerCase().replace(/^sha256=/, "");

        if (cleanSig.length !== expectedSig.length) return false;
        return crypto.timingSafeEqual(Buffer.from(cleanSig), Buffer.from(expectedSig));
    } catch {
        return false;
    }
}

