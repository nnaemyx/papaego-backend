"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOnboardingToken = verifyOnboardingToken;
exports.completeOnboarding = completeOnboarding;
exports.uploadOnboardingDocument = uploadOnboardingDocument;
const db_1 = __importDefault(require("../../config/db"));
const bcrypt_1 = __importDefault(require("bcrypt"));
/**
 * Verify if an onboarding token is valid
 */
async function verifyOnboardingToken(req, res) {
    try {
        const { token } = req.query;
        if (!token || typeof token !== "string") {
            return res.status(400).json({ error: "Token is required" });
        }
        const agentProfile = await db_1.default.agentProfile.findUnique({
            where: { onboardingToken: token },
            include: {
                user: true,
            }
        });
        if (!agentProfile) {
            return res.status(404).json({ error: "Invalid token" });
        }
        // Check if token has expired
        if (agentProfile.onboardingTokenExpiry && agentProfile.onboardingTokenExpiry < new Date()) {
            return res.status(400).json({ error: "Token has expired" });
        }
        // Check if agent has already completed onboarding
        if (agentProfile.onboardingStatus === "APPROVED") {
            return res.status(400).json({ error: "Onboarding already completed" });
        }
        res.json({
            valid: true,
            agent: {
                email: agentProfile.user?.email,
                phone: agentProfile.user?.phone,
                licenseId: agentProfile.licenseId,
                region: agentProfile.region,
                onboardingStatus: agentProfile.onboardingStatus
            }
        });
    }
    catch (error) {
        console.error("Error verifying onboarding token:", error);
        res.status(500).json({ error: "Failed to verify token" });
    }
}
/**
 * Complete agent onboarding
 */
async function completeOnboarding(req, res) {
    try {
        const { token, firstName, lastName, phone, password, dateOfBirth, homeAddress, governmentIdUrl, proofOfAddressUrl } = req.body;
        // Validate required fields
        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }
        if (!firstName || !lastName) {
            return res.status(400).json({ error: "First name and last name are required" });
        }
        if (!password) {
            return res.status(400).json({ error: "Password is required" });
        }
        // Find agent profile by token
        const agentProfile = await db_1.default.agentProfile.findUnique({
            where: { onboardingToken: token },
            include: {
                user: true
            }
        });
        if (!agentProfile) {
            return res.status(404).json({ error: "Invalid token" });
        }
        // Check if token has expired
        if (agentProfile.onboardingTokenExpiry && agentProfile.onboardingTokenExpiry < new Date()) {
            return res.status(400).json({ error: "Token has expired" });
        }
        // Check if agent has already completed onboarding
        if (agentProfile.onboardingStatus === "APPROVED") {
            return res.status(400).json({ error: "Onboarding already completed" });
        }
        // Hash the password
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        // Update user and agent profile
        await db_1.default.user.update({
            where: { id: agentProfile.userId },
            data: {
                firstName,
                lastName,
                phone: phone || agentProfile.user.phone,
                password: hashedPassword,
                isActive: false
            }
        });
        await db_1.default.agentProfile.update({
            where: { userId: agentProfile.userId },
            data: {
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                homeAddress,
                governmentIdUrl,
                proofOfAddressUrl,
                onboardingStatus: "SUBMITTED", // Changed from PENDING to SUBMITTED
                onboardingToken: null, // Invalidate the token
                onboardingTokenExpiry: null
            }
        });
        res.json({
            success: true,
            message: "Onboarding completed successfully. Your account is pending approval."
        });
    }
    catch (error) {
        console.error("Error completing onboarding:", error);
        res.status(500).json({ error: "Failed to complete onboarding" });
    }
}
/**
 * Upload onboarding document (NIN / Proof of Address)
 */
async function uploadOnboardingDocument(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        // Return the path prefix that matches the static folder config in app.ts
        const fileUrl = `/uploads/${req.file.filename}`;
        // Let the frontend complete the onboarding by pushing this URL string
        res.json({ url: fileUrl });
    }
    catch (error) {
        console.error("Error uploading document:", error);
        res.status(500).json({ error: "Failed to upload document" });
    }
}
