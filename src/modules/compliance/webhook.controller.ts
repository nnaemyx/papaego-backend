import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import { verifyWebhookSignature, FvApplicationResponse } from "./fvbank.adapter";
import { recordStatusChange, mapFvBankStatus, validateStatusTransition } from "./status.service";

// ─────────────────────────────────────────────────────
// Inbound webhook from FV Bank
// POST /compliance/webhook
// ─────────────────────────────────────────────────────
export async function handleFvBankWebhook(req: Request, res: Response, next: NextFunction) {
    try {
        const rawBody = (req as any).rawBody as string;
        const signature = req.headers["x-fvbank-signature"] as string || "";

        // 1. Verify HMAC signature
        if (!verifyWebhookSignature(rawBody, signature)) {
            console.warn("⚠️  Invalid webhook signature — rejecting.");
            return res.status(401).json({ error: "Invalid webhook signature." });
        }

        const payload = req.body;
        const { event, applicationId, applicationType, status, rejectionReason, additionalInfoNote, partnerOrgId } = payload;

        if (!event || !applicationId || !applicationType) {
            return res.status(400).json({ error: "Missing required webhook fields: event, applicationId, applicationType." });
        }

        // 2. Deduplicate: FV Bank may retry webhook delivery. Use a deterministic
        // event key so the same event is never processed twice.
        const eventKey: string = payload.eventId || payload.messageId ||
            `${event}:${applicationType}:${applicationId}:${status || "PROCESSING"}`;

        const alreadyProcessed = await prisma.complianceWebhook.findFirst({
            where: {
                processed: true,
                payload: { path: ["_eventKey"], equals: eventKey } as any
            }
        });

        if (alreadyProcessed) {
            console.log(`ℹ️  Duplicate webhook ignored (idempotent): ${eventKey}`);
            return res.status(200).json({ received: true, duplicate: true });
        }

        // 3. Store raw webhook for audit (tag with the dedup key)
        const webhook = await prisma.complianceWebhook.create({
            data: {
                organizationId: partnerOrgId || null,
                event,
                payload: { ...payload, _eventKey: eventKey },
                signature: signature || null
            }
        });

        const internalStatus = mapFvBankStatus(status || "PROCESSING");

        try {
            // 4. Process based on application type — atomically per entity
            if (applicationType === "KYC") {
                const kyc = await prisma.kycRequest.findFirst({
                    where: { fvBankApplicationId: applicationId }
                });

                if (kyc) {
                    const previousStatus = kyc.status;

                    // Enforce state-machine: block illegal regressions
                    const transition = validateStatusTransition(previousStatus, internalStatus);
                    if (!transition.valid) {
                        console.warn(`⚠️  Blocked invalid KYC transition: ${transition.reason}`);
                        await recordStatusChange({
                            organizationId: kyc.organizationId,
                            entityType: "KYC",
                            fromStatus: previousStatus,
                            toStatus: previousStatus,
                            changedBy: "FV_BANK_WEBHOOK",
                            kycRequestId: kyc.id,
                            reason: `Ignored webhook: ${transition.reason}`,
                            metadata: payload
                        });
                    } else {
                        await prisma.$transaction(async (tx) => {
                            await tx.kycRequest.update({
                                where: { id: kyc.id },
                                data: {
                                    status: internalStatus as any,
                                    rejectionReason: rejectionReason || null,
                                    additionalInfoNote: additionalInfoNote || null,
                                    reviewedAt: ["APPROVED", "REJECTED"].includes(internalStatus) ? new Date() : undefined,
                                    expiresAt: internalStatus === "EXPIRED" ? new Date() : undefined
                                }
                            });

                            await tx.verificationStatusHistory.create({
                                data: {
                                    organizationId: kyc.organizationId,
                                    entityType: "KYC",
                                    fromStatus: previousStatus,
                                    toStatus: internalStatus,
                                    changedBy: "FV_BANK_WEBHOOK",
                                    kycRequestId: kyc.id,
                                    reason: rejectionReason || additionalInfoNote || `FV Bank webhook: ${event}`,
                                    metadata: payload as any
                                }
                            });
                        });

                        // Activate org if both KYC and KYB approved
                        await checkAndActivateOrganization(kyc.organizationId, "FV_BANK_WEBHOOK");

                        // Create in-app notification
                        await createStatusNotification(kyc.userId, "KYC", internalStatus, rejectionReason, additionalInfoNote);
                    }
                } else {
                    console.warn(`⚠️  KYC application not found for FV Bank ID: ${applicationId}`);
                }
            } else if (applicationType === "KYB") {
                const kyb = await prisma.kybRequest.findFirst({
                    where: { fvBankApplicationId: applicationId }
                });

                if (kyb) {
                    const previousStatus = kyb.status;

                    const transition = validateStatusTransition(previousStatus, internalStatus);
                    if (!transition.valid) {
                        console.warn(`⚠️  Blocked invalid KYB transition: ${transition.reason}`);
                        await recordStatusChange({
                            organizationId: kyb.organizationId,
                            entityType: "KYB",
                            fromStatus: previousStatus,
                            toStatus: previousStatus,
                            changedBy: "FV_BANK_WEBHOOK",
                            kybRequestId: kyb.id,
                            reason: `Ignored webhook: ${transition.reason}`,
                            metadata: payload
                        });
                    } else {
                        await prisma.$transaction(async (tx) => {
                            await tx.kybRequest.update({
                                where: { id: kyb.id },
                                data: {
                                    status: internalStatus as any,
                                    rejectionReason: rejectionReason || null,
                                    additionalInfoNote: additionalInfoNote || null,
                                    reviewedAt: ["APPROVED", "REJECTED"].includes(internalStatus) ? new Date() : undefined,
                                    expiresAt: internalStatus === "EXPIRED" ? new Date() : undefined
                                }
                            });

                            await tx.verificationStatusHistory.create({
                                data: {
                                    organizationId: kyb.organizationId,
                                    entityType: "KYB",
                                    fromStatus: previousStatus,
                                    toStatus: internalStatus,
                                    changedBy: "FV_BANK_WEBHOOK",
                                    kybRequestId: kyb.id,
                                    reason: rejectionReason || additionalInfoNote || `FV Bank webhook: ${event}`,
                                    metadata: payload as any
                                }
                            });
                        });

                        // Activate org if both KYC and KYB approved
                        await checkAndActivateOrganization(kyb.organizationId, "FV_BANK_WEBHOOK");

                        // Notify org owner
                        const org = await prisma.organization.findUnique({ where: { id: kyb.organizationId } });
                        if (org) {
                            await createStatusNotification(org.ownerId, "KYB", internalStatus, rejectionReason, additionalInfoNote);
                        }
                    }
                } else {
                    console.warn(`⚠️  KYB application not found for FV Bank ID: ${applicationId}`);
                }
            }

            // 5. Mark webhook as processed
            await prisma.complianceWebhook.update({
                where: { id: webhook.id },
                data: { processed: true, processedAt: new Date() }
            });

            res.status(200).json({ received: true });
        } catch (processErr: any) {
            // Record the failure on the webhook so it can be retried/inspected
            console.error("❌ Webhook processing failed:", processErr.message);
            await prisma.complianceWebhook.update({
                where: { id: webhook.id },
                data: {
                    processed: false,
                    errorMessage: processErr.message,
                    retryCount: { increment: 1 }
                }
            }).catch(() => { /* swallow */ });

            // Acknowledge receipt (avoid infinite FV Bank retries) but flag internally
            return res.status(200).json({ received: true, processingError: true });
        }
    } catch (error: any) {
        console.error("❌ Webhook processing error:", error.message);
        next(error);
    }
}

