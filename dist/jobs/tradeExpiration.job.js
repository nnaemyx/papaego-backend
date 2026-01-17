"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startJobs = startJobs;
const db_1 = __importDefault(require("../config/db"));
function startJobs() {
    setInterval(async () => {
        await db_1.default.trade.updateMany({
            where: {
                status: "QUOTED",
                lockedUntil: { lt: new Date() }
            },
            data: { status: "EXPIRED" }
        });
    }, 60000);
}
