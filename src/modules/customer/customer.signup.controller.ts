import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../config/db";
import { passwordSchema } from "../auth/auth.schema";
import { sendOtpEmail } from "../../services/email.service";


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

        if (referralCode && typeof referralCode === "string") {
            const trimmedCode = referralCode.trim().toUpperCase();

            // 1. Try finding by referralCode
            let agentProfile = await prisma.agentProfile.findFirst({
                where: { referralCode: trimmedCode },
                include: { user: { select: { id: true, isActive: true } } },
            });

            // 2. If not found, try finding by licenseId (with or without REF- prefix)
            if (!agentProfile) {
                const licenseId = trimmedCode.startsWith("REF-") ? trimmedCode.slice(4) : trimmedCode;
                if (licenseId) {
                    agentProfile = await prisma.agentProfile.findFirst({
                        where: { licenseId },
                        include: { user: { select: { id: true, isActive: true } } },
                    });
                }
            }

            if (agentProfile) {
                if (agentProfile.user.isActive) {
                    referringAgentId = agentProfile.userId;
                    validatedReferralCode = trimmedCode;
                    referralType = "AGENT";
                } else {
                    console.warn(`Referral code ${trimmedCode} belongs to an inactive agent`);
                }
            } else {
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
                    referralCode: validatedReferralCode || (referralCode?.trim() || null),
                    referralType: referralType || "AGENT",
                    kycStatus: (governmentIdUrl && proofOfAddressUrl) ? "SUBMITTED" : "NOT_SUBMITTED",
                },
            });

            // Stub a referral commission for the agent (paid once customer completes first trade)
            if (referringAgentId) {
                // We log the referral in AuditLog; actual commission is created on first COMPLETED trade
                await tx.auditLog.create({
                    data: {
                        actorId: "SYSTEM",
                        role: "ADMIN",
                        action: "REFERRAL_CUSTOMER_REGISTERED",
                        entity: "Customer",
                        entityId: customer.id,
                        ip: "system",
                        metadata: { referringAgentId, referralCode },
                    },
                });
            }

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

/**
 * Step 1: Initiate signup by creating user/customer (inactive) and sending OTP
 */
