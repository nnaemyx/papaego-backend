import prisma from "../config/db";

export function startJobs() {
    setInterval(async () => {
        await prisma.trade.updateMany({
            where: {
                status: "QUOTED",
                lockedUntil: { lt: new Date() }
            },
            data: { status: "EXPIRED" }
        });
    }, 60000);
}
