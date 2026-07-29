/**
 * Banking Eligibility Validation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates all prerequisites before an organization is allowed to request
 * a dedicated managed U.S. bank account from FV Bank.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";

export interface EligibilityResult {
    isEligible: boolean;
    reasons: string[];
    details: {
        organizationExists: boolean;
        organizationActive: boolean;
        qualificationCompleted: boolean;
        kycApproved: boolean;
        kybApproved: boolean;
        notSuspended: boolean;
        noExistingActiveAccount: boolean;
    };
    organization?: any;
}

export async function checkBankingEligibility(organizationId: string): Promise<EligibilityResult> {
    const reasons: string[] = [];

    // Fetch organization with all compliance & banking relations
    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        include: {
            qualification: true,
            kycRequests: {
                orderBy: { createdAt: "desc" }
            },
            kybRequest: true,
            bankAccount: true
        }
    });

    if (!org) {
        return {
            isEligible: false,
            reasons: ["Organization does not exist."],
            details: {
                organizationExists: false,
                organizationActive: false,
                qualificationCompleted: false,
                kycApproved: false,
                kybApproved: false,
                notSuspended: false,
                noExistingActiveAccount: false
            }
        };
    }

    const organizationExists = true;
    const organizationActive = org.status === "ACTIVE";
    const notSuspended = org.status !== "SUSPENDED" && org.status !== "REJECTED";
    const qualificationCompleted = org.qualification !== null && org.qualification.outcome === "QUALIFIED";

    const latestKyc = org.kycRequests[0];
    const kycApproved = latestKyc !== undefined && latestKyc.status === "APPROVED";

    const kybApproved = org.kybRequest !== null && org.kybRequest.status === "APPROVED";

    // No existing active or creating managed bank account
    const existingAcc = org.bankAccount;
    const noExistingActiveAccount = !existingAcc || existingAcc.status === "CLOSED";

    // Build human-readable failure reasons
    if (!organizationActive) {
        reasons.push("Organization is not active. Current status: " + org.status);
    }
    if (!notSuspended) {
        reasons.push("Organization is currently suspended or rejected.");
    }
    if (!qualificationCompleted) {
        if (!org.qualification) {
            reasons.push("Business qualification assessment has not been completed.");
        } else if (org.qualification.outcome !== "QUALIFIED") {
            reasons.push(`Business qualification outcome is '${org.qualification.outcome}' instead of 'QUALIFIED'.`);
        }
    }
    if (!kycApproved) {
        if (!latestKyc) {
            reasons.push("Identity verification (KYC) has not been submitted.");
        } else if (latestKyc.status !== "APPROVED") {
            reasons.push(`Identity verification (KYC) status is '${latestKyc.status}'. Requires 'APPROVED'.`);
        }
    }
    if (!kybApproved) {
        if (!org.kybRequest) {
            reasons.push("Corporate verification (KYB) has not been submitted.");
        } else if (org.kybRequest.status !== "APPROVED") {
            reasons.push(`Corporate verification (KYB) status is '${org.kybRequest.status}'. Requires 'APPROVED'.`);
        }
    }
    if (!noExistingActiveAccount) {
        reasons.push(`Organization already has a managed bank account (Account Number: ${existingAcc?.accountNumber}, Status: ${existingAcc?.status}).`);
    }

    const isEligible =
        organizationExists &&
        organizationActive &&
        notSuspended &&
        qualificationCompleted &&
        kycApproved &&
        kybApproved &&
        noExistingActiveAccount;

    return {
        isEligible,
        reasons,
        details: {
            organizationExists,
            organizationActive,
            qualificationCompleted,
            kycApproved,
            kybApproved,
            notSuspended,
            noExistingActiveAccount
        },
        organization: org
    };
}
