"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentProfile = getAgentProfile;
exports.updateAgentProfile = updateAgentProfile;
exports.updateAgentPassword = updateAgentPassword;
exports.uploadProfileAvatar = uploadProfileAvatar;
const bcrypt_1 = __importDefault(require("bcrypt"));
const db_1 = __importDefault(require("../../config/db"));
async function getAgentProfile(req, res) {
    try {
        const userId = req.user.id;
        const user = await db_1.default.user.findUnique({
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
    }
    catch (error) {
        console.error("Error fetching agent profile:", error);
        res.status(500).json({ error: "Failed to fetch agent profile" });
    }
}
async function updateAgentProfile(req, res) {
    try {
        const userId = req.user.id;
        const { firstName, lastName, phone, address } = req.body;
        const updatedUser = await db_1.default.user.update({
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
    }
    catch (error) {
        console.error("Error updating agent profile:", error);
        res.status(500).json({ error: "Failed to update agent profile" });
    }
}
async function updateAgentPassword(req, res) {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;
        const user = await db_1.default.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        const isValid = await bcrypt_1.default.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid current password" });
        }
        const hashedNewPassword = await bcrypt_1.default.hash(newPassword, 10);
        await db_1.default.user.update({
            where: { id: userId },
            data: {
                password: hashedNewPassword
            }
        });
        res.json({ success: true, message: "Password updated successfully" });
    }
    catch (error) {
        console.error("Error updating agent password:", error);
        res.status(500).json({ error: "Failed to update password" });
    }
}
async function uploadProfileAvatar(req, res) {
    try {
        const userId = req.user.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        // Build the public URL path for the uploaded file
        const avatarUrl = `/uploads/${file.filename}`;
        // Store the avatar URL in governmentIdUrl as a quick solution (no schema migration needed)
        await db_1.default.agentProfile.update({
            where: { userId },
            data: { governmentIdUrl: avatarUrl }
        });
        res.json({ success: true, avatarUrl });
    }
    catch (error) {
        console.error("Error uploading avatar:", error);
        res.status(500).json({ error: "Failed to upload avatar" });
    }
}
