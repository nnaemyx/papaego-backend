import { Router } from "express";
import { getComplianceFlags, createComplianceReport, getReports } from "./compliance.controller";
import { requireRole } from "../../middlewares/rbac.middleware";
import { auth } from "../../middlewares/auth.middleware";

const router = Router();

router.use(auth);
router.use(requireRole("COMPLIANCE", "ADMIN"));

router.get("/flags", getComplianceFlags);
router.get("/reports", getReports);
router.post("/reports", createComplianceReport);

export default router;
