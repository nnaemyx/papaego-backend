import { Router } from "express";
import { login, signup } from "./auth.controller";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, signupSchema } from "./auth.schema";

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

export default router;
