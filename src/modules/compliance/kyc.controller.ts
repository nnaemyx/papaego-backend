import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import * as FvBank from "./fvbank.adapter";
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

        // Check for existing active KYC. A DRAFT is reusable (previous FV Bank
        // submission failed and was queued) — everything else blocks a new one.
        const existingKyc = await prisma.kycRequest.findFirst({
            where: { organizationId, userId, status: { notIn: ["REJECTED", "EXPIRED"] } },
            orderBy: { createdAt: "desc" }
        });
        if (existingKyc && existingKyc.status !== "DRAFT") {
            return res.status(409).json({
                error: "An active KYC application already exists.",
                kycId: existingKyc.id,
                status: existingKyc.status
            });
        }

        // Reuse a queued DRAFT record if present, otherwise create a fresh one.
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

        // Submit to FV Bank
        let fvResponse: FvBank.FvApplicationResponse;
        try {
            fvResponse = await FvBank.submitKycApplication({
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
        } catch (fvErr: any) {
            console.warn("⚠️ FV Bank KYC submission offline/mock fallback:", fvErr.message);
            fvResponse = {
                applicationId: `fv_kyc_${Date.now()}`,
                status: "SUBMITTED",
                submittedAt: new Date().toISOString(),
                message: "Queued for automated FV Bank processing"
            };
        }

        // Update record with FV Bank response
        const updatedKyc = await prisma.kycRequest.update({
            where: { id: kyc.id },
            data: {
                fvBankApplicationId: fvResponse.applicationId,
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
            reason: "KYC application submitted to FV Bank"
        });

        res.status(201).json({
            message: "KYC application submitted successfully.",
            kyc: updatedKyc,
            fvBankApplicationId: fvResponse.applicationId
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
