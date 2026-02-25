import { Router } from "express";
import {
    verifyOnboardingToken,
    completeOnboarding
} from "./agent.onboarding.controller";

const router = Router();

// Public routes (no auth required)
router.get("/verify-token", verifyOnboardingToken);
router.post("/complete-onboarding", completeOnboarding);

export default router;
