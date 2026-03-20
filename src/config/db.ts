import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
    log: ["error", "warn"],
});

prisma.$connect()
    .then(() => {
        console.log("Database connected successfully 🚀");
    })
    .catch((error) => {
        console.error("Database connection failed ❌", error);
        process.exit(1);
    });

export default prisma;
