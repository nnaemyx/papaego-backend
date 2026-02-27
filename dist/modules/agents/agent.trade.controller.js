"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTrade = createTrade;
exports.verifyCustomer = verifyCustomer;
exports.quoteTrade = quoteTrade;
exports.sendToCustomer = sendToCustomer;
exports.confirmPayout = confirmPayout;
const db_1 = __importDefault(require("../../config/db"));
const stateMachine_1 = require("../../utils/stateMachine");
const fx_service_1 = require("../fx/fx.service");
const node_crypto_1 = require("node:crypto");
async function createTrade(req, res) {
    const agentId = req.user.id;
    const { 
    // Legacy field: if a real UUID customer ID is passed, use it directly
    customerId: rawCustomerId, 
    // New fields from the trade form
    customerName, customerEmail, customerPhone, customerCountry, amount, sendCurrency, receiveCurrency, 
    // New fields
    paymentMethod, paymentSource, payoutMethod, recipientName, recipientDetails, payoutAmount, paymentProofUrl, } = req.body;
    let resolvedCustomerId = null;
    // Validate rawCustomerId if provided
    if (rawCustomerId && rawCustomerId !== 'temp-customer-id' && rawCustomerId.length > 20) {
        resolvedCustomerId = rawCustomerId;
    }
    // If no valid ID, find or create
    if (!resolvedCustomerId) {
        // 1. Try to find existing customer profile by email
        if (customerEmail) {
            const existingCustomer = await db_1.default.customer.findFirst({
                where: { email: { equals: customerEmail, mode: 'insensitive' } }
            });
            if (existingCustomer) {
                resolvedCustomerId = existingCustomer.id;
            }
        }
        // 2. If still no customer, check if a User exists with this email
        if (!resolvedCustomerId && customerEmail) {
            const existingUser = await db_1.default.user.findUnique({
                where: { email: customerEmail }
            });
            if (existingUser) {
                // User exists, see if they have a customer profile or create one
                const customerProfile = await db_1.default.customer.findUnique({
                    where: { userId: existingUser.id }
                });
                if (customerProfile) {
                    resolvedCustomerId = customerProfile.id;
                }
                else {
                    const newCustomer = await db_1.default.customer.create({
                        data: {
                            userId: existingUser.id,
                            fullName: customerName || `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() || 'Unknown',
                            bvn: 'PENDING',
                            email: customerEmail,
                            phone: customerPhone || existingUser.phone || null,
                        }
                    });
                    resolvedCustomerId = newCustomer.id;
                }
            }
        }
        // 3. Finally, create a new User and Customer if none found
        if (!resolvedCustomerId) {
            const generatedUserId = (0, node_crypto_1.randomUUID)();
            const newUser = await db_1.default.user.create({
                data: {
                    id: generatedUserId,
                    role: "CUSTOMER",
                    phone: customerPhone || "N/A",
                    password: (0, node_crypto_1.randomUUID)(), // Locked account
                    firstName: customerName?.split(" ")[0] || customerName || "Unknown",
                    lastName: customerName?.split(" ").slice(1).join(" ") || "",
                    email: customerEmail || null,
                }
            });
            const newCustomer = await db_1.default.customer.create({
                data: {
                    userId: newUser.id,
                    fullName: customerName || "Unknown Customer",
                    bvn: "PENDING",
                    email: customerEmail || null,
                    phone: customerPhone || null,
                    verified: false,
                }
            });
            resolvedCustomerId = newCustomer.id;
        }
    }
    // Resolve countryId: use first available country if not specified
    let resolvedCountryId = req.body.countryId;
    if (!resolvedCountryId) {
        const firstCountry = await db_1.default.country.findFirst();
        resolvedCountryId = firstCountry?.id || (0, node_crypto_1.randomUUID)(); // fallback
    }
    const trade = await db_1.default.trade.create({
        data: {
            agentId,
            customerId: resolvedCustomerId,
            countryId: resolvedCountryId,
            amount: parseFloat(String(amount)) || 0,
            sendCurrency,
            receiveCurrency,
            status: "INITIATED",
            paymentMethod,
            paymentSource,
            payoutMethod,
            recipientName,
            recipientDetails,
            payoutAmount,
            paymentProofUrl,
        }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: agentId,
            role: "AGENT",
            action: "TRADE_CREATED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json(trade);
}
async function verifyCustomer(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "CUSTOMER_VERIFIED");
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "CUSTOMER_VERIFIED" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "CUSTOMER_VERIFIED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ verified: true });
}
async function quoteTrade(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "QUOTED");
    const fxRate = await (0, fx_service_1.getLockedRate)(trade.sendCurrency, trade.receiveCurrency, trade.countryId);
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: {
            fxRate,
            lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
            status: "QUOTED"
        }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "FX_QUOTED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ fxRate });
}
async function sendToCustomer(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    (0, stateMachine_1.assertTransition)(trade.status, "SENT_TO_CUSTOMER");
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "SENT_TO_CUSTOMER" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "SENT_TO_CUSTOMER",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ sent: true });
}
async function confirmPayout(req, res) {
    const trade = await db_1.default.trade.findUnique({
        where: { id: req.params.id }
    });
    if (!trade)
        throw new Error("Trade not found");
    if (trade.status !== "PAYMENT_CONFIRMED") {
        return res.status(403).json({ error: "Payment not verified" });
    }
    await db_1.default.trade.update({
        where: { id: trade.id },
        data: { status: "COMPLETED" }
    });
    await db_1.default.auditLog.create({
        data: {
            actorId: req.user.id,
            role: "AGENT",
            action: "PAYOUT_CONFIRMED",
            entity: "Trade",
            entityId: trade.id,
            ip: req.ip || "127.0.0.1"
        }
    });
    res.json({ completed: true });
}
