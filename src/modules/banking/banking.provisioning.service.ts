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
    // 1. Run strict eligibility validation
    const eligibility = await checkBankingEligibility(organizationId);
    if (!eligibility.isEligible) {
        throw new Error(`Account provisioning blocked: ${eligibility.reasons.join(" | ")}`);
    }

    const org = eligibility.organization;

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

    // 4. Create BankAccount record in database
    const bankAccount = await prisma.bankAccount.create({
        data: {
            organizationId: org.id,
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

    // 5. Mask account number for BankingProfile (e.g., "•••• 6789")
    const last4 = fvRes.accountNumber.slice(-4);
    const maskedAccountNumber = `•••• ${last4}`;

    const bankingProfile = await prisma.bankingProfile.create({
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

    // 6. Record BankAccountEvent audit log
    await prisma.bankAccountEvent.create({
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
