import { z } from "zod";

export const signupSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string().min(6),
        phone: z.string().min(10).optional(),
        role: z.enum(["AGENT", "CUSTOMER", "COMPLIANCE", "ADMIN"]).optional()
    })
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string().email(),
        password: z.string()
    })
});
