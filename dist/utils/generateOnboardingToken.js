"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOnboardingToken = generateOnboardingToken;
exports.getOnboardingTokenExpiry = getOnboardingTokenExpiry;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generates a secure random onboarding token
 * @returns string - A URL-safe random token
 */
function generateOnboardingToken() {
    return crypto_1.default.randomBytes(32).toString('hex');
}
/**
 * Gets the expiry date for onboarding token (7 days from now)
 * @returns Date - Expiry date
 */
function getOnboardingTokenExpiry() {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7); // Token valid for 7 days
    return expiry;
}
