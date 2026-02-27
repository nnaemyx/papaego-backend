import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import routes from "./modules";

import { errorHandler } from "./middlewares/error.middleware";

const app = express();

app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.json({
    verify: (req: any, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use("/api", routes);

app.use(errorHandler);

export default app;
