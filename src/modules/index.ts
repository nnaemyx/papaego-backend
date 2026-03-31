import { Router } from "express";
import tradeRoutes from "./trades/trade.routes";
import webhookRoutes from "./webhooks/webhook.routes";
import customerRoutes from "./customers/customer.routes";
import agentRoutes from "./agents/agent.routes";
import agentOnboardingRoutes from "./agents/agent.onboarding.routes";
import adminRoutes from "./admin/admin.routes";
import adminCustomerRoutes from "./customer/customer.routes";
import adminCommissionRoutes from "./commission/commission.routes";
import adminAuditRoutes from "./audit/audit.routes";
import authRoutes from "./auth/auth.routes";
import complianceRoutes from "./compliance/compliance.routes";
import notificationRoutes from "./notifications/notification.routes";
import fxRoutes from "./fx/fx.routes";
import customerPortalRoutes from "./customer/customer.portal.routes";
import bankRoutes from "./bank/bank.routes";
import chatRoutes from "./chat/chat.routes";
import uploadRoutes from "./uploads/upload.routes";
import supplierRoutes from "./suppliers/supplier.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/trades", tradeRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/customer/portal", customerPortalRoutes); // Customer self-service portal
router.use("/customer", customerRoutes);
router.use("/agent/onboarding", agentOnboardingRoutes);
router.use("/agent", agentRoutes);
router.use("/admin", adminRoutes);
router.use("/admin/customers", adminCustomerRoutes);
router.use("/admin/commissions", adminCommissionRoutes);
router.use("/admin/audit-logs", adminAuditRoutes);
router.use("/compliance", complianceRoutes);
router.use("/notifications", notificationRoutes);
router.use("/fx", fxRoutes);
router.use("/bank", bankRoutes);
router.use("/chat", chatRoutes);
router.use("/upload", uploadRoutes);
router.use("/suppliers", supplierRoutes);

export default router;
