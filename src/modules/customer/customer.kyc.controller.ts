import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * GET /customer/portal/kyc-status
 * Returns the customer's KYC status with timeline from audit logs
 */
export async function getKycStatus(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({
            where: { userId },
            select: {
                id: true,
                kycStatus: true,
                kycRejectionReason: true,
                kycReviewedAt: true,
                kycReviewedBy: true,
                verified: true,
                governmentIdUrl: true,
                proofOfAddressUrl: true,
                createdAt: true,
            },
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }

        // Build KYC timeline from audit logs
        const auditLogs = await prisma.auditLog.findMany({
            where: {
                entityId: customer.id,
                entity: "Customer",
                action: { startsWith: "KYC_" },
            },
            orderBy: { createdAt: "asc" },
        });

        const timeline = auditLogs.map((log) => ({
            action: log.action,
            createdAt: log.createdAt.toISOString(),
        }));

        // Build stages with completion status
        const statusOrder = ["NOT_SUBMITTED", "SUBMITTED", "UNDER_REVIEW", "APPROVED"];
        const currentIndex = statusOrder.indexOf(
            customer.kycStatus === "REJECTED" || customer.kycStatus === "RESUBMITTED"
                ? "UNDER_REVIEW"
                : customer.kycStatus
        );

        const stages = [
            {
                key: "SUBMITTED",
                label: "Documents Submitted",
                description: "Your KYC documents have been submitted for review",
                completed: currentIndex >= 1 || customer.kycStatus === "REJECTED" || customer.kycStatus === "RESUBMITTED",
                completedAt: auditLogs.find((l) => l.action === "KYC_SUBMITTED")?.createdAt?.toISOString() || null,
            },
            {
                key: "UNDER_REVIEW",
                label: "Under Review",
                description: "Our compliance team is reviewing your documents",
                completed: currentIndex >= 2 || customer.kycStatus === "REJECTED",
                completedAt: auditLogs.find((l) => l.action === "KYC_UNDER_REVIEW")?.createdAt?.toISOString() || null,
            },
            {
                key: "APPROVED",
                label: "Approved",
                description: "Your identity has been verified successfully",
                completed: customer.kycStatus === "APPROVED",
                completedAt: auditLogs.find((l) => l.action === "KYC_APPROVED")?.createdAt?.toISOString() || null,
            },
        ];

        res.json({
            status: customer.kycStatus,
            verified: customer.verified,
            rejectionReason: customer.kycRejectionReason,
            reviewedAt: customer.kycReviewedAt?.toISOString() || null,
            hasDocuments: !!(customer.governmentIdUrl && customer.proofOfAddressUrl),
            stages,
            timeline,
        });
    } catch (error) {
        console.error("Error fetching KYC status:", error);
        res.status(500).json({ error: "Failed to fetch KYC status" });
    }
}

/**
 * PATCH /customer/portal/kyc/resubmit
 * Allows rejected customers to resubmit KYC documents
 */
