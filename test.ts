import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient(); async function main() { console.log(await prisma.user.findMany({ where: { role: "AGENT" } })); } main();
