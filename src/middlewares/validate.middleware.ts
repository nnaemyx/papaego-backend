import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export const validate = (schema: ZodSchema) => (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        schema.parse({
            body: req.body,
            query: req.query,
            params: req.params
        });
        next();
    } catch (error) {
        if (error instanceof ZodError) {
            const firstMessage = error.issues?.[0]?.message ?? "Validation failed";
            return res.status(400).json({
                error: firstMessage,
                details: error.issues
            });
        }
        next(error);
    }
};
