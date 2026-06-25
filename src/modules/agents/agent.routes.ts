import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import { uploadToCloudinary } from "../../middlewares/upload.middleware";
import {
    createTrade,
    verifyCustomer,
    quoteTrade,
    sendToCustomer,
    confirmPayout,
    cancelTrade
} from "./agent.trade.controller";
import {
    getDashboardStats,
    getAgentTrades,
    getAgentTrade,
    getAgentCommissions,
    getFxRatesForAgent,
    getAgentReferral
} from "./agent.controller";
import {
    getAgentCustomers,
    getAgentCustomer,
    getAgentCustomerStats
} from "./agent.customers.controller";
import {
    getAgentDocuments,
    getAgentDocument,
    uploadAgentDocument,
    updateDocumentStatus,
    deleteDocument
} from "./agent.documents.controller";
import {
    getAgentTradeRequests,
    rejectTradeRequest,
    claimTradeRequest,
    setTradeRequestRate
} from "./agent.request.controller";
import { getAgentReferralLink, getAgentReferrals } from "./referral.controller";
import { requestCashout, getAgentCashoutStatus } from "./agent.cashout.controller";

const router = Router();

router.use(auth);
router.use(requireRole("AGENT"));

// Dashboard
router.get("/dashboard/stats", getDashboardStats);
router.get("/commissions", getAgentCommissions);

// Cashout Requests
router.post("/cashout/request", requestCashout);
router.get("/cashout/status", getAgentCashoutStatus);

// Profile
import { getAgentProfile, updateAgentProfile, updateAgentPassword, uploadProfileAvatar } from "./agent.profile.controller";
router.get("/profile", getAgentProfile);
router.put("/profile", updateAgentProfile);
router.put("/profile/password", updateAgentPassword);
router.post("/profile/avatar", uploadToCloudinary.single("avatar"), uploadProfileAvatar);

// Referral
router.get("/referral", getAgentReferral);
router.get("/referral-link", getAgentReferralLink);
router.get("/referrals", getAgentReferrals);

// FX Rates (read admin-configured rates)
router.get("/fx-rates", getFxRatesForAgent);

// Customers — static routes MUST come before parameterized /:id routes
router.get("/customers", getAgentCustomers);
router.get("/customers/stats", getAgentCustomerStats); // Must be before /:id
router.get("/customers/:id", getAgentCustomer);

// Documents
router.get("/documents", getAgentDocuments);
router.get("/documents/:id", getAgentDocument);
router.post("/documents", uploadToCloudinary.single("document"), uploadAgentDocument);
router.patch("/documents/:id", updateDocumentStatus);
router.delete("/documents/:id", deleteDocument);

// Trade Requests
router.get("/trade-requests", getAgentTradeRequests);
router.patch("/trade-requests/:id/reject", rejectTradeRequest);
router.patch("/trade-requests/:id/claim", claimTradeRequest);
router.patch("/trade-requests/:id/set-rate", setTradeRequestRate);

// Trades
router.get("/trades", getAgentTrades);
router.get("/trades/:id", getAgentTrade);
router.post("/trades", uploadToCloudinary.single("paymentProof"), createTrade);
router.post("/trades/:id/verify-customer", verifyCustomer);
router.post("/trades/:id/quote", quoteTrade);
router.post("/trades/:id/send", sendToCustomer);
router.post("/trades/:id/confirm-payout", confirmPayout);
router.post("/trades/:id/cancel", cancelTrade);

export default router;