export async function resubmitKyc(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({
            where: { userId },
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }

        if (customer.kycStatus !== "REJECTED") {
            return res.status(400).json({
                error: "KYC resubmission is only allowed for rejected applications",
            });
        }

        const { governmentIdUrl, proofOfAddressUrl } = req.body;

        if (!governmentIdUrl && !proofOfAddressUrl) {
            return res.status(400).json({
                error: "Please upload at least one document to resubmit",
            });
        }

        const updateData: any = {
            kycStatus: "RESUBMITTED",
            kycRejectionReason: null,
        };

        if (governmentIdUrl) updateData.governmentIdUrl = governmentIdUrl;
        if (proofOfAddressUrl) updateData.proofOfAddressUrl = proofOfAddressUrl;

        await prisma.customer.update({
            where: { id: customer.id },
            data: updateData,
        });

        // Audit log
        await prisma.auditLog.create({
            data: {
                actorId: userId,
                role: "CUSTOMER",
                action: "KYC_RESUBMITTED",
                entity: "Customer",
                entityId: customer.id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true, status: "RESUBMITTED" });
    } catch (error) {
        console.error("Error resubmitting KYC:", error);
        res.status(500).json({ error: "Failed to resubmit KYC" });
    }
}

/**
 * PATCH /admin/customers/:id/kyc/review
 * Admin starts KYC review (SUBMITTED/RESUBMITTED → UNDER_REVIEW)
 */
export async function startKycReview(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const adminUser = (req as any).user;

        const customer = await prisma.customer.findUnique({ where: { id } });
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        if (customer.kycStatus !== "SUBMITTED" && customer.kycStatus !== "RESUBMITTED") {
            return res.status(400).json({
                error: `Cannot start review: current status is ${customer.kycStatus}`,
            });
        }

        await prisma.customer.update({
            where: { id },
            data: {
                kycStatus: "UNDER_REVIEW",
                kycReviewedBy: adminUser.id,
            },
        });

        await prisma.auditLog.create({
            data: {
                actorId: adminUser.id,
                role: adminUser.role,
                action: "KYC_UNDER_REVIEW",
                entity: "Customer",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true, status: "UNDER_REVIEW" });
    } catch (error) {
        console.error("Error starting KYC review:", error);
        res.status(500).json({ error: "Failed to start review" });
    }
}

/**
 * PATCH /admin/customers/:id/kyc/approve
 * Admin approves KYC (UNDER_REVIEW → APPROVED)
 */
export async function approveKyc(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const adminUser = (req as any).user;

        const customer = await prisma.customer.findUnique({ where: { id } });
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        if (customer.kycStatus !== "UNDER_REVIEW") {
            return res.status(400).json({
                error: `Cannot approve: current status is ${customer.kycStatus}`,
            });
        }

        await prisma.customer.update({
            where: { id },
            data: {
                kycStatus: "APPROVED",
                verified: true,
                kycReviewedAt: new Date(),
                kycReviewedBy: adminUser.id,
                kycRejectionReason: null,
            },
        });

        await prisma.auditLog.create({
            data: {
                actorId: adminUser.id,
                role: adminUser.role,
                action: "KYC_APPROVED",
                entity: "Customer",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        // Notify customer
        await prisma.notification.create({
            data: {
                userId: customer.userId,
                title: "KYC Approved",
                message: "Your identity verification has been approved! You now have full access to all PapaEgo features.",
                type: "SUCCESS",
            },
        });

        res.json({ success: true, status: "APPROVED" });
    } catch (error) {
        console.error("Error approving KYC:", error);
        res.status(500).json({ error: "Failed to approve KYC" });
    }
}

/**
 * PATCH /admin/customers/:id/kyc/reject
 * Admin rejects KYC with reason (UNDER_REVIEW → REJECTED)
 */
export async function rejectKyc(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const adminUser = (req as any).user;
        const { reason } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: "Rejection reason is required" });
        }

        const customer = await prisma.customer.findUnique({ where: { id } });
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        if (customer.kycStatus !== "UNDER_REVIEW") {
            return res.status(400).json({
                error: `Cannot reject: current status is ${customer.kycStatus}`,
            });
        }

        await prisma.customer.update({
            where: { id },
            data: {
                kycStatus: "REJECTED",
                verified: false,
                kycReviewedAt: new Date(),
                kycReviewedBy: adminUser.id,
                kycRejectionReason: reason.trim(),
            },
        });

        await prisma.auditLog.create({
            data: {
                actorId: adminUser.id,
                role: adminUser.role,
                action: "KYC_REJECTED",
                entity: "Customer",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        // Notify customer
        await prisma.notification.create({
            data: {
                userId: customer.userId,
                title: "KYC Rejected",
                message: `Your identity verification was not approved. Reason: ${reason.trim()}. Please resubmit your documents.`,
                type: "WARNING",
            },
        });

        res.json({ success: true, status: "REJECTED" });
    } catch (error) {
        console.error("Error rejecting KYC:", error);
        res.status(500).json({ error: "Failed to reject KYC" });
    }
}
