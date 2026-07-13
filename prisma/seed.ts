import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding database...");

    await prisma.systemConfig.upsert({
        where: { key: "negotiation_config" },
        update: {},
        create: {
            key: "negotiation_config",
            value: {
                threshold: 10_000_000,
                enabled: true,
                discountBps: 5,
            },
        },
    });
    console.log("✅ Negotiation config seeded (negotiation_config)");

    // Create admin user
    const adminEmail = process.env.ADMIN_EMAIL || "admin@papaego.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
    const adminPhone = process.env.ADMIN_PHONE || "+2348000000000";

    // Check if admin already exists
    const existingAdmin = await prisma.user.findFirst({
        where: {
            email: adminEmail,
            role: "ADMIN",
        },
    });

    if (existingAdmin) {
        console.log(`✅ Admin user already exists: ${adminEmail}`);
    } else {
        // Hash password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // Create admin user
        const admin = await prisma.user.create({
            data: {
                email: adminEmail,
                phone: adminPhone,
                password: hashedPassword,
                role: "ADMIN",
                isActive: true,
            },
        });

        console.log(`✅ Admin user created successfully!`);
        console.log(`   Email: ${adminEmail}`);
        console.log(`   Password: ${adminPassword}`);
        console.log(`   ID: ${admin.id}`);
        console.log("");
        console.log("⚠️  IMPORTANT: Change the password after first login!");
    }

    // Seeding Treasury Accounts and Ledger Entries
    console.log("🌱 Seeding Treasury Accounts...");
    const existingAccounts = await prisma.treasuryAccount.findMany();
    if (existingAccounts.length === 0) {
        // Create Treasury Accounts
        const gtbank = await prisma.treasuryAccount.create({
            data: {
                accountName: "GTBank NGN Treasury",
                provider: "GTBank",
                currency: "NGN",
                accountType: "BANK",
                status: "ACTIVE",
                metadata: { accountNumber: "0123456789", bankCode: "058" },
            }
        });

        const binanceNgn = await prisma.treasuryAccount.create({
            data: {
                accountName: "Binance NGN Liquidity",
                provider: "Binance",
                currency: "NGN",
                accountType: "EXCHANGE",
                status: "ACTIVE",
                metadata: { email: "treasury@papaego.com" },
            }
        });

        const okxNgn = await prisma.treasuryAccount.create({
            data: {
                accountName: "OKX NGN Wallet",
                provider: "OKX",
                currency: "NGN",
                accountType: "WALLET",
                status: "ACTIVE",
                metadata: { address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" },
            }
        });

        const binanceUsd = await prisma.treasuryAccount.create({
            data: {
                accountName: "Binance USD Treasury",
                provider: "Binance",
                currency: "USD",
                accountType: "EXCHANGE",
                status: "ACTIVE",
                metadata: { email: "treasury@papaego.com" },
            }
        });

        console.log("✅ Created 4 Treasury Accounts");

        // Seed Treasury Balances
        await prisma.treasuryBalance.createMany({
            data: [
                {
                    accountId: gtbank.id,
                    currency: "NGN",
                    availableBalance: 17450000.00,
                    reservedBalance: 2500000.00,
                    totalBalance: 19950000.00,
                },
                {
                    accountId: binanceNgn.id,
                    currency: "NGN",
                    availableBalance: 24000000.00,
                    reservedBalance: 0.00,
                    totalBalance: 24000000.00,
                },
                {
                    accountId: okxNgn.id,
                    currency: "NGN",
                    availableBalance: 10000000.00,
                    reservedBalance: 1250000.00,
                    totalBalance: 11250000.00,
                },
                {
                    accountId: binanceUsd.id,
                    currency: "USD",
                    availableBalance: 45000.00,
                    reservedBalance: 5000.00,
                    totalBalance: 50000.00,
                }
            ]
        });
        console.log("✅ Created Treasury Balances with millions of Naira");

        // Create historical ledger entries
        console.log("🌱 Creating historical Ledger Entries...");
        const ledgerData = [
            // GTBank NGN Treasury History
            {
                transactionType: "DEPOSIT" as const,
                creditAccountId: gtbank.id,
                amount: 20000000.00,
                currency: "NGN",
                description: "Initial treasury funding from corporate bank account",
                createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            },
            {
                transactionType: "RESERVATION" as const,
                debitAccountId: gtbank.id,
                amount: 2500000.00,
                currency: "NGN",
                description: "Reserved funds for pending agent payouts (Batch #452)",
                createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
            },
            {
                transactionType: "WITHDRAWAL" as const,
                debitAccountId: gtbank.id,
                amount: 50000.00,
                currency: "NGN",
                description: "Monthly account maintenance and processing fees",
                createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
            },

            // Binance NGN Liquidity History
            {
                transactionType: "DEPOSIT" as const,
                creditAccountId: binanceNgn.id,
                amount: 30000000.00,
                currency: "NGN",
                description: "Liquidity replenishment from NGN capital reserves",
                createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
            },
            {
                transactionType: "WITHDRAWAL" as const,
                debitAccountId: binanceNgn.id,
                amount: 6000000.00,
                currency: "NGN",
                description: "Transferred NGN to agent settlement pool",
                createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
            },

            // OKX NGN Wallet History
            {
                transactionType: "DEPOSIT" as const,
                creditAccountId: okxNgn.id,
                amount: 15000000.00,
                currency: "NGN",
                description: "OTC trading desk collateral deposit",
                createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
            },
            {
                transactionType: "RESERVATION" as const,
                debitAccountId: okxNgn.id,
                amount: 5000000.00,
                currency: "NGN",
                description: "Reserved collateral for smart contract trade #88A9",
                createdAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000), // 18 days ago
            },
            {
                transactionType: "SETTLEMENT" as const,
                debitAccountId: okxNgn.id,
                amount: 3750000.00,
                currency: "NGN",
                description: "Completed settlement for trade #88A9 - 3.75M NGN deducted",
                createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), // 12 days ago
            },

            // Binance USD Treasury History
            {
                transactionType: "DEPOSIT" as const,
                creditAccountId: binanceUsd.id,
                amount: 55000.00,
                currency: "USD",
                description: "USD capital deposit from external corporate wallet",
                createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
            },
            {
                transactionType: "RESERVATION" as const,
                debitAccountId: binanceUsd.id,
                amount: 5000.00,
                currency: "USD",
                description: "Reserved funds for pending agent payout #USD-99",
                createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
            }
        ];

        // Insert them sequentially
        for (const item of ledgerData) {
            await prisma.ledgerEntry.create({
                data: item
            });
        }
        console.log("✅ Created historical Ledger Entries successfully");
    } else {
        console.log("✅ Treasury Accounts already seeded.");
    }
}

main()
    .catch((e) => {
        console.error("❌ Error seeding database:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
