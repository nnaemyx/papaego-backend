import prisma from "./src/config/db";

async function main() {
    const rates = [
        {
            pair: "USD/NGN",
            baseCurrency: "USD",
            quoteCurrency: "NGN",
            buy: 1600,
            sell: 1600,
            lastUpdated: new Date().toISOString(),
            isActive: true
        }
    ];

    await prisma.systemConfig.upsert({
        where: { key: "fx_rates" },
        update: { value: rates },
        create: { key: "fx_rates", value: rates }
    });

    console.log("✅ fx_rates config upserted successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
