"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLicenseId = generateLicenseId;
const db_1 = __importDefault(require("../config/db"));
/**
 * Generates a sequential license ID in the format "LIC-0001", "LIC-0002", etc.
 * @returns Promise<string> - The next available license ID
 */
async function generateLicenseId() {
    try {
        // Get the latest agent profile ordered by licenseId in descending order
        const latestAgent = await db_1.default.agentProfile.findFirst({
            orderBy: {
                licenseId: 'desc'
            },
            select: {
                licenseId: true
            }
        });
        // If no agents exist, start with LIC-0001
        if (!latestAgent) {
            return "LIC-0001";
        }
        // Extract the numeric part from the license ID (e.g., "LIC-0042" -> "0042")
        const latestLicenseId = latestAgent.licenseId;
        const numericPart = latestLicenseId.replace("LIC-", "");
        // Convert to number, increment, and format with padding
        const nextNumber = parseInt(numericPart, 10) + 1;
        const paddedNumber = nextNumber.toString().padStart(4, "0");
        return `LIC-${paddedNumber}`;
    }
    catch (error) {
        console.error("Error generating license ID:", error);
        throw new Error("Failed to generate license ID");
    }
}
