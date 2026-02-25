import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

export function auth(req: Request, res: Response, next: NextFunction) {
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
    const payload = jwt.verify(token, process.env.JWT_SECRET!);
    console.log("✅ Token verified successfully:", payload);
    (req as any).user = payload;
    next();
  } catch (error) {
    console.log("❌ Token verification failed:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
}
