
import { Prisma } from '@prisma/client';

async function checkPrismaMetadata() {
  console.log('--- Prisma Metadata for Trade ---');
  // @ts-ignore
  const dmmf = Prisma.dmmf;
  const tradeModel = dmmf.datamodel.models.find((m: any) => m.name === 'Trade');
  if (tradeModel) {
    console.log('Fields in Trade:', tradeModel.fields.map((f: any) => f.name));
    console.log('Relations in Trade:', tradeModel.fields.filter((f: any) => f.kind === 'object').map((f: any) => f.name));
  } else {
    console.log('Trade model not found in DMMF');
  }
}

checkPrismaMetadata();
