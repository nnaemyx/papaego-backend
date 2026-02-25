"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = auth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function auth(req, res, next) {
    console.log("🔐 Auth middleware triggered");
    console.log("📋 Headers:", req.headers.authorization);
    console.log("🔑 JWT_SECRET exists:", !!process.env.JWT_SECRET);
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        console.log("❌ No token provided");
        return res.status(401).json({ error: "Unauthorized" });
    }
    console.log("🎫 Token received:", token.substring(0, 20) + "...");
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        console.log("✅ Token verified successfully:", payload);
        req.user = payload;
        next();
    }
    catch (error) {
        console.log("❌ Token verification failed:", error);
        return res.status(401).json({ error: "Invalid token" });
    }
}
