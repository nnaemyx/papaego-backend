import prisma from "../src/config/db";

async function main() {
    try {
        const users = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true, email: true, role: true }
        });
        console.log("Admin Users:", JSON.stringify(users, null, 2));
    } catch (e: any) {
        console.error("Error:", e.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
