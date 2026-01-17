import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import { startKyc, confirmKyc } from "./customer.controller";
import {
    confirmSupplier,
    getTradeSummary,
    confirmPayment,
    getCustomerTrade
} from "./customer.trade.controller";

const router = Router();

// Middleware
router.use(auth);
router.use(requireRole("CUSTOMER"));

// KYC
router.post("/kyc/start", startKyc);
router.post("/kyc/confirm", confirmKyc);

// Trades
router.get("/trades/:id", getCustomerTrade);
router.get("/trades/:id/summary", getTradeSummary);
router.post("/trades/:id/confirm-supplier", confirmSupplier);
router.post("/trades/:id/confirm-payment", confirmPayment);

export default router;
