"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const fx_controller_1 = require("./fx.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.auth);
router.get("/rate", fx_controller_1.getRate);
exports.default = router;
