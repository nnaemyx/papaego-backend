import { Request, Response, NextFunction } from "express";
import { getComplianceStatus, getStatusHistory } from "./status.service";

export async function getStatus(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId } = req.query;

        if (!organizationId || typeof organizationId !== "string") {
            return res.status(400).json({ error: "organizationId query parameter is required." });
        }

        const status = await getComplianceStatus(organizationId, userId);
        res.json(status);
    } catch (error: any) {
        if (error.message?.includes("denied") || error.message?.includes("not found")) {
            return res.status(403).json({ error: error.message });
        }
        next(error);
    }
}

export async function getHistory(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId, limit } = req.query;

        if (!organizationId || typeof organizationId !== "string") {
            return res.status(400).json({ error: "organizationId query parameter is required." });
        }

        const history = await getStatusHistory(
            organizationId,
            userId,
            limit ? parseInt(limit as string, 10) : 50
        );
        res.json({ history });
    } catch (error: any) {
        if (error.message?.includes("denied")) {
            return res.status(403).json({ error: error.message });
        }
        next(error);
    }
}
