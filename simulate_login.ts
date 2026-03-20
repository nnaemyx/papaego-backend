
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function simulateLogin() {
  const email = 'johnpauledeh27@gmail.com';
  console.log('--- Simulating Login for', email, '---');
  
  const user = await prisma.user.findFirst({
    where: { email }
  });
  
  if (!user) {
    console.log('❌ User not found in query');
    // Try insensitive just in case
    const userInsensitive = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } }
    });
    if (userInsensitive) {
        console.log('⚠️ Found with insensitive match ONLY:', userInsensitive.email);
    } else {
        console.log('❌ Still not found even with insensitive match');
    }
  } else {
    console.log('✅ User found:', user.email);
    console.log('Active status:', user.isActive);
    if (!user.isActive) {
        console.log('❌ User is inactive');
    } else {
        console.log('✅ User is active');
    }
  }
}

simulateLogin().finally(() => prisma.$disconnect());
