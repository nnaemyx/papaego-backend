"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const tradeExpiration_job_1 = require("./jobs/tradeExpiration.job");
const PORT = process.env.PORT || 5000;
(0, tradeExpiration_job_1.startJobs)();
app_1.default.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
