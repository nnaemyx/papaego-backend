import { Router, Request, Response } from "express";
import crypto from "crypto";
import prisma from "../../config/db";
import { verifyWebhook } from "./webhook.utils";
import { creditWallet } from "../wallet/wallet.service";

const router = Router();

// Paystack automated server-to-server webhook
router.post("/paystack", async (req: Request, res: Response) => {
    try {
        const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
        const signature = (req.headers["x-paystack-signature"] as string) || "";
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);

        // Verify cryptographic signature if secret key is set
        if (paystackSecret && !paystackSecret.includes("placeholder")) {
            const hash = crypto
                .createHmac("sha512", paystackSecret)
                .update(rawBody)
                .digest("hex");

            if (hash !== signature) {
                console.warn("[Paystack Webhook] Invalid signature received.");
                return res.status(401).json({ error: "Invalid signature" });
            }
        }

        const event = req.body?.event;
        const data = req.body?.data;

        // Respond immediately with 200 OK to acknowledge receipt
        if (event !== "charge.success" || !data) {
            return res.status(200).json({ received: true, ignored: true });
        }

        const reference = data.reference;
        const amountInNgn = Number(data.amount) / 100; // Paystack amounts are in kobo
        const customerEmail = data.customer?.email;
        const metadataCustomerId = data.metadata?.customerId;

        if (!reference || isNaN(amountInNgn) || amountInNgn <= 0) {
            return res.status(200).json({ received: true, error: "Invalid payload parameters" });
        }

        // 1. Check idempotency: Has this reference already been credited?
        const existingTx = await prisma.walletTransaction.findFirst({
            where: {
                OR: [
                    { description: { contains: reference } },
                    { metadata: { path: ["reference"], equals: reference } }
                ]
            }
        });

        if (existingTx) {
            console.log(`[Paystack Webhook] Reference ${reference} already credited. Skipping.`);
            return res.status(200).json({ received: true, alreadyProcessed: true });
        }

        // 2. Find target customer
        let customer = null;
        if (metadataCustomerId) {
            customer = await prisma.customer.findUnique({ where: { id: metadataCustomerId } });
        }
        if (!customer && customerEmail) {
            customer = await prisma.customer.findFirst({
                where: {
                    OR: [
                        { email: customerEmail },
                        { user: { email: customerEmail } }
                    ]
                },
                include: { user: true }
            });
        }

        if (!customer) {
            console.warn(`[Paystack Webhook] Could not find customer for payment reference ${reference} (Email: ${customerEmail})`);
            return res.status(200).json({ received: true, error: "Customer not found" });
        }

        // 3. Credit customer ledger wallet
        const updatedWallet = await creditWallet(
            customer.id,
            amountInNgn,
            "DEPOSIT",
            {
                description: `Paystack Deposit (${reference})`,
                actorId: customer.userId || "SYSTEM",
                metadata: {
                    reference,
                    channel: "PAYSTACK_WEBHOOK",
                    verifiedAt: new Date().toISOString(),
                    paystackId: data.id,
                    gatewayResponse: data.gateway_response
                }
            }
        );

        // 4. Create Audit Log for admin and compliance tracking
        await prisma.auditLog.create({
            data: {
                actorId: customer.userId || customer.id,
                role: "ADMIN",
                action: "PAYSTACK_WEBHOOK_DEPOSIT_CREDITED",
                entity: "CustomerWallet",
                entityId: updatedWallet.id,
                ip: req.ip || "127.0.0.1",
                metadata: {
                    reference,
                    amount: amountInNgn,
                    channel: "PAYSTACK_WEBHOOK",
                    customerEmail: customerEmail || customer.email
                }
            }
        });

        console.log(`[Paystack Webhook] Successfully credited NGN ${amountInNgn.toLocaleString()} to customer ${customer.id} (Ref: ${reference})`);
        return res.status(200).json({ received: true, status: "credited" });
    } catch (err: any) {
        console.error("[Paystack Webhook] Error processing event:", err);
        return res.status(500).json({ error: "Internal processing error" });
    }
});

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

