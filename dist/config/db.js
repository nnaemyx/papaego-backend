"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient({
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
exports.default = prisma;
