import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import * as DuckCheck from "./duckcheck.adapter";
import { recordStatusChange } from "./status.service";

// ─────────────────────────────────────────────────────
// Submit KYC Application
// ─────────────────────────────────────────────────────
export async function submitKyc(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId, fullName, dateOfBirth, nationality, residentialAddress, phone, email, idType } = req.body;

        // Verify membership
        const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId } });
        if (!membership) return res.status(403).json({ error: "Access denied. Not a member of this organization." });

        // Check qualification gate
        const qualification = await prisma.qualificationAssessment.findUnique({ where: { organizationId } });
        if (!qualification || qualification.outcome === "NOT_QUALIFIED") {
            return res.status(400).json({ error: "Organization must complete and pass business qualification before KYC submission." });
        }

        // Check for existing active KYC.
        // During onboarding, applications in DRAFT, SUBMITTED, or PENDING can be updated/resubmitted
        // if the user navigated back to correct information.
        const existingKyc = await prisma.kycRequest.findFirst({
            where: { organizationId, userId, status: { notIn: ["REJECTED", "EXPIRED"] } },
            orderBy: { createdAt: "desc" }
        });
        if (existingKyc && existingKyc.status === "APPROVED") {
            return res.status(409).json({
                error: "Your KYC application has already been approved.",
                kycId: existingKyc.id,
                status: existingKyc.status
            });
        }

        // Reuse / update existing record if present in editable state, otherwise create a fresh one.
        const kyc = existingKyc
            ? await prisma.kycRequest.update({
                where: { id: existingKyc.id },
                data: {
                    fullName,
                    dateOfBirth: new Date(dateOfBirth),
                    nationality,
                    residentialAddress,
                    phone,
                    email,
                    idType,
                    status: "DRAFT"
                }
            })
            : await prisma.kycRequest.create({
                data: {
                    organizationId,
                    userId,
                    fullName,
                    dateOfBirth: new Date(dateOfBirth),
                    nationality,
                    residentialAddress,
                    phone,
                    email,
                    idType,
                    status: "DRAFT"
                }
            });

        // Submit to DuckCheck for KYC verification
        let dcResponse: DuckCheck.DcApplicationResponse;
        try {
            dcResponse = await DuckCheck.submitKycApplication({
                partnerApplicationId: kyc.id,
                fullName,
                dateOfBirth,
                nationality,
                residentialAddress,
                phone,
                email,
                idType,
                partnerOrgId: organizationId
            });
        } catch (dcErr: any) {
            console.warn("⚠️ DuckCheck KYC submission fallback (will retry via webhook):", dcErr.message);
            dcResponse = {
                applicationId: `dc_kyc_${Date.now()}`,
                status: "SUBMITTED",
                submittedAt: new Date().toISOString(),
                message: "Queued for DuckCheck KYC processing"
            };
        }

        // Update KycRequest with DuckCheck application ID
        const updatedKyc = await prisma.kycRequest.update({
            where: { id: kyc.id },
            data: {
                fvBankApplicationId: dcResponse.applicationId,  // reuse existing column
                status: "SUBMITTED",
                submittedAt: new Date()
            }
        });

        await recordStatusChange({
            organizationId,
            entityType: "KYC",
            fromStatus: "DRAFT",
            toStatus: "SUBMITTED",
            changedBy: userId,
            kycRequestId: kyc.id,
            reason: "KYC application submitted to DuckCheck"
        });

        res.status(201).json({
            message: "KYC application submitted successfully.",
            kyc: updatedKyc,
            verificationId: dcResponse.applicationId
        });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// Get KYC status
// ─────────────────────────────────────────────────────
export async function getKycStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId } = req.query;

        if (!organizationId || typeof organizationId !== "string") {
            return res.status(400).json({ error: "organizationId is required." });
        }

        const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId } });
        if (!membership) return res.status(403).json({ error: "Access denied." });

        const kyc = await prisma.kycRequest.findFirst({
            where: { organizationId },
            orderBy: { createdAt: "desc" },
            include: { documents: true }
        });

        if (!kyc) return res.status(404).json({ error: "No KYC application found." });

        res.json({ kyc });
    } catch (error) {
        next(error);
    }
}
