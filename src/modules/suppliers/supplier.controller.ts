import { Request, Response } from "express";
import prisma from "../../config/db";

// GET /api/suppliers
// Get all suppliers for the authenticated customer
export const getSuppliers = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({
            where: { userId }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }

        const suppliers = await prisma.supplier.findMany({
            where: { customerId: customer.id },
            orderBy: { createdAt: "desc" }
        });

        res.json(suppliers);
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ error: "Failed to fetch suppliers" });
    }
};

// POST /api/suppliers
// Create a new supplier
export const createSupplier = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({
            where: { userId }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }

        const {
            beneficiaryName,
            bankName,
            accountNumber,
            iban,
            swiftBic,
            routingCode,
            currency,
            address
        } = req.body;

        // Check for duplicate supplier under this customer
        const duplicate = await prisma.supplier.findFirst({
            where: {
                customerId: customer.id,
                bankName: bankName,
                accountNumber: accountNumber
            }
        });

        if (duplicate) {
            return res.status(409).json({
                error: "A supplier with this bank name and account number already exists for this customer."
            });
        }

        const supplier = await prisma.supplier.create({
            data: {
                customerId: customer.id,
                beneficiaryName,
                bankName,
                accountNumber,
                iban,
                swiftBic,
                routingCode,
                currency,
                address
            }
        });

        res.status(201).json(supplier);
    } catch (error) {
        console.error("Error creating supplier:", error);
        res.status(500).json({ error: "Failed to create supplier" });
    }
};

// PUT /api/suppliers/:id
// Update a supplier
export const updateSupplier = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({
            where: { userId }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }

        const existing = await prisma.supplier.findFirst({
            where: { id, customerId: customer.id }
        });

        if (!existing) {
            return res.status(404).json({ error: "Supplier not found or unauthorized" });
        }

        const { bankName, accountNumber } = req.body;
        if (bankName || accountNumber) {
            // Check if any other supplier has the same bankName and accountNumber
            const duplicate = await prisma.supplier.findFirst({
                where: {
                    customerId: customer.id,
                    bankName: bankName !== undefined ? bankName : existing.bankName,
                    accountNumber: accountNumber !== undefined ? accountNumber : existing.accountNumber,
                    NOT: { id }
                }
            });

            if (duplicate) {
                return res.status(409).json({
                    error: "A supplier with this bank name and account number already exists for this customer."
                });
            }
        }

        const updated = await prisma.supplier.update({
            where: { id },
            data: req.body
        });

        res.json(updated);
    } catch (error) {
        console.error("Error updating supplier:", error);
        res.status(500).json({ error: "Failed to update supplier" });
    }
};

// DELETE /api/suppliers/:id
// Delete a supplier
export const deleteSupplier = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({
            where: { userId }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }

        const existing = await prisma.supplier.findFirst({
            where: { id, customerId: customer.id }
        });

        if (!existing) {
            return res.status(404).json({ error: "Supplier not found or unauthorized" });
        }

        await prisma.supplier.delete({
            where: { id }
        });

        res.json({ message: "Supplier deleted successfully" });
    } catch (error) {
        console.error("Error deleting supplier:", error);
        res.status(500).json({ error: "Failed to delete supplier" });
    }
};
