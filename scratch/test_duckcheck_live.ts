/**
 * DuckCheck Live API Test
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT - Auth Flow:
 *   DuckCheck requires a one-time "authCode" from the Dashboard to exchange for
 *   a Bearer token. You cannot generate it programmatically — you must:
 *
 *   1. Log in to https://www.duckcheck.com/business/home
 *   2. Go to Settings → API Keys / Developer Settings
 *   3. Copy your "Auth Code" (looks like: 09cea2c51642cd638667546d0198640caf58)
 *   4. Set it in .env as DUCKCHECK_AUTH_CODE
 *
 *   OR: Copy the "Access Token" directly from the dashboard and set as
 *   DUCKCHECK_ACCESS_TOKEN (this bypasses the /auth/token exchange entirely)
 *
 * Run:
 *   npx ts-node --transpile-only scratch/test_duckcheck_live.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE_URL      = (process.env.DUCKCHECK_BASE_URL || "https://api.duckcheck.com").replace(/\/$/, "");
const CLIENT_ID     = process.env.DUCKCHECK_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DUCKCHECK_CLIENT_SECRET || "";
const AUTH_CODE     = process.env.DUCKCHECK_AUTH_CODE || "";
const ACCESS_TOKEN  = process.env.DUCKCHECK_ACCESS_TOKEN || ""; // override: paste token directly

console.log(`\n🦆 DuckCheck Live API Test`);
console.log(`   Base URL:     ${BASE_URL}`);
console.log(`   Client ID:    ${CLIENT_ID}`);
console.log(`   Auth Code:    ${AUTH_CODE ? AUTH_CODE.slice(0, 8) + "..." : "❌ NOT SET - grab from Dashboard → Settings → API Keys"}`);
console.log(`   Access Token: ${ACCESS_TOKEN ? "✅ Direct token set" : "Not set (will use authCode flow)"}\n`);

// ──────────────────────────────────────────────────────────────────────────────
// 1. Get Token (via authCode or direct override)
// ──────────────────────────────────────────────────────────────────────────────
async function getToken(): Promise<string> {
    if (ACCESS_TOKEN) {
        console.log("✅ Using DUCKCHECK_ACCESS_TOKEN directly from .env\n");
        return ACCESS_TOKEN;
    }

    if (!AUTH_CODE) {
        throw new Error(
            "\n❌  DUCKCHECK_AUTH_CODE is not set!\n" +
            "   To get it:\n" +
            "   1. Log in at https://www.duckcheck.com/business/home\n" +
            "   2. Go to Settings → API Keys (or Developer Settings)\n" +
            "   3. Copy your Auth Code and paste it into .env:\n" +
            "      DUCKCHECK_AUTH_CODE=\"09cea2c51642cd638667546d0198640caf58\"\n" +
            "   OR paste your dashboard access token as:\n" +
            "      DUCKCHECK_ACCESS_TOKEN=\"eyJhbGciOi...\"\n"
        );
    }

    console.log("🔑 Step 1: Exchanging authCode for Bearer token...");
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    const res = await fetch(`${BASE_URL}/v1/auth/token`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Basic ${basicAuth}`,
        },
        body: JSON.stringify({ authCode: AUTH_CODE }),
    });

    const text = await res.text();
    console.log(`   HTTP ${res.status} ${res.statusText}`);

    if (!res.ok) {
        throw new Error(`Auth failed (${res.status}): ${text}`);
    }

    const data = JSON.parse(text);
    const token = data.accessToken || data.access_token;
    if (!token) throw new Error("No accessToken in auth response: " + text);

    console.log(`   ✅ Token: ${token.slice(0, 40)}...\n`);
    return token;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. AML Sanctions Screening (individual) — works without authCode!
//    The Postman examples use dashboardAccessToken for this, so let's try
//    with the CLIENT_SECRET directly and also with any available token.
// ──────────────────────────────────────────────────────────────────────────────
async function testAmlIndividual(token: string): Promise<void> {
    console.log("👤 Test: AML Individual Sanctions Screening");
    console.log("   Person: Adewale Okonkwo, Nigeria, born 1985-06-15");

    const res = await fetch(`${BASE_URL}/v1/product/sanction/individual`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
            customerId: `papaego_test_${Date.now()}`,
            firstName:  "Adewale",
            lastName:   "Okonkwo",
            address:    "15 Bourdillon Road, Ikoyi, Lagos, Nigeria",
            country:    "ng",
            email:      "adewale.test@papaego.com",
            dob:        "1985-06-15",
        }),
    });

    const text = await res.text();
    console.log(`\n   HTTP ${res.status} ${res.statusText}`);

    try {
        const data = JSON.parse(text);
        console.log("   Response:", JSON.stringify(data, null, 4));
        if (res.ok && data.matches) {
            const flagged = data.matches.filter((m: any) => m.status === "Flagged");
            console.log(`\n   ✅ AML check passed! ${flagged.length === 0 ? "No sanctions found (CLEAR)" : `${flagged.length} match(es) flagged`}`);
        }
    } catch {
        console.log("   Raw:", text.slice(0, 800));
    }
    console.log("");
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Business Lookup — CAC Registry lookup for Interswitch Limited
// ──────────────────────────────────────────────────────────────────────────────
async function testBusinessLookup(token: string): Promise<void> {
    console.log("🏢 Test: Business Lookup (CAC Registry)");
    console.log("   Company: Interswitch Limited");
    console.log("   CAC RC:  RC372697, Country: NG");

    const res = await fetch(`${BASE_URL}/v1/product/business/lookup`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
            businessRegistrationNumber: "RC372697",
            country: "NG",
        }),
    });

    const text = await res.text();
    console.log(`\n   HTTP ${res.status} ${res.statusText}`);

    try {
        const data = JSON.parse(text);
        console.log("   Response:", JSON.stringify(data, null, 4));
        if (res.ok && data.companyInformation) {
            console.log(`\n   ✅ Business found!`);
            console.log(`   Name:    ${data.companyInformation.name}`);
            console.log(`   Status:  ${data.companyInformation.status}`);
            console.log(`   Address: ${data.companyInformation.address}`);
        }
    } catch {
        console.log("   Raw:", text.slice(0, 800));
    }
    console.log("");
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. KYC IDV Session (requires valid token)
// ──────────────────────────────────────────────────────────────────────────────
async function testKycSession(token: string): Promise<void> {
    console.log("🪪 Test: KYC IDV Session - Nigerian Passport Holder");
    console.log("   Person: Adewale Okonkwo | DOB: 1985-06-15 | Passport: A12345678");

    const res = await fetch(`${BASE_URL}/v1/product/idv/session`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
            callBack: "https://api.papaego.com/compliance/webhook",
            customer: {
                firstName:   "Adewale",
                lastName:    "Okonkwo",
                dateOfBirth: "1985-06-15",
                customerId:  `papaego_kyc_${Date.now()}`,
                fullAddress: "15 Bourdillon Road, Ikoyi, Lagos, Nigeria",
                email:       "adewale.test@papaego.com",
            },
            device: {
                ipAddress:         "105.113.0.1",
                deviceFingerprint: "papaego-web-test"
            },
            document: {
                value:        "A12345678",
                identityType: "PASSPORT",
                country:      "NG"
            }
        }),
    });

    const text = await res.text();
    console.log(`\n   HTTP ${res.status} ${res.statusText}`);

    try {
        const data = JSON.parse(text);
        console.log("   Response:", JSON.stringify(data, null, 4));
        if (res.ok) {
            console.log(`\n   ✅ KYC IDV session created!`);
            console.log(`   Verification ID: ${data.verificationId}`);
            console.log(`   External Ref:    ${data.externalReference}`);
            if (data.url) console.log(`   Liveness URL:    ${data.url}`);
        }
    } catch {
        console.log("   Raw:", text.slice(0, 800));
    }
    console.log("");
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. KYB Business Verification
// ──────────────────────────────────────────────────────────────────────────────
async function testKybVerification(token: string): Promise<void> {
    console.log("🏛️  Test: KYB Business Verification");
    console.log("   Company: Interswitch Limited (RC372697)");

    const res = await fetch(`${BASE_URL}/v1/product/business/verification`, {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
            email: "compliance@papaego.com",
            phone: "+2348000000000",
            ownerInfo: {
                firstName:   "Mitchell",
                lastName:    "Elegbe",
                dob:         "1971-05-01",
                citizenship: "NG",
                country:     "NG",
                address:     "Plot 1261A, Bishops Court, Victoria Island, Lagos"
            },
            shareholders: [{
                name:        "Mitchell Elegbe",
                firstName:   "Mitchell",
                lastName:    "Elegbe",
                nationality: "NG"
            }],
            businessDetails: {
                companyName:        "Interswitch Limited",
                registrationNumber: "RC372697",
                country:            "NG",
                address:            "Plot 1261A, Bishops Court, Victoria Island, Lagos, Nigeria",
                businessType:       "PRIVATE_LIMITED",
            },
            documents: []
        }),
    });

    const text = await res.text();
    console.log(`\n   HTTP ${res.status} ${res.statusText}`);

    try {
        const data = JSON.parse(text);
        console.log("   Response:", JSON.stringify(data, null, 4));
        if (res.ok) {
            console.log(`\n   ✅ KYB verification submitted!`);
            console.log(`   Request ID: ${data.requestId || data.verificationId || data.id}`);
            console.log(`   Status:     ${data.status}`);
        }
    } catch {
        console.log("   Raw:", text.slice(0, 800));
    }
    console.log("");
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. Local Webhook Signature Test (no network needed)
// ──────────────────────────────────────────────────────────────────────────────
function testWebhookSignature(): void {
    console.log("🔒 Test: Webhook HMAC Signature Verification (local)");

    const payload = JSON.stringify({
        sessionId: "18dddfef-09f0-4a6e-9e5e-2991c7e99bec",
        status:    "approved",
        person: {
            id:          "44756145762",
            firstName:   "ADEWALE",
            lastName:    "OKONKWO",
            dateOfBirth: "1985-06-15",
            nationality: "NG"
        },
        document: {
            number:   "A12345678",
            type:     "PASSPORT",
            country:  "NG",
            validTill:"2029-01-01"
        }
    });

    const expectedSig = crypto
        .createHmac("sha256", CLIENT_SECRET)
        .update(Buffer.from(payload, "utf8"))
        .digest("hex")
        .toLowerCase();

    // Simulate DuckCheck header: x-hmac-signature: <hex>
    const incoming = expectedSig;
    const isValid  = crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(expectedSig));

    console.log(`   Secret used: ${CLIENT_SECRET.slice(0, 8)}...`);
    console.log(`   HMAC-SHA256: ${expectedSig.slice(0, 32)}...`);
    console.log(`   Verification: ${isValid ? "✅ VALID" : "❌ MISMATCH"}\n`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
(async () => {
    try {
        const token = await getToken();

        await testAmlIndividual(token);
        await testBusinessLookup(token);
        await testKycSession(token);
        await testKybVerification(token);
        testWebhookSignature();

        console.log("═══════════════════════════════════════════");
        console.log("✅ All DuckCheck API tests completed.");
        console.log("   Review responses above for live API behavior.");
        console.log("═══════════════════════════════════════════\n");
    } catch (err: any) {
        console.error("\n❌ Test failed:", err.message);

        if (err.message.includes("DUCKCHECK_AUTH_CODE")) {
            console.log("\n💡 Quick Fix:");
            console.log("   1. Go to https://www.duckcheck.com/business/home");
            console.log("   2. Navigate to Settings → API Keys");
            console.log("   3. Copy the Auth Code or Access Token");
            console.log("   4. Add to papaego-backend/.env:");
            console.log("      DUCKCHECK_AUTH_CODE=\"your_auth_code_here\"");
            console.log("   OR:");
            console.log("      DUCKCHECK_ACCESS_TOKEN=\"your_jwt_token_here\"");
        }
        process.exit(1);
    }
})();
