import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Send a chat message for a trade
 * POST /api/chat/messages
 */
export async function sendMessage(req: Request, res: Response) {
    try {
        const { tradeId, message } = req.body;
        const userId = (req as any).user.id;
        const role = (req as any).user.role;

        if (!tradeId || !message) {
            return res.status(400).json({ error: "Trade ID and message are required" });
        }

        // Verify trade existence
        const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        const chatMessage = await (prisma as any).chatMessage.create({
            data: {
                tradeId,
                senderId: userId,
                message,
                role
            }
        });

        res.status(201).json(chatMessage);
    } catch (error) {
        console.error("Error sending chat message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
}

/**
 * Get chat messages for a trade
 * GET /api/chat/messages/:tradeId
 */
export async function getMessages(req: Request, res: Response) {
    try {
        const { tradeId } = req.params;

        const messages = await (prisma as any).chatMessage.findMany({
            where: { tradeId },
            orderBy: { createdAt: "asc" }
        });

        res.json(messages);
    } catch (error) {
        console.error("Error fetching chat messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
}
