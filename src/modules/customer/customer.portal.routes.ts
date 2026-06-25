import { Router, Request, Response } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import prisma from "../../config/db";
import { Decimal } from "@prisma/client/runtime/library";

export async function getCurrentFxRateForPair(sendCurrency: string, receiveCurrency: string): Promise<number | null> {
    const config = await prisma.systemConfig.findUnique({ where: { key: "fx_rates" } });
    if (!config) return null;
    const rates = config.value as any[];
    if (!Array.isArray(rates)) return null;

    const pairName = sendCurrency === 'NGN' 
        ? `${receiveCurrency}/NGN` 
        : `${sendCurrency}/NGN`;

    const matchingRate = rates.find(r => r.pair === pairName && r.isActive);
    if (!matchingRate) return null;

    return sendCurrency === 'NGN' ? Number(matchingRate.sell) : Number(matchingRate.buy);
}

export async function checkAndRefreshTradeExpiry(trade: any): Promise<any> {
    const now = new Date();
    const expStatuses = ["QUOTED", "SENT_TO_CUSTOMER", "AWAITING_PAYMENT"];
    if (trade.lockedUntil && new Date(trade.lockedUntil) < now && expStatuses.includes(trade.status)) {
        const newRate = await getCurrentFxRateForPair(trade.sendCurrency, trade.receiveCurrency);
        if (newRate) {
            const amount = Number(trade.amount);
            const payoutAmountVal = trade.sendCurrency === 'NGN' ? (amount / newRate) : (amount * newRate);
            const payoutAmount = payoutAmountVal.toFixed(2);

            const updatedTrade = await prisma.trade.update({
                where: { id: trade.id },
                data: {
                    fxRate: new Decimal(newRate),
                    payoutAmount: String(payoutAmount),
                    lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
                },
                include: { customer: true, agent: true }
            });

            await prisma.auditLog.create({
                data: {
                    actorId: "SYSTEM",
                    role: "ADMIN",
                    action: "RATE_AUTO_REFRESHED",
                    entity: "Trade",
                    entityId: trade.id,
                    ip: "127.0.0.1",
                    metadata: {
                        oldRate: trade.fxRate?.toString(),
                        newRate: newRate.toString(),
                        reason: "Validity period expired"
                    }
                }
            });

            return updatedTrade;
        }
    }
    return trade;
}

export async function checkAndRefreshTradeRequestExpiry(tradeRequest: any): Promise<any> {
    const now = new Date();
    const expiryTime = tradeRequest.quotedAt 
        ? new Date(new Date(tradeRequest.quotedAt).getTime() + 10 * 60 * 1000)
        : null;

    if (tradeRequest.status === "QUOTED" && expiryTime && expiryTime < now) {
        const newRate = await getCurrentFxRateForPair(tradeRequest.sendCurrency, tradeRequest.receiveCurrency);
        if (newRate) {
            const amount = Number(tradeRequest.amount);
            const payoutAmountVal = tradeRequest.sendCurrency === 'NGN' ? (amount / newRate) : (amount * newRate);

            const updatedRequest = await prisma.tradeRequest.update({
                where: { id: tradeRequest.id },
                data: {
                    fxRate: new Decimal(newRate),
                    payoutAmount: new Decimal(payoutAmountVal),
                    quotedAt: new Date(),
                },
                include: { customer: { include: { user: true } }, agent: true }
            });

            await prisma.auditLog.create({
                data: {
                    actorId: "SYSTEM",
                    role: "ADMIN",
                    action: "RATE_AUTO_REFRESHED",
                    entity: "TradeRequest",
                    entityId: tradeRequest.id,
                    ip: "127.0.0.1",
                    metadata: {
                        oldRate: tradeRequest.fxRate?.toString(),
                        newRate: newRate.toString(),
                        reason: "Validity period expired"
                    }
                }
            });

            return updatedRequest;
        }
    }
    return tradeRequest;
}
import { customerSignup, uploadCustomerDocument, initiateSignup, verifySignupOtp, resendSignupOtp, submitSignupKyc } from "./customer.signup.controller";
import { createTradeRequest, getCustomerTradeRequests, getTradeRequestById, updateCustomerTradeRequest, cancelCustomerTradeRequest } from "./customer.request.controller";
import { upsertBankDetails, getBankDetails } from "./customer.bank.controller";
import { createNotification } from "../notifications/notification.service";
import { getKycStatus, resubmitKyc } from "./customer.kyc.controller";
import { uploadToCloudinary } from "../../middlewares/upload.middleware";
import { sendReceiptUploadedEmail } from "../../services/email.service";
import {
    assertRateNotExpired,
    isRateExpired,
    rateExpiresInSeconds,
    RateExpiredError,
} from "../../utils/checkRateExpiry";
import { expireTradeIfNeeded } from "../../jobs/tradeExpiration.job";
import {
    checkNegotiationEligibility as checkGlobalNegotiationEligibility,
    applyNegotiation,
    isTurnoverTargetMet,
    isNegotiationFeatureEnabled,
} from "../trades/negotiation.service";
import {
    checkNegotiationEligibility as checkCustomerNegotiationEligibility,
    requestNegotiation as requestCustomerNegotiation,
} from "../negotiation/negotiation.controller";

