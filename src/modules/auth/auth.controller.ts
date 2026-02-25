import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../config/db";

export async function signup(req: Request, res: Response, next: NextFunction) {
    try {
        const { email, password, phone, role } = req.body;

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
        const { email, password } = req.body;

        console.log("🔐 Login attempt for:", email);

        const user = await prisma.user.findFirst({
            where: { email }
        });

        if (!user || !user.isActive) {
            console.log("❌ User not found or inactive");
            return res.status(401).json({ error: "Invalid credentials or inactive account" });
        }

        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            console.log("❌ Invalid password");
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
