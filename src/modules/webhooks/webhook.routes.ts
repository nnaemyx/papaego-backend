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

        // 4. Create a DepositRequest record so it appears on admin Deposits page
        const depositRecord = await prisma.depositRequest.create({
            data: {
                customerId: customer.id,
                amount: amountInNgn,
                currency: "NGN",
                method: "PAYSTACK",
                reference,
                note: `Auto-approved via Paystack webhook (Gateway: ${data.gateway_response || "success"})`,
                status: "APPROVED",
                creditedAmount: amountInNgn,
                reviewedBy: "SYSTEM",
                reviewedAt: new Date(),
            }
        });

        // 5. Create Audit Log for admin and compliance tracking
        await prisma.auditLog.create({
            data: {
                actorId: customer.userId || customer.id,
                role: "ADMIN",
                action: "PAYSTACK_WEBHOOK_DEPOSIT_CREDITED",
                entity: "DepositRequest",
                entityId: depositRecord.id,
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

// ─── MoneyPings server-to-server webhook ───────────────────────────────────
// MoneyPings signs every delivery with HMAC-SHA256 over the raw request body
// using the secret returned when you register your endpoint URL.
// The event to act on is "wallet.credited" — other events are acknowledged
// but not processed (collection.received, collection.confirmed, etc.).
router.post("/moneypings", async (req: Request, res: Response) => {
    try {
        const mpSecret = process.env.MONEYPINGS_WEBHOOK_SECRET;
        const rawSig = (
            (req.headers["x-webhook-signature"] as string) ||
            (req.headers["x-signature"] as string) ||
            (req.headers["x-moneypings-signature"] as string) ||
            (req.headers["signature"] as string) ||
            (req.headers["moneypings-signature"] as string) ||
            (req.headers["webhook-signature"] as string) ||
            ""
        ).trim();
        const sentSig = rawSig.replace(/^sha256=/, "").trim().toLowerCase();
        const webhookId = (req.headers["x-webhook-id"] as string) || (req.body?.id as string) || "";
        const webhookEvent = (req.headers["x-webhook-event"] as string) || req.body?.event || "";
        const webhookTimestamp = (req.headers["x-webhook-timestamp"] as string) || req.body?.timestamp || "";

        // 1. Mandatory Header Check: Signature must be present
        if (!sentSig) {
            console.warn(`[MoneyPings Webhook] Missing signature header. WebhookId: ${webhookId || "none"}. Headers:`, Object.keys(req.headers));
            return res.status(401).json({ error: "bad signature" });
        }

        // 2. Secret Configuration Check (fail-closed if secret missing)
        if (!mpSecret || mpSecret.includes("placeholder") || mpSecret.includes("your_moneypings")) {
            console.error("[MoneyPings Webhook] MONEYPINGS_WEBHOOK_SECRET is not configured on server.");
            return res.status(401).json({ error: "bad signature" });
        }

        // 3. Constant-time HMAC-SHA256 verification against raw body
        const rawBytes: Buffer = Buffer.isBuffer((req as any).rawBody)
            ? (req as any).rawBody
            : typeof (req as any).rawBody === "string"
            ? Buffer.from((req as any).rawBody, "utf8")
            : Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}), "utf8");

        const expectedSig = crypto
            .createHmac("sha256", mpSecret)
            .update(rawBytes)
            .digest("hex")
            .toLowerCase();

        const a = Buffer.from(sentSig, "utf8");
        const b = Buffer.from(expectedSig, "utf8");

        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            console.warn(`[MoneyPings Webhook] Invalid signature. ID: ${webhookId}, Sent: ${sentSig.substring(0, 10)}..., Expected: ${expectedSig.substring(0, 10)}..., BodyBytes: ${rawBytes.length}`);
            return res.status(401).json({ error: "bad signature" });
        }

        console.log(`[MoneyPings Webhook] Verified signature successfully. WebhookId: ${webhookId}, Event: ${webhookEvent}, Timestamp: ${webhookTimestamp}`);

        // Record verified webhook receipt in AuditLog for confirmation & audit trail
        await prisma.auditLog.create({
            data: {
                actorId: "SYSTEM",
                role: "ADMIN",
                action: "MONEYPINGS_WEBHOOK_DELIVERY_RECEIVED",
                entity: "WebhookDelivery",
                entityId: webhookId || "whk_unidentified",
                ip: req.ip || "moneypings",
                metadata: {
                    webhookId,
                    event: webhookEvent,
                    timestamp: webhookTimestamp,
                    verified: true
                }
            }
        }).catch(() => {});

        // Handle test events immediately (MoneyPings expects any 2xx response)
        const event = webhookEvent;
        if (event === "webhook.test" || req.body?.data?.test === true) {
            console.log(`[MoneyPings Webhook] Responded 200 OK to test event: ${webhookId}`);
            return res.status(200).json({ ok: true, received: true, test: true, message: "Test event acknowledged successfully" });
        }

        // 4. Acknowledge verified delivery quickly (MoneyPings times out after 10s)
        res.status(200).json({ ok: true });

        const data = req.body?.data;

        // 5. Only act on wallet.credited — ignore all other events
        if (event !== "wallet.credited" || !data) {
            console.log(`[MoneyPings Webhook] Acknowledged non-funding event: ${event} (ID: ${webhookId})`);
            return;
        }

        // 4. Idempotency — deduplicate by MoneyPings webhook ID (whk_…)
        if (webhookId) {
            const already = await prisma.walletTransaction.findFirst({
                where: {
                    metadata: { path: ["moneypingsWebhookId"], equals: webhookId }
                }
            });
            if (already) {
                console.log(`[MoneyPings Webhook] Duplicate delivery ${webhookId} — skipping.`);
                return;
            }
        }

        // 5. Parse amount — MoneyPings uses integer kobo in amount_minor
        const amountMinor: number = data.entry?.amount_minor ?? 0;
        const amountInNgn = amountMinor / 100;
        // external_reference is the Papa Ego customer ID we sent when creating the wallet
        const externalRef: string = data.external_reference ?? "";
        const walletRef: string = data.wallet_reference ?? "";
        const entryRef: string = data.entry?.reference ?? "";

        if (!amountMinor || amountInNgn <= 0) {
            console.warn("[MoneyPings Webhook] Missing or zero amount — ignoring.");
            return;
        }

        // 6. Find the Papa Ego customer
        // external_reference is set to our customerId when we open the MoneyPings wallet
        let customer = externalRef
            ? await prisma.customer.findUnique({ where: { id: externalRef } })
            : null;

        // Fallback: look up by stored walletRef in customer metadata
        if (!customer && walletRef) {
            customer = await prisma.customer.findFirst({
                where: {
                    metadata: { path: ["moneypingsWalletRef"], equals: walletRef }
                }
            });
        }

        if (!customer) {
            console.warn(`[MoneyPings Webhook] No customer found for external_reference=${externalRef} wallet=${walletRef}`);
            return;
        }

        // 7. Credit the internal ledger wallet
        const updatedWallet = await creditWallet(
            customer.id,
            amountInNgn,
            "DEPOSIT",
            {
                description: `MoneyPings Deposit (${entryRef || walletRef})`,
                actorId: customer.userId || "SYSTEM",
                metadata: {
                    reference: entryRef,
                    walletReference: walletRef,
                    externalReference: externalRef,
                    channel: "MONEYPINGS_WEBHOOK",
                    moneypingsWebhookId: webhookId,
                    verifiedAt: new Date().toISOString(),
                    narration: data.entry?.narration ?? ""
                }
            }
        );

        // 8. Create a DepositRequest record so it appears on the admin Deposits page
        const depositRecord = await prisma.depositRequest.create({
            data: {
                customerId: customer.id,
                amount: amountInNgn,
                currency: "NGN",
                method: "MONEYPINGS",
                reference: entryRef || webhookId,
                note: `Auto-approved via MoneyPings webhook (${data.entry?.narration ?? "wallet.credited"})`,
                status: "APPROVED",
                creditedAmount: amountInNgn,
                reviewedBy: "SYSTEM",
                reviewedAt: new Date(),
            }
        });

        // 9. Audit log
        await prisma.auditLog.create({
            data: {
                actorId: customer.userId || customer.id,
                role: "ADMIN",
                action: "MONEYPINGS_WEBHOOK_DEPOSIT_CREDITED",
                entity: "DepositRequest",
                entityId: depositRecord.id,
                ip: "webhook",
                metadata: {
                    reference: entryRef,
                    walletReference: walletRef,
                    amount: amountInNgn,
                    amountMinor,
                    channel: "MONEYPINGS_WEBHOOK",
                    moneypingsWebhookId: webhookId
                }
            }
        });

        console.log(`[MoneyPings Webhook] Credited NGN ${amountInNgn.toLocaleString()} to customer ${customer.id} (Entry: ${entryRef})`);
    } catch (err: any) {
        console.error("[MoneyPings Webhook] Error processing event:", err);
        // Response already sent — don't try to send again
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

