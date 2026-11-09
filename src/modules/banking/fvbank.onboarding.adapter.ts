/**
 * FV Bank GMA Applications v2 — Onboarding Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Submits PapaEgo business customer applications to FV Bank's sandbox
 * onboarding system (Applications v2 / "Business Plus" tier) so that
 * customers provisioned in PapaEgo appear in the FV Bank Sandbox Portal
 * under Users / Accounts — ready for UAT transactions.
 *
 * Authentication: Same two-step JWT → SessionToken flow as the GMA API.
 * Base URL: FV_BANK_GMA_URL (e.g. https://sandbox.gma-api.fvbank.us)
 *
 * Flow triggered by: Admin approves both KYC + KYB for an organization.
 *   1. POST /business-plus-application  → creates application, returns applicationId
 *   2. POST /officer  (per director/UBO) → registers beneficial owners
 *   3. FV Bank reviews → webhook: account.created → customer visible in portal
 *
 * References: https://gma-docs.fvbank.us/guides/home
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { fvBankGmaClient } from "./fvbank.gma.client";

// ── Payload & Response Types ─────────────────────────────────────────────────

export interface FvBusinessPlusApplicationPayload {
    /** PapaEgo's internal organization ID — stored as partner reference */
    partnerReferenceId: string;
    business: {
        businessName: string;
        businessRegistrationNumber?: string;
        countryOfRegistration: string;
        businessType: string;
        /** e.g. "IMPORT_EXPORT" | "TRADING" | "SERVICES" */
        industry?: string;
        taxIdentification?: string;
        businessAddress: string;
    };
    primaryContact: {
        fullName: string;
        email: string;
        phone?: string;
    };
    directors?: FvOfficerPayload[];
    ubos?: FvOfficerPayload[];
}

export interface FvOfficerPayload {
    fullName: string;
    role: "DIRECTOR" | "UBO" | "AUTHORIZED_SIGNATORY";
    email?: string;
    nationality?: string;
    /** ISO date string e.g. "1985-04-22" */
    dateOfBirth?: string;
    identityType?: string;
    identityNumber?: string;
    residentialAddress?: string;
    /** Ownership percentage (for UBOs) */
    ownershipPercentage?: number;
}

export interface FvBusinessPlusApplicationResponse {
    applicationId: string;
    status: "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | string;
    message?: string;
    submittedAt: string;
}

export interface FvOfficerResponse {
    officerId: string;
    applicationId: string;
    fullName: string;
    role: string;
    status: string;
}

// ── Internal helper: authenticated request via GMA client session token ───────

async function gmaRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
): Promise<T> {
    const baseUrl = (
        process.env.FV_BANK_GMA_URL ||
        process.env.FV_BANK_API_URL ||
        "https://sandbox.gma-api.fvbank.us"
    ).replace(/\/$/, "");

    const sessionToken = await fvBankGmaClient.getSessionToken();

    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            "session-token": sessionToken,
            "x-auth-token": sessionToken,
            "Authorization": `Bearer ${sessionToken}`,
            "Accept": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        const msg = (err as any).message || (err as any).ResponseMessage || res.statusText;
        throw new Error(`FV Bank Onboarding API error (${res.status} on ${path}): ${msg}`);
    }

    return res.json() as Promise<T>;
}

// ── Simulation fallback (mirrors GMA client's simulation logic) ───────────────

