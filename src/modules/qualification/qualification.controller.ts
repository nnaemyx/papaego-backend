import { Request, Response, NextFunction } from "express";
import { submitQualification, getQualificationStatus } from "./qualification.service";

export async function submitQualificationHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const result = await submitQualification(userId, req.body);
        res.status(201).json(result);
    } catch (error: any) {
        if (error.message?.includes("not found") || error.message?.includes("denied") || error.message?.includes("already")) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
}

export async function getQualificationStatusHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { organizationId } = req.query;
        if (!organizationId || typeof organizationId !== "string") {
            return res.status(400).json({ error: "organizationId query parameter is required." });
        }
        const assessment = await getQualificationStatus(userId, organizationId);
        if (!assessment) {
            return res.status(404).json({ error: "Qualification assessment not found. Please complete the qualification questionnaire." });
        }
        res.json({ assessment });
    } catch (error: any) {
        if (error.message?.includes("denied")) {
            return res.status(403).json({ error: error.message });
        }
        next(error);
    }
}