export async function initiateSignup(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail, password, phone, firstName, lastName, referralCode } = req.body;

        if (!rawEmail || !password || !phone || !firstName || !lastName) {
            return res.status(400).json({ error: "First name, last name, email, phone, and password are required" });
        }

        const email = rawEmail.trim().toLowerCase();

        // 1. Password strength validation
        const passwordResult = passwordSchema.safeParse(password);
        if (!passwordResult.success) {
            const errors = passwordResult.error.issues.map((e: any) => e.message);
            return res.status(400).json({ error: errors[0], passwordErrors: errors });
        }

        // 2. Check if user already exists
        const existingUser = await prisma.user.findFirst({ where: { email } });
        if (existingUser && existingUser.isActive) {
            return res.status(409).json({ error: "An account with this email already exists" });
        }

        // 3. Process referral code if any
        let referringAgentId: string | null = null;
        let validatedReferralCode: string | null = null;
        let referralType: string | null = null;

        if (referralCode && typeof referralCode === "string") {
            const trimmedCode = referralCode.trim().toUpperCase();
            let agentProfile = await prisma.agentProfile.findFirst({
                where: { referralCode: trimmedCode },
                include: { user: { select: { id: true, isActive: true } } },
            });

            if (!agentProfile) {
                const licenseId = trimmedCode.startsWith("REF-") ? trimmedCode.slice(4) : trimmedCode;
                if (licenseId) {
                    agentProfile = await prisma.agentProfile.findFirst({
                        where: { licenseId },
                        include: { user: { select: { id: true, isActive: true } } },
                    });
                }
            }

            if (agentProfile && agentProfile.user.isActive) {
                referringAgentId = agentProfile.userId;
                validatedReferralCode = trimmedCode;
                referralType = "AGENT";
            }
        }

        // 4. Handle OTP Lockout check before DB user modifications
        let otpRecord = await prisma.verificationOtp.findUnique({ where: { email } });
        if (otpRecord && otpRecord.lockedUntil && otpRecord.lockedUntil > new Date()) {
            return res.status(403).json({
                error: `Too many incorrect attempts. Please try again after ${otpRecord.lockedUntil.toLocaleTimeString()}`
            });
        }

        // 5. Enforce resend cooldown (60 seconds)
        if (otpRecord) {
            const timeSinceLastSent = Date.now() - otpRecord.lastSentAt.getTime();
            if (timeSinceLastSent < 60 * 1000) {
                return res.status(429).json({
                    error: "Please wait 60 seconds before requesting another code."
                });
            }
        }

        // 6. Create/Update user (with isActive: false)
        const hashedPassword = await bcrypt.hash(password, 10);
        let user;
        if (existingUser) {
            user = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                    password: hashedPassword,
                    phone,
                    firstName,
                    lastName
                }
            });
            await prisma.customer.upsert({
                where: { userId: user.id },
                update: {
                    fullName: `${firstName} ${lastName}`,
                    phone,
                    email,
                    referringAgentId,
                    referralCode: validatedReferralCode || (referralCode?.trim() || null),
                    referralType: referralType || "AGENT"
                },
                create: {
                    userId: user.id,
                    fullName: `${firstName} ${lastName}`,
                    email,
                    phone,
                    bvn: "",
                    verified: false,
                    referringAgentId,
                    referralCode: validatedReferralCode || (referralCode?.trim() || null),
                    referralType: referralType || "AGENT"
                }
            });
        } else {
            const result = await prisma.$transaction(async (tx) => {
                const u = await tx.user.create({
                    data: {
                        email,
                        password: hashedPassword,
                        phone,
                        firstName,
                        lastName,
                        role: "CUSTOMER",
                        isActive: false, // Inactive until verified
                    }
                });
                const c = await tx.customer.create({
                    data: {
                        userId: u.id,
                        fullName: `${firstName} ${lastName}`,
                        email,
                        phone,
                        bvn: "",
                        verified: false,
                        referringAgentId,
                        referralCode: validatedReferralCode || (referralCode?.trim() || null),
                        referralType: referralType || "AGENT",
                        kycStatus: "NOT_SUBMITTED"
                    }
                });
                return { user: u, customer: c };
            });
            user = result.user;
        }

        // 7. Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

        // 8. Upsert OTP record
        otpRecord = await prisma.verificationOtp.upsert({
            where: { email },
            update: {
                otp,
                attempts: 0,
                // If it is within 1 hour, increment resend, otherwise reset to 1
                resendAttempts: otpRecord && (Date.now() - otpRecord.createdAt.getTime() < 60 * 60 * 1000)
                    ? otpRecord.resendAttempts + 1
                    : 1,
                expiresAt,
                lastSentAt: new Date(),
                lockedUntil: null
            },
            create: {
                email,
                otp,
                attempts: 0,
                resendAttempts: 1,
                expiresAt,
                lastSentAt: new Date()
            }
        });

        // 9. Send delivery via email
        await sendOtpEmail({
            email,
            userName: firstName,
            otp
        }).catch((err) => console.error("⚠️ Failed to send Resend OTP email:", err));

        // 10. Audit Log
        await prisma.auditLog.create({
            data: {
                actorId: user.id,
                role: "CUSTOMER",
                action: "OTP_SENT",
                entity: "User",
                entityId: user.id,
                ip: req.ip || "unknown",
                metadata: { email, resendAttempts: otpRecord.resendAttempts }
            }
        });

        res.status(200).json({
            message: "OTP sent to your email. Please verify to activate your account.",
            devOtp: process.env.NODE_ENV !== "production" ? otp : undefined
        });
    } catch (error) {
        console.error("Initiate signup error:", error);
        next(error);
    }
}

/**
 * Step 1.5: Verify OTP to activate account and return JWT token
 */
