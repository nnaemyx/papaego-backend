/**
 * Banking Profile Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides customer banking profiles, account details, copyable properties,
 * and status histories.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from "../../config/db";

export async function getBankingProfile(organizationId: string) {
    let profile = await prisma.bankingProfile.findUnique({
        where: { organizationId },
        include: {
            bankAccount: {
                include: {
                    events: {
                        orderBy: { createdAt: "desc" },
                        take: 10
                    }
                }
            }
        }
    });

    if (!profile) {
        // Check if bankAccount exists
        const bankAccount = await prisma.bankAccount.findUnique({
            where: { organizationId },
            include: {
                events: {
                    orderBy: { createdAt: "desc" },
                    take: 10
                }
            }
        });

        if (bankAccount && bankAccount.accountNumber !== "PENDING") {
            profile = await prisma.bankingProfile.create({
                data: {
                    organizationId,
                    bankAccountId: bankAccount.id,
                    bankName: bankAccount.bankName,
                    accountHolder: bankAccount.accountHolder,
                    maskedAccountNumber: `•••• ${bankAccount.accountNumber.slice(-4)}`,
                    accountNumber: bankAccount.accountNumber,
                    routingNumber: bankAccount.routingNumber,
                    currency: bankAccount.currency,
                    status: bankAccount.status
                },
                include: {
                    bankAccount: {
                        include: {
                            events: {
                                orderBy: { createdAt: "desc" },
                                take: 10
                            }
                        }
                    }
                }
            });
        }
    }

    if (!profile) {
        return null;
    }

    return {
        id: profile.id,
        organizationId: profile.organizationId,
        bankAccountId: profile.bankAccountId,
        bankName: profile.bankName,
        accountHolder: profile.accountHolder,
        accountNumber: profile.accountNumber, // Provided securely to authorized user
        maskedAccountNumber: profile.maskedAccountNumber,
        routingNumber: profile.routingNumber,
        currency: profile.currency,
        country: profile.bankAccount.country || "United States",
        swiftBic: profile.bankAccount.swiftBic || "FVBKUS33XXX",
        status: profile.status,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        recentEvents: profile.bankAccount.events.map(e => ({
            id: e.id,
            event: e.event,
            source: e.source,
            statusFrom: e.statusFrom,
            statusTo: e.statusTo,
            details: e.details,
            createdAt: e.createdAt
        }))
    };
}
