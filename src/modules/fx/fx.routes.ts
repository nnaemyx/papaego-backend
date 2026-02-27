import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { getRate } from "./fx.controller";

const router = Router();

router.use(auth);

router.get("/rate", getRate);

export default router;
