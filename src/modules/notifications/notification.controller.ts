import { Request, Response } from "express";
import * as notificationService from "./notification.service";

export async function getNotifications(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        const notifications = await notificationService.getUserNotifications(userId);
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
}

export async function markRead(req: Request, res: Response) {
    try {
        const { id } = req.params;
        await notificationService.markAsRead(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
}

export async function markAllRead(req: Request, res: Response) {
    try {
        const userId = (req as any).user.id;
        await notificationService.markAllAsRead(userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
}
