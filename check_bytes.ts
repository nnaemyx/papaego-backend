
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkEmailBytes() {
  const email = 'johnpauledeh27@gmail.com';
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } }
  });
  
  if (user && user.email) {
    console.log('Email in DB:', user.email);
    console.log('Bytes:', Buffer.from(user.email).toString('hex'));
    console.log('Expected Bytes:', Buffer.from(email).toString('hex'));
  } else {
    console.log('User not found in DB with that email (even insensitive)');
    // Try partial match to find it
    const partial = await prisma.user.findMany({
        where: { email: { contains: 'johnpauledeh' } }
    });
    console.log('Partial results:', partial.map(p => ({ email: p.email, bytes: p.email ? Buffer.from(p.email).toString('hex') : '' })));
  }
}

checkEmailBytes().finally(() => prisma.$disconnect());
