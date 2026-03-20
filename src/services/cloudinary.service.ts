import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Setup Multer Storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "papaego-uploads",
      format: "png", // transform to png
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  },
});

export const cloudinaryUpload = multer({ storage: storage });

/**
 * Direct upload to cloudinary from a buffer or stream (if needed)
 */
export async function uploadToCloudinary(filePath: string, folder: string = "papaego-uploads") {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
    });
    return result.secure_url;
  } catch (error) {
    console.error("Cloudinary upload failed:", error);
    throw new Error("Failed to upload image to Cloudinary");
  }
}

export default cloudinary;
