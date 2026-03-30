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
    approveCustomer,
    deleteCustomer,
    restrictCustomer,
    sendCustomerMessage
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
router.delete("/:id", deleteCustomer);
router.patch("/:id/restrict", restrictCustomer);
router.post("/:id/message", sendCustomerMessage);

export default router;
