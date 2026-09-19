import crypto from "crypto";
import app from "../src/app";
import http from "http";

async function runTests() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = process.env.MONEYPINGS_WEBHOOK_SECRET || "whsec_9150a8620b22cdac2d1623ac183b62696ce54f4668874a9e";

  console.log(`Testing MoneyPings webhook security on ${baseUrl}...`);

  // Test 1: Missing signature
  const res1 = await fetch(`${baseUrl}/api/webhooks/moneypings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "webhook.test", id: "whk_fake1" })
  });
  console.log("Test 1 (Missing signature) -> Status:", res1.status, await res1.json());
  if (res1.status !== 401) throw new Error(`Test 1 Failed! Expected 401, got ${res1.status}`);

  // Test 2: Fake signature (Wrong signature)
  const res2 = await fetch(`${baseUrl}/api/webhooks/moneypings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": "fake_invalid_signature_1234567890abcdef",
      "X-Webhook-Id": "whk_fake2"
    },
    body: JSON.stringify({ event: "webhook.test", id: "whk_fake2" })
  });
  console.log("Test 2 (Fake signature) -> Status:", res2.status, await res2.json());
  if (res2.status !== 401) throw new Error(`Test 2 Failed! Expected 401, got ${res2.status}`);

  // Test 3: Test via /hooks/moneypings alias with fake signature
  const res3 = await fetch(`${baseUrl}/hooks/moneypings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": "another_bad_signature_0000000000000000",
      "X-Webhook-Id": "whk_fake3"
    },
    body: JSON.stringify({ event: "webhook.test", id: "whk_fake3" })
  });
  console.log("Test 3 (Alias /hooks with fake sig) -> Status:", res3.status, await res3.json());
  if (res3.status !== 401) throw new Error(`Test 3 Failed! Expected 401, got ${res3.status}`);

  // Test 4: Valid signature with test event (e.g. Tim's test whk_7c8ff531fd220c8d39e76af19afa18a7)
  const testPayload = JSON.stringify({
    event: "webhook.test",
    id: "whk_7c8ff531fd220c8d39e76af19afa18a7",
    timestamp: "2026-09-18T16:33:00.000Z",
    data: { test: true, message: "Test delivery" }
  });
  const validSig = crypto.createHmac("sha256", secret).update(testPayload).digest("hex");

  const res4 = await fetch(`${baseUrl}/api/webhooks/moneypings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": validSig,
      "X-Webhook-Id": "whk_7c8ff531fd220c8d39e76af19afa18a7",
      "X-Webhook-Event": "webhook.test"
    },
    body: testPayload
  });
  console.log("Test 4 (Valid signature) -> Status:", res4.status, await res4.json());
  if (res4.status !== 200) throw new Error(`Test 4 Failed! Expected 200, got ${res4.status}`);

  server.close();
  console.log("\n✅ ALL WEBHOOK SECURITY TESTS PASSED PERFECTLY!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});

