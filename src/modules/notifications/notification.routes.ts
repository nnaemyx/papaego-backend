import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { getNotifications, markRead, markAllRead } from "./notification.controller";

const router = Router();

router.use(auth);

router.get("/", getNotifications);
router.post("/mark-all-read", markAllRead);
router.post("/:id/read", markRead);

export default router;
