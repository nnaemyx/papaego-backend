import { Request, Response, NextFunction } from "express";
import * as OrgService from "./organization.service";

export async function createOrganization(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const org = await OrgService.createOrganization(userId, req.body);
        res.status(201).json({ organization: org });
    } catch (error: any) {
        if (error.message?.includes("already created")) {
            return res.status(409).json({ error: error.message });
        }
        next(error);
    }
}

export async function getOrganization(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const org = await OrgService.getOrganizationById(req.params.id, userId);
        res.json({ organization: org });
    } catch (error: any) {
        if (error.message?.includes("not found") || error.message?.includes("denied")) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
}

export async function getMyOrganization(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const org = await OrgService.getMyOrganization(userId);
        if (!org) return res.status(404).json({ error: "No organization found for your account." });
        res.json({ organization: org });
    } catch (error) {
        next(error);
    }
}

export async function updateOrganization(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const org = await OrgService.updateOrganization(req.params.id, userId, req.body);
        res.json({ organization: org });
    } catch (error: any) {
        if (error.message?.includes("not found") || error.message?.includes("denied") || error.message?.includes("activation")) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
}

export async function getOrganizationMembers(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const members = await OrgService.getOrganizationMembers(req.params.id, userId);
        res.json({ members });
    } catch (error: any) {
        if (error.message?.includes("denied")) {
            return res.status(403).json({ error: error.message });
        }
        next(error);
    }
}

export async function inviteMember(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = (req as any).user.id;
        const { email, role } = req.body;
        const member = await OrgService.inviteMember(req.params.id, userId, email, role || "MEMBER");
        res.status(201).json({ member });
    } catch (error: any) {
        if (error.message?.includes("not found") || error.message?.includes("denied") || error.message?.includes("already a member")) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
}
