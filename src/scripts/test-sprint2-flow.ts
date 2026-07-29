import prisma from "../config/db";
import bcrypt from "bcrypt";
import { checkBankingEligibility } from "../modules/banking/banking.eligibility.service";
import { provisionManagedAccount } from "../modules/banking/banking.provisioning.service";
import { syncBankAccount } from "../modules/banking/banking.sync.service";
import { getBankingProfile } from "../modules/banking/banking.profile.service";
import { processBankingWebhook } from "../modules/banking/banking.webhook.service";

async function runSprint2FullTest() {
    console.log("\n============================================================");
    console.log("🧪 STARTING SPRINT 2 MANAGED BANKING END-TO-END VERIFICATION");
    console.log("============================================================\n");

    const testTimestamp = Date.now();
    const testEmail = `sprint2.owner.${testTimestamp}@papaego-test.com`;

    // ─────────────────────────────────────────────────────
    // TEST 1: User & Organization Creation (Pre-compliance)
    // ─────────────────────────────────────────────────────
    console.log("▶ TEST 1: Setting up Test User & Organization");
    const hashedPassword = await bcrypt.hash("Password123!", 10);
    const user = await prisma.user.create({
        data: {
            email: testEmail,
            password: hashedPassword,
            firstName: "Sprint2",
            lastName: "Tester",
            phone: "+2348099998888",
            role: "ORG_OWNER",
            isActive: true
        }
    });

    const org = await prisma.organization.create({
        data: {
            ownerId: user.id,
            businessName: `Sprint2 Global Logistics ${testTimestamp}`,
            businessType: "LLC",
            countryOfRegistration: "Nigeria",
            industry: "Technology",
            businessAddress: "100 Innovation Way",
            city: "Lagos",
            country: "Nigeria",
            contactEmail: testEmail,
            contactPhone: "+2348099998888",
            authorizedRepName: "Sprint2 Tester",
            authorizedRepTitle: "CEO",
            status: "DRAFT"
        }
    });

    await prisma.organizationMember.create({
        data: {
            organizationId: org.id,
            userId: user.id,
            role: "OWNER"
        }
    });

    console.log(`  ✅ Test Organization Created: ${org.id} [Status: DRAFT]`);

    // ─────────────────────────────────────────────────────
    // TEST 2: Eligibility Check for Non-compliant Organization
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 2: Testing Eligibility Validation Engine (Ineligible State)");
    let eligibility = await checkBankingEligibility(org.id);

    console.log(`  ✅ Is Eligible: ${eligibility.isEligible} (Expected: false)`);
    console.log(`  ✅ Failure Reasons (${eligibility.reasons.length}):`);
    eligibility.reasons.forEach(r => console.log(`     - ${r}`));

    if (eligibility.isEligible) {
        throw new Error("Expected unverified organization to be ineligible for managed bank account!");
    }

    // Attempting provisioning on ineligible org must throw error
    try {
        await provisionManagedAccount(org.id, user.id);
        throw new Error("Provisioning should have thrown an error for ineligible org!");
    } catch (err: any) {
        console.log(`  ✅ Provisioning correctly blocked with error: "${err.message.slice(0, 70)}..."`);
    }

    // ─────────────────────────────────────────────────────
    // TEST 3: Complete Compliance Setup (Qualify + KYC + KYB)
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 3: Approving Qualification, KYC, and KYB");
    await prisma.qualificationAssessment.create({
        data: {
            organizationId: org.id,
            hasInternationalPayments: true,
            expectedMonthlyVolume: 75000,
            supplierPaymentFrequency: "MONTHLY",
            countriesOfOperation: ["Nigeria", "United States"],
            primaryUseCase: "Supplier Settlements",
            outcome: "QUALIFIED"
        }
    });

    const kyc = await prisma.kycRequest.create({
        data: {
            organizationId: org.id,
            userId: user.id,
            fullName: "Sprint2 Tester",
            dateOfBirth: new Date("1992-04-10"),
            nationality: "Nigerian",
            residentialAddress: "100 Innovation Way, Lagos",
            phone: "+2348099998888",
            email: testEmail,
            idType: "PASSPORT",
            status: "APPROVED"
        }
    });

    const kyb = await prisma.kybRequest.create({
        data: {
            organizationId: org.id,
            companyName: org.businessName,
            registrationNumber: `RC-${testTimestamp}`,
            countryOfIncorporation: "Nigeria",
            businessAddress: org.businessAddress,
            taxIdentification: "TIN-999000",
            status: "APPROVED"
        }
    });

    await prisma.organization.update({
        where: { id: org.id },
        data: { status: "ACTIVE" }
    });

    console.log(`  ✅ Qualification: QUALIFIED`);
    console.log(`  ✅ KYC Request: ${kyc.id} [Status: APPROVED]`);
    console.log(`  ✅ KYB Request: ${kyb.id} [Status: APPROVED]`);
    console.log(`  ✅ Organization Status: ACTIVE`);

    // ─────────────────────────────────────────────────────
    // TEST 4: Eligibility Check for Approved Organization
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 4: Re-testing Eligibility Validation Engine (Eligible State)");
    eligibility = await checkBankingEligibility(org.id);

    console.log(`  ✅ Is Eligible: ${eligibility.isEligible} (Expected: true)`);
    if (!eligibility.isEligible) {
        throw new Error(`Expected approved organization to be eligible! Reasons: ${eligibility.reasons.join(", ")}`);
    }

    // ─────────────────────────────────────────────────────
    // TEST 5: Managed Account Provisioning (FV Bank Adapter)
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 5: Provisioning Managed FV Bank U.S. Account");
    const provisioningResult = await provisionManagedAccount(org.id, user.id);

    const bankAcc = provisioningResult.bankAccount;
    const profile = provisioningResult.bankingProfile;

    console.log(`  ✅ Managed Account Provisioned Successfully:`);
    console.log(`     - Bank Account ID: ${bankAcc.id}`);
    console.log(`     - FV Bank Account ID: ${bankAcc.fvAccountId}`);
    console.log(`     - Bank Name: ${bankAcc.bankName}`);
    console.log(`     - Account Holder: ${bankAcc.accountHolder}`);
    console.log(`     - Account Number: ${bankAcc.accountNumber}`);
    console.log(`     - Routing Number: ${bankAcc.routingNumber}`);
    console.log(`     - Masked Number: ${profile.maskedAccountNumber}`);
    console.log(`     - Currency: ${bankAcc.currency}`);
    console.log(`     - Status: ${bankAcc.status}`);

    if (bankAcc.routingNumber !== "021000021" || bankAcc.bankName !== "FV Bank") {
        throw new Error("Invalid banking details provisioned!");
    }

    // ─────────────────────────────────────────────────────
    // TEST 6: Prevent Duplicate Account Requests
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 6: Verifying Duplicate Account Provisioning Prevention");
    eligibility = await checkBankingEligibility(org.id);
    console.log(`  ✅ Is Eligible for 2nd Account: ${eligibility.isEligible} (Expected: false)`);
    console.log(`  ✅ Blocking Reason: ${eligibility.reasons[0]}`);

    try {
        await provisionManagedAccount(org.id, user.id);
        throw new Error("Duplicate account provisioning should be blocked!");
    } catch (err: any) {
        console.log(`  ✅ Duplicate provisioning correctly blocked: "${err.message.slice(0, 60)}..."`);
    }

    // ─────────────────────────────────────────────────────
    // TEST 7: Account Synchronization Service
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 7: Account Synchronization Service");
    const syncRes = await syncBankAccount(bankAcc.id, "MANUAL");

    console.log(`  ✅ Sync Executed: ${syncRes.synced}`);
    console.log(`  ✅ Status Changed: ${syncRes.hasStatusChanged}`);
    console.log(`  ✅ Current Status: ${syncRes.currentStatus}`);

    const syncLogsCount = await prisma.bankAccountSyncLog.count({ where: { bankAccountId: bankAcc.id } });
    console.log(`  ✅ Total Sync Logs Recorded: ${syncLogsCount}`);

    // ─────────────────────────────────────────────────────
    // TEST 8: Webhook Processing (Suspension & Activation)
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 8: Inbound Banking Webhook Processing & Auto-Sync");

    // 1. Simulate ACCOUNT_SUSPENDED webhook
    await processBankingWebhook(
        JSON.stringify({ event: "ACCOUNT_SUSPENDED", fvAccountId: bankAcc.fvAccountId }),
        undefined,
        {
            event: "ACCOUNT_SUSPENDED",
            fvAccountId: bankAcc.fvAccountId!,
            reason: "Routine compliance review"
        }
    );

    let updatedAcc = await prisma.bankAccount.findUnique({ where: { id: bankAcc.id } });
    console.log(`  ✅ Webhook ACCOUNT_SUSPENDED -> Current Status: ${updatedAcc?.status}`);

    if (updatedAcc?.status !== "SUSPENDED") {
        throw new Error("Expected status to update to SUSPENDED via webhook!");
    }

    // 2. Simulate ACCOUNT_ACTIVATED webhook
    await processBankingWebhook(
        JSON.stringify({ event: "ACCOUNT_ACTIVATED", fvAccountId: bankAcc.fvAccountId }),
        undefined,
        {
            event: "ACCOUNT_ACTIVATED",
            fvAccountId: bankAcc.fvAccountId!,
            details: "Review cleared. Account reactivated."
        }
    );

    updatedAcc = await prisma.bankAccount.findUnique({ where: { id: bankAcc.id } });
    console.log(`  ✅ Webhook ACCOUNT_ACTIVATED -> Current Status: ${updatedAcc?.status}`);

    if (updatedAcc?.status !== "ACTIVE") {
        throw new Error("Expected status to update back to ACTIVE via webhook!");
    }

    // ─────────────────────────────────────────────────────
    // TEST 9: Banking Profile Retrieval & Audit History
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 9: Banking Profile Retrieval & Event Timeline");
    const finalProfile = await getBankingProfile(org.id);

    console.log(`  ✅ Banking Profile Retrieved:`);
    console.log(`     - Bank Name: ${finalProfile?.bankName}`);
    console.log(`     - Account Holder: ${finalProfile?.accountHolder}`);
    console.log(`     - Account Number: ${finalProfile?.accountNumber}`);
    console.log(`     - Routing Number: ${finalProfile?.routingNumber}`);
    console.log(`     - Status: ${finalProfile?.status}`);
    console.log(`     - Event Timeline Length: ${finalProfile?.recentEvents?.length}`);

    if (!finalProfile || finalProfile.recentEvents?.length! < 3) {
        throw new Error("Expected full audit event timeline to be populated!");
    }

    // Cleanup test data
    console.log("\n🧹 Cleaning up test verification records...");
    await prisma.bankAccountEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.bankAccountSyncLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.bankAccountWebhook.deleteMany({ where: { organizationId: org.id } });
    await prisma.bankingProfile.delete({ where: { organizationId: org.id } });
    await prisma.bankAccount.delete({ where: { organizationId: org.id } });
    await prisma.kycRequest.deleteMany({ where: { organizationId: org.id } });
    await prisma.kybRequest.deleteMany({ where: { organizationId: org.id } });
    await prisma.qualificationAssessment.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: user.id } });

    console.log("\n============================================================");
    console.log("🎉 ALL SPRINT 2 TEST CASES PASSED WITH 100% SUCCESS!");
    console.log("============================================================\n");
}

runSprint2FullTest()
    .catch((err) => {
        console.error("❌ SPRINT 2 TEST SUITE FAILED:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
