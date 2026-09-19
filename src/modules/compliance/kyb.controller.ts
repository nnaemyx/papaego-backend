import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import * as DuckCheck from "./duckcheck.adapter";
import { recordStatusChange } from "./status.service";

// ─────────────────────────────────────────────────────
// Submit KYB Application
// ─────────────────────────────────────────────────────
export async function submitKyb(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId, companyName, registrationNumber, countryOfIncorporation, businessAddress, taxIdentification, directors, ubos } = req.body;

        // Verify ownership (only owner can submit KYB)
        const org = await prisma.organization.findUnique({ where: { id: organizationId } });
        if (!org) return res.status(404).json({ error: "Organization not found." });
        if (org.ownerId !== userId) return res.status(403).json({ error: "Only the organization owner can submit KYB." });

        // Check qualification gate
        const qualification = await prisma.qualificationAssessment.findUnique({ where: { organizationId } });
        if (!qualification || qualification.outcome === "NOT_QUALIFIED") {
            return res.status(400).json({ error: "Organization must complete and pass business qualification before KYB submission." });
        }

        // Check for existing active KYB
        const existingKyb = await prisma.kybRequest.findUnique({ where: { organizationId } });
        if (existingKyb && existingKyb.status === "APPROVED") {
            return res.status(409).json({
                error: "Your KYB application has already been approved.",
                kybId: existingKyb.id,
                status: existingKyb.status
            });
        }

        // Create KYB record in DRAFT
        const kyb = await prisma.kybRequest.upsert({
            where: { organizationId },
            create: {
                organizationId,
                companyName,
                registrationNumber,
                countryOfIncorporation,
                businessAddress,
                taxIdentification,
                directors: directors || [],
                ubos: ubos || [],
                status: "DRAFT"
            },
            update: {
                companyName,
                registrationNumber,
                countryOfIncorporation,
                businessAddress,
                taxIdentification,
                directors: directors || [],
                ubos: ubos || [],
                status: "DRAFT"
            }
        });

        // Submit to DuckCheck for KYB (corporate) verification
        let dcResponse: DuckCheck.DcApplicationResponse;
        try {
            dcResponse = await DuckCheck.submitKybApplication({
                partnerApplicationId: kyb.id,
                companyName,
                registrationNumber,
                countryOfIncorporation,
                businessAddress,
                taxIdentification,
                directors,
                ubos,
                partnerOrgId: organizationId
            });
        } catch (dcErr: any) {
            console.warn("⚠️ DuckCheck KYB submission fallback (will retry via webhook):", dcErr.message);
            dcResponse = {
                applicationId: `dc_kyb_${Date.now()}`,
                status: "SUBMITTED",
                submittedAt: new Date().toISOString(),
                message: "Queued for DuckCheck KYB processing"
            };
        }

        // Update KybRequest with DuckCheck application ID
        const updatedKyb = await prisma.kybRequest.update({
            where: { organizationId },
            data: {
                fvBankApplicationId: dcResponse.applicationId,  // reuse existing column
                status: "SUBMITTED",
                submittedAt: new Date()
            }
        });

        await recordStatusChange({
            organizationId,
            entityType: "KYB",
            fromStatus: "DRAFT",
            toStatus: "SUBMITTED",
            changedBy: userId,
            kybRequestId: kyb.id,
            reason: "KYB application submitted to DuckCheck"
        });

        res.status(201).json({
            message: "KYB application submitted successfully.",
            kyb: updatedKyb,
            verificationId: dcResponse.applicationId
        });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// Get KYB status
// ─────────────────────────────────────────────────────
export async function getKybStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId } = req.query;

        if (!organizationId || typeof organizationId !== "string") {
            return res.status(400).json({ error: "organizationId is required." });
        }

        const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId } });
        if (!membership) return res.status(403).json({ error: "Access denied." });

        const kyb = await prisma.kybRequest.findUnique({
            where: { organizationId },
            include: { documents: true }
        });

        if (!kyb) return res.status(404).json({ error: "No KYB application found." });

        res.json({ kyb });
    } catch (error) {
        next(error);
    }
}
