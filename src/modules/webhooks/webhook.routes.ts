import { Router, Request, Response } from "express";
import prisma from "../../config/db";
import { verifyWebhook } from "./webhook.utils";

const router = Router();

router.post("/payment", async (req: Request, res: Response) => {
    const signature = req.headers["x-signature"] as string;
    const rawBody = (req as any).rawBody; // Need to ensure rawBody is available

    if (!verifyWebhook(rawBody, signature, process.env.PSP_SECRET!)) {
        return res.status(401).end();
    }

    const { tradeId } = req.body;

    await prisma.trade.update({
        where: { id: tradeId },
        data: { status: "PAYMENT_CONFIRMED" }
    });

    res.sendStatus(200);
});

export default router;
