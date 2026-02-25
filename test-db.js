"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("./src/config/db"));
async function main() {
    console.log("Attempting database connection...");
    try {
        await db_1.default.$connect();
        console.log("✅ Connection SUCCESSFUL");
        await db_1.default.$disconnect();
        process.exit(0);
    }
    catch (e) {
        console.error("❌ Connection FAILED", e);
        process.exit(1);
    }
}
main();
