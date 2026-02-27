import prisma from "../../config/db";

export async function createNotification(userId: string, title: string, message: string, type: 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR' = 'INFO') {
    return prisma.notification.create({
        data: {
            userId,
            title,
            message,
            type
        }
    });
}

export async function getUserNotifications(userId: string) {
    return prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50
    });
}

export async function markAsRead(notificationId: string) {
    return prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
    });
}

export async function markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true }
    });
}
