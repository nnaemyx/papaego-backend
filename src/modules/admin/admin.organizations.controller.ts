/**
 * Admin Business Organizations & Onboarding Compliance Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints for Admin to view, inspect, review, and manage all Business
 * Onboardings, Qualifications, KYC/KYB requests, Documents, and Bank Accounts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import { recordStatusChange } from "../compliance/status.service";
import { provisionManagedAccount } from "../banking/banking.provisioning.service";

// ─────────────────────────────────────────────────────
// GET /admin/organizations
// List all registered business organizations
// ─────────────────────────────────────────────────────
export async function getOrganizations(req: Request, res: Response, next: NextFunction) {
    try {
        const { status, search } = req.query;

        const where: any = {};
        if (status && typeof status === "string" && status !== "ALL") {
            where.status = status;
        }

        if (search && typeof search === "string") {
            where.OR = [
                { businessName: { contains: search, mode: "insensitive" } },
                { contactEmail: { contains: search, mode: "insensitive" } },
                { registrationNumber: { contains: search, mode: "insensitive" } },
                { authorizedRepName: { contains: search, mode: "insensitive" } }
            ];
        }

        const organizations = await prisma.organization.findMany({
            where,
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true, phone: true }
                },
                qualification: true,
                kycRequests: {
                    orderBy: { createdAt: "desc" },
                    take: 1
                },
                kybRequest: true,
                bankAccount: true
            },
            orderBy: { createdAt: "desc" }
        });

        const formatted = organizations.map(org => {
            const latestKyc = org.kycRequests[0] || null;
            return {
                id: org.id,
                businessName: org.businessName,
                businessType: org.businessType,
                countryOfRegistration: org.countryOfRegistration,
                registrationNumber: org.registrationNumber,
                industry: org.industry,
                contactEmail: org.contactEmail,
                contactPhone: org.contactPhone,
                authorizedRepName: org.authorizedRepName,
                status: org.status,
                createdAt: org.createdAt,
                owner: org.owner,
                qualificationOutcome: org.qualification?.outcome || "NOT_SUBMITTED",
                kycStatus: latestKyc?.status || "NOT_SUBMITTED",
                kybStatus: org.kybRequest?.status || "NOT_SUBMITTED",
                hasBankAccount: !!org.bankAccount,
                bankAccountStatus: org.bankAccount?.status || null
            };
        });

        res.json({ organizations: formatted, total: formatted.length });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// GET /admin/organizations/:id
// Get full details of a specific organization
// ─────────────────────────────────────────────────────
export async function getOrganizationDetail(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;

        const org = await prisma.organization.findUnique({
            where: { id },
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true }
                },
                members: {
                    include: {
                        user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } }
                    }
                },
                qualification: true,
                kycRequests: {
                    orderBy: { createdAt: "desc" },
                    include: { documents: true }
                },
                kybRequest: {
                    include: { documents: true }
                },
                documents: true,
                statusHistory: {
                    orderBy: { createdAt: "desc" }
                },
                bankAccount: {
                    include: {
                        events: { orderBy: { createdAt: "desc" } },
                        syncLogs: { orderBy: { createdAt: "desc" } }
                    }
                },
                bankingProfile: true
            }
        });

        if (!org) {
            return res.status(404).json({ error: "Organization not found." });
        }

        res.json({ organization: org });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// POST /admin/organizations/:id/kyc/status
// Admin review & update KYC Status
// ─────────────────────────────────────────────────────
export async function updateKycStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params; // orgId
        const adminId = (req as any).user.id;
        const { kycRequestId, status, reason, note } = req.body;

        if (!status) {
            return res.status(400).json({ error: "Status is required." });
        }

        const kyc = await prisma.kycRequest.findFirst({
            where: { id: kycRequestId, organizationId: id }
        });

        if (!kyc) {
            return res.status(404).json({ error: "KYC request not found." });
        }

        const updatedKyc = await prisma.kycRequest.update({
            where: { id: kyc.id },
            data: {
                status,
                rejectionReason: status === "REJECTED" ? reason : undefined,
                additionalInfoNote: note,
                reviewedAt: new Date()
            }
        });

        await recordStatusChange({
            organizationId: id,
            entityType: "KYC",
            fromStatus: kyc.status,
            toStatus: status,
            changedBy: adminId,
            kycRequestId: kyc.id,
            reason: reason || note || `Admin updated KYC status to ${status}`
        });

        res.json({ message: `KYC status updated to ${status}`, kyc: updatedKyc });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// POST /admin/organizations/:id/kyb/status
// Admin review & update KYB Status
// ─────────────────────────────────────────────────────
export async function updateKybStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params; // orgId
        const adminId = (req as any).user.id;
        const { kybRequestId, status, reason, note } = req.body;

        if (!status) {
            return res.status(400).json({ error: "Status is required." });
        }

        const kyb = await prisma.kybRequest.findFirst({
            where: { id: kybRequestId, organizationId: id }
        });

        if (!kyb) {
            return res.status(404).json({ error: "KYB request not found." });
        }

        const updatedKyb = await prisma.kybRequest.update({
            where: { id: kyb.id },
            data: {
                status,
                rejectionReason: status === "REJECTED" ? reason : undefined,
                additionalInfoNote: note,
                reviewedAt: new Date()
            }
        });

        await recordStatusChange({
            organizationId: id,
            entityType: "KYB",
            fromStatus: kyb.status,
            toStatus: status,
            changedBy: adminId,
            kybRequestId: kyb.id,
            reason: reason || note || `Admin updated KYB status to ${status}`
        });

        // Auto activate org if both KYC and KYB are approved
        const latestKyc = await prisma.kycRequest.findFirst({
            where: { organizationId: id },
            orderBy: { createdAt: "desc" }
        });

        if (status === "APPROVED" && latestKyc?.status === "APPROVED") {
            await prisma.organization.update({
                where: { id },
                data: { status: "ACTIVE" }
            });
            await recordStatusChange({
                organizationId: id,
                entityType: "ORGANIZATION",
                fromStatus: "DRAFT",
                toStatus: "ACTIVE",
                changedBy: adminId,
                reason: "Both KYC and KYB approved. Admin activated organization."
            });
        }

        res.json({ message: `KYB status updated to ${status}`, kyb: updatedKyb });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// POST /admin/organizations/:id/status
// Admin update Organization Status (ACTIVE, SUSPENDED, REJECTED)
// ─────────────────────────────────────────────────────
export async function updateOrganizationStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;
        const adminId = (req as any).user.id;
        const { status, reason } = req.body;

        if (!["DRAFT", "ACTIVE", "SUSPENDED", "REJECTED"].includes(status)) {
            return res.status(400).json({ error: "Invalid organization status." });
        }

        const org = await prisma.organization.findUnique({ where: { id } });
        if (!org) {
            return res.status(404).json({ error: "Organization not found." });
        }

        const updatedOrg = await prisma.organization.update({
            where: { id },
            data: { status }
        });

        await recordStatusChange({
            organizationId: id,
            entityType: "ORGANIZATION",
            fromStatus: org.status,
            toStatus: status,
            changedBy: adminId,
            reason: reason || `Admin changed status to ${status}`
        });

        res.json({ message: `Organization status updated to ${status}`, organization: updatedOrg });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// POST /admin/organizations/:id/provision-bank
// Admin manual trigger managed bank account provisioning
// ─────────────────────────────────────────────────────
export async function adminProvisionBank(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;
        const adminId = (req as any).user.id;

        const org = await prisma.organization.findUnique({ where: { id } });
        if (!org) {
            return res.status(404).json({ error: "Organization not found." });
        }

        const result = await provisionManagedAccount(id, org.ownerId);
        res.status(201).json({
            message: "Managed U.S. bank account provisioned successfully.",
            bankAccount: result.bankAccount,
            bankingProfile: result.bankingProfile
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
}

// ─────────────────────────────────────────────────────
// DELETE /admin/organizations/:id
// Admin delete business organization and all related onboarding records
// ─────────────────────────────────────────────────────
export async function deleteOrganization(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;
        const adminId = (req as any).user?.id || "ADMIN";

        const org = await prisma.organization.findUnique({ where: { id } });
        if (!org) {
            return res.status(404).json({ error: "Organization not found." });
        }

        await prisma.$transaction(async (tx: any) => {
            await Promise.all([
                tx.bankAccountWebhook.deleteMany({ where: { organizationId: id } }),
                tx.bankAccountSyncLog.deleteMany({ where: { organizationId: id } }),
                tx.bankAccountEvent.deleteMany({ where: { organizationId: id } }),
                tx.bankingProfile.deleteMany({ where: { organizationId: id } }),
                tx.complianceWebhook.deleteMany({ where: { organizationId: id } }),
                tx.verificationStatusHistory.deleteMany({ where: { organizationId: id } }),
                tx.verificationDocument.deleteMany({ where: { organizationId: id } }),
                tx.kybRequest.deleteMany({ where: { organizationId: id } }),
                tx.kycRequest.deleteMany({ where: { organizationId: id } }),
                tx.qualificationAssessment.deleteMany({ where: { organizationId: id } }),
                tx.organizationMember.deleteMany({ where: { organizationId: id } }),
            ]);
            await tx.bankAccount.deleteMany({ where: { organizationId: id } });
            await tx.organization.delete({ where: { id } });
        }, { maxWait: 20000, timeout: 30000 });

        await prisma.auditLog.create({
            data: {
                actorId: adminId,
                role: "ADMIN",
                action: "ORGANIZATION_DELETED",
                entity: "Organization",
                entityId: id,
                ip: req.ip || "127.0.0.1",
                metadata: { businessName: org.businessName, contactEmail: org.contactEmail }
            }
        });

        res.json({ success: true, message: `Organization "${org.businessName}" deleted successfully.` });
    } catch (error) {
        next(error);
    }
}
