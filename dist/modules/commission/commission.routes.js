"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const commission_controller_1 = require("./commission.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.use((0, rbac_middleware_1.requireRole)("ADMIN"));
// Commission routes
router.get("/", commission_controller_1.getCommissions);
router.get("/stats", commission_controller_1.getCommissionStats);
router.get("/export", commission_controller_1.exportCommissions);
router.get("/:id", commission_controller_1.getCommission);
router.patch("/:id/status", commission_controller_1.updateCommissionStatus);
router.post("/:id/notes", commission_controller_1.addCommissionNote);
exports.default = router;
