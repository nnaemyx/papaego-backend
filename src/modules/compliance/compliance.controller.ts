import { Request, Response } from "express";
import prisma from "../../config/db";

export async function getComplianceFlags(req: Request, res: Response) {
    const flags = await prisma.complianceFlag.findMany({
        orderBy: { createdAt: "desc" }
    });
    res.json(flags);
}

export async function createComplianceReport(req: Request, res: Response) {
    const { tradeId, type, data } = req.body;

    const report = await prisma.complianceReport.create({
        data: {
            tradeId,
            type,
            data
        }
    });

    res.json(report);
}

export async function getReports(req: Request, res: Response) {
    const reports = await prisma.complianceReport.findMany({
        orderBy: { createdAt: "desc" }
    });
    res.json(reports);
}
