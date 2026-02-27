"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.getUserNotifications = getUserNotifications;
exports.markAsRead = markAsRead;
exports.markAllAsRead = markAllAsRead;
const db_1 = __importDefault(require("../../config/db"));
async function createNotification(userId, title, message, type = 'INFO') {
    return db_1.default.notification.create({
        data: {
            userId,
            title,
            message,
            type
        }
    });
}
async function getUserNotifications(userId) {
    return db_1.default.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
    });
}
async function markAsRead(notificationId) {
    return db_1.default.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
    });
}
async function markAllAsRead(userId) {
    return db_1.default.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true }
    });
}
