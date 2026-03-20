import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { verifyAccount } from "./bank.controller";

const router = Router();

// Bank verification is available to all authenticated users
router.use(auth);

router.post("/verify", verifyAccount);

export default router;
