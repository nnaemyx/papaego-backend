import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { supplierCreateSchema, supplierUpdateSchema } from "./supplier.schema";
import {
    getSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier
} from "./supplier.controller";

const router = Router();

// Require all users trying to manage their personal suppliers to be authenticated
// Allow CUSTOMER, ORG_OWNER, and ORG_ADMIN roles (business users)
router.use(auth);
router.use(requireRole("CUSTOMER", "ORG_OWNER", "ORG_ADMIN"));

// Supplier routes
router.get("/", getSuppliers);
router.post("/", validate(supplierCreateSchema), createSupplier);
router.put("/:id", validate(supplierUpdateSchema), updateSupplier);
router.delete("/:id", deleteSupplier);

export default router;
