import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../config/db";
import { passwordSchema } from "../auth/auth.schema";

export async function uploadCustomerDocument(req: Request, res: Response) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        res.json({ url: req.file.path }); // Returns the Cloudinary secure URL
    } catch (error) {
        console.error("Error uploading signup document:", error);
        res.status(500).json({ error: "Failed to upload document" });
    }
}

/**
 * Customer self-registration endpoint
 * Creates a User (role=CUSTOMER) and associated Customer profile in one transaction.
 * Supports referral code attribution — if a valid agent referral code is provided,
 * the customer is linked to the referring agent.
 */
export async function customerSignup(req: Request, res: Response, next: NextFunction) {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            password,
            // KYC details
            gender,
            dateOfBirth,
            homeAddress,
            bvn,
            nin,
            companyName,
            companySector,
            // Document URLs (uploaded separately via file upload endpoints)
            governmentIdUrl,
            proofOfAddressUrl,
            // Referral
            referralCode,
        } = req.body;

        if (!email || !password || !phone || !firstName || !lastName) {
            return res.status(400).json({ error: "First name, last name, email, phone, and password are required" });
        }

        if (!bvn) {
            return res.status(400).json({ error: "BVN is required" });
        }

        // Validate password strength
        const passwordResult = passwordSchema.safeParse(password);
        if (!passwordResult.success) {
            const errors = passwordResult.error.issues.map((e: any) => e.message);
            return res.status(400).json({ error: errors[0], passwordErrors: errors });
        }

        let parsedDob: Date | null = null;
        if (dateOfBirth) {
            parsedDob = new Date(dateOfBirth);
            if (isNaN(parsedDob.getTime())) {
                return res.status(400).json({ error: "Invalid date of birth format" });
            }
            const year = parsedDob.getFullYear();
            if (year < 1900 || year > new Date().getFullYear()) {
                return res.status(400).json({ error: "Please enter a valid birth year" });
            }
        }

        // Check if email already exists
        const existingUser = await prisma.user.findFirst({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: "An account with this email already exists" });
        }

        // ── Referral Code Validation ─────────────────────────────────────
        let referringAgentId: string | null = null;
        let validatedReferralCode: string | null = null;
        let referralType: string | null = null;

        if (referralCode) {
            const trimmedCode = referralCode.trim().toUpperCase();

            // Look up agent by referral code
            const agentProfile = await prisma.agentProfile.findFirst({
                where: { referralCode: trimmedCode },
                include: { user: { select: { id: true, isActive: true } } },
            });

            if (agentProfile && agentProfile.user.isActive) {
                referringAgentId = agentProfile.userId;
                validatedReferralCode = trimmedCode;
                referralType = "AGENT";
            } else if (agentProfile && !agentProfile.user.isActive) {
                // Agent exists but is suspended — still allow signup but don't attribute
                console.warn(`Referral code ${trimmedCode} belongs to an inactive agent`);
            } else {
                // Invalid referral code — don't block signup, just ignore
                console.warn(`Invalid referral code provided: ${trimmedCode}`);
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user and customer profile in a transaction
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    phone,
                    firstName,
                    lastName,
                    role: "CUSTOMER",
                    isActive: true,
                },
            });

            const customer = await tx.customer.create({
                data: {
                    userId: user.id,
                    fullName: `${firstName} ${lastName}`,
                    email,
                    phone,
                    bvn: bvn || "",
                    nin: nin || null,
                    gender: gender || null,
                    dateOfBirth: parsedDob,
                    homeAddress: homeAddress || null,
                    companyName: companyName || null,
                    companySector: companySector || null,
                    governmentIdUrl: governmentIdUrl || null,
                    proofOfAddressUrl: proofOfAddressUrl || null,
                    verified: false,
                    // Referral attribution
                    referringAgentId,
                    referralCode: validatedReferralCode,
                    referralType,
                    kycStatus: (governmentIdUrl && proofOfAddressUrl) ? "SUBMITTED" : "NOT_SUBMITTED",
                },
            });

            return { user, customer };
        });

        const token = jwt.sign(
            { id: result.user.id, role: result.user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        res.status(201).json({
            user: {
                id: result.user.id,
                email: result.user.email,
                firstName: result.user.firstName,
                lastName: result.user.lastName,
                role: result.user.role,
                isActive: result.user.isActive,
            },
            customer: {
                id: result.customer.id,
                fullName: result.customer.fullName,
                verified: result.customer.verified,
                referralApplied: !!referringAgentId,
            },
            token,
        });
    } catch (error) {
        console.error("Customer signup error:", error);
        next(error);
    }
}