function simulateApplicationResponse(
    partnerReferenceId: string,
    businessName: string
): FvBusinessPlusApplicationResponse {
    return {
        applicationId: `fv_app_${Date.now()}_${partnerReferenceId.slice(-6)}`,
        status: "SUBMITTED",
        message: `Business Plus application for "${businessName}" submitted (simulation — IP whitelist pending).`,
        submittedAt: new Date().toISOString(),
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Submit a Business Plus onboarding application to FV Bank.
 * This makes the organization visible in the FV Bank Sandbox Portal
 * under Users / Accounts once FV Bank approves it.
 *
 * Returns the FV Bank applicationId to store against the organization's
 * KYB record so we can correlate the account.created webhook later.
 */
export async function submitBusinessPlusApplication(
    payload: FvBusinessPlusApplicationPayload
): Promise<FvBusinessPlusApplicationResponse> {
    // Gracefully handle IP-whitelist / auth errors with simulation fallback
    if (fvBankGmaClient.isSimulationMode()) {
        const result = simulateApplicationResponse(
            payload.partnerReferenceId,
            payload.business.businessName
        );
        console.log(
            `ℹ️  [FV Bank Onboarding] Simulation mode — application for "${payload.business.businessName}" queued locally (ID: ${result.applicationId}).`
        );
        return result;
    }

    try {
        const response = await gmaRequest<FvBusinessPlusApplicationResponse>(
            "POST",
            "/business-plus-application",
            {
                PartnerReferenceId: payload.partnerReferenceId,
                Business: {
                    BusinessName: payload.business.businessName,
                    BusinessRegistrationNumber: payload.business.businessRegistrationNumber,
                    CountryOfRegistration: payload.business.countryOfRegistration,
                    BusinessType: payload.business.businessType,
                    Industry: payload.business.industry,
                    TaxIdentification: payload.business.taxIdentification,
                    BusinessAddress: payload.business.businessAddress,
                },
                PrimaryContact: {
                    FullName: payload.primaryContact.fullName,
                    Email: payload.primaryContact.email,
                    Phone: payload.primaryContact.phone,
                },
            }
        );

        console.log(
            `✅ [FV Bank Onboarding] Business Plus application submitted for "${payload.business.businessName}". Application ID: ${response.applicationId}`
        );

        // After creating the application, register directors and UBOs as officers
        const officers = [
            ...(payload.directors || []).map(d => ({ ...d, role: "DIRECTOR" as const })),
            ...(payload.ubos || []).map(u => ({ ...u, role: "UBO" as const })),
        ];

        for (const officer of officers) {
            await registerOfficer(response.applicationId, officer).catch((err: Error) => {
                console.warn(
                    `⚠️  [FV Bank Onboarding] Officer registration failed for "${officer.fullName}": ${err.message}`
                );
            });
        }

        return response;
    } catch (err: any) {
        // If this is a 403 (IP whitelist) or network error, fall back to simulation
        if (
            err.message.includes("403") ||
            err.message.includes("401") ||
            err.message.includes("ENOTFOUND") ||
            err.message.includes("network")
        ) {
            console.warn(
                `⚠️  [FV Bank Onboarding] Live API unavailable (${err.message}). Using simulation fallback.`
            );
            return simulateApplicationResponse(
                payload.partnerReferenceId,
                payload.business.businessName
            );
        }
        throw err;
    }
}

/**
 * Register a director or UBO as an Officer on an existing FV Bank application.
 * Called automatically by submitBusinessPlusApplication for each director/UBO.
 */
export async function registerOfficer(
    applicationId: string,
    officer: FvOfficerPayload
): Promise<FvOfficerResponse> {
    if (fvBankGmaClient.isSimulationMode()) {
        return {
            officerId: `fv_off_${Date.now()}`,
            applicationId,
            fullName: officer.fullName,
            role: officer.role,
            status: "SUBMITTED",
        };
    }

    const response = await gmaRequest<FvOfficerResponse>("POST", "/officer", {
        ApplicationId: applicationId,
        FullName: officer.fullName,
        Role: officer.role,
        Email: officer.email,
        Nationality: officer.nationality,
        DateOfBirth: officer.dateOfBirth,
        IdentityType: officer.identityType,
        IdentityNumber: officer.identityNumber,
        ResidentialAddress: officer.residentialAddress,
        OwnershipPercentage: officer.ownershipPercentage,
    });

    console.log(
        `✅ [FV Bank Onboarding] Officer "${officer.fullName}" (${officer.role}) registered for application ${applicationId}.`
    );

    return response;
}

/**
 * Retrieve the status of an existing FV Bank Business Plus application.
 * Useful for polling or admin status-check endpoints.
 */
export async function getApplicationStatus(
    applicationId: string
): Promise<FvBusinessPlusApplicationResponse> {
    if (fvBankGmaClient.isSimulationMode()) {
        return {
            applicationId,
            status: "UNDER_REVIEW",
            message: "Application under review (simulation).",
            submittedAt: new Date().toISOString(),
        };
    }

    return gmaRequest<FvBusinessPlusApplicationResponse>(
        "GET",
        `/business-plus-application?applicationId=${encodeURIComponent(applicationId)}`
    );
}
