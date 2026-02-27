import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getCustomers,
    getCustomer,
    getCustomerStats,
    addCustomerNote,
    getCustomerTransactions,
    exportCustomers,
    approveCustomer
} from "./customer.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

// Customer routes
router.get("/", getCustomers);
router.get("/stats", getCustomerStats);
router.get("/export", exportCustomers);
router.get("/:id", getCustomer);
router.get("/:id/transactions", getCustomerTransactions);
router.post("/:id/notes", addCustomerNote);
router.patch("/:id/approve", approveCustomer);

export default router;
