import prisma from "../../config/db";
import { recordStatusChange } from "../compliance/status.service";

// ─────────────────────────────────────────────────────
// Qualification Scoring Engine
// Evaluates questionnaire answers and returns outcome
// ─────────────────────────────────────────────────────

interface QualificationInput {
    organizationId: string;
    hasInternationalPayments: boolean;
    expectedMonthlyVolume?: number;
    supplierPaymentFrequency?: string;
    countriesOfOperation: string[];
    primaryUseCase?: string;
    additionalContext?: string;
}

type Outcome = "QUALIFIED" | "MANUAL_REVIEW" | "NOT_QUALIFIED";

function scoreQualification(input: QualificationInput): { outcome: Outcome; notes: string } {
    const reasons: string[] = [];
    let score = 0;
    let manualReviewTriggers: string[] = [];

    // Rule 1: Must have international payment needs
    if (!input.hasInternationalPayments) {
        return {
            outcome: "NOT_QUALIFIED",
            notes: "Business does not have international payment needs. Papa Ego is designed for cross-border payments."
        };
    }
    score += 30;

    // Rule 2: Monthly volume assessment (informational — not auto-blocked per spec)
    if (input.expectedMonthlyVolume !== undefined) {
        if (input.expectedMonthlyVolume >= 20000) {
            score += 30;
            reasons.push("Meets or exceeds $20,000 monthly transaction threshold.");
        } else if (input.expectedMonthlyVolume >= 5000) {
            score += 15;
            manualReviewTriggers.push(`Expected monthly volume ($${input.expectedMonthlyVolume?.toLocaleString()}) is below $20,000 threshold.`);
        } else {
            manualReviewTriggers.push(`Expected monthly volume ($${input.expectedMonthlyVolume?.toLocaleString()}) is significantly below threshold.`);
        }
    } else {
        manualReviewTriggers.push("Monthly transaction volume not provided.");
    }

    // Rule 3: Countries of operation — high-risk country check
    const highRiskCountries = ["IR", "KP", "SY", "CU", "SD", "RU", "BY"];
    const hasHighRisk = input.countriesOfOperation.some(c => highRiskCountries.includes(c.toUpperCase()));
    if (hasHighRisk) {
        return {
            outcome: "NOT_QUALIFIED",
            notes: "One or more countries of operation are subject to international sanctions. Papa Ego cannot process payments to these jurisdictions."
        };
    }
    score += 20;

    // Rule 4: Payment frequency
    if (input.supplierPaymentFrequency === "WEEKLY" || input.supplierPaymentFrequency === "MONTHLY") {
        score += 20;
    } else if (input.supplierPaymentFrequency) {
        score += 10;
    }

    // Determine outcome
    if (score >= 70 && manualReviewTriggers.length === 0) {
        return {
            outcome: "QUALIFIED",
            notes: `Business qualifies for Papa Ego. ${reasons.join(" ")}`
        };
    } else if (manualReviewTriggers.length > 0) {
        return {
            outcome: "MANUAL_REVIEW",
            notes: `Manual review required. ${manualReviewTriggers.join(" ")} Score: ${score}/100.`
        };
    } else {
        return {
            outcome: "QUALIFIED",
            notes: `Business qualifies for Papa Ego. Score: ${score}/100.`
        };
    }
}

// ─────────────────────────────────────────────────────
// Submit qualification questionnaire
// ─────────────────────────────────────────────────────
export async function submitQualification(userId: string, input: QualificationInput) {
    const org = await prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!org) throw new Error("Organization not found.");
    if (org.ownerId !== userId) throw new Error("Only the organization owner can submit qualification.");

    // Check if already qualified
    const existing = await prisma.qualificationAssessment.findUnique({
        where: { organizationId: input.organizationId }
    });
    if (existing?.outcome === "QUALIFIED") {
        throw new Error("This organization has already been qualified. Please proceed to compliance verification.");
    }

    const { outcome, notes } = scoreQualification(input);

    const assessment = await prisma.qualificationAssessment.upsert({
        where: { organizationId: input.organizationId },
        create: {
            organizationId: input.organizationId,
            hasInternationalPayments: input.hasInternationalPayments,
            expectedMonthlyVolume: input.expectedMonthlyVolume,
            supplierPaymentFrequency: input.supplierPaymentFrequency,
            countriesOfOperation: input.countriesOfOperation,
            primaryUseCase: input.primaryUseCase,
            additionalContext: input.additionalContext,
            outcome,
            reviewNotes: notes,
            reviewedAt: new Date()
        },
        update: {
            hasInternationalPayments: input.hasInternationalPayments,
            expectedMonthlyVolume: input.expectedMonthlyVolume,
            supplierPaymentFrequency: input.supplierPaymentFrequency,
            countriesOfOperation: input.countriesOfOperation,
            primaryUseCase: input.primaryUseCase,
            additionalContext: input.additionalContext,
            outcome,
            reviewNotes: notes,
            reviewedAt: new Date()
        }
    });

    await recordStatusChange({
        organizationId: input.organizationId,
        entityType: "ORGANIZATION",
        fromStatus: existing?.outcome || "PENDING",
        toStatus: `QUALIFICATION_${outcome}`,
        changedBy: userId,
        reason: notes
    });

    return { assessment, outcome, notes };
}

// ─────────────────────────────────────────────────────
// Get qualification status for an organization
// ─────────────────────────────────────────────────────
export async function getQualificationStatus(userId: string, organizationId: string) {
    const membership = await prisma.organizationMember.findFirst({
        where: { organizationId, userId }
    });
    if (!membership) throw new Error("Access denied. You are not a member of this organization.");

    const assessment = await prisma.qualificationAssessment.findUnique({
        where: { organizationId }
    });

    return assessment;
}
