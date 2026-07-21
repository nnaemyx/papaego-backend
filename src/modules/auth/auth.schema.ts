import { z } from "zod";

export const passwordSchema = z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const signupSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: passwordSchema,
        phone: z.string().min(10).optional(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        role: z.enum(["AGENT", "CUSTOMER", "COMPLIANCE", "ADMIN", "ORG_OWNER", "ORG_ADMIN"]).optional()
    })
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string()
    })
});

export const forgotPasswordSchema = z.object({
    body: z.object({
        email: z.string().email("Please enter a valid email address")
    })
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, "Reset token is required"),
        password: passwordSchema
    })
});

export const verifyEmailSchema = z.object({
    body: z.object({
        email: z.string().email(),
        otp: z.string().length(6, "OTP must be 6 digits")
    })
});

export const resendOtpSchema = z.object({
    body: z.object({
        email: z.string().email()
    })
});

