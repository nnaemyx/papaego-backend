import crypto from "crypto";

export function verifyWebhook(payload: string, signature: string, secret: string) {
    const hash = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

    return hash === signature;
}
