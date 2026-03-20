import { Request, Response } from "express";

/**
 * Handle generic file upload to Cloudinary
 * Returns the secure URL of the uploaded file
 */
export async function uploadFile(req: Request, res: Response) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Multer-storage-cloudinary populates req.file.path with the secure_url
        const fileUrl = (req.file as any).path;

        res.json({ 
            url: fileUrl,
            message: "File uploaded successfully to Cloudinary"
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: "Failed to upload file to Cloudinary" });
    }
}
