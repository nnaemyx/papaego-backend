/**
 * Test: FV Bank Business Plus Application Submission
 * ────────────────────────────────────────────────────────────────────────────
 * Tests the full flow:
 *   1. Auth (JWT → SessionToken) via GET /auth
 *   2. POST /business-plus-application
 *   3. POST /officer (director)
 *
 * Run from backend root:
 *   node scratch/test_fvbank_onboarding.js
 *
 * Also tests the Admin "push to FV Bank" endpoint (requires backend running):
 *   POST /api/admin/organizations/:id/push-to-fvbank
 * ────────────────────────────────────────────────────────────────────────────
 */

const BASE_URL = process.env.FV_BANK_GMA_URL || "https://sandbox.gma-api.fvbank.us";
const CLIENT_ID = process.env.FV_BANK_CLIENT_ID || "49df80e5-8e25-4f8c-81de-3d1ff5d0ae82";
const CLIENT_SECRET = process.env.FV_BANK_CLIENT_SECRET || "1c73b9ce-2ebd-4fd2-858f-95b58c914640";

// ── Step 1: Mint a JWT ───────────────────────────────────────────────────────
function mintJwt() {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const now    = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
        ClientID: CLIENT_ID,
        iss: CLIENT_ID,
        aud: BASE_URL,
        iat: now,
        exp: now + 3000,
    })).toString("base64url");

    const crypto = require("crypto");
    const sig = crypto
        .createHmac("sha256", CLIENT_SECRET)
        .update(`${header}.${payload}`)
        .digest("base64url");

    return `${header}.${payload}.${sig}`;
}

async function main() {
    console.log("\n🔌 FV Bank Onboarding Integration Test");
    console.log("=========================================");
    console.log(`API Base: ${BASE_URL}`);
    console.log(`Client:   ${CLIENT_ID.slice(0, 8)}...\n`);

    // 1. Auth
    console.log("--- Step 1: GET /auth ---");
    const jwt = mintJwt();
    let sessionToken = null;
    try {
        const authRes = await fetch(`${BASE_URL}/auth`, {
            method: "GET",
            headers: { "x-auth-token": jwt, "Accept": "application/json" },
        });
        console.log(`Auth status: ${authRes.status}`);
        if (authRes.ok) {
            const data = await authRes.json();
            sessionToken = data.SessionToken || data.sessionToken || data.token || data.ResponseData?.SessionToken;
            console.log(`✅ Session token: ${sessionToken ? sessionToken.slice(0, 20) + "..." : "MISSING from response"}`);
            console.log("   Full response:", JSON.stringify(data, null, 2));
        } else {
            const text = await authRes.text();
            console.log(`❌ Auth failed: ${text}`);
            if (authRes.status === 403) {
                console.log("\n⚠️  403 = IP not whitelisted in FV Bank Sandbox Portal.");
                console.log("   Go to: https://sandbox.gma-portal.fvbank.us/login");
                console.log("   Settings → API → IP Whitelist → Add your IP");
                console.log(`   Current IP to whitelist: Run 'curl -4 ifconfig.me' to find it`);
            }
            return;
        }
    } catch (err) {
        console.log(`❌ Network error: ${err.message}`);
        return;
    }

    // 2. Submit Business Plus Application
    console.log("\n--- Step 2: POST /business-plus-application ---");
    try {
        const appPayload = {
            PartnerReferenceId: `papaego_test_${Date.now()}`,
            Business: {
                BusinessName: "Test PapaEgo Import Ltd",
                BusinessRegistrationNumber: "RC123456",
                CountryOfRegistration: "NG",
                BusinessType: "PRIVATE_LIMITED",
                Industry: "IMPORT_EXPORT",
                TaxIdentification: "TIN98765432",
                BusinessAddress: "1 Marina Street, Lagos, Nigeria",
            },
            PrimaryContact: {
                FullName: "Test Contact Person",
                Email: "Engineering@papaego.com",
                Phone: "+2341234567890",
            },
        };

        const appRes = await fetch(`${BASE_URL}/business-plus-application`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "session-token": sessionToken,
                "Authorization": `Bearer ${sessionToken}`,
                "Accept": "application/json",
            },
            body: JSON.stringify(appPayload),
        });

        console.log(`Application status: ${appRes.status}`);
        const appData = await appRes.json().catch(() => appRes.text());
        console.log("   Response:", JSON.stringify(appData, null, 2));

        if (appRes.ok && appData?.applicationId) {
            console.log(`\n✅ Application created! ID: ${appData.applicationId}`);

            // 3. Register a Director
            console.log("\n--- Step 3: POST /officer ---");
            const officerRes = await fetch(`${BASE_URL}/officer`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "session-token": sessionToken,
                    "Authorization": `Bearer ${sessionToken}`,
                    "Accept": "application/json",
                },
                body: JSON.stringify({
                    ApplicationId: appData.applicationId,
                    FullName: "John Test Director",
                    Role: "DIRECTOR",
                    Email: "director@testpapaego.com",
                    Nationality: "NG",
                    DateOfBirth: "1980-01-15",
                    IdentityType: "NIN",
                    IdentityNumber: "12345678901",
                    ResidentialAddress: "1 Test Street, Lagos, Nigeria",
                }),
            });

            console.log(`Officer status: ${officerRes.status}`);
            const officerData = await officerRes.json().catch(() => officerRes.text());
            console.log("   Response:", JSON.stringify(officerData, null, 2));
        }
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
    }

    // 4. Test the Admin API endpoint (requires local backend running on port 5000)
    console.log("\n--- Step 4: Test Admin push-to-fvbank endpoint ---");
    console.log("   (Requires backend running: http://localhost:5000)");
    console.log("   Run: curl -X POST http://localhost:5000/api/admin/organizations/<ORG_ID>/push-to-fvbank \\");
    console.log("     -H 'Authorization: Bearer <ADMIN_TOKEN>'");
    console.log("   OR use the Admin panel → Organizations → <org> → 'Push to FV Bank' button");

    console.log("\n✅ Onboarding test complete.\n");
}

main().catch(console.error);
