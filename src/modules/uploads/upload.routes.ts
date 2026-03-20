import { Router } from "express";
import { uploadToCloudinary } from "../../middlewares/upload.middleware";
import { uploadFile } from "./upload.controller";
import { auth } from "../../middlewares/auth.middleware";

const router = Router();

// Generic upload endpoint - Requires authentication
router.post("/", auth, uploadToCloudinary.single("file"), uploadFile);

export default router;
