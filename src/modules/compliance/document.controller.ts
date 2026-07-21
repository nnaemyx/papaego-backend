import { Request, Response, NextFunction } from "express";
import prisma from "../../config/db";
import * as FvBank from "./fvbank.adapter";

// Upload a verification document (KYC or KYB)
// The file should already be uploaded to Cloudinary via the existing upload middleware
export async function uploadDocument(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId, kycRequestId, kybRequestId, documentType } = req.body;
        const file = (req as any).file;

        if (!file) return res.status(400).json({ error: "No file uploaded." });
        if (!kycRequestId && !kybRequestId) {
            return res.status(400).json({ error: "Either kycRequestId or kybRequestId is required." });
        }

        // Verify membership
        const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId } });
        if (!membership) return res.status(403).json({ error: "Access denied." });

        // Save document record
        const doc = await prisma.verificationDocument.create({
            data: {
                organizationId,
                kycRequestId: kycRequestId || null,
                kybRequestId: kybRequestId || null,
                documentType,
                fileUrl: file.path || file.secure_url || file.url || file.filename || `/uploads/${file.originalname}`,
                fileName: file.originalname,
                fileSize: file.size,
                mimeType: file.mimetype,
                uploadedBy: userId
            }
        });

        // Try to upload to FV Bank
        const applicationId = kycRequestId
            ? (await prisma.kycRequest.findUnique({ where: { id: kycRequestId } }))?.fvBankApplicationId
            : (await prisma.kybRequest.findUnique({ where: { id: kybRequestId! } }))?.fvBankApplicationId;

        if (applicationId) {
            try {
                const fvResponse = await FvBank.uploadDocument(
                    applicationId,
                    kycRequestId ? "KYC" : "KYB",
                    documentType,
                    doc.fileUrl,
                    doc.fileName
                );

                await prisma.verificationDocument.update({
                    where: { id: doc.id },
                    data: { fvBankDocId: fvResponse.documentId }
                });
            } catch (fvErr: any) {
                console.error("⚠️  Failed to forward document to FV Bank:", fvErr.message);
                // Don't fail the upload — document is saved and can be re-sent
            }
        }

        res.status(201).json({
            message: "Document uploaded successfully.",
            document: doc
        });
    } catch (error) {
        next(error);
    }
}
