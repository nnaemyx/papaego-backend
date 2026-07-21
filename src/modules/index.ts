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
import marketRoutes from "./market/market.routes";
import agentApplicationRoutes from "./agent-applications/agent-application.routes";
import treasuryRoutes from "./treasury/treasury.routes";
import exchangeRateRoutes from "./exchange-rate/exchange-rate.routes";

// Sprint 1: Organization onboarding & compliance
import organizationRoutes from "./organizations/organization.routes";
import qualificationRoutes from "./qualification/qualification.routes";

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
router.use("/admin/market", marketRoutes);
router.use("/admin/agent-applications", agentApplicationRoutes); // Admin view
router.use("/agent-applications", agentApplicationRoutes); // Public submission
router.use("/compliance", complianceRoutes);
router.use("/notifications", notificationRoutes);
router.use("/fx", fxRoutes);
router.use("/bank", bankRoutes);
router.use("/chat", chatRoutes);
router.use("/upload", uploadRoutes);
router.use("/suppliers", supplierRoutes);
router.use("/treasury", treasuryRoutes);
router.use("/ledger", treasuryRoutes); // Alias for /ledger/entries
router.use("/exchange-rate", exchangeRateRoutes);

// Sprint 1: New onboarding routes
router.use("/organizations", organizationRoutes);
router.use("/qualification", qualificationRoutes);

export default router;

