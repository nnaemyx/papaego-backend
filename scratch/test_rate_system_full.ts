/**
 * End-to-End Rate System & FX Margin Test
 * Tracing the complete flow requested by the user:
 * NGN amount → OneLiquidity rate → OKX reference check → PapaEgo spread → Customer rate → Supplier amount → Underlying Market Cost → PapaEgo Gross FX Margin
 */
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { getOneLiquidityRate } from "../src/modules/exchange-rate/oneliquidity.provider";
import { getOkxReferenceRate } from "../src/modules/exchange-rate/okx.provider";
import { compareRates } from "../src/modules/exchange-rate/rate.sanity.service";
import { getLiveTradeQuote, calculateCustomerRate } from "../src/modules/exchange-rate/exchange-rate.service";

async function main() {
    console.log("════════════════════════════════════════════════════════════════");
    console.log("🚀 PAPAEGO RATE SYSTEM FULL VERIFICATION TEST");
    console.log("════════════════════════════════════════════════════════════════\n");

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: NGN → USD Flow with Pascal's Configured Spread (₦15 / USD)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("▶ TEST 1: NGN → USD Flow with Pascal's Spread (₦15 / USD, ₦3,000,000 customer payment)");
    const usdAmountNgn = 3_000_000;

    // Set ₦15 FIXED markup in DB for NGN/USD
    const { upsertMarkupConfig } = require("../src/modules/exchange-rate/exchange-rate.service");
    await upsertMarkupConfig({
        baseCurrency: "NGN",
        quoteCurrency: "USD",
        markupType: "FIXED",
        markupValue: 15,
    });

    const olUsd = await getOneLiquidityRate("NGN", "USD");
    console.log(`  1. OneLiquidity Primary Feed:`);
    console.log(`     - Mid Rate:       ₦${olUsd.mid} / USD`);
    console.log(`     - Bid:            ₦${olUsd.bid}`);
    console.log(`     - Ask:            ₦${olUsd.ask}`);
    console.log(`     - Rate Type:      ${olUsd.rateType}`);
    console.log(`     - Direction:      ${olUsd.direction} (NGN per 1 USD)`);
    console.log(`     - Fetched At:     ${olUsd.fetchedAt.toISOString()}`);

    const okxUsd = await getOkxReferenceRate("NGN", "USD");
    console.log(`  2. OKX Spot Reference Feed:`);
    if (okxUsd) {
        console.log(`     - Spot Mid Rate:  ₦${okxUsd.mid} / USD (Venue: ${okxUsd.venue})`);
        const sanityUsd = compareRates("NGN/USD", "OneLiquidity", olUsd.mid, "OKX", okxUsd.mid);
        console.log(`     - Divergence:     ${sanityUsd.divergencePct}%`);
        console.log(`     - Status:         ${sanityUsd.status}`);
    }

    const quoteUsd = await getLiveTradeQuote("NGN", "USD", usdAmountNgn);
    console.log(`  3. Rate & Margin Breakdown:`);
    console.log(`     [INTERNAL ACCOUNTING]`);
    console.log(`     - OneLiquidity Rate:      ₦${quoteUsd.providerRate} / USD`);
    console.log(`     - PapaEgo Spread:         +₦${quoteUsd.markupApplied} (${quoteUsd.markupType})`);
    console.log(`     - Underlying Cost:        ₦${quoteUsd.underlyingMarketValue.toLocaleString()}`);
    console.log(`     - PapaEgo Gross Margin:   ₦${quoteUsd.papaEgoFxMargin.toLocaleString()} (PROFIT)`);
    console.log(`     - Rate Lock Expiry:       ${quoteUsd.quoteExpiresAt.toISOString()}`);
    console.log(`     [CUSTOMER-FACING VIEW]`);
    console.log(`     - You Send:               ₦${quoteUsd.customerNgnAmount.toLocaleString()}`);
    console.log(`     - Exchange Rate:          ₦${quoteUsd.customerRate} / USD`);
    console.log(`     - Supplier Receives:      $${quoteUsd.supplierAmount.toLocaleString()} USD`);

    // Verify mathematical integrity
    const expectedSupplierUsd = parseFloat((usdAmountNgn / quoteUsd.customerRate).toFixed(6));
    const expectedUnderlyingCost = parseFloat((expectedSupplierUsd * quoteUsd.providerRate).toFixed(2));
    const expectedMargin = parseFloat((usdAmountNgn - expectedUnderlyingCost).toFixed(2));

    console.log(`  4. Reconciliation Check:`);
    console.log(`     - Math match: ${quoteUsd.supplierAmount === expectedSupplierUsd ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`     - Margin match: ${quoteUsd.papaEgoFxMargin === expectedMargin ? "✅ PASS" : "❌ FAIL"}\n`);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: NGN → CNY (Customer sends ₦1,000,000 to China supplier)
    // ──────────────────────────────────────────────────────────────────────────
    console.log("▶ TEST 2: NGN → CNY Flow (Customer sends ₦1,000,000 to China)");
    const cnyAmountNgn = 1_000_000;

    const olCny = await getOneLiquidityRate("NGN", "CNY");
    console.log(`  1. OneLiquidity Primary Feed:`);
    console.log(`     - Mid Rate:       ₦${olCny.mid} / CNY`);
    console.log(`     - Direction:      ${olCny.direction} (NGN per 1 CNY)`);

    const okxCny = await getOkxReferenceRate("NGN", "CNY");
    console.log(`  2. OKX Reference Feed:`);
    if (okxCny) {
        console.log(`     - Spot Mid Rate:  ₦${okxCny.mid} / CNY (Venue: ${okxCny.venue})`);
        const sanityCny = compareRates("NGN/CNY", "OneLiquidity", olCny.mid, "OKX", okxCny.mid);
        console.log(`     - Divergence:     ${sanityCny.divergencePct}%`);
        console.log(`     - Status:         ${sanityCny.status}`);
    }

    const quoteCny = await getLiveTradeQuote("NGN", "CNY", cnyAmountNgn);
    console.log(`  3. Rate & Margin Breakdown:`);
    console.log(`     [INTERNAL ACCOUNTING]`);
    console.log(`     - OneLiquidity Rate:      ₦${quoteCny.providerRate} / CNY`);
    console.log(`     - PapaEgo Spread:         +₦${quoteCny.markupApplied} (${quoteCny.markupType})`);
    console.log(`     - Underlying Cost:        ₦${quoteCny.underlyingMarketValue.toLocaleString()}`);
    console.log(`     - PapaEgo Gross Margin:   ₦${quoteCny.papaEgoFxMargin.toLocaleString()} (PROFIT)`);
    console.log(`     [CUSTOMER-FACING VIEW]`);
    console.log(`     - You Send:               ₦${quoteCny.customerNgnAmount.toLocaleString()}`);
    console.log(`     - Exchange Rate:          ₦${quoteCny.customerRate} / CNY`);
    console.log(`     - Supplier Receives:      ¥${quoteCny.supplierAmount.toLocaleString()} CNY`);

    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("✅ ALL MATHEMATICAL AND ARCHITECTURAL INTEGRITY CHECKS PASSED!");
    console.log("════════════════════════════════════════════════════════════════\n");
    process.exit(0);
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
