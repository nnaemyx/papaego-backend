import { Router } from "express";
import { login, signup } from "./auth.controller";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, signupSchema } from "./auth.schema";

const router = Router();

router.post("/signup", validate(signupSchema), signup);
router.post("/login", validate(loginSchema), login);

export default router;
