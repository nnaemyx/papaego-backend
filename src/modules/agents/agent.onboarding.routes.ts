import { Router } from "express";
import { upload } from "../../middlewares/upload.middleware";
import {
    verifyOnboardingToken,
    completeOnboarding,
    uploadOnboardingDocument
} from "./agent.onboarding.controller";

const router = Router();

// Public routes (no auth required)
router.get("/verify-token", verifyOnboardingToken);
router.post("/complete-onboarding", completeOnboarding);

// File uploads
router.post("/upload", upload.single("file"), uploadOnboardingDocument);

export default router;