export async function verifySignupOtp(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail, otp } = req.body;

        if (!rawEmail || !otp) {
            return res.status(400).json({ error: "Email and OTP are required" });
        }

        const email = rawEmail.trim().toLowerCase();

        const user = await prisma.user.findFirst({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const otpRecord = await prisma.verificationOtp.findUnique({ where: { email } });
        if (!otpRecord) {
            return res.status(400).json({ error: "OTP expired or not found. Please request a new code." });
        }

        // 1. Lockout check
        if (otpRecord.lockedUntil && otpRecord.lockedUntil > new Date()) {
            return res.status(403).json({
                error: `Account locked due to too many failed attempts. Try again after ${otpRecord.lockedUntil.toLocaleTimeString()}`
            });
        }

        // 2. Expiry check
        if (otpRecord.expiresAt < new Date()) {
            await prisma.auditLog.create({
                data: {
                    actorId: user.id,
                    role: "CUSTOMER",
                    action: "OTP_EXPIRED_ATTEMPT",
                    entity: "User",
                    entityId: user.id,
                    ip: req.ip || "unknown",
                    metadata: { email }
                }
            });
            return res.status(400).json({ error: "OTP has expired. Please request a new code." });
        }

        // 3. Validate OTP
        if (otpRecord.otp !== otp.trim()) {
            const currentAttempts = otpRecord.attempts + 1;

            if (currentAttempts >= 5) {
                const lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lockout
                await prisma.verificationOtp.update({
                    where: { email },
                    data: {
                        attempts: currentAttempts,
                        lockedUntil
                    }
                });

                await prisma.auditLog.create({
                    data: {
                        actorId: user.id,
                        role: "CUSTOMER",
                        action: "OTP_LOCKOUT",
                        entity: "User",
                        entityId: user.id,
                        ip: req.ip || "unknown",
                        metadata: { email, attempts: currentAttempts }
                    }
                });

                return res.status(403).json({
                    error: "Too many incorrect attempts. Account locked for 15 minutes."
                });
            } else {
                await prisma.verificationOtp.update({
                    where: { email },
                    data: { attempts: currentAttempts }
                });

                await prisma.auditLog.create({
                    data: {
                        actorId: user.id,
                        role: "CUSTOMER",
                        action: "OTP_VERIFY_FAILED",
                        entity: "User",
                        entityId: user.id,
                        ip: req.ip || "unknown",
                        metadata: { email, attempts: currentAttempts }
                    }
                });

                return res.status(400).json({
                    error: `Invalid verification code. ${5 - currentAttempts} attempts remaining.`
                });
            }
        }

        // 4. Activation
        await prisma.user.update({
            where: { id: user.id },
            data: { isActive: true }
        });

        // 5. Delete OTP record (prevent reuse)
        await prisma.verificationOtp.delete({ where: { email } });

        // 6. Audit success
        await prisma.auditLog.create({
            data: {
                actorId: user.id,
                role: "CUSTOMER",
                action: "OTP_VERIFIED",
                entity: "User",
                entityId: user.id,
                ip: req.ip || "unknown",
                metadata: { email }
            }
        });

        const customer = await prisma.customer.findUnique({ where: { userId: user.id } });

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        res.status(200).json({
            message: "Account verified and activated successfully.",
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                isActive: true
            },
            customer: customer ? {
                id: customer.id,
                fullName: customer.fullName,
                verified: customer.verified
            } : null,
            token
        });
    } catch (error) {
        console.error("Verify signup OTP error:", error);
        next(error);
    }
}

/**
 * Resend OTP code (max 3 times within 1 hour)
 */
