import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../../config/db";
import { sendResetPasswordEmail, sendOtpEmail } from "../../services/email.service";

// ---------- Helper: Generate 6-digit OTP ----------
function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function signup(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail, password, phone, role, firstName, lastName } = req.body;
        const email = rawEmail.trim().toLowerCase();

        const existing = await prisma.user.findFirst({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                phone: phone || "",
                firstName: firstName || null,
                lastName: lastName || null,
                role: role || "CUSTOMER"
            }
        });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        await prisma.verificationOtp.upsert({
            where: { email },
            create: { email, otp, expiresAt },
            update: { otp, expiresAt, attempts: 0, lockedUntil: null, resendAttempts: 0, lastSentAt: new Date() }
        });

        console.log(`📧 OTP generated for ${email}: ${otp}`);

        // Send real email via Resend
        await sendOtpEmail({
            email,
            userName: firstName || email.split("@")[0],
            otp
        }).catch(err => console.error("⚠️ Failed to send Resend OTP email:", err));

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        res.status(201).json({
            user,
            token,
            devOtp: process.env.NODE_ENV !== "production" ? otp : undefined
        });
    } catch (error) {
        next(error);
    }
}

export async function login(req: Request, res: Response, next: NextFunction) {
    try {
        const rawEmail = req.body.email;
        const email = rawEmail?.trim().toLowerCase();
        const { password } = req.body;

        console.log(`🔐 Login attempt for: ${email}`);

        const user = await prisma.user.findFirst({
            where: { email }
        });

        if (!user) {
            console.log(`❌ User not found in DB for email: ${email}`);
            return res.status(401).json({ error: "User not found or inactive" });
        }

        console.log(`👤 User found: ${user.email}, Role: ${user.role}, Active: ${user.isActive}`);

        if (!user.isActive) {
            console.log(`❌ User is inactive: ${email}`);
            return res.status(401).json({ error: "User not found or inactive" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log(`🔑 Password valid: ${isPasswordValid}`);

        if (!isPasswordValid) {
            console.log(`❌ Invalid password for: ${email}`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        console.log("🔑 JWT_SECRET exists:", !!process.env.JWT_SECRET);
        console.log("🔑 JWT_SECRET value:", process.env.JWT_SECRET);

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        console.log("✅ Token generated:", token.substring(0, 30) + "...");
        console.log("👤 User role:", user.role);

        // If needed, fetch specific profile ID (customerId or agentId) to include, 
        // but for now the middleware uses user.id to look things up or we can add it to token payload later.

        res.json({ user, token });
    } catch (error) {
        console.log("❌ Login error:", error);
        next(error);
    }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail } = req.body;
        const email = rawEmail?.trim().toLowerCase();

        console.log(`🔑 Forgot password request for: ${email}`);

        // Always return success to prevent email enumeration
        const user = await prisma.user.findFirst({ where: { email } });

        if (user) {
            // Generate secure random token
            const resetToken = crypto.randomBytes(32).toString("hex");
            const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            // Save token to database
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    resetPasswordToken: resetToken,
                    resetPasswordExpires: resetExpires
                }
            });

            // Build reset URL
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            const resetUrl = `${frontendUrl}/customer-auth/reset-password?token=${resetToken}`;

            // Send email
            try {
                await sendResetPasswordEmail({
                    email: user.email!,
                    userName: user.firstName || "Customer",
                    resetUrl
                });
                console.log(`✅ Reset email sent to: ${email}`);
            } catch (emailError) {
                console.error("❌ Failed to send reset email:", emailError);
                // Don't expose email failure to client
            }
        } else {
            console.log(`⚠️ No user found for email: ${email} (silent)`);
        }

        // Always return success regardless of whether user exists
        res.json({
            message: "If an account with that email exists, a password reset link has been sent."
        });
    } catch (error) {
        console.error("❌ Forgot password error:", error);
        next(error);
    }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
        const { token, password } = req.body;

        console.log("🔑 Reset password attempt with token");

        // Find user by token and check expiry
        const user = await prisma.user.findFirst({
            where: {
                resetPasswordToken: token,
                resetPasswordExpires: { gt: new Date() }
            }
        });

        if (!user) {
            return res.status(400).json({
                error: "Invalid or expired reset token. Please request a new password reset."
            });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update password and clear reset token fields
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null
            }
        });

        console.log(`✅ Password reset successful for user: ${user.email}`);

        res.json({ message: "Password has been reset successfully. You can now sign in with your new password." });
    } catch (error) {
        console.error("❌ Reset password error:", error);
        next(error);
    }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail, otp } = req.body;
        const email = rawEmail.trim().toLowerCase();

        const record = await prisma.verificationOtp.findUnique({ where: { email } });

        if (!record) {
            return res.status(400).json({ error: "No OTP found for this email. Please register first." });
        }

        if (record.lockedUntil && record.lockedUntil > new Date()) {
            return res.status(429).json({ error: "Too many failed attempts. Please wait before trying again." });
        }

        if (record.expiresAt < new Date()) {
            return res.status(400).json({ error: "OTP has expired. Please request a new one." });
        }

        if (record.otp !== otp) {
            const attempts = record.attempts + 1;
            const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
            await prisma.verificationOtp.update({
                where: { email },
                data: { attempts, lockedUntil }
            });
            return res.status(400).json({ error: "Invalid OTP. Please try again." });
        }

        // Mark user as verified (email confirmed)
        await prisma.user.updateMany({
            where: { email },
            data: { isActive: true }
        });

        // Clean up OTP record
        await prisma.verificationOtp.delete({ where: { email } });

        res.json({ message: "Email verified successfully." });
    } catch (error) {
        console.error("❌ Verify email error:", error);
        next(error);
    }
}

export async function resendOtp(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail } = req.body;
        const email = rawEmail.trim().toLowerCase();

        const record = await prisma.verificationOtp.findUnique({ where: { email } });

        if (record) {
            if (record.resendAttempts >= 5) {
                return res.status(429).json({ error: "Maximum resend attempts reached. Please try again later." });
            }
            // Rate limit: 60s between resends
            const cooldown = new Date(record.lastSentAt.getTime() + 60 * 1000);
            if (cooldown > new Date()) {
                return res.status(429).json({ error: "Please wait at least 60 seconds before requesting a new OTP." });
            }
        }

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        await prisma.verificationOtp.upsert({
            where: { email },
            create: { email, otp, expiresAt },
            update: { otp, expiresAt, attempts: 0, lockedUntil: null, resendAttempts: { increment: 1 }, lastSentAt: new Date() }
        });

        console.log(`📧 Resending OTP for ${email}: ${otp}`);

        // Send real email via Resend
        const user = await prisma.user.findFirst({ where: { email } });
        await sendOtpEmail({
            email,
            userName: user?.firstName || email.split("@")[0],
            otp
        }).catch(err => console.error("⚠️ Failed to send Resend OTP email:", err));

        res.json({
            message: "A new OTP has been sent to your email.",
            devOtp: process.env.NODE_ENV !== "production" ? otp : undefined
        });
    } catch (error) {
        console.error("❌ Resend OTP error:", error);
        next(error);
    }
}
