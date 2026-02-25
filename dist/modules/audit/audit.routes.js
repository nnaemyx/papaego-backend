"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const audit_controller_1 = require("./audit.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("ADMIN"));
// Audit log routes
router.get("/", audit_controller_1.getAuditLogs);
router.get("/stats", audit_controller_1.getAuditLogStats);
router.get("/export", audit_controller_1.exportAuditLogs);
exports.default = router;
