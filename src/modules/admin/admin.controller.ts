import { Request, Response } from "express";
import prisma from "../../config/db";

export async function createAgent(req: Request, res: Response) {
    const { email, phone, countryId, licenseId } = req.body;

    const user = await prisma.user.create({
        data: {
            email,
            phone,
            role: "AGENT",
            password: "TEMP_PASSWORD" // In real app, this should be hashed
        }
    });

    await prisma.agentProfile.create({
        data: {
            userId: user.id,
            countryId,
            licenseId,
            lga: "Default", // Missing in snippet but required by schema
            dailyLimit: 50000,
            monthlyLimit: 500000
        }
    });

    res.json(user);
}

export async function suspendAgent(req: Request, res: Response) {
    await prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: false }
    });

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "ADMIN",
            action: "AGENT_SUSPENDED",
            entity: "User",
            entityId: req.params.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    res.json({ suspended: true });
}

export async function setFxMargin(req: Request, res: Response) {
    const { countryId, margin } = req.body;

    await prisma.fxMargin.upsert({
        where: { countryId },
        update: { margin },
        create: { countryId, margin }
    });

    res.json({ updated: true });
}

export async function listAllTrades(req: Request, res: Response) {
    const trades = await prisma.trade.findMany({
        orderBy: { createdAt: "desc" }
    });

    res.json(trades);
}

export async function approveOverride(req: Request, res: Response) {
    const override = await prisma.overrideApproval.findUnique({
        where: { id: req.params.id }
    });

    if (!override) return res.status(404).json({ error: "Override not found" });

    if (override.requestedBy === (req as any).user.id) {
        return res.status(403).json({ error: "Maker cannot approve" });
    }

    await prisma.overrideApproval.update({
        where: { id: override.id },
        data: {
            status: "APPROVED",
            approvedBy: (req as any).user.id
        }
    });

    res.json({ approved: true });
}