const router = Router();

// --- Public: Customer signup ---
router.post("/signup", customerSignup);
router.post("/signup/initiate", initiateSignup);
router.post("/signup/verify", verifySignupOtp);
router.post("/signup/resend", resendSignupOtp);
router.post("/signup/upload", uploadToCloudinary.single("file"), uploadCustomerDocument);

// --- Auth required from here ---
router.use(auth, requireRole("CUSTOMER"));

// Middleware to populate Customer profile on req.user
const populateCustomer = async (req: Request, res: Response, next: any) => {
    try {
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({ where: { userId } });
        if (!customer) {
            return res.status(404).json({ error: "Customer profile not found" });
        }
        (req as any).user.customer = customer;
        next();
    } catch (error) {
        next(error);
    }
};

router.use(populateCustomer);

router.post("/signup/submit-kyc", submitSignupKyc);

/**
 * GET /customer/portal/me
 * Returns the authenticated customer's profile
 */
router.get("/me", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        // Re-fetch only if needing relations that middleware doesn't include, or just use customer
        // Here we need 'user' relation for email/phone etc. 
        const fullCustomer = await prisma.customer.findUnique({
            where: { id: customer.id },
            include: { 
                user: { select: { email: true, firstName: true, lastName: true, phone: true, createdAt: true } },
                bankDetails: true
            },
        });
        res.json({
            ...fullCustomer,
            kycStatus: fullCustomer?.kycStatus || "NOT_SUBMITTED",
        });
    } catch (error) {
        console.error("Error fetching customer profile:", error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

/**
 * GET /customer/portal/dashboard/stats
 * Returns dashboard stats for the authenticated customer
 */
router.get("/dashboard/stats", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [allTrades, todayTrades] = await Promise.all([
            prisma.trade.findMany({ where: { customerId: customer.id } }),
            prisma.trade.findMany({
                where: { customerId: customer.id, createdAt: { gte: today } },
            }),
        ]);

        const pendingStatuses = ["REQUESTED", "INITIATED", "QUOTED", "SENT_TO_CUSTOMER", "AWAITING_PAYMENT", "CUSTOMER_CONFIRMED", "CUSTOMER_VERIFIED"];
        const pendingTrades = allTrades.filter((t) => pendingStatuses.includes(t.status));

        res.json({
            totalTrades: allTrades.length,
            todayTrades: todayTrades.length,
            pendingActions: pendingTrades.length,
            kycVerified: customer.verified,
            kycStatus: customer.kycStatus || "NOT_SUBMITTED",
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// --- Trade Requests ---
router.post("/trade-requests", createTradeRequest);
router.get("/trade-requests", getCustomerTradeRequests);
router.get("/trade-requests/:id", getTradeRequestById);
router.put("/trade-requests/:id", updateCustomerTradeRequest);
router.patch("/trade-requests/:id/cancel", cancelCustomerTradeRequest);

// --- Bank Details ---
router.post("/bank-details", upsertBankDetails);
router.get("/bank-details", getBankDetails);

// --- KYC Status ---
router.get("/kyc-status", getKycStatus);
router.patch("/kyc/resubmit", uploadToCloudinary.fields([
    { name: "governmentId", maxCount: 1 },
    { name: "proofOfAddress", maxCount: 1 },
]), async (req: Request, res: Response, next: any) => {
    // Convert uploaded files to URLs in req.body before passing to controller
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (files?.governmentId?.[0]) {
        req.body.governmentIdUrl = files.governmentId[0].path;
    }
    if (files?.proofOfAddress?.[0]) {
        req.body.proofOfAddressUrl = files.proofOfAddress[0].path;
    }
    next();
}, resubmitKyc);

/**
 * GET /customer/portal/trades
 */
router.get("/trades", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const { status, page = 1, limit = 20, search } = req.query;
        const where: any = { customerId: customer.id };
        if (status && status !== "ALL") where.status = status;

        if (search) {
            const cleanSearch = (search as string).trim().toLowerCase();
            const rawIdSearch = cleanSearch.replace("pe-", "");
            where.AND = [
                {
                    OR: [
                        { id: { contains: rawIdSearch } },
                        { recipientName: { contains: cleanSearch, mode: "insensitive" } },
                        { sendCurrency: { contains: cleanSearch, mode: "insensitive" } },
                        { receiveCurrency: { contains: cleanSearch, mode: "insensitive" } },
                    ]
                }
            ];
        }

        const [trades, total] = await Promise.all([
            prisma.trade.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit),
            }),
            prisma.trade.count({ where }),
        ]);

        const formatted = trades.map((t) => ({
            id: t.id,
            tradeId: `PE-${t.id.slice(0, 5).toUpperCase()}`,
            amount: t.amount.toString(),
            sendCurrency: t.sendCurrency,
            receiveCurrency: t.receiveCurrency,
            fxRate: t.fxRate?.toString() || null,
            status: t.status,
            paymentProofUrl: t.paymentProofUrl,
            recipientName: t.recipientName,
            payoutAmount: t.payoutAmount,
            lockedUntil: t.lockedUntil,
            rateExpiresIn: rateExpiresInSeconds(t.lockedUntil),
            isRateExpired: isRateExpired(t),
            createdAt: t.createdAt.toISOString(),
        }));

        res.json({ trades: formatted, total, page: Number(page), limit: Number(limit) });
    } catch (error) {
        console.error("Error fetching customer trades:", error);
        res.status(500).json({ error: "Failed to fetch trades" });
    }
});

