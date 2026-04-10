import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import routes from "./modules";

import { errorHandler } from "./middlewares/error.middleware";

import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

const app = express();

// Security: Set security-related HTTP headers
app.use(helmet());

// Sanitize and define allowed origins
const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const allowedOrigins = [
    frontendUrl,
    frontendUrl.includes("www.") ? frontendUrl.replace("www.", "") : frontendUrl.replace("://", "://www."),
    "http://localhost:3000"
];

const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string[]) => void) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
    optionsSuccessStatus: 200 // Some legacy browsers crash on 204
};

// Apply CORS *before* rate limiter so that 429 responses still have CORS headers
app.use(cors(corsOptions));

// Global Rate Limiter: Prevent general DDoS/abuse (500 req per 15 min per IP)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // Increased for dashboard usage
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});
app.use(limiter);

app.use(express.json({
    verify: (req: any, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use("/api", routes);

app.use(errorHandler);

export default app;
