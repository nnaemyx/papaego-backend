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

// Global Rate Limiter: Prevent general DDoS/abuse (100 req per 15 min per IP)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});
app.use(limiter);

const corsOptions = {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({
    verify: (req: any, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use("/api", routes);

app.use(errorHandler);

export default app;