/**
 * GET /customer/portal/trades/:id
 */
router.get("/trades/:id", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const customer = await prisma.customer.findUnique({ where: { userId } });
        if (!customer) return res.status(404).json({ error: "Customer not found" });

        let trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id },
            include: {
                agent: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    }
                },
                agentRating: true,
            }
        });

        if (trade) {
            // Check expiry & auto-refresh
            const activeTrade = await checkAndRefreshTradeExpiry(trade);
            if (!activeTrade) {
                return res.status(404).json({ error: "Trade not found" });
            }

            // Build timeline from audit logs
            const auditLogs = await prisma.auditLog.findMany({
                where: { entityId: activeTrade.id, entity: "Trade" },
                orderBy: { createdAt: "asc" },
            });

            // Determine stages completion
            const status = activeTrade.status;
            const isUnderReview = ["REQUESTED", "INITIATED", "CUSTOMER_VERIFIED", "UNDER_REVIEW", "FLAGGED", "QUOTED", "SENT_TO_CUSTOMER", "CUSTOMER_CONFIRMED", "AWAITING_PAYMENT", "PAYMENT_UPLOADED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(status);
            const isRateAssigned = ["QUOTED", "SENT_TO_CUSTOMER", "CUSTOMER_CONFIRMED", "AWAITING_PAYMENT", "PAYMENT_UPLOADED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(status);
            const isPaymentSubmitted = ["PAYMENT_UPLOADED", "PAYMENT_CONFIRMED", "COMPLETED"].includes(status);
            const isPaymentVerified = ["PAYMENT_CONFIRMED", "COMPLETED"].includes(status);
            const isCompleted = status === "COMPLETED";

            const findLogTime = (actions: string[]) => {
                const log = auditLogs.find((l) => actions.includes(l.action));
                return log ? log.createdAt.toISOString() : null;
            };

            const stages = [
                {
                    key: "UNDER_REVIEW",
                    label: "Under Review",
                    description: "Your trade is being reviewed by our compliance team",
                    completed: isUnderReview,
                    completedAt: findLogTime(["TRADE_CREATED", "TRADE_REQUEST_PROCESSED"]) || activeTrade.createdAt.toISOString()
                },
                {
                    key: "RATE_ASSIGNED",
                    label: "Rate Assigned",
                    description: "An exchange rate has been assigned and locked",
                    completed: isRateAssigned,
                    completedAt: findLogTime(["FX_QUOTED", "TRADE_REQUEST_RATE_SET", "SENT_TO_CUSTOMER", "SUPPLIER_AND_RATE_CONFIRMED"])
                },
                {
                    key: "PAYMENT_SUBMITTED",
                    label: "Payment Submitted",
                    description: "Your payment proof / receipt has been uploaded",
                    completed: isPaymentSubmitted,
                    completedAt: findLogTime(["PAYMENT_RECEIPT_UPLOADED"])
                },
                {
                    key: "PAYMENT_VERIFIED",
                    label: "Payment Verified",
                    description: "Payment verified successfully by compliance/admin",
                    completed: isPaymentVerified,
                    completedAt: findLogTime(["PAYMENT_CONFIRMED", "PAYOUT_CONFIRMED"])
                },
                {
                    key: "COMPLETED",
                    label: "Completed",
                    description: "Trade completed and payout confirmed",
                    completed: isCompleted,
                    completedAt: findLogTime(["PAYOUT_CONFIRMED", "TRADE_COMPLETED"])
                }
            ];

            // Compute seconds remaining on the rate lock
            const rateExpiresIn = rateExpiresInSeconds(activeTrade.lockedUntil);
            const isExpired = isRateExpired(activeTrade);

            return res.json({
                id: activeTrade.id,
                tradeId: `PE-${activeTrade.id.slice(0, 5).toUpperCase()}`,
                amount: activeTrade.amount.toString(),
                sendCurrency: activeTrade.sendCurrency,
                receiveCurrency: activeTrade.receiveCurrency,
                fxRate: activeTrade.fxRate?.toString() || null,
                originalFxRate: activeTrade.originalFxRate?.toString() || null,
                negotiatedRate: activeTrade.negotiatedRate?.toString() || null,
                negotiationUsed: activeTrade.negotiationUsed,
                status: activeTrade.status,
                agent: (activeTrade as any).agent,
                agentRating: (activeTrade as any).agentRating,
                paymentMethod: activeTrade.paymentMethod,
                paymentSource: activeTrade.paymentSource,
                payoutMethod: activeTrade.payoutMethod,
                recipientName: activeTrade.recipientName,
                recipientDetails: activeTrade.recipientDetails,
                payoutAmount: activeTrade.payoutAmount,
                paymentProofUrl: activeTrade.paymentProofUrl,
                lockedUntil: activeTrade.lockedUntil,
                rateExpiresIn,
                isRateExpired: isExpired,
                paymentAccountName: activeTrade.paymentAccountName,
                paymentAccountNumber: activeTrade.paymentAccountNumber,
                paymentBankName: activeTrade.paymentBankName,
                paymentAmount: activeTrade.paymentAmount?.toString() || null,
                createdAt: activeTrade.createdAt.toISOString(),
                timeline: auditLogs.map((log) => ({
                    action: log.action,
                    createdAt: log.createdAt.toISOString(),
                })),
                stages
            });
        }

        // If trade is not found, fallback to TradeRequest lookup
        let tradeRequest = await prisma.tradeRequest.findFirst({
            where: { id: req.params.id, customerId: customer.id },
        });

        if (!tradeRequest) {
            return res.status(404).json({ error: "Trade not found" });
        }

        // Check expiry & auto-refresh for TradeRequest
        const activeRequest = await checkAndRefreshTradeRequestExpiry(tradeRequest);
        if (!activeRequest) {
            return res.status(404).json({ error: "TradeRequest not found" });
        }

        // Build timeline from audit logs for TradeRequest
        const requestAuditLogs = await prisma.auditLog.findMany({
            where: { entityId: activeRequest.id, entity: "TradeRequest" },
            orderBy: { createdAt: "asc" },
        });

        const reqStatus = activeRequest.status;
        const isUnderReview = ["PENDING", "POOL", "ASSIGNED", "QUOTED", "PROCESSED", "REJECTED"].includes(reqStatus);
        const isRateAssigned = ["QUOTED", "PROCESSED"].includes(reqStatus);
        const isPaymentSubmitted = false;
        const isPaymentVerified = false;
        const isCompleted = false;

        const findLogTime = (actions: string[]) => {
            const log = requestAuditLogs.find((l) => actions.includes(l.action));
            return log ? log.createdAt.toISOString() : null;
        };

        const stages = [
            {
                key: "UNDER_REVIEW",
                label: "Under Review",
                description: "Your trade is being reviewed by our compliance team",
                completed: isUnderReview,
                completedAt: findLogTime(["TRADE_CREATED", "TRADE_REQUEST_PROCESSED"]) || activeRequest.createdAt.toISOString()
            },
            {
                key: "RATE_ASSIGNED",
                label: "Rate Assigned",
                description: "An exchange rate has been assigned and locked",
                completed: isRateAssigned,
                completedAt: findLogTime(["FX_QUOTED", "TRADE_REQUEST_RATE_SET", "SENT_TO_CUSTOMER", "SUPPLIER_AND_RATE_CONFIRMED"])
            },
            {
                key: "PAYMENT_SUBMITTED",
                label: "Payment Submitted",
                description: "Your payment proof / receipt has been uploaded",
                completed: isPaymentSubmitted,
                completedAt: null
            },
            {
                key: "PAYMENT_VERIFIED",
                label: "Payment Verified",
                description: "Payment verified successfully by compliance/admin",
                completed: isPaymentVerified,
                completedAt: null
            },
            {
                key: "COMPLETED",
                label: "Completed",
                description: "Trade completed and payout confirmed",
                completed: isCompleted,
                completedAt: null
            }
        ];

        let rateExpiresIn: number | null = null;
        let isExpired = false;
        const targetLockTime = activeRequest.quotedAt 
            ? new Date(new Date(activeRequest.quotedAt).getTime() + 10 * 60 * 1000)
            : null;
        if (activeRequest.status === "QUOTED" && targetLockTime) {
            rateExpiresIn = rateExpiresInSeconds(targetLockTime);
            isExpired = targetLockTime.getTime() <= Date.now();
        }

        return res.json({
            id: activeRequest.id,
            tradeId: `PE-${activeRequest.id.slice(0, 5).toUpperCase()}`,
            amount: activeRequest.amount.toString(),
            sendCurrency: activeRequest.sendCurrency,
            receiveCurrency: activeRequest.receiveCurrency,
            fxRate: activeRequest.fxRate?.toString() || null,
            originalFxRate: (activeRequest as any).originalFxRate?.toString() || activeRequest.fxRate?.toString() || null,
            negotiatedRate: (activeRequest as any).negotiatedRate?.toString() || null,
            negotiationUsed: Boolean((activeRequest as any).negotiationUsed),
            status: activeRequest.status,
            paymentMethod: null,
            paymentSource: null,
            payoutMethod: null,
            recipientName: activeRequest.supplierBusinessName,
            recipientDetails: activeRequest.supplierAccountNumber ? `Bank: ${activeRequest.supplierBankName}, A/C: ${activeRequest.supplierAccountNumber}` : null,
            payoutAmount: activeRequest.payoutAmount?.toString() || null,
            paymentProofUrl: null,
            lockedUntil: targetLockTime,
            rateExpiresIn,
            isRateExpired: isExpired,
            paymentAccountName: null,
            paymentAccountNumber: null,
            paymentBankName: null,
            paymentAmount: null,
            createdAt: activeRequest.createdAt.toISOString(),
            timeline: requestAuditLogs.map((log) => ({
                action: log.action,
                createdAt: log.createdAt.toISOString(),
            })),
            stages
        });
    } catch (error) {
        console.error("Error fetching trade detail:", error);
        res.status(500).json({ error: "Failed to fetch trade" });
    }
});

