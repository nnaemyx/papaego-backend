/**
 * Account Synchronization Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Maintains synchronization with FV Bank for account status, restrictions,
 * frozen/suspended states, and account closures.
 *
 * Hardening (Sprint 2 strengthening):
 *   • Banking state machine guards illegal remote transitions (e.g. a stale
 *     ACTIVE poll must not revive a CLOSED account).
 *   • Atomic: BankAccount + BankingProfile + BankAccountEvent are updated in a
 *     single Prisma transaction.
 *   • Customer notification fired when a status change is detected remotely.
 *   • Sync-failure notification remains best-effort and never blocks the caller.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";
import * as FvBankBanking from "./fvbank.banking.adapter";
import { BankAccountStatus, BankAccountSyncType } from "@prisma/client";
import { notifyAccountStatusChange } from "./banking.notification.service";

const BANK_ACCOUNT_TRANSITIONS: Record<BankAccountStatus, BankAccountStatus[]> = {
    PENDING_CREATION: ["PENDING_CREATION", "CREATING", "ACTIVE", "RESTRICTED", "SUSPENDED", "FROZEN", "CLOSED"],
    CREATING: ["CREATING", "ACTIVE", "RESTRICTED", "SUSPENDED", "FROZEN", "CLOSED"],
    ACTIVE: ["ACTIVE", "RESTRICTED", "SUSPENDED", "FROZEN", "CLOSED"],
    RESTRICTED: ["RESTRICTED", "ACTIVE", "SUSPENDED", "FROZEN", "CLOSED"],
    SUSPENDED: ["SUSPENDED", "ACTIVE", "RESTRICTED", "FROZEN", "CLOSED"],
    FROZEN: ["FROZEN", "ACTIVE", "RESTRICTED", "SUSPENDED", "CLOSED"],
    CLOSED: ["CLOSED"]
};

function isValidBankTransition(from: BankAccountStatus, to: BankAccountStatus): boolean {
    const allowed = BANK_ACCOUNT_TRANSITIONS[from];
    if (!allowed) return true;
    return allowed.includes(to);
}

export async function syncBankAccount(bankAccountId: string, syncType: BankAccountSyncType = "MANUAL") {
    const bankAccount = await prisma.bankAccount.findUnique({
        where: { id: bankAccountId },
        include: { bankingProfile: true }
    });

    if (!bankAccount) {
        throw new Error("Bank account not found.");
    }

    if (!bankAccount.fvAccountId) {
        return {
            synced: false,
            message: "No FV Bank Account ID associated with local record.",
            status: bankAccount.status
        };
    }

    let fvStatusRes: FvBankBanking.FvAccountStatusResponse;
    try {
        fvStatusRes = await FvBankBanking.getAccountStatus(bankAccount.fvAccountId);
    } catch (err: any) {
        // Log sync failure
        await prisma.bankAccountSyncLog.create({
            data: {
                bankAccountId: bankAccount.id,
                organizationId: bankAccount.organizationId,
                syncType,
                status: "FAILED",
                errorMessage: err.message
            }
        });
        throw new Error(`Failed to synchronize with FV Bank: ${err.message}`);
    }

    const statusMap: Record<string, BankAccountStatus> = {
        PENDING_CREATION: "PENDING_CREATION",
        CREATING: "CREATING",
        ACTIVE: "ACTIVE",
        RESTRICTED: "RESTRICTED",
        SUSPENDED: "SUSPENDED",
        FROZEN: "FROZEN",
        CLOSED: "CLOSED"
    };

    let targetStatus: BankAccountStatus = statusMap[fvStatusRes.status] || bankAccount.status;
    if (fvStatusRes.isFrozen) targetStatus = "FROZEN";
    if (fvStatusRes.isSuspended) targetStatus = "SUSPENDED";

    const previousStatus = bankAccount.status;
    const wantsChange = targetStatus !== previousStatus;

    // Guard illegal remote transitions (e.g. CLOSED → ACTIVE). Record + skip.
    if (wantsChange && !isValidBankTransition(previousStatus, targetStatus)) {
        await prisma.bankAccountSyncLog.create({
            data: {
                bankAccountId: bankAccount.id,
                organizationId: bankAccount.organizationId,
                syncType,
                status: "REJECTED",
                errorMessage: `Illegal transition ${previousStatus} → ${targetStatus} ignored during ${syncType} sync.`,
                changesDetected: { from: previousStatus, to: targetStatus, rejected: true } as any
            }
        });
        return {
            synced: true,
            hasStatusChanged: false,
            rejected: true,
            reason: "ILLEGAL_TRANSITION",
            previousStatus,
            currentStatus: previousStatus
        };
    }

    const hasStatusChanged = wantsChange;

    if (hasStatusChanged) {
        // Apply status change atomically (account + profile + event).
        await prisma.$transaction(async (tx) => {
            await tx.bankAccount.update({
                where: { id: bankAccount.id },
                data: { status: targetStatus }
            });

            if (bankAccount.bankingProfile) {
                await tx.bankingProfile.update({
                    where: { id: bankAccount.bankingProfile.id },
                    data: { status: targetStatus }
                });
            }

            await tx.bankAccountEvent.create({
                data: {
                    bankAccountId: bankAccount.id,
                    organizationId: bankAccount.organizationId,
                    event: "STATUS_CHANGE",
                    source: syncType === "WEBHOOK" ? "FV_BANK_WEBHOOK" : "SYNC",
                    statusFrom: previousStatus,
                    statusTo: targetStatus,
                    details: `Account status updated via ${syncType} sync from ${previousStatus} to ${targetStatus}`,
                    metadata: { fvStatusRes: fvStatusRes as any }
                }
            });
        });
    }

    // Log Sync Execution
    const syncLog = await prisma.bankAccountSyncLog.create({
        data: {
            bankAccountId: bankAccount.id,
            organizationId: bankAccount.organizationId,
            syncType,
            status: hasStatusChanged ? "SUCCESS" : "NO_CHANGE",
            changesDetected: hasStatusChanged ? ({ from: previousStatus, to: targetStatus } as any) : undefined
        }
    });

    // Notify customer of any detected status change (best-effort; never throws).
    if (hasStatusChanged) {
        await dispatchSyncStatusChangeNotification(
            bankAccount.organizationId,
            previousStatus,
            targetStatus,
            `Detected via ${syncType} synchronization with FV Bank.`
        );
    }

    return {
        synced: true,
        hasStatusChanged,
        previousStatus,
        currentStatus: targetStatus,
        syncLogId: syncLog.id
    };
}

/**
 * Fires the customer-facing status change notification for a sync-detected
 * change. Fully guarded — must never roll back the committed status update.
 */
async function dispatchSyncStatusChangeNotification(
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
        console.error("❌ dispatchSyncStatusChangeNotification error:", err.message);
    }
}
