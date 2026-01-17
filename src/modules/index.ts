import { Router } from "express";
import tradeRoutes from "./trades/trade.routes";
import webhookRoutes from "./webhooks/webhook.routes";
import customerRoutes from "./customers/customer.routes";
import agentRoutes from "./agents/agent.routes";
import adminRoutes from "./admin/admin.routes";
import authRoutes from "./auth/auth.routes";
import complianceRoutes from "./compliance/compliance.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/trades", tradeRoutes); // Keeping original trade routes for now, though logic might be moving to specific role routes
router.use("/webhooks", webhookRoutes);
router.use("/customer", customerRoutes);
router.use("/agent", agentRoutes);
router.use("/admin", adminRoutes);
router.use("/compliance", complianceRoutes);

export default router;