/**
 * PATCH /customer/portal/trades/:id/upload-receipt
 */
router.patch("/trades/:id/upload-receipt", uploadToCloudinary.single("receipt"), async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No receipt file provided" });

        let trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id },
            include: { agent: true }
        });
        if (!trade) {
            trade = await prisma.trade.findFirst({
                where: { tradeRequestId: req.params.id, customerId: customer.id },
                include: { agent: true }
            });
        }
        if (!trade) return res.status(404).json({ error: "Trade not found" });

        const activeTrade = await checkAndRefreshTradeExpiry(trade);
        if (!activeTrade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        const updatedTrade = await prisma.trade.update({
            where: { id: activeTrade.id },
            data: {
                paymentProofUrl: file.path,
                status: "PAYMENT_UPLOADED"
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "CUSTOMER",
                action: "PAYMENT_RECEIPT_UPLOADED",
                entity: "Trade",
                entityId: activeTrade.id,
                ip: req.ip || "127.0.0.1",
            },
        });

        // Notify Admin
        const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        if (adminUser && adminUser.email) {
            await sendReceiptUploadedEmail({
                adminEmail: adminUser.email,
                customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer',
                tradeId: activeTrade.id.slice(0, 8).toUpperCase(),
                dashboardLink: `${process.env.FRONTEND_URL || "http://localhost:3000"}/admin/transactions/${activeTrade.id}`,
            });
        }

        res.json(updatedTrade);
    } catch (error) {
        console.error("Error uploading receipt:", error);
        res.status(500).json({ error: "Failed to upload receipt" });
    }
});

