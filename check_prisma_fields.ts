
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkTradeFields() {
  // @ts-ignore - used to access the model object itself
  const tradeModel = prisma.trade;
  console.log('Trade model exists:', !!tradeModel);
  
  // Try to create a dummy trade and see what it expects
  // (We don't actually run it, just check the types if we could, 
  // but as a script we can't do that easily without tsc)
  
  // Let's use Prisma.dmmf to check the schema
  // @ts-ignore
  const dmmf = prisma._baseClient._dmmf;
  const trade = dmmf.modelMap.Trade;
  console.log('Fields in Trade:', trade.fields.map((f: any) => f.name));
  
  const customer = dmmf.modelMap.Customer;
  console.log('Fields in Customer:', customer.fields.map((f: any) => f.name));
}

checkTradeFields().finally(() => prisma.$disconnect());
