import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { sendMessage, getMessages } from "./chat.controller";

const router = Router();

router.use(auth);

router.post("/messages", sendMessage);
router.get("/messages/:tradeId", getMessages);

export default router;
