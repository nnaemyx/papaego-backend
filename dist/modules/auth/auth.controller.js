"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../../config/db"));
async function signup(req, res, next) {
    try {
        const { email, password, phone, role } = req.body;
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await db_1.default.user.create({
            data: {
                email,
                password: hashedPassword,
                phone,
                role: role || "CUSTOMER"
            }
        });
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
        res.status(201).json({ user, token });
    }
    catch (error) {
        next(error);
    }
}
async function login(req, res, next) {
    try {
        const { email, password } = req.body;
        console.log("🔐 Login attempt for:", email);
        const user = await db_1.default.user.findFirst({
            where: { email }
        });
        if (!user || !user.isActive) {
            console.log("❌ User not found or inactive");
            return res.status(401).json({ error: "Invalid credentials or inactive account" });
        }
        const isValid = await bcrypt_1.default.compare(password, user.password);
        if (!isValid) {
            console.log("❌ Invalid password");
            return res.status(401).json({ error: "Invalid credentials" });
        }
        console.log("🔑 JWT_SECRET exists:", !!process.env.JWT_SECRET);
        console.log("🔑 JWT_SECRET value:", process.env.JWT_SECRET);
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
        console.log("✅ Token generated:", token.substring(0, 30) + "...");
        console.log("👤 User role:", user.role);
        // If needed, fetch specific profile ID (customerId or agentId) to include, 
        // but for now the middleware uses user.id to look things up or we can add it to token payload later.
        res.json({ user, token });
    }
    catch (error) {
        console.log("❌ Login error:", error);
        next(error);
    }
}
