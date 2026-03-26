import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Get customer's saved suppliers
 * GET /api/customer/portal/suppliers
 */
export async function getSuppliers(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        if (!customerId) {
            return res.status(403).json({ error: "Customer profile not found" });
        }

        const supplierLinks = await prisma.supplierCustomer.findMany({
            where: { customerId },
            include: { supplier: true },
            orderBy: { createdAt: "desc" },
        });

        const suppliers = supplierLinks.map(link => link.supplier);
        res.json(suppliers);
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ error: "Failed to fetch suppliers" });
    }
}
