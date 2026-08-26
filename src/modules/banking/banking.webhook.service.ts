/**
 * Banking Webhook Processing Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Processes inbound banking webhooks from FV Bank (Account Created, Activated,
 * Suspended, Frozen, Closed, Info Updated).
 *
 * Hardening (Sprint 2 strengthening):
 *   • HMAC signature verification (mirrors Compliance webhook pattern).
 *   • Idempotent: every delivery is persisted for audit, but state mutations
 *     are skipped when the target status was already applied (dedupe / replay
 *     safety) so FV Bank retries never corrupt account state.
 *   • Banking state machine: illegal transitions (e.g. CLOSED → ACTIVE) are
 *     rejected instead of silently applied.
 *   • Atomic: BankAccount + BankingProfile + BankAccountEvent are updated inside
 *     a single Prisma transaction.
 *   • Customer notification fired on every real status change.
 *   • The webhook row is ALWAYS marked processed (even for no-op / unknown
 *     account) so the endpoint can safely return 200 and stop retry storms;
 *     genuine processing errors are recorded with retryCount for reprocessing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";
import * as FvBankBanking from "./fvbank.banking.adapter";
import { BankAccountStatus, BankingWebhookEvent } from "@prisma/client";
import { notifyAccountStatusChange } from "./banking.notification.service";

export interface BankingWebhookPayload {
    event: BankingWebhookEvent;
    fvAccountId: string;
    partnerOrgId?: string;
    status?: string;
    accountNumber?: string;
    routingNumber?: string;
    accountHolder?: string;
    details?: string;
    reason?: string;
    // Optional idempotency key supplied by FV Bank
    eventId?: string;
    deliveryId?: string;
}

// ─────────────────────────────────────────────────────
// Banking State Machine
// Governs which target statuses are reachable from a given
// current status. Prevents illegal regressions like a stale
// ACCOUNT_ACTIVATED reviving a CLOSED account.
// ─────────────────────────────────────────────────────
const BANK_ACCOUNT_TRANSITIONS: Record<BankAccountStatus, BankAccountStatus[]> = {
    PENDING_CREATION: ["PENDING_CREATION", "CREATING", "ACTIVE", "RESTRICTED", "SUSPENDED", "FROZEN", "CLOSED"],
    CREATING: ["CREATING", "ACTIVE", "RESTRICTED", "SUSPENDED", "FROZEN", "CLOSED"],
    ACTIVE: ["ACTIVE", "RESTRICTED", "SUSPENDED", "FROZEN", "CLOSED"],
    RESTRICTED: ["RESTRICTED", "ACTIVE", "SUSPENDED", "FROZEN", "CLOSED"],
    SUSPENDED: ["SUSPENDED", "ACTIVE", "RESTRICTED", "FROZEN", "CLOSED"],
    FROZEN: ["FROZEN", "ACTIVE", "RESTRICTED", "SUSPENDED", "CLOSED"],
    CLOSED: ["CLOSED"] // Terminal
};

function isValidBankTransition(from: BankAccountStatus, to: BankAccountStatus): boolean {
    const allowed = BANK_ACCOUNT_TRANSITIONS[from];
    if (!allowed) return true; // defensive default
    return allowed.includes(to);
}

function eventToTargetStatus(event: BankingWebhookEvent): BankAccountStatus | null {
    switch (event) {
        case "ACCOUNT_CREATED":
        case "ACCOUNT_ACTIVATED":
            return "ACTIVE";
        case "ACCOUNT_SUSPENDED":
            return "SUSPENDED";
        case "ACCOUNT_FROZEN":
            return "FROZEN";
        case "ACCOUNT_CLOSED":
            return "CLOSED";
        case "BANKING_INFO_UPDATED":
        default:
            return null;
    }
}

export async function processBankingWebhook(
    rawBody: string,
    signature: string | undefined,
    payload: BankingWebhookPayload
) {
    // 1. Verify HMAC signature (throws for tampered payloads).
    const isValidSig = FvBankBanking.verifyBankingWebhookSignature(rawBody, signature || "");
    if (!isValidSig) {
        throw new Error("Invalid banking webhook HMAC signature");
    }

    const event = payload.event;
    const fvAccountId = payload.fvAccountId;
    const partnerOrgId = payload.partnerOrgId;

    // 2. Resolve local bank account (by FV account id, then partner org id).
    let bankAccount = fvAccountId
        ? await prisma.bankAccount.findFirst({ where: { fvAccountId }, include: { bankingProfile: true } })
        : null;

    if (!bankAccount && partnerOrgId) {
        bankAccount = await prisma.bankAccount.findUnique({
            where: { organizationId: partnerOrgId },
            include: { bankingProfile: true }
        });
    }

    // 3. Persist the raw delivery for audit (always).
    const webhookRecord = await prisma.bankAccountWebhook.create({
        data: {
            organizationId: bankAccount?.organizationId || partnerOrgId || null,
            bankAccountId: bankAccount?.id || null,
            event,
            payload: payload as any,
            signature: signature || null,
            processed: false
        }
    });

    // Helper: mark this delivery processed (idempotent ack).
    const markProcessed = (note?: string) =>
        prisma.bankAccountWebhook.update({
            where: { id: webhookRecord.id },
            data: {
                processed: true,
                processedAt: new Date(),
                errorMessage: note || null
            }
        });

    try {
        // 4. Unknown account → ack (nothing to mutate). Prevents infinite retries.
        if (!bankAccount) {
            await markProcessed("No matching local bank account; delivery stored for audit.");
            return { success: true, webhookId: webhookRecord.id, applied: false, reason: "NO_LOCAL_ACCOUNT" };
        }

        const previousStatus = bankAccount.status;
        const details = payload.details || payload.reason || `FV Bank webhook event: ${event}`;

        // 5. BANKING_INFO_UPDATED — patch mutable fields, no status change.
        if (event === "BANKING_INFO_UPDATED") {
            if (payload.accountHolder || payload.routingNumber) {
                await prisma.$transaction(async (tx) => {
                    await tx.bankAccount.update({
                        where: { id: bankAccount!.id },
                        data: {
                            accountHolder: payload.accountHolder || bankAccount!.accountHolder,
                            routingNumber: payload.routingNumber || bankAccount!.routingNumber
                        }
                    });
                    if (bankAccount!.bankingProfile) {
                        await tx.bankingProfile.update({
                            where: { id: bankAccount!.bankingProfile.id },
                            data: {
                                accountHolder: payload.accountHolder || bankAccount!.accountHolder,
                                routingNumber: payload.routingNumber || bankAccount!.routingNumber
                            }
                        });
                    }
                    await tx.bankAccountEvent.create({
                        data: {
                            bankAccountId: bankAccount!.id,
                            organizationId: bankAccount!.organizationId,
                            event: "BANKING_INFO_UPDATED",
                            source: "FV_BANK_WEBHOOK",
                            statusFrom: previousStatus,
                            statusTo: previousStatus,
                            details,
                            metadata: { webhookId: webhookRecord.id, payload: payload as any }
                        }
                    });
                });
            }
            await markProcessed();
            return { success: true, webhookId: webhookRecord.id, applied: true, event };
        }

        // 6. Status-changing events.
        const targetStatus = eventToTargetStatus(event);

        // Unknown event type → ack for audit only.
        if (!targetStatus) {
            await markProcessed(`Unhandled event type '${event}'.`);
            return { success: true, webhookId: webhookRecord.id, applied: false, reason: "UNHANDLED_EVENT" };
        }

        // 6a. Idempotency / replay: status already applied → no-op ack.
        if (targetStatus === previousStatus) {
            await markProcessed("Duplicate/replay: target status already applied.");
            return {
                success: true,
                webhookId: webhookRecord.id,
                applied: false,
                reason: "ALREADY_APPLIED",
                status: previousStatus
            };
        }

        // 6b. Illegal transition → record + ack (do NOT corrupt state, do NOT retry).
        if (!isValidBankTransition(previousStatus, targetStatus)) {
            await prisma.bankAccountEvent.create({
                data: {
                    bankAccountId: bankAccount.id,
                    organizationId: bankAccount.organizationId,
                    event: "STATUS_CHANGE_REJECTED",
                    source: "FV_BANK_WEBHOOK",
                    statusFrom: previousStatus,
                    statusTo: targetStatus,
                    details: `Rejected illegal transition ${previousStatus} → ${targetStatus}. ${details}`,
                    metadata: { webhookId: webhookRecord.id, payload: payload as any }
                }
            });
            await markProcessed(`Illegal transition ${previousStatus} → ${targetStatus} ignored.`);
            return {
                success: true,
                webhookId: webhookRecord.id,
                applied: false,
                reason: "ILLEGAL_TRANSITION",
                from: previousStatus,
                to: targetStatus
            };
        }

        // 6c. Apply status change atomically.
        await prisma.$transaction(async (tx) => {
            await tx.bankAccount.update({
                where: { id: bankAccount!.id },
                data: { status: targetStatus }
            });

            if (bankAccount!.bankingProfile) {
                await tx.bankingProfile.update({
                    where: { id: bankAccount!.bankingProfile.id },
                    data: { status: targetStatus }
                });
            }

            await tx.bankAccountEvent.create({
                data: {
                    bankAccountId: bankAccount!.id,
                    organizationId: bankAccount!.organizationId,
                    event,
                    source: "FV_BANK_WEBHOOK",
                    statusFrom: previousStatus,
                    statusTo: targetStatus,
                    details,
                    metadata: { webhookId: webhookRecord.id, payload: payload as any }
                }
            });
        });

        // 7. Mark processed BEFORE side-effect notifications.
        await markProcessed();

        // 8. Notify customer (best-effort; never throws).
        await dispatchStatusChangeNotification(
            bankAccount.organizationId,
            previousStatus,
            targetStatus,
            details
        );

        return {
            success: true,
            webhookId: webhookRecord.id,
            applied: true,
            event,
            from: previousStatus,
            to: targetStatus
        };
    } catch (err: any) {
        // Genuine processing failure → keep unprocessed for retry/reprocessing.
        await prisma.bankAccountWebhook.update({
            where: { id: webhookRecord.id },
            data: {
                processed: false,
                errorMessage: err.message,
                retryCount: { increment: 1 }
            }
        });
        throw err;
    }
}

/**
 * Resolves the notification recipient (organization owner member) and fires the
 * customer-facing status change notification. Fully guarded — a failure here
 * must never roll back the (already-committed) status update.
 */
async function dispatchStatusChangeNotification(
    organizationId: string,
    previousStatus: string,
    currentStatus: string,
    reason?: string
) {
    try {
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { businessName: true, contactEmail: true, ownerId: true }
        });
        if (!org) return;

        await notifyAccountStatusChange({
            organizationId,
            userId: org.ownerId,
            companyName: org.businessName,
            recipientEmail: org.contactEmail,
            previousStatus,
            currentStatus,
            reason
        });
    } catch (err: any) {
        console.error("❌ dispatchStatusChangeNotification error:", err.message);
    }
}
