import prisma from "../../config/db";

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
        "SUBMITTED": "SUBMITTED"
    };
    return mapping[fvStatus.toUpperCase()] || "PROCESSING";
}
