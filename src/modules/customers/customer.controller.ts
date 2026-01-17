import { Request, Response } from "express";
import prisma from "../../config/db";

export async function startKyc(req: Request, res: Response) {
    const { bvn, phone, email, fullName } = req.body;

    const customer = await prisma.customer.create({
        data: {
            bvn,
            fullName: fullName || "Unknown",
            phone,
            email,
            userId: (req as any).user.id
        }
    });

    // Call external BVN service here (mocked)
    const verifiedData = {
        fullName: "John Doe",
        bankName: "GTBank",
        accountNo: "0123456789"
    };

    res.json({
        verificationResult: verifiedData
    });
}

export async function confirmKyc(req: Request, res: Response) {
    const { customerId } = req.body;

    await prisma.customer.update({
        where: { id: customerId },
        data: { verified: true }
    });

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "CUSTOMER",
            action: "CUSTOMER_KYC_CONFIRMED",
            entity: "Customer",
            entityId: customerId,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ verified: true });
}
