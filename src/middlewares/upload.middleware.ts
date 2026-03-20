import multer from "multer";
import path from "path";
import crypto from "crypto";
import { cloudinaryUpload as cloudinaryStorage } from "../services/cloudinary.service";

// Define storage location and filename for LOCAL fallback
const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, "../../uploads"));
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

// Cloudinary specific middleware - Enforce Cloudinary usage
const hasCloudinaryKeys = 
    process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET;

if (!hasCloudinaryKeys) {
    console.error("❌ CRITICAL: Cloudinary credentials missing in .env. Uploads will FAIL.");
}

// ALWAYS use Cloudinary storage. If keys are missing, multer will likely throw an error on configuration
// which is better than silently falling back to local storage when the user wants Cloudinary only.
export const uploadToCloudinary = cloudinaryStorage;

