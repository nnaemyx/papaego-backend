import { Request, Response } from "express";
import prisma from "../../config/db";
import bcrypt from "bcrypt";

/**
 * Verify if an onboarding token is valid
 */
export async function verifyOnboardingToken(req: Request, res: Response) {
    try {
        const { token } = req.query;

        if (!token || typeof token !== "string") {
            return res.status(400).json({ error: "Token is required" });
        }

        const agentProfile = await prisma.agentProfile.findUnique({
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
    } catch (error) {
        console.error("Error verifying onboarding token:", error);
        res.status(500).json({ error: "Failed to verify token" });
    }
}

/**
 * Complete agent onboarding
 */
export async function completeOnboarding(req: Request, res: Response) {
    try {
        const {
            token,
            firstName,
            lastName,
            password,
            dateOfBirth,
            homeAddress,
            governmentIdUrl,
            proofOfAddressUrl
        } = req.body;

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
        const agentProfile = await prisma.agentProfile.findUnique({
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
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update user and agent profile
        await prisma.user.update({
            where: { id: agentProfile.userId },
            data: {
                firstName,
                lastName,
                password: hashedPassword
            }
        });

        await prisma.agentProfile.update({
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
    } catch (error) {
        console.error("Error completing onboarding:", error);
        res.status(500).json({ error: "Failed to complete onboarding" });
    }
}
