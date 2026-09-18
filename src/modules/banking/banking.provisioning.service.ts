/**
 * Managed Account Provisioning Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Submits managed account provisioning requests to FV Bank, creates local
 * BankAccount and BankingProfile records, logs events, and emits notifications.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";
import { checkBankingEligibility } from "./banking.eligibility.service";
import * as FvBankBanking from "./fvbank.banking.adapter";
import { BankAccountStatus } from "@prisma/client";
import {
    notifyProvisioningPending,
    notifyProvisioningSuccess,
    notifyProvisioningFailed
} from "./banking.notification.service";

export async function provisionManagedAccount(organizationId: string, userId: string) {
    // 1. Run strict eligibility validation first
    const eligibility = await checkBankingEligibility(organizationId);
    if (!eligibility.isEligible) {
        throw new Error(`Account provisioning blocked: ${eligibility.reasons.join(" | ")}`);
    }

    const org = eligibility.organization;

    // 2. Check if a valid managed account already exists
    const existing = await prisma.bankAccount.findUnique({ where: { organizationId } });
    if (existing && existing.status === "ACTIVE" && existing.accountNumber !== "PENDING") {
        let existingProfile = await prisma.bankingProfile.findUnique({ where: { organizationId } });
        if (!existingProfile) {
            existingProfile = await prisma.bankingProfile.create({
                data: {
                    organizationId: org.id,
                    bankAccountId: existing.id,
                    bankName: existing.bankName,
                    accountHolder: existing.accountHolder,
                    maskedAccountNumber: `•••• ${existing.accountNumber.slice(-4)}`,
                    accountNumber: existing.accountNumber,
                    routingNumber: existing.routingNumber,
                    currency: existing.currency,
                    status: existing.status
                }
            });
        }
        return { bankAccount: existing, bankingProfile: existingProfile };
    }

    // 3. Acquire slot or reuse uncompleted claim
    if (!existing) {
        await prisma.bankAccount.create({
            data: {
                organizationId,
                accountNumber: "PENDING",
                routingNumber: "PENDING",
                accountHolder: "PENDING",
                status: "PENDING_CREATION"
            }
        });
    } else if (existing.status === "CLOSED" || (existing.status === "PENDING_CREATION" && existing.accountNumber === "PENDING")) {
        await prisma.bankAccount.update({
            where: { organizationId },
            data: {
                accountNumber: "PENDING",
                routingNumber: "PENDING",
                accountHolder: "PENDING",
                status: "PENDING_CREATION"
            }
        });
    } else {
        throw new Error(
            `Account provisioning blocked: Organization already has a managed bank account (Status: ${existing.status}).`
        );
    }

    // 2. Notify customer that account creation is PENDING
    await notifyProvisioningPending({
        organizationId: org.id,
        userId,
        companyName: org.businessName,
        recipientEmail: org.contactEmail
    });

    // 3. Submit account creation request to FV Bank via adapter
    let fvRes: FvBankBanking.FvCreateAccountResponse;
    try {
        fvRes = await FvBankBanking.requestManagedAccount({
            organizationId: org.id,
            companyName: org.businessName,
            accountHolderName: org.businessName,
            businessType: org.businessType,
            countryOfRegistration: org.countryOfRegistration,
            registrationNumber: org.registrationNumber || undefined,
            taxIdentification: org.kybRequest?.taxIdentification || undefined,
            contactEmail: org.contactEmail
        });
    } catch (err: any) {
        // Log failure event & Notify Operations/Admin team
        console.error("❌ Managed account provisioning failed with FV Bank API:", err.message);

        // Release the claim so the customer can safely retry once FV Bank recovers.
        await prisma.bankAccount.deleteMany({
            where: { organizationId: org.id, status: "PENDING_CREATION", fvAccountId: null }
        }).catch(() => { /* ignore */ });

        await notifyProvisioningFailed({
            organizationId: org.id,
            userId,
            companyName: org.businessName,
            recipientEmail: org.contactEmail,
            errorReason: err.message
        });

        throw new Error(`FV Bank provisioning request failed: ${err.message}`);
    }

    // 3. Map status string to Prisma BankAccountStatus
    const statusMap: Record<string, BankAccountStatus> = {
        PENDING_CREATION: "PENDING_CREATION",
        CREATING: "CREATING",
        ACTIVE: "ACTIVE",
        RESTRICTED: "RESTRICTED",
        SUSPENDED: "SUSPENDED",
        FROZEN: "FROZEN",
        CLOSED: "CLOSED"
    };
    const accStatus: BankAccountStatus = statusMap[fvRes.status] || "ACTIVE";

    // 5. Mask account number for BankingProfile (e.g., "•••• 6789")
    const last4 = fvRes.accountNumber.slice(-4);
    const maskedAccountNumber = `•••• ${last4}`;

    // 4-6. Persist the real account details onto the claimed placeholder row,
    //      create the banking profile, and write the audit event atomically.
    const { bankAccount, bankingProfile } = await prisma.$transaction(async (tx) => {
        const bankAccount = await tx.bankAccount.update({
            where: { organizationId: org.id },
            data: {
                fvAccountId: fvRes.fvAccountId,
                accountNumber: fvRes.accountNumber,
                routingNumber: fvRes.routingNumber,
                accountHolder: fvRes.accountHolder,
                bankName: fvRes.bankName || "FV Bank",
                currency: fvRes.currency || "USD",
                country: fvRes.country || "United States",
                swiftBic: fvRes.swiftBic || null,
                accountReference: fvRes.accountReference || null,
                status: accStatus
            }
        });

        const bankingProfile = await tx.bankingProfile.create({
            data: {
                organizationId: org.id,
                bankAccountId: bankAccount.id,
                bankName: bankAccount.bankName,
                accountHolder: bankAccount.accountHolder,
                maskedAccountNumber,
                accountNumber: bankAccount.accountNumber,
                routingNumber: bankAccount.routingNumber,
                currency: bankAccount.currency,
                status: accStatus
            }
        });

        await tx.bankAccountEvent.create({
            data: {
                bankAccountId: bankAccount.id,
                organizationId: org.id,
                event: "ACCOUNT_CREATED",
                source: "SYSTEM",
                statusFrom: "PENDING_CREATION",
                statusTo: accStatus,
                details: `Managed U.S. bank account provisioned. Routing: ${bankAccount.routingNumber}, Acc: ${maskedAccountNumber}`,
                metadata: {
                    fvAccountId: fvRes.fvAccountId,
                    swiftBic: fvRes.swiftBic
                }
            }
        });

        return { bankAccount, bankingProfile };
    });

    // 7. Send success notifications (In-App & Email via Resend)
    await notifyProvisioningSuccess({
        organizationId: org.id,
        userId,
        companyName: org.businessName,
        recipientEmail: org.contactEmail,
        accountNumber: bankAccount.accountNumber,
        routingNumber: bankAccount.routingNumber
    });

    return {
        bankAccount,
        bankingProfile
    };
}
