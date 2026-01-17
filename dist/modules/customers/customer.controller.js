"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startKyc = startKyc;
exports.confirmKyc = confirmKyc;
const db_1 = __importDefault(require("../../config/db"));
async function startKyc(req, res) {
    const { bvn, phone, email, fullName } = req.body;
    const customer = await db_1.default.customer.create({
        data: {
            bvn,
            fullName: fullName || "Unknown",
            phone,
            email,
            userId: req.user.id
        }
    });
    // Call external BVN service here (mocked)
    const verifiedData = {
        fullName: "John Doe",
        bankName: "GTBank",
        accountNo: "0123456789"
    };
    res.json({
        verificationResult: verifiedData
    });
}
async function confirmKyc(req, res) {
    const { customerId } = req.body;
    await db_1.default.customer.update({
        where: { id: customerId },
        data: { verified: true }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "CUSTOMER",
            action: "CUSTOMER_KYC_CONFIRMED",
            entity: "Customer",
            entityId: customerId,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ verified: true });
}
