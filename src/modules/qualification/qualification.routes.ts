import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { submitQualificationHandler, getQualificationStatusHandler } from "./qualification.controller";
import { qualificationSchema } from "./qualification.schema";

const router = Router();

router.use(auth);

router.post("/", validate(qualificationSchema), submitQualificationHandler);
router.get("/status", getQualificationStatusHandler);

export default router;
