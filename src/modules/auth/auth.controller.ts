import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../config/db";

export async function signup(req: Request, res: Response, next: NextFunction) {
    try {
        const { email: rawEmail, password, phone, role } = req.body;
        const email = rawEmail.trim().toLowerCase();

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                phone,
                role: role || "CUSTOMER"
            }
        });

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        res.status(201).json({ user, token });
    } catch (error) {
        next(error);
    }
}

export async function login(req: Request, res: Response, next: NextFunction) {
    try {
        const rawEmail = req.body.email;
        const email = rawEmail?.trim().toLowerCase();
        const { password } = req.body;

        console.log(`🔐 Login attempt for: ${email}`);

        const user = await prisma.user.findFirst({
            where: { email }
        });

        if (!user) {
            console.log(`❌ User not found in DB for email: ${email}`);
            return res.status(401).json({ error: "User not found or inactive" });
        }

        console.log(`👤 User found: ${user.email}, Role: ${user.role}, Active: ${user.isActive}`);

        if (!user.isActive) {
            console.log(`❌ User is inactive: ${email}`);
            return res.status(401).json({ error: "User not found or inactive" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log(`🔑 Password valid: ${isPasswordValid}`);

        if (!isPasswordValid) {
            console.log(`❌ Invalid password for: ${email}`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        console.log("🔑 JWT_SECRET exists:", !!process.env.JWT_SECRET);
        console.log("🔑 JWT_SECRET value:", process.env.JWT_SECRET);

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        console.log("✅ Token generated:", token.substring(0, 30) + "...");
        console.log("👤 User role:", user.role);

        // If needed, fetch specific profile ID (customerId or agentId) to include, 
        // but for now the middleware uses user.id to look things up or we can add it to token payload later.

        res.json({ user, token });
    } catch (error) {
        console.log("❌ Login error:", error);
        next(error);
    }
}
