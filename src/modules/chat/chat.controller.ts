import { Request, Response } from "express";
import prisma from "../../config/db";

/**
 * Send a chat message for a trade
 * POST /api/chat/messages
 */
export async function sendMessage(req: Request, res: Response) {
    try {
        const { tradeId, tradeRequestId, message, imageUrl, fileUrl } = req.body;
        const userId = (req as any).user.id;
        const role = (req as any).user.role;

        // TradeRequest is the primary entity for our new chat flow
        if (!tradeRequestId && !tradeId) {
            return res.status(400).json({ error: "Trade Request ID or Trade ID is required" });
        }

        if (!message && !imageUrl && !fileUrl) {
            return res.status(400).json({ error: "Message content or attachment is required" });
        }

        // Verification & Access Control
        if (tradeRequestId) {
            const tr = await prisma.tradeRequest.findUnique({ 
                where: { id: tradeRequestId },
                include: { customer: true }
            });
            if (!tr) return res.status(404).json({ error: "Trade Request not found" });

            // Restriction: Agents can no longer chat (per new requirement)
            if (role === "AGENT") {
                return res.status(403).json({ error: "Agents are not permitted to use chat" });
            }

            // If Customer, verify ownership
            if (role === "CUSTOMER" && tr.customer.userId !== userId) {
                return res.status(403).json({ error: "Unauthorized access to this chat" });
            }
        }

        const chatMessage = await prisma.chatMessage.create({
            data: {
                tradeId: tradeId || null,
                tradeRequestId: tradeRequestId || null,
                senderId: userId,
                message: message || null,
                imageUrl: imageUrl || null,
                fileUrl: fileUrl || null,
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
 * Get chat messages for a trade or trade request
 * GET /api/chat/messages/:id
 */
export async function getMessages(req: Request, res: Response) {
    try {
        const { id } = req.params; // Generic ID param
        const { isTradeRequest } = req.query;

        let messages: any[] = [];

        if (isTradeRequest === 'true') {
            // Fetch messages directly on this tradeRequest
            const requestMessages = await prisma.chatMessage.findMany({
                where: { tradeRequestId: id },
                orderBy: { createdAt: "asc" }
            });

            // Also find any Trades linked to this tradeRequest and get their messages
            const linkedTrades = await prisma.trade.findMany({
                where: { tradeRequestId: id },
                select: { id: true }
            });

            let tradeMessages: any[] = [];
            if (linkedTrades.length > 0) {
                const linkedTradeIds = linkedTrades.map((t: any) => t.id);
                tradeMessages = await prisma.chatMessage.findMany({
                    where: { tradeId: { in: linkedTradeIds } },
                    orderBy: { createdAt: "asc" }
                });
            }

            // Merge, deduplicate by ID, and sort by createdAt
            const seen = new Set<string>();
            messages = [...requestMessages, ...tradeMessages]
                .filter((m) => {
                    if (seen.has(m.id)) return false;
                    seen.add(m.id);
                    return true;
                })
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        } else {
            messages = await prisma.chatMessage.findMany({
                where: { tradeId: id },
                orderBy: { createdAt: "asc" }
            });
        }

        res.json(messages);
    } catch (error) {
        console.error("Error fetching chat messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
}
