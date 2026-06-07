import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../../config/db";
import { sendResetPasswordEmail } from "../../services/email.service";

export async function signup(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail, password, phone, role } = req.body;
        const email = rawEmail.trim().toLowerCase();

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                phone,
                role: role || "CUSTOMER"
            }
        });

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        res.status(201).json({ user, token });
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
