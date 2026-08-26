/**
 * Managed Banking Notification Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all customer & admin/ops notifications for account provisioning:
 * 1. Notify customer when account provisioning is pending.
 * 2. Notify customer when account provisioning succeeds/active.
 * 3. Notify Operations/Admin team when account provisioning fails.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";
import {
    sendProvisioningPendingEmail,
    sendProvisioningSuccessEmail,
    sendProvisioningFailedOpsEmail,
    sendAccountStatusChangeEmail
} from "../../services/email.service";


/**
 * 1. Notify customer when provisioning is PENDING
 */
export async function notifyProvisioningPending({
    organizationId,
    userId,
    companyName,
    recipientEmail
}: {
    organizationId: string;
    userId: string;
    companyName: string;
    recipientEmail: string;
}) {
    try {
        // Create in-app NotificationLog
        await prisma.notificationLog.create({
            data: {
                recipientId: userId,
                channel: "IN_APP",
                type: "BANK_ACCOUNT_PENDING",
                subject: "Managed U.S. Bank Account Pending",
                content: `Your managed U.S. bank account request for ${companyName} is currently pending provisioning with FV Bank.`,
                metadata: { organizationId }
            }
        });

        // Create user Notification for real-time UI display
        await prisma.notification.create({
            data: {
                userId,
                title: "Account Provisioning Pending",
                message: `Your U.S. bank account request for ${companyName} is being processed.`,
                type: "INFO"
            }
        }).catch(err => console.warn("Note:", err.message));

        // Send email via Resend
        if (recipientEmail) {
            await sendProvisioningPendingEmail({ email: recipientEmail, companyName });
        }
    } catch (err: any) {
        console.error("❌ Error in notifyProvisioningPending:", err.message);
    }
}

/**
 * 2. Notify customer when provisioning is CREATED / ACTIVE
 */
export async function notifyProvisioningSuccess({
    organizationId,
    userId,
    companyName,
    recipientEmail,
    accountNumber,
    routingNumber
}: {
    organizationId: string;
    userId: string;
    companyName: string;
    recipientEmail: string;
    accountNumber: string;
    routingNumber: string;
}) {
    try {
        const masked = `•••• ${accountNumber.slice(-4)}`;

        // Create in-app NotificationLog
        await prisma.notificationLog.create({
            data: {
                recipientId: userId,
                channel: "IN_APP",
                type: "BANK_ACCOUNT_CREATED",
                subject: "Your Managed U.S. Bank Account is Active!",
                content: `Your dedicated FV Bank U.S. account (${masked}) has been successfully provisioned. Routing: ${routingNumber}`,
                metadata: { organizationId, accountNumber, routingNumber }
            }
        });

        // Create user Notification for UI display
        await prisma.notification.create({
            data: {
                userId,
                title: "Managed U.S. Account Active 🎉",
                message: `Your dedicated FV Bank U.S. account (${masked}) is active and ready for funding.`,
                type: "SUCCESS"
            }
        }).catch(err => console.warn("Note:", err.message));

        // Send email via Resend
        if (recipientEmail) {
            await sendProvisioningSuccessEmail({
                email: recipientEmail,
                companyName,
                accountNumber,
                routingNumber
            });
        }
    } catch (err: any) {
        console.error("❌ Error in notifyProvisioningSuccess:", err.message);
    }
}

/**
 * 3. Notify Operations / Admin team when provisioning FAILS
 */
export async function notifyProvisioningFailed({
    organizationId,
    userId,
    companyName,
    recipientEmail,
    errorReason
}: {
    organizationId: string;
    userId: string;
    companyName: string;
    recipientEmail: string;
    errorReason: string;
}) {
    try {
        // Create in-app NotificationLog for user
        await prisma.notificationLog.create({
            data: {
                recipientId: userId,
                channel: "IN_APP",
                type: "BANK_ACCOUNT_PROVISIONING_FAILED",
                subject: "Managed Bank Account Provisioning Failed",
                content: `Account creation for ${companyName} failed: ${errorReason}`,
                metadata: { organizationId, error: errorReason }
            }
        });

        // Find all ADMIN users to create in-app alerts for Operations
        const admins = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true, email: true }
        });

        for (const admin of admins) {
            await prisma.notification.create({
                data: {
                    userId: admin.id,
                    title: "🚨 Ops Alert: Provisioning Failed",
                    message: `Bank account creation failed for ${companyName} (Org: ${organizationId}): ${errorReason}`,
                    type: "ERROR"
                }
            }).catch(err => console.warn("Note:", err.message));

            // Send ops email alert
            const opsEmail = admin.email || process.env.ADMIN_EMAIL || "admin@papaego.com";
            await sendProvisioningFailedOpsEmail({
                adminEmail: opsEmail,
                companyName,
                errorReason,
                organizationId
            });
        }
    } catch (err: any) {
        console.error("❌ Error in notifyProvisioningFailed:", err.message);
    }
}

/**
 * 4. Notify customer when a live account status change is received from
 *    FV Bank (webhook or sync): SUSPENDED, FROZEN, CLOSED, RESTRICTED, or
 *    re-ACTIVATED. Best-effort — never throws (called from webhook/sync path).
 */
export async function notifyAccountStatusChange({
    organizationId,
    userId,
    companyName,
    recipientEmail,
    previousStatus,
    currentStatus,
    reason
}: {
    organizationId: string;
    userId: string;
    companyName: string;
    recipientEmail?: string | null;
    previousStatus: string;
    currentStatus: string;
    reason?: string;
}) {
    try {
        const isPositive = currentStatus === "ACTIVE";
        const notifType = isPositive ? "SUCCESS" : "WARNING";
        const title = isPositive
            ? "Bank Account Re-activated ✅"
            : `Bank Account ${currentStatus}`;
        const message = `Your managed U.S. bank account for ${companyName} changed from ${previousStatus} to ${currentStatus}.${reason ? ` ${reason}` : ""}`;

        // Immutable audit log entry
        await prisma.notificationLog.create({
            data: {
                recipientId: userId,
                channel: "IN_APP",
                type: "BANK_ACCOUNT_STATUS_CHANGE",
                subject: title,
                content: message,
                metadata: { organizationId, previousStatus, currentStatus, reason }
            }
        }).catch(err => console.warn("Note:", err.message));

        // Real-time in-app notification
        await prisma.notification.create({
            data: {
                userId,
                title,
                message,
                type: notifType
            }
        }).catch(err => console.warn("Note:", err.message));

        // Email (best-effort)
        if (recipientEmail) {
            await sendAccountStatusChangeEmail({
                email: recipientEmail,
                companyName,
                previousStatus,
                currentStatus,
                reason
            });
        }
    } catch (err: any) {
        console.error("❌ Error in notifyAccountStatusChange:", err.message);
    }
}

