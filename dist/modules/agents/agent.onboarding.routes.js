"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const agent_onboarding_controller_1 = require("./agent.onboarding.controller");
const router = (0, express_1.Router)();
// Public routes (no auth required)
router.get("/verify-token", agent_onboarding_controller_1.verifyOnboardingToken);
router.post("/complete-onboarding", agent_onboarding_controller_1.completeOnboarding);
exports.default = router;
