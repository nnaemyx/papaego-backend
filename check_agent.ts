
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkAgent() {
  const email = 'johnpauledeh27@gmail.com';
  const users = await prisma.user.findMany({
    where: { email: { contains: 'johnpauledeh', mode: 'insensitive' } }
  });
  console.log('Users found:', JSON.stringify(users, null, 2));
}

checkAgent().finally(() => prisma.$disconnect());
