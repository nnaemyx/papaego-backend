import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    getSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier
} from "./supplier.controller";

const router = Router();

// Require all users trying to manage their personal suppliers to be CUSTOMERs
router.use(auth);
router.use(requireRole("CUSTOMER"));

// Supplier routes
router.get("/", getSuppliers);
router.post("/", createSupplier);
router.put("/:id", updateSupplier);
router.delete("/:id", deleteSupplier);

export default router;
