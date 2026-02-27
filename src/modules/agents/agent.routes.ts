import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import { upload } from "../../middlewares/upload.middleware";
import {
    createTrade,
    verifyCustomer,
    quoteTrade,
    sendToCustomer,
    confirmPayout
} from "./agent.trade.controller";
import {
    getDashboardStats,
    getAgentTrades,
    getAgentTrade
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

const router = Router();

router.use(auth);
router.use(requireRole("AGENT"));

// Dashboard
router.get("/dashboard/stats", getDashboardStats);

// Profile
import { getAgentProfile, updateAgentProfile, updateAgentPassword, uploadProfileAvatar } from "./agent.profile.controller";
router.get("/profile", getAgentProfile);
router.put("/profile", updateAgentProfile);
router.put("/profile/password", updateAgentPassword);
router.post("/profile/avatar", upload.single("avatar"), uploadProfileAvatar);

// Customers
router.get("/customers", getAgentCustomers);
router.get("/customers/stats", getAgentCustomerStats);
router.get("/customers/:id", getAgentCustomer);

// Documents
router.get("/documents", getAgentDocuments);
router.get("/documents/:id", getAgentDocument);
router.post("/documents", uploadAgentDocument);
router.patch("/documents/:id", updateDocumentStatus);
router.delete("/documents/:id", deleteDocument);

// Trades
router.get("/trades", getAgentTrades);
router.get("/trades/:id", getAgentTrade);
router.post("/trades", upload.single("paymentProof"), createTrade);
router.post("/trades/:id/verify-customer", verifyCustomer);
router.post("/trades/:id/quote", quoteTrade);
router.post("/trades/:id/send", sendToCustomer);
router.post("/trades/:id/confirm-payout", confirmPayout);

export default router;
