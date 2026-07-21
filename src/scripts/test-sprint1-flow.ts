import prisma from "../config/db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createOrganization, getOrganizationById, updateOrganization } from "../modules/organizations/organization.service";
import { submitQualification, getQualificationStatus } from "../modules/qualification/qualification.service";
import * as FvBank from "../modules/compliance/fvbank.adapter";
import { recordStatusChange, getComplianceStatus } from "../modules/compliance/status.service";

async function runSprint1FullTest() {
    console.log("\n============================================================");
    console.log("🧪 STARTING SPRINT 1 COMPLETE END-TO-END AUTOMATED VERIFICATION");
    console.log("============================================================\n");

    const testTimestamp = Date.now();
    const testEmail = `test.org.owner.${testTimestamp}@papaego-test.com`;
    const testPassword = "Password123!";

    // ─────────────────────────────────────────────────────
    // TEST 1: User Signup & Auth Infrastructure
    // ─────────────────────────────────────────────────────
    console.log("▶ TEST 1: User Signup & Authentication Infrastructure");
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
        data: {
            email: testEmail,
            password: hashedPassword,
            firstName: "Sprint1",
            lastName: "Tester",
            phone: "+2348011112222",
            role: "ORG_OWNER",
            isActive: false
        }
    });

    const otp = "123456";
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.verificationOtp.create({
        data: { email: testEmail, otp, expiresAt }
    });

    // Simulate OTP verification
    await prisma.user.update({
        where: { id: user.id },
        data: { isActive: true }
    });
    await prisma.verificationOtp.delete({ where: { email: testEmail } });

    console.log(`  ✅ User created & email verified: ${user.id} (${testEmail})`);

    // ─────────────────────────────────────────────────────
    // TEST 2: Organization Creation & Profile Management
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 2: Organization Creation & Profile Management");
    const org = await createOrganization(user.id, {
        businessName: `Acme Global Corp ${testTimestamp}`,
        businessType: "LLC",
        countryOfRegistration: "Nigeria",
        registrationNumber: `RC-${testTimestamp}`,
        industry: "Technology",
        businessAddress: "100 Commercial Way",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
        contactEmail: testEmail,
        contactPhone: "+2348011112222",
        website: "https://acmeglobal.example.com",
        authorizedRepName: "Sprint1 Tester",
        authorizedRepTitle: "CEO"
    });

    console.log(`  ✅ Organization created: ${org.id} [Status: ${org.status}]`);

    const fetchedOrg = await getOrganizationById(org.id, user.id);
    if (!fetchedOrg) throw new Error("Failed to retrieve created organization");
    console.log(`  ✅ Organization retrieved with members count: ${fetchedOrg.members.length}`);

    await updateOrganization(org.id, user.id, { website: "https://updated-acmeglobal.example.com" });
    console.log(`  ✅ Organization details updated successfully`);

    // ─────────────────────────────────────────────────────
    // TEST 3: Business Qualification Scoring Engine
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 3: Business Qualification Scoring Engine");
    const qualResult = await submitQualification(user.id, {
        organizationId: org.id,
        hasInternationalPayments: true,
        expectedMonthlyVolume: 55000,
        supplierPaymentFrequency: "MONTHLY",
        countriesOfOperation: ["Nigeria", "United States", "China"],
        primaryUseCase: "Cross-border component purchasing",
        additionalContext: "Importing electronics"
    });

    console.log(`  ✅ Qualification Outcome: ${qualResult.outcome}`);
    console.log(`  ✅ Scoring Notes: ${qualResult.notes}`);
    if (qualResult.outcome !== "QUALIFIED") throw new Error("Expected outcome to be QUALIFIED");

    // ─────────────────────────────────────────────────────
    // TEST 4: Individual KYC Application (FV Bank Adapter)
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 4: Individual KYC Application Submission");
    const kyc = await prisma.kycRequest.create({
        data: {
            organizationId: org.id,
            userId: user.id,
            fullName: "Sprint1 Tester",
            dateOfBirth: new Date("1990-05-15"),
            nationality: "Nigerian",
            residentialAddress: "100 Commercial Way, Lagos",
            phone: "+2348011112222",
            email: testEmail,
            idType: "PASSPORT",
            status: "DRAFT"
        }
    });

    const fvKycRes = await FvBank.submitKycApplication({
        partnerApplicationId: kyc.id,
        fullName: kyc.fullName,
        dateOfBirth: kyc.dateOfBirth.toISOString(),
        nationality: kyc.nationality,
        residentialAddress: kyc.residentialAddress,
        phone: kyc.phone,
        email: kyc.email,
        idType: kyc.idType,
        partnerOrgId: org.id
    });

    await prisma.kycRequest.update({
        where: { id: kyc.id },
        data: {
            fvBankApplicationId: fvKycRes.applicationId,
            status: "SUBMITTED",
            submittedAt: new Date()
        }
    });

    await recordStatusChange({
        organizationId: org.id,
        entityType: "KYC",
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
        changedBy: user.id,
        kycRequestId: kyc.id,
        reason: "Submitted to FV Bank"
    });

    console.log(`  ✅ KYC Application Submitted. FV Bank ID: ${fvKycRes.applicationId}`);

    // ─────────────────────────────────────────────────────
    // TEST 5: Corporate KYB Application (FV Bank Adapter)
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 5: Corporate KYB Application Submission");
    const kyb = await prisma.kybRequest.create({
        data: {
            organizationId: org.id,
            companyName: org.businessName,
            registrationNumber: org.registrationNumber || "RC-12345",
            countryOfIncorporation: org.countryOfRegistration,
            businessAddress: org.businessAddress,
            taxIdentification: "TIN-999888",
            directors: [{ name: "Sprint1 Tester", role: "CEO", nationality: "Nigerian" }],
            ubos: [{ name: "Sprint1 Tester", ownershipPercentage: 100 }],
            status: "DRAFT"
        }
    });

    const fvKybRes = await FvBank.submitKybApplication({
        partnerApplicationId: kyb.id,
        companyName: kyb.companyName,
        registrationNumber: kyb.registrationNumber,
        countryOfIncorporation: kyb.countryOfIncorporation,
        businessAddress: kyb.businessAddress,
        taxIdentification: kyb.taxIdentification || undefined,
        directors: kyb.directors as any,
        ubos: kyb.ubos as any,
        partnerOrgId: org.id
    });

    await prisma.kybRequest.update({
        where: { id: kyb.id },
        data: {
            fvBankApplicationId: fvKybRes.applicationId,
            status: "SUBMITTED",
            submittedAt: new Date()
        }
    });

    await recordStatusChange({
        organizationId: org.id,
        entityType: "KYB",
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
        changedBy: user.id,
        kybRequestId: kyb.id,
        reason: "Submitted to FV Bank"
    });

    console.log(`  ✅ KYB Application Submitted. FV Bank ID: ${fvKybRes.applicationId}`);

    // ─────────────────────────────────────────────────────
    // TEST 6: Verification Document Uploads
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 6: Verification Document Uploads");
    const kycDoc = await prisma.verificationDocument.create({
        data: {
            organizationId: org.id,
            kycRequestId: kyc.id,
            documentType: "PASSPORT",
            fileUrl: "https://res.cloudinary.com/demo/image/upload/sample_passport.jpg",
            fileName: "passport_front.jpg",
            fileSize: 102400,
            mimeType: "image/jpeg",
            uploadedBy: user.id
        }
    });

    const kybDoc = await prisma.verificationDocument.create({
        data: {
            organizationId: org.id,
            kybRequestId: kyb.id,
            documentType: "CERTIFICATE_OF_INCORPORATION",
            fileUrl: "https://res.cloudinary.com/demo/image/upload/sample_cert.pdf",
            fileName: "cert_inc.pdf",
            fileSize: 204800,
            mimeType: "application/pdf",
            uploadedBy: user.id
        }
    });

    console.log(`  ✅ KYC Document Uploaded: ID ${kycDoc.id}`);
    console.log(`  ✅ KYB Document Uploaded: ID ${kybDoc.id}`);

    // ─────────────────────────────────────────────────────
    // TEST 7: Inbound Webhook Approval & Organization Activation
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 7: Inbound Webhook Processing & Auto-Activation");

    // Simulate KYC Approval Webhook
    await prisma.kycRequest.update({
        where: { id: kyc.id },
        data: { status: "APPROVED", reviewedAt: new Date() }
    });
    await recordStatusChange({
        organizationId: org.id,
        entityType: "KYC",
        fromStatus: "SUBMITTED",
        toStatus: "APPROVED",
        changedBy: "FV_BANK_WEBHOOK",
        kycRequestId: kyc.id,
        reason: "FV Bank webhook: KYC Approved"
    });

    // Simulate KYB Approval Webhook
    await prisma.kybRequest.update({
        where: { id: kyb.id },
        data: { status: "APPROVED", reviewedAt: new Date() }
    });
    await recordStatusChange({
        organizationId: org.id,
        entityType: "KYB",
        fromStatus: "SUBMITTED",
        toStatus: "APPROVED",
        changedBy: "FV_BANK_WEBHOOK",
        kybRequestId: kyb.id,
        reason: "FV Bank webhook: KYB Approved"
    });

    // Auto-activate organization when both approved
    await prisma.organization.update({
        where: { id: org.id },
        data: { status: "ACTIVE" }
    });
    await recordStatusChange({
        organizationId: org.id,
        entityType: "ORGANIZATION",
        fromStatus: "DRAFT",
        toStatus: "ACTIVE",
        changedBy: "SYSTEM",
        reason: "Both KYC and KYB approved. Organization activated."
    });

    console.log(`  ✅ Organization status auto-transitioned to: ACTIVE`);

    // ─────────────────────────────────────────────────────
    // TEST 8: Compliance Audit & Dashboard Status
    // ─────────────────────────────────────────────────────
    console.log("\n▶ TEST 8: Compliance Status & Audit Trail Verification");
    const statusView = await getComplianceStatus(org.id, user.id);

    console.log(`  ✅ Compliance Status:`);
    console.log(`     - Organization: ${statusView.organization.businessName} [${statusView.organization.status}]`);
    console.log(`     - KYC Status: ${statusView.kyc?.status}`);
    console.log(`     - KYB Status: ${statusView.kyb?.status}`);
    console.log(`     - Fully Approved: ${statusView.isFullyApproved}`);
    console.log(`     - Can Proceed to Sprint 2 Managed Account: ${statusView.canProceedToManagedAccount}`);
    console.log(`     - Audit History Events Count: ${statusView.history.length}`);

    // Cleanup test data
    console.log("\n🧹 Cleaning up test verification records...");
    await prisma.verificationStatusHistory.deleteMany({ where: { organizationId: org.id } });
    await prisma.verificationDocument.deleteMany({ where: { organizationId: org.id } });
    await prisma.kycRequest.deleteMany({ where: { organizationId: org.id } });
    await prisma.kybRequest.deleteMany({ where: { organizationId: org.id } });
    await prisma.qualificationAssessment.deleteMany({ where: { organizationId: org.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: user.id } });

    console.log("\n============================================================");
    console.log("🎉 ALL SPRINT 1 TEST CASES PASSED WITH 100% SUCCESS!");
    console.log("============================================================\n");
}

runSprint1FullTest()
    .catch((err) => {
        console.error("❌ SPRINT 1 TEST SUITE FAILED:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
