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
import { submitBusinessPlusApplication } from "../banking/fvbank.onboarding.adapter";

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

            // ── PUSH TO FV BANK ONBOARDING (Applications v2) ───────────────────
            // Now that KYC + KYB are both approved, submit a Business Plus
            // application to FV Bank so this customer appears in the Sandbox
            // Portal under Users/Accounts and is ready for UAT transactions.
            try {
                const fullOrg = await prisma.organization.findUnique({
                    where: { id },
                    include: {
                        owner: { select: { email: true, firstName: true, lastName: true, phone: true } },
                        kybRequest: true,
                        kycRequests: { orderBy: { createdAt: "desc" }, take: 1 }
                    }
                });

                if (fullOrg) {
                    const kyb = fullOrg.kybRequest;
                    const directors: any[] = Array.isArray(kyb?.directors) ? (kyb!.directors as any[]) : [];
                    const ubos: any[]       = Array.isArray(kyb?.ubos)      ? (kyb!.ubos      as any[]) : [];

                    const fvAppRes = await submitBusinessPlusApplication({
                        partnerReferenceId: fullOrg.id,
                        business: {
                            businessName:              fullOrg.businessName,
                            businessRegistrationNumber: fullOrg.registrationNumber || undefined,
                            countryOfRegistration:     fullOrg.countryOfRegistration,
                            businessType:              fullOrg.businessType,
                            industry:                  fullOrg.industry || undefined,
                            taxIdentification:         kyb?.taxIdentification || undefined,
                            businessAddress:           kyb?.businessAddress   || fullOrg.countryOfRegistration,
                        },
                        primaryContact: {
                            fullName: fullOrg.owner
                                ? `${fullOrg.owner.firstName} ${fullOrg.owner.lastName}`.trim()
                                : fullOrg.authorizedRepName || fullOrg.businessName,
                            email: fullOrg.contactEmail,
                            phone: fullOrg.contactPhone || fullOrg.owner?.phone || undefined,
                        },
                        directors: directors.map((d: any) => ({
                            fullName:            d.name || d.fullName || "Director",
                            role:                "DIRECTOR" as const,
                            email:               d.email,
                            nationality:         d.nationality,
                            dateOfBirth:         d.dateOfBirth,
                            residentialAddress:  d.address,
                            identityType:        d.identityType,
                            identityNumber:      d.identityNumber,
                        })),
                        ubos: ubos.map((u: any) => ({
                            fullName:             u.name || u.fullName || "UBO",
                            role:                 "UBO" as const,
                            email:                u.email,
                            nationality:          u.nationality,
                            dateOfBirth:          u.dateOfBirth,
                            residentialAddress:   u.address,
                            ownershipPercentage:  u.ownershipPercentage || u.percentage,
                        })),
                    });

                    // Store the FV Bank applicationId on the KYB record for webhook correlation
                    if (kyb && fvAppRes.applicationId) {
                        await prisma.kybRequest.update({
                            where: { organizationId: id },
                            data: { fvBankApplicationId: fvAppRes.applicationId }
                        });
                    }

                    console.log(
                        `🏦 [FV Bank Onboarding] Business Plus application submitted for org "${fullOrg.businessName}" ` +
                        `(ID: ${fullOrg.id}). FV App ID: ${fvAppRes.applicationId}, Status: ${fvAppRes.status}`
                    );
                }
            } catch (fvErr: any) {
                // Non-blocking — do not fail the KYB approval if FV Bank push fails
                console.warn(
                    `⚠️  [FV Bank Onboarding] Failed to submit Business Plus application for org ${id}: ${fvErr.message}`
                );
            }
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
// POST /admin/organizations/:id/push-to-fvbank
// Admin manually (re-)submits a Business Plus application to FV Bank so that
// an already-approved organization appears in the Sandbox Portal.
// Safe to call multiple times — FV Bank uses PartnerReferenceId for deduplication.
// ─────────────────────────────────────────────────────
export async function adminPushToFvBank(req: Request, res: Response, next: NextFunction) {
    try {
        const { id } = req.params;
        console.log(`[Admin] Initiating FV Bank Push for Org ID: ${id}`);

        const org = await prisma.organization.findUnique({
            where: { id },
            include: {
                owner: { select: { email: true, firstName: true, lastName: true, phone: true } },
                kybRequest: true,
            }
        });

        if (!org) {
            return res.status(404).json({ error: "Organization not found." });
        }

        console.log(`[Admin] Found Org: ${org.businessName}. Submitting Business Plus Application...`);

        const kyb     = org.kybRequest;
        const directors: any[] = Array.isArray(kyb?.directors) ? (kyb!.directors as any[]) : [];
        const ubos: any[]       = Array.isArray(kyb?.ubos)      ? (kyb!.ubos      as any[]) : [];

        const fvAppRes = await submitBusinessPlusApplication({
            partnerReferenceId: org.id,
            business: {
                businessName:              org.businessName,
                businessRegistrationNumber: org.registrationNumber || undefined,
                countryOfRegistration:     org.countryOfRegistration,
                businessType:              org.businessType,
                industry:                  org.industry || undefined,
                taxIdentification:         kyb?.taxIdentification || undefined,
                businessAddress:           kyb?.businessAddress   || org.countryOfRegistration,
            },
            primaryContact: {
                fullName: org.owner
                    ? `${org.owner.firstName} ${org.owner.lastName}`.trim()
                    : org.authorizedRepName || org.businessName,
                email: org.contactEmail,
                phone: org.contactPhone || org.owner?.phone || undefined,
            },
            directors: directors.map((d: any) => ({
                fullName:           d.name || d.fullName || "Director",
                role:               "DIRECTOR" as const,
                email:              d.email,
                nationality:        d.nationality,
                dateOfBirth:        d.dateOfBirth,
                residentialAddress: d.address,
                identityType:       d.identityType,
                identityNumber:     d.identityNumber,
            })),
            ubos: ubos.map((u: any) => ({
                fullName:            u.name || u.fullName || "UBO",
                role:                "UBO" as const,
                email:               u.email,
                nationality:         u.nationality,
                dateOfBirth:         u.dateOfBirth,
                residentialAddress:  u.address,
                ownershipPercentage: u.ownershipPercentage || u.percentage,
            })),
        });

        console.log(`[Admin] FV Bank Push result:`, fvAppRes);

        // Store the returned applicationId on the KYB record
        if (kyb && fvAppRes.applicationId) {
            await prisma.kybRequest.update({
                where: { organizationId: id },
                data: { fvBankApplicationId: fvAppRes.applicationId }
            });
        }

        res.status(201).json({
            message: `Business Plus application submitted to FV Bank for "${org.businessName}".`,
            fvBankApplicationId: fvAppRes.applicationId,
            fvBankStatus: fvAppRes.status,
            isSimulation: fvAppRes.applicationId.startsWith("fv_app_"),
        });
    } catch (error: any) {
        console.error(`[Admin] FV Bank Push failed with error:`, error);
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