/**
 * GET /customer/portal/fx-rates
 */
router.get("/fx-rates", async (req: Request, res: Response) => {
    try {
        const margins = await prisma.fxMargin.findMany();
        const baseRates: Record<string, { buy: number; sell: number }> = {
            "USD/NGN": { buy: 1580, sell: 1600 },
            "GBP/NGN": { buy: 1990, sell: 2020 },
            "EUR/NGN": { buy: 1720, sell: 1745 },
            "CAD/NGN": { buy: 1150, sell: 1170 },
            "AED/NGN": { buy: 430, sell: 445 },
        };

        const rates = Object.entries(baseRates).map(([pair, rate]) => ({
            pair,
            buy: rate.buy,
            sell: rate.sell,
            lastUpdated: new Date().toISOString(),
        }));

        res.json({ rates });
    } catch (error) {
        console.error("Error fetching FX rates:", error);
        res.status(500).json({ error: "Failed to fetch FX rates" });
    }
});

/**
 * GET /customer/portal/agents
 */
router.get("/agents", async (req: Request, res: Response) => {
    try {
        const agents = await prisma.user.findMany({
            where: { role: "AGENT", isActive: true },
            select: { id: true, firstName: true, lastName: true, agentProfile: { select: { region: true } } }
        });
        const formatted = agents.map(a => ({
            id: a.id,
            name: `${a.firstName} ${a.lastName}`,
            region: a.agentProfile?.region || 'Global'
        }));
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch agents" });
    }
});

