"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotifications = getNotifications;
exports.markRead = markRead;
exports.markAllRead = markAllRead;
const notificationService = __importStar(require("./notification.service"));
async function getNotifications(req, res) {
    try {
        const userId = req.user.id;
        const notifications = await notificationService.getUserNotifications(userId);
        res.json(notifications);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
}
async function markRead(req, res) {
    try {
        const { id } = req.params;
        await notificationService.markAsRead(id);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
}
async function markAllRead(req, res) {
    try {
        const userId = req.user.id;
        await notificationService.markAllAsRead(userId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
}