// ─────────────────────────────────────────────────────
// Helper: Activate org if both KYC + KYB are approved
// ─────────────────────────────────────────────────────
async function checkAndActivateOrganization(organizationId: string, changedBy: string) {
    const [kyc, kyb] = await Promise.all([
        prisma.kycRequest.findFirst({
            where: { organizationId, status: "APPROVED" },
            orderBy: { createdAt: "desc" }
        }),
        prisma.kybRequest.findUnique({ where: { organizationId } })
    ]);

    if (kyc && kyb?.status === "APPROVED") {
        const org = await prisma.organization.findUnique({ where: { id: organizationId } });
        if (org && org.status !== "ACTIVE") {
            await prisma.organization.update({
                where: { id: organizationId },
                data: { status: "ACTIVE" }
            });

            await recordStatusChange({
                organizationId,
                entityType: "ORGANIZATION",
                fromStatus: org.status,
                toStatus: "ACTIVE",
                changedBy,
                reason: "Both KYC and KYB approved by FV Bank. Organization activated."
            });

            console.log(`✅ Organization ${organizationId} activated after KYC + KYB approval.`);
        }
    }
}

// ─────────────────────────────────────────────────────
// Helper: Create in-app notification for status change
// ─────────────────────────────────────────────────────
async function createStatusNotification(
    userId: string,
    type: "KYC" | "KYB",
    status: string,
    rejectionReason?: string,
    additionalInfoNote?: string
) {
    const messages: Record<string, { title: string; message: string }> = {
        APPROVED: {
            title: `${type} Approved ✅`,
            message: `Your ${type} verification has been approved by FV Bank. ${type === "KYB" ? "Your organization is now being activated." : ""}`
        },
        REJECTED: {
            title: `${type} Rejected`,
            message: `Your ${type} verification was rejected. ${rejectionReason ? `Reason: ${rejectionReason}` : "Please contact support for details."}`
        },
        ADDITIONAL_INFO_REQUIRED: {
            title: `Additional Information Required`,
            message: `FV Bank requires additional information for your ${type} verification. ${additionalInfoNote || "Please check your compliance dashboard."}`
        },
        MANUAL_REVIEW: {
            title: `${type} Under Manual Review`,
            message: `Your ${type} verification is being manually reviewed by FV Bank. This may take 1-3 business days.`
        },
        PROCESSING: {
            title: `${type} Processing`,
            message: `Your ${type} verification is being processed by FV Bank.`
        },
        EXPIRED: {
            title: `${type} Verification Expired`,
            message: `Your ${type} verification has expired. Please resubmit your application.`
        }
    };

    const content = messages[status] || {
        title: `${type} Status Update`,
        message: `Your ${type} verification status has been updated to: ${status}`
    };

    await prisma.notificationLog.create({
        data: {
            recipientId: userId,
            channel: "IN_APP",
            type: `${type}_STATUS_UPDATE`,
            subject: content.title,
            content: content.message,
            metadata: { status, rejectionReason, additionalInfoNote } as any,
            sent: true,
            sentAt: new Date()
        }
    });

    // Also create in the existing notifications table for real-time display
    await prisma.notification.create({
        data: {
            userId,
            title: content.title,
            message: content.message,
            type: status === "APPROVED" ? "SUCCESS" : status === "REJECTED" ? "ERROR" : "INFO"
        }
    });
}
