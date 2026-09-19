import prisma from '../src/config/db';

async function main() {
  console.log("Searching for test IDs in AuditLog...");
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { action: { contains: "MONEYPINGS" } },
        { metadata: { path: ["moneypingsWebhookId"], equals: "whk_7c8ff531fd220c8d39e76af19afa18a7" } },
        { metadata: { path: ["moneypingsWebhookId"], equals: "whk_fb40a97082a6daaa4324d29d4326506a" } }
      ]
    },
    take: 20,
    orderBy: { createdAt: "desc" }
  });
  console.log("AuditLogs count:", logs.length);
  for (const l of logs) {
    console.log(`[${l.createdAt.toISOString()}] Action: ${l.action}, EntityId: ${l.entityId}, Metadata:`, JSON.stringify(l.metadata));
  }

  console.log("\nSearching for test IDs in DepositRequest...");
  const deposits = await prisma.depositRequest.findMany({
    where: {
      OR: [
        { method: "MONEYPINGS" },
        { reference: { contains: "whk_" } },
        { note: { contains: "MoneyPings" } }
      ]
    },
    take: 20,
    orderBy: { createdAt: "desc" }
  });
  console.log("DepositRequests count:", deposits.length);
  for (const d of deposits) {
    console.log(`[${d.createdAt.toISOString()}] Ref: ${d.reference}, Amount: ${d.amount}, Method: ${d.method}, Note: ${d.note}`);
  }

  console.log("\nSearching for test IDs in WalletTransaction...");
  const txs = await prisma.walletTransaction.findMany({
    where: {
      OR: [
        { description: { contains: "MoneyPings" } },
        { metadata: { path: ["moneypingsWebhookId"], equals: "whk_7c8ff531fd220c8d39e76af19afa18a7" } },
        { metadata: { path: ["moneypingsWebhookId"], equals: "whk_fb40a97082a6daaa4324d29d4326506a" } }
      ]
    },
    take: 20,
    orderBy: { createdAt: "desc" }
  });
  console.log("WalletTransactions count:", txs.length);
  for (const t of txs) {
    console.log(`[${t.createdAt.toISOString()}] Desc: ${t.description}, Amount: ${t.amount}, Metadata:`, JSON.stringify(t.metadata));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

