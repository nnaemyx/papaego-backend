/**
 * Account Synchronization Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Maintains synchronization with FV Bank for account status, restrictions,
 * frozen/suspended states, and account closures.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";
import * as FvBankBanking from "./fvbank.banking.adapter";
import { BankAccountStatus, BankAccountSyncType } from "@prisma/client";

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

    const hasStatusChanged = targetStatus !== bankAccount.status;

    if (hasStatusChanged) {
        const previousStatus = bankAccount.status;

        // Update local BankAccount & BankingProfile
        await prisma.bankAccount.update({
            where: { id: bankAccount.id },
            data: { status: targetStatus }
        });

        if (bankAccount.bankingProfile) {
            await prisma.bankingProfile.update({
                where: { id: bankAccount.bankingProfile.id },
                data: { status: targetStatus }
            });
        }

        // Log BankAccountEvent
        await prisma.bankAccountEvent.create({
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
    }

    // Log Sync Execution
    const syncLog = await prisma.bankAccountSyncLog.create({
        data: {
            bankAccountId: bankAccount.id,
            organizationId: bankAccount.organizationId,
            syncType,
            status: hasStatusChanged ? "SUCCESS" : "NO_CHANGE",
            changesDetected: hasStatusChanged ? ({ from: bankAccount.status, to: targetStatus } as any) : undefined
        }
    });

    return {
        synced: true,
        hasStatusChanged,
        previousStatus: bankAccount.status,
        currentStatus: targetStatus,
        syncLogId: syncLog.id
    };
}