/**
 * PATCH /customer/portal/trades/:id/confirm
 */
router.patch("/trades/:id/confirm", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const customer = (req as any).user.customer;

        let trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id }
        });
        if (!trade) {
            trade = await prisma.trade.findFirst({
                where: { tradeRequestId: req.params.id, customerId: customer.id }
            });
        }

        if (!trade) return res.status(404).json({ error: "Trade not found" });

        const activeTrade = await checkAndRefreshTradeExpiry(trade);
        if (!activeTrade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        if (!["QUOTED", "SENT_TO_CUSTOMER"].includes(activeTrade.status)) {
            return res.status(400).json({
                error: "Trade cannot be confirmed in its current status",
                code: "INVALID_STATUS",
            });
        }

        try {
            assertRateNotExpired(activeTrade);
        } catch (error) {
            if (error instanceof RateExpiredError) {
                await expireTradeIfNeeded(activeTrade);
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
            throw error;
        }

        await prisma.trade.update({
            where: { id: activeTrade.id },
            data: { status: "CUSTOMER_CONFIRMED" }
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                role: "CUSTOMER",
                action: "SUPPLIER_AND_RATE_CONFIRMED",
                entity: "Trade",
                entityId: activeTrade.id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, status: "CUSTOMER_CONFIRMED" });
    } catch (error) {
        console.error("Error confirming trade:", error);
        res.status(500).json({ error: "Failed to confirm trade" });
    }
});

