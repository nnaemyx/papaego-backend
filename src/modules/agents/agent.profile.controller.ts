import { Request, Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../../config/db";
import path from "path";

export async function getAgentProfile(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                agentProfile: true
            }
        });

        if (!user || !user.agentProfile) {
            return res.status(404).json({ error: "Agent profile not found" });
        }

        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        console.error("Error fetching agent profile:", error);
        res.status(500).json({ error: "Failed to fetch agent profile" });
    }
}

export async function updateAgentProfile(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        const { firstName, lastName, phone, address } = req.body;

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                firstName,
                lastName,
                phone,
                agentProfile: {
                    update: {
                        homeAddress: address
                    }
                }
            },
            include: {
                agentProfile: true
            }
        });

        const { password, ...userWithoutPassword } = updatedUser;
        res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
        console.error("Error updating agent profile:", error);
        res.status(500).json({ error: "Failed to update agent profile" });
    }
}

export async function updateAgentPassword(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        const { currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid current password" });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: {
                password: hashedNewPassword
            }
        });

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        console.error("Error updating agent password:", error);
        res.status(500).json({ error: "Failed to update password" });
    }
}

export async function uploadProfileAvatar(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        const file = (req as any).file;

        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // Cloudinary provides the secure_url in file.path (or file.secure_url)
        const avatarUrl = file.path;

        await prisma.agentProfile.update({
            where: { userId },
            data: { governmentIdUrl: avatarUrl }
        });

        res.json({ success: true, avatarUrl });
    } catch (error) {
        console.error("Error uploading avatar:", error);
        res.status(500).json({ error: "Failed to upload avatar" });
    }
}
