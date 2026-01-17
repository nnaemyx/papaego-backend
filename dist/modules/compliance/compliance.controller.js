"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComplianceFlags = getComplianceFlags;
exports.createComplianceReport = createComplianceReport;
exports.getReports = getReports;
const db_1 = __importDefault(require("../../config/db"));
async function getComplianceFlags(req, res) {
    const flags = await db_1.default.complianceFlag.findMany({
        orderBy: { createdAt: "desc" }
    });
    res.json(flags);
}
async function createComplianceReport(req, res) {
    const { tradeId, type, data } = req.body;
    const report = await db_1.default.complianceReport.create({
        data: {
            tradeId,
            type,
            data
        }
    });
    res.json(report);
}
async function getReports(req, res) {
    const reports = await db_1.default.complianceReport.findMany({
        orderBy: { createdAt: "desc" }
    });
    res.json(reports);
}
