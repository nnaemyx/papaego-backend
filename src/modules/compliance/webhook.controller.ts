import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import { verifyWebhookSignature as verifyDuckCheckSignature } from "./duckcheck.adapter";
import { verifyWebhookSignature as verifyFvBankSignature, FvApplicationResponse } from "./fvbank.adapter";
import { recordStatusChange, mapFvBankStatus, validateStatusTransition } from "./status.service";

// ─────────────────────────────────────────────────────
// Inbound webhook from DuckCheck / Compliance Partner
// POST /compliance/webhook
// ─────────────────────────────────────────────────────
export async function handleFvBankWebhook(req: Request, res: Response, next: NextFunction) {
    try {
        const rawBody = (req as any).rawBody as string;
        const signature = (req.headers["x-duckcheck-signature"] || req.headers["x-signature"] || req.headers["x-fvbank-signature"]) as string || "";

        // 1. Verify HMAC signature (DuckCheck first, then FV Bank adapter fallback)
        const isDcValid = verifyDuckCheckSignature(rawBody, signature);
        const isFvValid = !process.env.DUCKCHECK_WEBHOOK_SECRET && verifyFvBankSignature(rawBody, signature);

        if (!isDcValid && !isFvValid) {
            console.warn("⚠️  Invalid compliance webhook signature — rejecting.");
            return res.status(401).json({ error: "Invalid webhook signature." });
        }

        const payload = req.body || {};

        // Parse DuckCheck & compliance partner payloads:
        // KYC: { sessionId: "...", status: "approved" | "rejected", person: {...} }
        // KYB: { requestId: "...", verificationResult: "APPROVED" | "REJECTED", eventType: "BUSINESS_VERIFICATION", reason: "..." }
        let applicationType: "KYC" | "KYB" = payload.applicationType;
        let applicationId: string = payload.applicationId || payload.sessionId || payload.requestId || payload.id;
        let event: string = payload.event || payload.eventType || "VERIFICATION_DECISION";
        let status: string = payload.status;
        let rejectionReason: string = payload.rejectionReason || payload.reason;
        let additionalInfoNote: string = payload.additionalInfoNote;
        let partnerOrgId: string = payload.partnerOrgId;

        if (payload.sessionId || payload.person) {
            applicationType = "KYC";
            applicationId = payload.sessionId;
            status = payload.status === "approved" ? "APPROVED" : payload.status === "rejected" ? "REJECTED" : payload.status;
        } else if (payload.eventType === "BUSINESS_VERIFICATION" || payload.verificationResult || payload.documentResults) {
            applicationType = "KYB";
            applicationId = payload.requestId || payload.id;
            status = payload.verificationResult || (payload.status === "COMPLETED" ? "APPROVED" : payload.status);
            rejectionReason = payload.reason || rejectionReason;
        }

        if (!applicationId || !applicationType) {
            return res.status(400).json({ error: "Missing required webhook fields: could not identify applicationId or applicationType." });
        }

        // 2. Deduplicate: Use a deterministic event key so the same event is never processed twice.
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

        let webhookEvent: any = applicationType === "KYC"
            ? (status === "APPROVED" ? "KYC_APPROVED" : status === "REJECTED" ? "KYC_REJECTED" : "KYC_PROCESSING")
            : (status === "APPROVED" ? "KYB_APPROVED" : status === "REJECTED" ? "KYB_REJECTED" : "KYB_PROCESSING");

        // 3. Store raw webhook for audit (tag with the dedup key)
        const webhook = await prisma.complianceWebhook.create({
            data: {
                organizationId: partnerOrgId || null,
                event: webhookEvent,
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
