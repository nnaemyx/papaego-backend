import { Request, Response } from "express";
import prisma from "../../config/db";
import { createNotification } from "../notifications/notification.service";

/**
 * PATCH /api/admin/transactions/:id/receipt
 * Admin uploads a receipt/invoice and notifies the customer.
 * Uses uploadToCloudinary multer middleware in the route.
 * req.file.path is the Cloudinary URL.
 */
export async function uploadTradeReceipt(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const trade = await prisma.trade.findUnique({
            where: { id },
            include: {
                customer: { select: { id: true, userId: true, fullName: true } },
            },
        });

        if (!trade) return res.status(404).json({ error: "Trade not found" });
        if (!req.file) return res.status(400).json({ error: "No receipt file uploaded" });

        // multer-storage-cloudinary puts the Cloudinary URL in req.file.path
        const receiptUrl = (req.file as any).path || (req.file as any).secure_url;

        await (prisma.trade as any).update({
            where: { id },
            data: { receiptUrl },
        });

        // Notify the customer
        if ((trade as any).customer?.userId) {
            await createNotification(
                (trade as any).customer.userId,
                "Invoice / Receipt Ready",
                "Admin has uploaded a receipt for your trade. Please log in to view it.",
                "INFO"
            );
        }

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "TRADE_RECEIPT_UPLOADED",
                entity: "Trade",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true, receiptUrl });
    } catch (error) {
        console.error("Error uploading receipt:", error);
        res.status(500).json({ error: "Failed to upload receipt" });
    }
}
