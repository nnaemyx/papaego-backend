import prisma from "../src/config/db";

async function main() {
    try {
        const orgs = await prisma.organization.findMany({
            take: 10,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                businessName: true,
                status: true,
                createdAt: true,
                kybRequest: {
                    select: {
                        id: true,
                        status: true,
                        fvBankApplicationId: true,
                    }
                },
                bankAccount: {
                    select: {
                        id: true,
                        status: true,
                        accountNumber: true,
                        fvAccountId: true,
                    }
                }
            }
        });
        console.log("Recent Organizations in DB:");
        console.log(JSON.stringify(orgs, null, 2));
    } catch (e: any) {
        console.error("DB Error:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