export async function resendSignupOtp(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail } = req.body;

        if (!rawEmail) {
            return res.status(400).json({ error: "Email is required" });
        }

        const email = rawEmail.trim().toLowerCase();

        const user = await prisma.user.findFirst({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (user.isActive) {
            return res.status(400).json({ error: "This account has already been verified and is active." });
        }

        let otpRecord = await prisma.verificationOtp.findUnique({ where: { email } });
        if (!otpRecord) {
            return res.status(400).json({ error: "No pending OTP request found for this email." });
        }

        // 1. Lockout check
        if (otpRecord.lockedUntil && otpRecord.lockedUntil > new Date()) {
            return res.status(403).json({
                error: `Account locked due to too many failed attempts. Try again after ${otpRecord.lockedUntil.toLocaleTimeString()}`
            });
        }

        // 2. Resend attempts check (max 3)
        if (otpRecord.resendAttempts >= 3) {
            await prisma.auditLog.create({
                data: {
                    actorId: user.id,
                    role: "CUSTOMER",
                    action: "OTP_RESEND_EXCEEDED",
                    entity: "User",
                    entityId: user.id,
                    ip: req.ip || "unknown",
                    metadata: { email }
                }
            });
            return res.status(400).json({
                error: "Maximum resend attempts (3) exceeded. Please wait or contact support."
            });
        }

        // 3. Cooldown check (60s)
        const timePassed = Date.now() - otpRecord.lastSentAt.getTime();
        if (timePassed < 60 * 1000) {
            return res.status(429).json({
                error: "Please wait 60 seconds before resending another verification code."
            });
        }

        // 4. Generate new OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

        otpRecord = await prisma.verificationOtp.update({
            where: { email },
            data: {
                otp,
                resendAttempts: otpRecord.resendAttempts + 1,
                expiresAt,
                lastSentAt: new Date()
            }
        });

        // 5. Send email
        await sendOtpEmail({
            email,
            userName: user.firstName || "Customer",
            otp
        }).catch((err) => console.error("⚠️ Failed to send Resend OTP email:", err));

        // 6. Audit resend
        await prisma.auditLog.create({
            data: {
                actorId: user.id,
                role: "CUSTOMER",
                action: "OTP_RESENT",
                entity: "User",
                entityId: user.id,
                ip: req.ip || "unknown",
                metadata: { email, attempt: otpRecord.resendAttempts }
            }
        });

        res.status(200).json({
            message: "Verification code resent successfully.",
            devOtp: process.env.NODE_ENV !== "production" ? otp : undefined
        });
    } catch (error) {
        console.error("Resend signup OTP error:", error);
        next(error);
    }
}

/**
 * Step 2 & 3: Submit KYC data for authenticated customer
 */
export async function submitSignupKyc(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        let customer = (req as any).user.customer; // Attached via populateCustomer middleware

        if (!customer) {
            customer = await prisma.customer.findUnique({ where: { userId } });
        }

        if (!customer) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            customer = await prisma.customer.create({
                data: {
                    userId,
                    fullName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || "Customer",
                    email: user?.email || "",
                    phone: user?.phone || "",
                    bvn: req.body.bvn || "",
                    verified: false,
                    kycStatus: "NOT_SUBMITTED"
                }
            });
        }

        const {
            gender,
            dateOfBirth,
            homeAddress,
            bvn,
            nin,
            companyName,
            companySector,
            governmentIdUrl,
            proofOfAddressUrl
        } = req.body;

        if (!bvn) {
            return res.status(400).json({ error: "BVN is required" });
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

        const updatedCustomer = await prisma.customer.update({
            where: { id: customer.id },
            data: {
                bvn,
                nin: nin || null,
                gender: gender || null,
                dateOfBirth: parsedDob,
                homeAddress: homeAddress || null,
                companyName: companyName || null,
                companySector: companySector || null,
                governmentIdUrl: governmentIdUrl || null,
                proofOfAddressUrl: proofOfAddressUrl || null,
                kycStatus: (governmentIdUrl && proofOfAddressUrl) ? "SUBMITTED" : "NOT_SUBMITTED",
            }
        });

        // Stub referral log if referrer exists
        if (updatedCustomer.referringAgentId) {
            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    role: "CUSTOMER",
                    action: "REFERRAL_CUSTOMER_REGISTERED",
                    entity: "Customer",
                    entityId: updatedCustomer.id,
                    ip: req.ip || "unknown",
                    metadata: { referringAgentId: updatedCustomer.referringAgentId, referralCode: updatedCustomer.referralCode },
                },
            });
        }

        res.status(200).json({
            message: "KYC details submitted successfully.",
            customer: {
                id: updatedCustomer.id,
                fullName: updatedCustomer.fullName,
                verified: updatedCustomer.verified,
                kycStatus: updatedCustomer.kycStatus
            }
        });
    } catch (error) {
        console.error("Submit signup KYC error:", error);
        next(error);
    }
}

