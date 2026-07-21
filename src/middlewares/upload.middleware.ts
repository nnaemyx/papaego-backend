import multer from "multer";
import path from "path";
import crypto from "crypto";
import { cloudinaryUpload as cloudinaryStorage } from "../services/cloudinary.service";

import fs from "fs";

// Ensure local uploads directory exists
const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Define storage location and filename for LOCAL fallback
const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + crypto.randomBytes(4).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

// File filter (optional but good for security)
const fileFilter = (req: any, file: any, cb: any) => {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "application/pdf"
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Invalid file type. Only JPG, PNG, and PDF are allowed."), false);
    }
};

export const upload = multer({
    storage: localStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter
});

const hasCloudinaryKeys = 
    process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET;

export const uploadToCloudinary = hasCloudinaryKeys ? cloudinaryStorage : upload;

// Alias used by compliance document upload routes (uses Cloudinary if keys present, disk otherwise)
export const uploadMiddleware = hasCloudinaryKeys ? cloudinaryStorage : upload;


