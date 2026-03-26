import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * GET /api/admin/suppliers
 * List all suppliers with optional search/sector filter and pagination
 */
export async function getSuppliers(req: Request, res: Response) {
    try {
        const { search, sector, page = "1", limit = "20" } = req.query;
        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const where: any = {};
        if (sector) where.sector = sector;
        if (search) {
            where.OR = [
                { businessName: { contains: search as string, mode: "insensitive" } },
                { bankName: { contains: search as string, mode: "insensitive" } },
                { accountNumber: { contains: search as string, mode: "insensitive" } },
            ];
        }

        const [suppliers, total] = await Promise.all([
            (prisma as any).supplier.findMany({
                where,
                include: {
                    linkedCustomers: {
                        include: {
                            customer: {
                                select: { id: true, fullName: true, email: true },
                            },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
                take,
                skip,
            }),
            (prisma as any).supplier.count({ where }),
        ]);

        const formatted = suppliers.map((s: any) => ({
            ...s,
            linkedCustomers: s.linkedCustomers.map((sc: any) => ({
                id: sc.customer.id,
                fullName: sc.customer.fullName,
                email: sc.customer.email,
            })),
        }));

        res.json({ suppliers: formatted, total });
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ error: "Failed to fetch suppliers" });
    }
}

/**
 * GET /api/admin/suppliers/:id
 */
export async function getSupplier(req: Request, res: Response) {
    try {
        const supplier = await (prisma as any).supplier.findUnique({
            where: { id: req.params.id },
            include: {
                linkedCustomers: {
                    include: {
                        customer: { select: { id: true, fullName: true, email: true } },
                    },
                },
            },
        });

        if (!supplier) return res.status(404).json({ error: "Supplier not found" });

        res.json({
            ...supplier,
            linkedCustomers: supplier.linkedCustomers.map((sc: any) => ({
                id: sc.customer.id,
                fullName: sc.customer.fullName,
                email: sc.customer.email,
            })),
        });
    } catch (error) {
        console.error("Error fetching supplier:", error);
        res.status(500).json({ error: "Failed to fetch supplier" });
    }
}

/**
 * POST /api/admin/suppliers
 */
export async function createSupplier(req: Request, res: Response) {
    try {
        const { businessName, bankName, accountNumber, sector, address, customerIds = [] } = req.body;

        if (!businessName || !bankName || !accountNumber || !sector) {
            return res.status(400).json({ error: "businessName, bankName, accountNumber and sector are required" });
        }

        const supplier = await (prisma as any).supplier.create({
            data: {
                businessName,
                bankName,
                accountNumber,
                sector,
                address: address || null,
                linkedCustomers: customerIds.length > 0
                    ? {
                          create: (customerIds as string[]).map((cid) => ({ customerId: cid })),
                      }
                    : undefined,
            },
            include: {
                linkedCustomers: {
                    include: {
                        customer: { select: { id: true, fullName: true, email: true } },
                    },
                },
            },
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "SUPPLIER_CREATED",
                entity: "Supplier",
                entityId: supplier.id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.status(201).json({
            ...supplier,
            linkedCustomers: supplier.linkedCustomers.map((sc: any) => ({
                id: sc.customer.id,
                fullName: sc.customer.fullName,
                email: sc.customer.email,
            })),
        });
    } catch (error) {
        console.error("Error creating supplier:", error);
        res.status(500).json({ error: "Failed to create supplier" });
    }
}

/**
 * PATCH /api/admin/suppliers/:id
 */
export async function updateSupplier(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { businessName, bankName, accountNumber, sector, address } = req.body;

        const updateData: any = {};
        if (businessName !== undefined) updateData.businessName = businessName;
        if (bankName !== undefined) updateData.bankName = bankName;
        if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
        if (sector !== undefined) updateData.sector = sector;
        if (address !== undefined) updateData.address = address;

        const supplier = await (prisma as any).supplier.update({
            where: { id },
            data: updateData,
            include: {
                linkedCustomers: {
                    include: {
                        customer: { select: { id: true, fullName: true, email: true } },
                    },
                },
            },
        });

        res.json({
            ...supplier,
            linkedCustomers: supplier.linkedCustomers.map((sc: any) => ({
                id: sc.customer.id,
                fullName: sc.customer.fullName,
                email: sc.customer.email,
            })),
        });
    } catch (error) {
        console.error("Error updating supplier:", error);
        res.status(500).json({ error: "Failed to update supplier" });
    }
}

/**
 * DELETE /api/admin/suppliers/:id
 */
export async function deleteSupplier(req: Request, res: Response) {
    try {
        const { id } = req.params;
        await (prisma as any).supplier.delete({ where: { id } });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "SUPPLIER_DELETED",
                entity: "Supplier",
                entityId: id,
                ip: req.ip || "127.0.0.1",
            },
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting supplier:", error);
        res.status(500).json({ error: "Failed to delete supplier" });
    }
}

/**
 * POST /api/admin/suppliers/:id/link-customer
 */
export async function linkCustomerToSupplier(req: Request, res: Response) {
    try {
        const { id: supplierId } = req.params;
        const { customerId } = req.body;

        if (!customerId) return res.status(400).json({ error: "customerId required" });

        await (prisma as any).supplierCustomer.upsert({
            where: { supplierId_customerId: { supplierId, customerId } },
            create: { supplierId, customerId },
            update: {},
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error linking customer:", error);
        res.status(500).json({ error: "Failed to link customer" });
    }
}

/**
 * DELETE /api/admin/suppliers/:id/link-customer/:customerId
 */
export async function unlinkCustomerFromSupplier(req: Request, res: Response) {
    try {
        const { id: supplierId, customerId } = req.params;

        await (prisma as any).supplierCustomer.deleteMany({
            where: { supplierId, customerId },
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error unlinking customer:", error);
        res.status(500).json({ error: "Failed to unlink customer" });
    }
}

/**
 * GET /api/admin/suppliers/by-customer/:customerId
 */
export async function getSuppliersByCustomer(req: Request, res: Response) {
    try {
        const { customerId } = req.params;

        const links = await (prisma as any).supplierCustomer.findMany({
            where: { customerId },
            include: {
                supplier: true,
            },
        });

        res.json(links.map((l: any) => l.supplier));
    } catch (error) {
        console.error("Error fetching suppliers by customer:", error);
        res.status(500).json({ error: "Failed to fetch suppliers" });
    }
}
