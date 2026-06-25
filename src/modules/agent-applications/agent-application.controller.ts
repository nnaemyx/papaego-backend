import { Request, Response } from "express";
import prisma from "../../config/db";

// ── Public: Submit an agent application ─────────────────────────────────────
export async function submitApplication(req: Request, res: Response) {
    const {
        fullName,
        email,
        phone,
        country,
        stateCity,
        occupation,
        linkedIn,
        hearAboutUs,
        ownsOrOperatesBusiness,
        whyAgent,
        networkSize,
    } = req.body;

    // Basic validation
    if (!fullName || !email || !phone || !country || !stateCity || !occupation || !hearAboutUs || !whyAgent) {
        return res.status(400).json({ error: "Please fill in all required fields." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email address." });
    }

    try {
        const application = await prisma.agentApplication.create({
            data: {
                fullName: fullName.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim(),
                country: country.trim(),
                stateCity: stateCity.trim(),
                occupation: occupation.trim(),
                linkedIn: linkedIn?.trim() || null,
                hearAboutUs: hearAboutUs.trim(),
                ownsOrOperatesBusiness: Boolean(ownsOrOperatesBusiness),
                whyAgent: whyAgent.trim(),
                networkSize: networkSize?.trim() || null,
            },
        });

        return res.status(201).json({
            message: "Application submitted successfully. We'll be in touch soon!",
            id: application.id,
        });
    } catch (error) {
        console.error("submitApplication error:", error);
        return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
}

// ── Admin: List all applications ─────────────────────────────────────────────
export async function getApplications(req: Request, res: Response) {
    const { status, page = "1", limit = "20", search } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};

    if (status && status !== "ALL") {
        where.status = status;
    }

    if (search) {
        where.OR = [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { country: { contains: search, mode: "insensitive" } },
            { occupation: { contains: search, mode: "insensitive" } },
        ];
    }

    try {
        const [applications, total] = await Promise.all([
            prisma.agentApplication.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limitNum,
            }),
            prisma.agentApplication.count({ where }),
        ]);

        return res.json({
            applications,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
        });
    } catch (error) {
        console.error("getApplications error:", error);
        return res.status(500).json({ error: "Failed to fetch applications." });
    }
}

// ── Admin: Get single application ────────────────────────────────────────────
export async function getApplication(req: Request, res: Response) {
    const { id } = req.params;

    try {
        const application = await prisma.agentApplication.findUnique({ where: { id } });

        if (!application) {
            return res.status(404).json({ error: "Application not found." });
        }

        return res.json(application);
    } catch (error) {
        console.error("getApplication error:", error);
        return res.status(500).json({ error: "Failed to fetch application." });
    }
}

// ── Admin: Update application status ─────────────────────────────────────────
export async function updateApplicationStatus(req: Request, res: Response) {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const validStatuses = ["PENDING", "REVIEWED", "APPROVED", "REJECTED"];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(", ")}` });
    }

    try {
        const application = await prisma.agentApplication.update({
            where: { id },
            data: {
                status,
                adminNotes: adminNotes?.trim() || undefined,
            },
        });

        return res.json({
            message: "Application status updated.",
            application,
        });
    } catch (error: any) {
        if (error?.code === "P2025") {
            return res.status(404).json({ error: "Application not found." });
        }
        console.error("updateApplicationStatus error:", error);
        return res.status(500).json({ error: "Failed to update application." });
    }
}

// ── Admin: Get application stats ──────────────────────────────────────────────
export async function getApplicationStats(req: Request, res: Response) {
    try {
        const [total, pending, reviewed, approved, rejected] = await Promise.all([
            prisma.agentApplication.count(),
            prisma.agentApplication.count({ where: { status: "PENDING" } }),
            prisma.agentApplication.count({ where: { status: "REVIEWED" } }),
            prisma.agentApplication.count({ where: { status: "APPROVED" } }),
            prisma.agentApplication.count({ where: { status: "REJECTED" } }),
        ]);

        return res.json({ total, pending, reviewed, approved, rejected });
    } catch (error) {
        console.error("getApplicationStats error:", error);
        return res.status(500).json({ error: "Failed to fetch stats." });
    }
}
