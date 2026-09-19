import prisma from "../../config/db";

// ─────────────────────────────────────────────────────
// Verification State Machine
// Enforces valid status transitions for KYC/KYB entities.
// Prevents illegal regressions (e.g. APPROVED → PROCESSING)
// and impossible jumps (e.g. EXPIRED → APPROVED).
// ─────────────────────────────────────────────────────
export type VerificationStatusValue =
    | "DRAFT"
    | "SUBMITTED"
    | "PROCESSING"
    | "MANUAL_REVIEW"
    | "ADDITIONAL_INFO_REQUIRED"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED";

const VERIFICATION_STATE_TRANSITIONS: Record<VerificationStatusValue, VerificationStatusValue[]> = {
    DRAFT: ["DRAFT", "SUBMITTED"],
    SUBMITTED: ["SUBMITTED", "PROCESSING", "MANUAL_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED", "EXPIRED"],
    PROCESSING: ["PROCESSING", "MANUAL_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED", "EXPIRED"],
    MANUAL_REVIEW: ["MANUAL_REVIEW", "PROCESSING", "ADDITIONAL_INFO_REQUIRED", "APPROVED", "REJECTED", "EXPIRED"],
    ADDITIONAL_INFO_REQUIRED: ["ADDITIONAL_INFO_REQUIRED", "SUBMITTED", "PROCESSING", "MANUAL_REVIEW", "APPROVED", "REJECTED", "EXPIRED"],
    APPROVED: ["APPROVED", "EXPIRED"], // Approved can only expire
    REJECTED: ["REJECTED"], // Terminal
    EXPIRED: ["EXPIRED"] // Terminal
};

export function validateStatusTransition(
    from: string,
    to: string
): { valid: boolean; reason?: string } {
    const fromKey = from as VerificationStatusValue;
    const toKey = to as VerificationStatusValue;

    const allowed = VERIFICATION_STATE_TRANSITIONS[fromKey];
    if (!allowed) {
        // Unknown source status — allow but let caller decide (defensive default)
        return { valid: true };
    }

    if (!allowed.includes(toKey)) {
        return {
            valid: false,
            reason: `Invalid status transition from '${from}' to '${to}'. Allowed next states: ${allowed.join(", ")}.`
        };
    }

    return { valid: true };
}

// ─────────────────────────────────────────────────────
// Record a status change in the immutable audit trail
// ─────────────────────────────────────────────────────
export async function recordStatusChange(params: {
    organizationId: string;
    entityType: "KYC" | "KYB" | "ORGANIZATION";
    fromStatus?: string | null;
    toStatus: string;
    changedBy?: string;
    reason?: string;
    kycRequestId?: string;
    kybRequestId?: string;
    metadata?: Record<string, unknown>;
}) {
    return prisma.verificationStatusHistory.create({
        data: {
            organizationId: params.organizationId,
            entityType: params.entityType,
            fromStatus: params.fromStatus || null,
            toStatus: params.toStatus,
            changedBy: params.changedBy || "SYSTEM",
            reason: params.reason,
            kycRequestId: params.kycRequestId,
            kybRequestId: params.kybRequestId,
            metadata: params.metadata as any
        }
    });
}

// ─────────────────────────────────────────────────────
// Get full compliance status for an organization
// ─────────────────────────────────────────────────────
export async function getComplianceStatus(organizationId: string, requesterId: string) {
    const membership = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: requesterId }
    });
    if (!membership) throw new Error("Access denied.");

    const [org, kyc, kyb, history] = await Promise.all([
        prisma.organization.findUnique({ where: { id: organizationId } }),
        prisma.kycRequest.findFirst({
            where: { organizationId },
            orderBy: { createdAt: "desc" }
        }),
        prisma.kybRequest.findUnique({ where: { organizationId } }),
        prisma.verificationStatusHistory.findMany({
            where: { organizationId },
            orderBy: { createdAt: "desc" },
            take: 20
        })
    ]);

    if (!org) throw new Error("Organization not found.");

    const isFullyApproved = kyc?.status === "APPROVED" && kyb?.status === "APPROVED";

    return {
        organization: {
            id: org.id,
            businessName: org.businessName,
            status: org.status
        },
        kyc: kyc ? {
            id: kyc.id,
            status: kyc.status,
            submittedAt: kyc.submittedAt,
            rejectionReason: kyc.rejectionReason,
            additionalInfoNote: kyc.additionalInfoNote
        } : null,
        kyb: kyb ? {
            id: kyb.id,
            status: kyb.status,
            submittedAt: kyb.submittedAt,
            rejectionReason: kyb.rejectionReason,
            additionalInfoNote: kyb.additionalInfoNote
        } : null,
        isFullyApproved,
        canProceedToManagedAccount: isFullyApproved && org.status === "ACTIVE",
        history: history.map(h => ({
            id: h.id,
            entityType: h.entityType,
            fromStatus: h.fromStatus,
            toStatus: h.toStatus,
            changedBy: h.changedBy,
            reason: h.reason,
            createdAt: h.createdAt
        }))
    };
}

// ─────────────────────────────────────────────────────
// Get status change history for an organization
// ─────────────────────────────────────────────────────
export async function getStatusHistory(organizationId: string, requesterId: string, limit = 50) {
    const membership = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: requesterId }
    });
    if (!membership) throw new Error("Access denied.");

    return prisma.verificationStatusHistory.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: limit
    });
}

// ─────────────────────────────────────────────────────
// Map FV Bank status strings to our VerificationStatus enum
// ─────────────────────────────────────────────────────
export function mapFvBankStatus(fvStatus: string): string {
    const mapping: Record<string, string> = {
        "PROCESSING": "PROCESSING",
        "UNDER_REVIEW": "MANUAL_REVIEW",
        "MANUAL_REVIEW": "MANUAL_REVIEW",
        "ADDITIONAL_INFO_REQUIRED": "ADDITIONAL_INFO_REQUIRED",
        "APPROVED": "APPROVED",
        "REJECTED": "REJECTED",
        "EXPIRED": "EXPIRED",
        "SUBMITTED": "SUBMITTED",
        "COMPLETED": "APPROVED",
        "INITIAL": "SUBMITTED"
    };
    return mapping[(fvStatus || "").toUpperCase()] || "PROCESSING";
}
