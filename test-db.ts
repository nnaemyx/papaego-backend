
import prisma from "./src/config/db";

async function main() {
    console.log("Attempting database connection...");
    try {
        await prisma.$connect();
        console.log("✅ Connection SUCCESSFUL");
        await prisma.$disconnect();
        process.exit(0);
    } catch (e) {
        console.error("❌ Connection FAILED", e);
        process.exit(1);
    }
}

main();
