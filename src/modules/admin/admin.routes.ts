import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import {
    createAgent,
    suspendAgent,
    setFxMargin,
    listAllTrades,
    approveOverride
} from "./admin.controller";

const router = Router();

router.use(auth);
router.use(requireRole("ADMIN"));

router.post("/agents", createAgent);
router.post("/agents/:id/suspend", suspendAgent);
router.post("/fx-margins", setFxMargin);
router.get("/trades", listAllTrades);
router.post("/overrides/:id/approve", approveOverride);

export default router;
