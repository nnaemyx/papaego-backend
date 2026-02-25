"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const customer_controller_1 = require("./customer.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("ADMIN"));
// Customer routes
router.get("/", customer_controller_1.getCustomers);
router.get("/stats", customer_controller_1.getCustomerStats);
router.get("/export", customer_controller_1.exportCustomers);
router.get("/:id", customer_controller_1.getCustomer);
router.get("/:id/transactions", customer_controller_1.getCustomerTransactions);
router.post("/:id/notes", customer_controller_1.addCustomerNote);
exports.default = router;
