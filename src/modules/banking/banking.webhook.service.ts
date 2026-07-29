/**
 * Banking Webhook Processing Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Processes inbound banking webhooks from FV Bank (Account Created, Activated,
 * Suspended, Frozen, Closed, Info Updated) with HMAC validation and audit logging.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";
import * as FvBankBanking from "./fvbank.banking.adapter";
import { BankAccountStatus, BankingWebhookEvent } from "@prisma/client";

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
}

export async function processBankingWebhook(rawBody: string, signature: string | undefined, payload: BankingWebhookPayload) {
    // 1. Verify HMAC signature if signature provided
    const isValidSig = FvBankBanking.verifyBankingWebhookSignature(rawBody, signature || "");
    if (!isValidSig) {
        throw new Error("Invalid banking webhook HMAC signature");
    }

    const event = payload.event;
    const fvAccountId = payload.fvAccountId;
    const partnerOrgId = payload.partnerOrgId;

    // 2. Find local bank account record
    let bankAccount = fvAccountId
        ? await prisma.bankAccount.findFirst({ where: { fvAccountId }, include: { bankingProfile: true } })
        : null;

    if (!bankAccount && partnerOrgId) {
        bankAccount = await prisma.bankAccount.findUnique({ where: { organizationId: partnerOrgId }, include: { bankingProfile: true } });
    }

    // 3. Save raw webhook in bank_account_webhooks
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

    try {
        if (bankAccount) {
            const previousStatus = bankAccount.status;
            let targetStatus: BankAccountStatus | null = null;
            let details = payload.details || payload.reason || `FV Bank webhook event received: ${event}`;

            switch (event) {
                case "ACCOUNT_CREATED":
                case "ACCOUNT_ACTIVATED":
                    targetStatus = "ACTIVE";
                    break;
                case "ACCOUNT_SUSPENDED":
                    targetStatus = "SUSPENDED";
                    break;
                case "ACCOUNT_FROZEN":
                    targetStatus = "FROZEN";
                    break;
                case "ACCOUNT_CLOSED":
                    targetStatus = "CLOSED";
                    break;
                case "BANKING_INFO_UPDATED":
                    // Keep current status, update details if provided
                    if (payload.accountHolder || payload.routingNumber) {
                        await prisma.bankAccount.update({
                            where: { id: bankAccount.id },
                            data: {
                                accountHolder: payload.accountHolder || bankAccount.accountHolder,
                                routingNumber: payload.routingNumber || bankAccount.routingNumber
                            }
                        });
                        if (bankAccount.bankingProfile) {
                            await prisma.bankingProfile.update({
                                where: { id: bankAccount.bankingProfile.id },
                                data: {
                                    accountHolder: payload.accountHolder || bankAccount.accountHolder,
                                    routingNumber: payload.routingNumber || bankAccount.routingNumber
                                }
                            });
                        }
                    }
                    break;
            }

            if (targetStatus && targetStatus !== previousStatus) {
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

                // Log Event
                await prisma.bankAccountEvent.create({
                    data: {
                        bankAccountId: bankAccount.id,
                        organizationId: bankAccount.organizationId,
                        event,
                        source: "FV_BANK_WEBHOOK",
                        statusFrom: previousStatus,
                        statusTo: targetStatus,
                        details,
                        metadata: { webhookId: webhookRecord.id, payload: payload as any }
                    }
                });
            }
        }

        // Mark webhook as processed
        await prisma.bankAccountWebhook.update({
            where: { id: webhookRecord.id },
            data: {
                processed: true,
                processedAt: new Date()
            }
        });

        return { success: true, webhookId: webhookRecord.id };
    } catch (err: any) {
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