/**
 * PATCH /customer/portal/trades/:id/proof (Cloudinary version)
 */
router.patch("/trades/:id/proof", uploadToCloudinary.single("proof"), async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const file = (req as any).file;

        if (!file) {
            return res.status(400).json({ error: "Proof file is required" });
        }

        let trade = await prisma.trade.findUnique({ where: { id } });
        if (!trade) {
            trade = await prisma.trade.findFirst({ where: { tradeRequestId: id } });
        }
        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        const activeTrade = await checkAndRefreshTradeExpiry(trade);
        if (!activeTrade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        const updatedTrade = await prisma.trade.update({
            where: { id: activeTrade.id },
            data: {
                paymentProofUrl: file.path, // Cloudinary provides secure_url in path
                status: "PAYMENT_CONFIRMED"
            }
        });

        res.json(updatedTrade);
    } catch (error) {
        console.error("Error uploading proof:", error);
        res.status(500).json({ error: "Failed to upload proof" });
    }
});

// --- Negotiation ---
router.get("/trades/:id/negotiate/eligibility", checkCustomerNegotiationEligibility);

/**
 * GET /customer/portal/trades/:id/negotiation-eligibility
 * Check if a specific trade can be negotiated via the automatic 0.05% global target rule.
 */
router.get("/trades/:id/negotiation-eligibility", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        let trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id },
        });

        // Fallback to TradeRequest if no Trade record exists
        if (!trade) {
            const tradeRequest = await prisma.tradeRequest.findFirst({
                where: { id: req.params.id, customerId: customer.id },
            });
            if (!tradeRequest) return res.status(404).json({ error: "Trade not found" });

            // Use the global eligibility check which now supports TradeRequest IDs
            const eligibility = await checkGlobalNegotiationEligibility(tradeRequest.id);
            return res.json(eligibility);
        }

        const eligibility = await checkGlobalNegotiationEligibility(trade.id);
        res.json(eligibility);
    } catch (error) {
        console.error("Error checking negotiation eligibility:", error);
        res.status(500).json({ error: "Failed to check eligibility" });
    }
});

/**
 * POST /customer/portal/trades/:id/negotiate
 * Handshake for both custom rate submission (body: { requestedRate })
 * and automatic 0.05% negotiation discount.
 */
router.post("/trades/:id/negotiate", async (req: Request, res: Response) => {
    if (req.body && req.body.requestedRate !== undefined) {
        return requestCustomerNegotiation(req, res);
    }

    try {
        const customer = (req as any).user.customer;
        const userId = (req as any).user.id;
        const ip = req.ip || "127.0.0.1";

        let trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id },
        });

        // Fallback to TradeRequest if no Trade record exists
        if (!trade) {
            const tradeRequest = await prisma.tradeRequest.findFirst({
                where: { id: req.params.id, customerId: customer.id },
            });
            if (!tradeRequest) return res.status(404).json({ error: "Trade not found" });

            // Check eligibility first
            const eligibility = await checkGlobalNegotiationEligibility(tradeRequest.id);
            if (!eligibility.eligible) {
                return res.status(403).json({
                    error: eligibility.reason,
                    eligible: false,
                });
            }

            const result = await applyNegotiation(tradeRequest.id, userId, ip);
            return res.json(result);
        }

        // Check eligibility first
        const eligibility = await checkGlobalNegotiationEligibility(trade.id);
        if (!eligibility.eligible) {
            return res.status(403).json({
                error: eligibility.reason,
                eligible: false,
            });
        }

        const result = await applyNegotiation(trade.id, userId, ip);
        res.json(result);
    } catch (error: any) {
        console.error("Error applying negotiation:", error);

        if (error.message === "Negotiation has already been used for this trade") {
            return res.status(409).json({ error: error.message });
        }

        res.status(500).json({ error: "Failed to apply negotiation" });
    }
});

