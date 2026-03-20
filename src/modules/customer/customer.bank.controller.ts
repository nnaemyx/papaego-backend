import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Save or update customer's bank details
 * POST /api/customer/portal/bank-details
 */
export async function upsertBankDetails(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        if (!customerId) {
            return res.status(403).json({ error: "Customer profile not found" });
        }

        const {
            bankName,
            accountName,
            accountNumber,
            routingNumber,
            swiftCode
        } = req.body;

        if (!bankName || !accountName || !accountNumber) {
            return res.status(400).json({ error: "Bank name, account name, and account number are required" });
        }

        // Upsert logic (find first, then update or create)
        const existing = await prisma.customerBankDetails.findFirst({
            where: { customerId }
        });

        if (existing) {
            const updated = await prisma.customerBankDetails.update({
                where: { id: existing.id },
                data: {
                    bankName,
                    accountName,
                    accountNumber,
                    routingNumber,
                    swiftCode
                }
            });
            return res.json(updated);
        }

        const created = await prisma.customerBankDetails.create({
            data: {
                customerId,
                bankName,
                accountName,
                accountNumber,
                routingNumber,
                swiftCode
            }
        });

        res.status(201).json(created);
    } catch (error) {
        console.error("Error saving bank details:", error);
        res.status(500).json({ error: "Failed to save bank details" });
    }
}

/**
 * Get customer's bank details
 * GET /api/customer/portal/bank-details
 */
export async function getBankDetails(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const details = await prisma.customerBankDetails.findFirst({
            where: { customerId }
        });
        res.json(details || {});
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch bank details" });
    }
}
