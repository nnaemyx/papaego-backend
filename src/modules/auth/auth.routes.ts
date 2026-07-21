import { Router } from "express";
import { login, signup, forgotPassword, resetPassword, verifyEmail, resendOtp } from "./auth.controller";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, signupSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, resendOtpSchema } from "./auth.schema";

import { rateLimit } from "express-rate-limit";

const router = Router();

// Stricter Rate Limiter for Authentication: 5 attempts per 15 minutes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again in 15 minutes." }
});

router.post("/signup", authLimiter, validate(signupSchema), signup);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);
router.post("/verify-email", authLimiter, validate(verifyEmailSchema), verifyEmail);
router.post("/resend-otp", authLimiter, validate(resendOtpSchema), resendOtp);

export default router;