/**
 * GET /customer/portal/negotiation-status
 * Global negotiation availability status for the customer.
 */
router.get("/negotiation-status", async (req: Request, res: Response) => {
    try {
        const [featureEnabled, turnoverMet] = await Promise.all([
            isNegotiationFeatureEnabled(),
            isTurnoverTargetMet(),
        ]);

        res.json({
            negotiationAvailable: featureEnabled && turnoverMet,
        });
    } catch (error) {
        console.error("Error fetching negotiation status:", error);
        res.status(500).json({ error: "Failed to fetch status" });
    }
});

/**
 * PATCH /customer/portal/trades/:id/cancel
 */
router.patch("/trades/:id/cancel", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const customer = (req as any).user.customer;

        const trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id }
        });

        if (!trade) return res.status(404).json({ error: "Trade not found" });

        if (["COMPLETED", "CANCELLED", "EXPIRED"].includes(trade.status)) {
            return res.status(400).json({ error: `Cannot cancel trade in ${trade.status} status` });
        }

        const updated = await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CANCELLED" }
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                role: "CUSTOMER",
                action: "TRADE_CANCELLED_BY_CUSTOMER",
                entity: "Trade",
                entityId: trade.id,
                ip: req.ip || "127.0.0.1"
            }
        });

        // Notify assigned agent
        await createNotification(
            trade.agentId,
            "Trade Cancelled by Customer",
            `Customer has cancelled trade #${trade.id.slice(0, 8).toUpperCase()}.`,
            "WARNING"
        );

        res.json({ success: true, status: "CANCELLED" });
    } catch (error) {
        console.error("Error cancelling trade:", error);
        res.status(500).json({ error: "Failed to cancel trade" });
    }
});

/**
 * POST /customer/portal/trades/:id/rate
 * Rate the agent for a completed trade
 */
router.post("/trades/:id/rate", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { rating, feedback } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: "Rating must be an integer between 1 and 5" });
        }

        const customer = (req as any).user.customer;

        const trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id }
        });

        if (!trade) return res.status(404).json({ error: "Trade not found" });

        if (trade.status !== "COMPLETED") {
            return res.status(400).json({ error: "Only completed trades can be rated" });
        }

        // Check duplicate
        const existingRating = await prisma.agentRating.findUnique({
            where: { tradeId: trade.id }
        });
        if (existingRating) {
            return res.status(400).json({ error: "This transaction has already been rated" });
        }

        const agentRating = await prisma.agentRating.create({
            data: {
                tradeId: trade.id,
                agentId: trade.agentId,
                customerId: customer.id,
                rating: Number(rating),
                feedback: feedback || null
            }
        });

        res.status(201).json(agentRating);
    } catch (error) {
        console.error("Error rating agent:", error);
        res.status(500).json({ error: "Failed to submit agent rating" });
    }
});

/**
 * POST /customer/portal/feedback
 * General customer feedback capture
 */
router.post("/feedback", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const { category, message } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Feedback message is required" });
        }

        const feedback = await prisma.customerFeedback.create({
            data: {
                customerId: customer.id,
                category: category || "GENERAL",
                message
            }
        });

        res.status(201).json(feedback);
    } catch (error) {
        console.error("Error creating feedback:", error);
        res.status(500).json({ error: "Failed to submit feedback" });
    }
});


export default router;
