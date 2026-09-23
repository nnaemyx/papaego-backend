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
import { getMyWallet } from "../wallet/wallet.controller";
import {
    createDepositRequest,
    getCustomerDeposits,
    cancelDepositRequest,
} from "../wallet/deposit.controller";

const router = Router();

// --- Public: Customer signup ---
router.post("/signup", customerSignup);
router.post("/signup/initiate", initiateSignup);
router.post("/signup/verify", verifySignupOtp);
router.post("/signup/resend", resendSignupOtp);
router.post("/signup/upload", uploadToCloudinary.single("file"), uploadCustomerDocument);

// --- Auth required from here ---
router.use(auth, requireRole("CUSTOMER", "ORG_OWNER", "ORG_ADMIN"));

// Middleware to populate Customer profile on req.user
const populateCustomer = async (req: Request, res: Response, next: any) => {
    try {
        const userPayload = (req as any).user;
        const userId = userPayload.id;
        const dbUser = await prisma.user.findUnique({ where: { id: userId } });
        let customer = await prisma.customer.findUnique({ where: { userId } });

        const userEmail = dbUser?.email || userPayload.email || "customer@papaego.com";

        if (!customer) {
            // Auto-create Customer profile if user is ORG_OWNER or ORG_ADMIN
            const nameParts = [dbUser?.firstName, dbUser?.lastName].filter(Boolean);
            const fullName = nameParts.length > 0 ? nameParts.join(" ") : (userEmail ? userEmail.split("@")[0] : "Business Customer");

            customer = await prisma.customer.create({
                data: {
                    userId,
                    bvn: "N/A",
                    fullName,
                    email: userEmail,
                    phone: dbUser?.phone || "N/A",
                    verified: true,
                    kycStatus: "APPROVED"
                }
            });
        } else if (!customer.email && dbUser?.email) {
            customer = await prisma.customer.update({
                where: { id: customer.id },
                data: { email: dbUser.email }
            });
        }

        (req as any).user = {
            ...userPayload,
            ...(dbUser || {}),
            customer
        };
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

        const [allTrades, todayTrades, wallet] = await Promise.all([
            prisma.trade.findMany({ where: { customerId: customer.id } }),
            prisma.trade.findMany({
                where: { customerId: customer.id, createdAt: { gte: today } },
            }),
            prisma.customerWallet.findUnique({ where: { customerId: customer.id } }),
        ]);

        const pendingStatuses = ["REQUESTED", "INITIATED", "QUOTED", "SENT_TO_CUSTOMER", "AWAITING_PAYMENT", "CUSTOMER_CONFIRMED", "CUSTOMER_VERIFIED"];
        const pendingTrades = allTrades.filter((t) => pendingStatuses.includes(t.status));

        res.json({
            totalTrades: allTrades.length,
            todayTrades: todayTrades.length,
            pendingActions: pendingTrades.length,
            kycVerified: customer.verified,
            kycStatus: customer.kycStatus || "NOT_SUBMITTED",
            availableBalance: wallet ? Number(wallet.availableBalance) : 0,
            reservedBalance: wallet ? Number(wallet.reservedBalance) : 0,
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
 * Returns authoritative customer rates from the OneLiquidity live rate engine.
 * Never exposes raw provider rates or internal spread breakdowns.
 */
router.get("/fx-rates", async (req: Request, res: Response) => {
    try {
        const { getAllCustomerRates } = require("../exchange-rate/exchange-rate.service");
        const customerRates = await getAllCustomerRates((req as any).user?.id);

        const rates = customerRates.map((r: any) => ({
            pair: r.pair,
            buy: r.customerRate,
            sell: r.customerRate,
            customerRate: r.customerRate,
            markupType: r.markupType,
            lastUpdated: r.createdAt || new Date().toISOString(),
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

// --- Pay from Wallet / Ledger ---
router.post("/wallet/check-balance", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const { amount } = req.body;
        const parsedAmount = parseFloat(String(amount || 0));
        const { checkWalletBalance } = await import("../wallet/wallet.service");
        const balanceInfo = await checkWalletBalance(customer.id, parsedAmount);
        res.json(balanceInfo);
    } catch (error) {
        console.error("Error checking balance:", error);
        res.status(500).json({ error: "Failed to check ledger balance" });
    }
});

router.post("/trades/:id/pay-from-wallet", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const userId = (req as any).user.id;
        const { id } = req.params;

        let trade = await prisma.trade.findFirst({
            where: { id, customerId: customer.id }
        });
        if (!trade) {
            trade = await prisma.trade.findFirst({
                where: { tradeRequestId: id, customerId: customer.id }
            });
        }

        if (trade) {
            const activeTrade = await checkAndRefreshTradeExpiry(trade);
            if (!activeTrade) return res.status(404).json({ error: "Trade not found" });

            // Required NGN amount
            const amountToDebit = Number(activeTrade.amount);

            // Reserve or debit funds from customer wallet
            const { reserveFunds } = await import("../wallet/wallet.service");
            try {
                await reserveFunds(customer.id, amountToDebit, {
                    tradeId: activeTrade.id,
                    description: `Payment for trade #${activeTrade.id.slice(0, 8).toUpperCase()}`,
                    actorId: userId,
                    metadata: {
                        sendCurrency: activeTrade.sendCurrency,
                        receiveCurrency: activeTrade.receiveCurrency,
                        paymentSource: "NGN_LEDGER",
                    }
                });
            } catch (err: any) {
                return res.status(400).json({ error: err.message || "Insufficient ledger balance" });
            }

            const updatedTrade = await prisma.trade.update({
                where: { id: activeTrade.id },
                data: {
                    status: "PAYMENT_CONFIRMED",
                    paymentMethod: "WALLET",
                    paymentSource: "NGN_LEDGER"
                }
            });

            await prisma.auditLog.create({
                data: {
                    actorId: userId,
                    role: "CUSTOMER",
                    action: "PAYMENT_CONFIRMED_VIA_WALLET",
                    entity: "Trade",
                    entityId: activeTrade.id,
                    ip: req.ip || "127.0.0.1",
                    metadata: {
                        amount: amountToDebit,
                        paymentSource: "NGN_LEDGER"
                    }
                }
            });

            return res.json({
                success: true,
                trade: updatedTrade,
                message: "Trade funded successfully from NGN Ledger"
            });
        }

        // Check if it is a TradeRequest
        const tradeRequest = await prisma.tradeRequest.findFirst({
            where: { id, customerId: customer.id }
        });

        if (!tradeRequest) {
            return res.status(404).json({ error: "Trade not found" });
        }

        const amountToDebit = Number(tradeRequest.amount);
        const { reserveFunds } = await import("../wallet/wallet.service");
        try {
            await reserveFunds(customer.id, amountToDebit, {
                tradeRequestId: tradeRequest.id,
                description: `Payment for trade request #${tradeRequest.id.slice(0, 8).toUpperCase()}`,
                actorId: userId,
                metadata: {
                    sendCurrency: tradeRequest.sendCurrency,
                    receiveCurrency: tradeRequest.receiveCurrency,
                    paymentSource: "NGN_LEDGER",
                }
            });
        } catch (err: any) {
            return res.status(400).json({ error: err.message || "Insufficient ledger balance" });
        }

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                role: "CUSTOMER",
                action: "PAYMENT_CONFIRMED_VIA_WALLET",
                entity: "TradeRequest",
                entityId: tradeRequest.id,
                ip: req.ip || "127.0.0.1",
                metadata: {
                    amount: amountToDebit,
                    paymentSource: "NGN_LEDGER"
                }
            }
        });

        return res.json({
            success: true,
            trade: tradeRequest,
            message: "Trade request funded successfully from NGN Ledger"
        });
    } catch (error) {
        console.error("Error paying from wallet:", error);
        res.status(500).json({ error: "Failed to process payment from wallet" });
    }
});

// --- Paystack Direct Deposit ---
router.post("/wallet/paystack/initialize", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const customer = user.customer || await prisma.customer.findUnique({ where: { userId: user.id } });
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        const { amount } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ error: "Valid amount is required" });
        }

        const email = (user.email || customer?.email || dbUser?.email || "customer@papaego.com").trim();
        const reference = `PSTK_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
        const rawPublicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY || "pk_test_2250be21340e86249354313ff63bd93bc8656a15";
        const paystackPublicKey = rawPublicKey.trim();

        res.json({
            reference,
            amount: Number(amount),
            email,
            publicKey: paystackPublicKey,
            currency: "NGN",
            metadata: {
                customerId: customer?.id,
                userId: user.id,
                customerEmail: email
            }
        });
    } catch (error) {
        console.error("Error initializing Paystack deposit:", error);
        res.status(500).json({ error: "Failed to initialize Paystack deposit" });
    }
});

router.post("/wallet/paystack/verify", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const customer = user.customer || await prisma.customer.findUnique({ where: { userId: user.id } });
        const userId = user.id;
        const { reference, amount } = req.body;

        if (!reference) {
            return res.status(400).json({ error: "Transaction reference is required" });
        }

        if (!customer) {
            return res.status(404).json({ error: "Customer record not found for ledger verification" });
        }

        // 1. Idempotency Check: Was this transaction already credited (e.g. by Webhook)?
        const existingTx = await prisma.walletTransaction.findFirst({
            where: {
                customerId: customer.id,
                OR: [
                    { description: { contains: reference } },
                    { metadata: { path: ["reference"], equals: reference } }
                ]
            }
        });

        if (existingTx) {
            const currentWallet = await prisma.customerWallet.findUnique({ where: { customerId: customer.id } });
            return res.json({
                success: true,
                amount: Number(existingTx.amount),
                availableBalance: currentWallet?.availableBalance?.toString() || "0",
                message: "Deposit already verified and credited to ledger"
            });
        }

        const rawSecret = process.env.PAYSTACK_SECRET_KEY || "sk_test_bdec83e09150a8a5110d9cddb0cdb75f48b4a4b2";
        const paystackSecretKey = rawSecret.trim();
        let verifiedAmount = Number(amount);

        // If secret key is present, verify directly with Paystack API
        if (paystackSecretKey && !paystackSecretKey.includes("placeholder")) {
            try {
                const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
                    headers: {
                        Authorization: `Bearer ${paystackSecretKey}`,
                    },
                });
                const data: any = await response.json();
                if (data.status && data.data?.status === "success") {
                    verifiedAmount = data.data.amount / 100; // Paystack amounts are in kobo
                }
            } catch (paystackErr) {
                console.warn("Paystack direct API verification note:", paystackErr);
            }
        }

        if (!verifiedAmount || verifiedAmount <= 0) {
            return res.status(400).json({ error: "Invalid payment amount" });
        }

        // Credit the customer's wallet
        const { creditWallet } = await import("../wallet/wallet.service");
        const updatedWallet = await creditWallet(
            customer.id,
            verifiedAmount,
            "DEPOSIT",
            {
                description: `Paystack Deposit (${reference})`,
                actorId: userId,
                metadata: {
                    reference,
                    channel: "PAYSTACK_CLIENT_VERIFY",
                    verifiedAt: new Date().toISOString()
                }
            }
        );

        // Create a DepositRequest record so it appears on admin Deposits page
        await prisma.depositRequest.create({
            data: {
                customerId: customer.id,
                amount: verifiedAmount,
                currency: "NGN",
                method: "PAYSTACK",
                reference,
                note: `Direct Paystack Deposit (${reference})`,
                status: "APPROVED",
                creditedAmount: verifiedAmount,
                reviewedBy: "SYSTEM",
                reviewedAt: new Date(),
            }
        }).catch(err => {
            // In case already created by webhook concurrently
            console.log("DepositRequest create note:", err.message);
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                role: "CUSTOMER",
                action: "PAYSTACK_DEPOSIT_CREDITED",
                entity: "CustomerWallet",
                entityId: updatedWallet.id,
                ip: req.ip || "127.0.0.1",
                metadata: { reference, amount: verifiedAmount }
            }
        });

        res.json({
            success: true,
            amount: verifiedAmount,
            availableBalance: updatedWallet.availableBalance.toString(),
            message: "Deposit confirmed and credited to ledger"
        });
    } catch (error) {
        console.error("Error verifying Paystack deposit:", error);
        res.status(500).json({ error: "Failed to verify deposit" });
    }
});

// ─── MoneyPings Direct Deposit ─────────────────────────────────────────────

/**
 * POST /wallet/moneypings/init-wallet
 * Ensures a MoneyPings wallet exists for this customer.
 * Idempotent: calling twice with the same customer ID returns the same wallet.
 * Stores the returned wallet_reference back on the Customer record so the
 * webhook handler can look it up later.
 */
router.post("/wallet/moneypings/init-wallet", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const customer = user.customer || await prisma.customer.findUnique({ where: { userId: user.id } });

        if (!customer) {
            return res.status(404).json({ error: "Customer record not found" });
        }

        const mpKey = process.env.MONEYPINGS_API_KEY;
        const isSimulated = !mpKey || mpKey.includes("placeholder") || mpKey.includes("your_moneypings");

        if (isSimulated) {
            const simulatedRef = `mp_wal_sim_${customer.id.slice(0, 8)}`;
            return res.json({
                walletReference: simulatedRef,
                externalReference: customer.id,
                status: "ACTIVE",
                balanceMinor: 0,
                balance: 0,
                message: "Simulated MoneyPings wallet (pending live partner API key)"
            });
        }

        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        const holderEmail = (dbUser?.email || user.email || customer.email || "").trim();
        const holderName = [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(" ") || customer.name || "Papa Ego Customer";
        const holderPhone = customer.phone || dbUser?.phone || "";

        const response = await fetch("https://moneypings.com/api/partner/wallets", {
            method: "POST",
            headers: {
                "X-API-Key": mpKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                external_reference: customer.id,  // our stable customer ID
                holder_name: holderName,
                holder_email: holderEmail,
                holder_phone: holderPhone || undefined,
                currency: "NGN"
            })
        });

        const result: any = await response.json().catch(() => ({}));

        if (!response.ok && response.status !== 200) {
            console.error("[MoneyPings] Wallet creation failed:", response.status, result);
            return res.status(502).json({
                error: "Failed to create MoneyPings wallet",
                details: result?.message || result?.error || `HTTP ${response.status}`
            });
        }

        const walletRef: string = result.data?.wallet_reference ?? "";

        // Persist the MoneyPings wallet reference on the customer record for webhook lookups
        if (walletRef) {
            await prisma.customer.update({
                where: { id: customer.id },
                data: {
                    metadata: {
                        ...(typeof customer.metadata === "object" && customer.metadata !== null ? customer.metadata as object : {}),
                        moneypingsWalletRef: walletRef
                    }
                }
            });
        }

        return res.json({
            walletReference: walletRef,
            externalReference: result.data?.external_reference,
            status: result.data?.status,
            balanceMinor: result.data?.balance_minor,
            balance: result.data?.balance,
            message: result.message
        });
    } catch (error) {
        console.error("[MoneyPings] Error initialising wallet:", error);
        return res.status(500).json({ error: "Failed to initialise MoneyPings wallet" });
    }
});

/**
 * POST /wallet/moneypings/pay-in
 * Generates a temporary virtual bank account for a customer to pay into.
 * The account is tied to a single payment and expires in ~5 hours.
 * Body: { amount: number }  — NGN, e.g. 500 means ₦500
 */
router.post("/wallet/moneypings/pay-in", async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const customer = user.customer || await prisma.customer.findUnique({ where: { userId: user.id } });

        if (!customer) {
            return res.status(404).json({ error: "Customer record not found" });
        }

        // 1. Hard Gate: KYC verification must be approved
        if (customer.kycStatus !== "APPROVED" || !customer.verified) {
            return res.status(403).json({
                error: "Your identity verification (KYC) is pending approval. You cannot fund your ledger or initiate transactions until your account is fully verified.",
                code: "KYC_VERIFICATION_REQUIRED",
                kycStatus: customer.kycStatus
            });
        }

        // 2. Hard Gate: Business (KYB) verification must be approved if applicable
        const orgMember = await prisma.organizationMember.findFirst({
            where: { userId: user.id },
            include: { organization: { include: { kybRequest: true } } }
        });
        const orgKyb = orgMember?.organization?.kybRequest;
        if (orgKyb && orgKyb.status !== "APPROVED") {
            return res.status(403).json({
                error: `Your business verification (KYB) is ${orgKyb.status.toLowerCase().replace('_', ' ')}. You cannot fund your ledger or initiate transactions until your business is approved.`,
                code: "KYB_VERIFICATION_REQUIRED",
                kybStatus: orgKyb.status
            });
        }

        const { amount } = req.body;
        const numAmount = Number(amount);
        if (!amount || isNaN(numAmount) || numAmount < 20000000) {
            return res.status(400).json({
                error: "Minimum transaction amount is ₦20,000,000",
                code: "MINIMUM_AMOUNT_NOT_MET",
                minAmount: 20000000
            });
        }

        const mpKey = process.env.MONEYPINGS_API_KEY;
        const isSimulated = !mpKey || mpKey.includes("placeholder") || mpKey.includes("your_moneypings");

        // If no live MoneyPings API key is configured yet, provide a realistic sandbox simulation
        if (isSimulated) {
            const timestamp = Date.now();
            const randomAccount = "99" + Math.floor(10000000 + Math.random() * 90000000).toString();
            const reference = `MP-SIM-${timestamp.toString().slice(-6)}`;
            const expiry = new Date(Date.now() + 5 * 3600 * 1000).toISOString();

            return res.json({
                accountNumber: randomAccount,
                accountName: `PapaEgo / ${customer.fullName || customer.name || "Customer"}`,
                bankName: "Providus Bank",
                amount: Number(amount),
                amountMinor: Math.round(Number(amount) * 100),
                currency: "NGN",
                expiresAt: expiry,
                reference,
                walletReference: `mp_wal_sim_${customer.id.slice(0, 8)}`,
                notice: "Sandbox Simulated Account. Provide your MONEYPINGS_API_KEY in .env to activate live account generation."
            });
        }

        // Resolve the MoneyPings wallet reference for this customer
        const meta: any = customer.metadata ?? {};
        let walletRef: string = meta.moneypingsWalletRef ?? "";

        // If we don't have one yet, auto-create the wallet first
        if (!walletRef) {
            const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
            const holderEmail = (dbUser?.email || user.email || customer.email || "").trim();
            const holderName = [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(" ") || customer.fullName || customer.name || "Papa Ego Customer";

            const initRes = await fetch("https://moneypings.com/api/partner/wallets", {
                method: "POST",
                headers: { "X-API-Key": mpKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                    external_reference: customer.id,
                    holder_name: holderName,
                    holder_email: holderEmail,
                    currency: "NGN"
                })
            });
            const initData: any = await initRes.json().catch(() => ({}));
            walletRef = initData.data?.wallet_reference ?? "";

            if (walletRef) {
                await prisma.customer.update({
                    where: { id: customer.id },
                    data: {
                        metadata: {
                            ...(typeof customer.metadata === "object" && customer.metadata !== null ? customer.metadata as object : {}),
                            moneypingsWalletRef: walletRef
                        }
                    }
                });
            } else {
                console.error("[MoneyPings] Could not create wallet for customer:", initRes.status, initData);
                return res.status(502).json({
                    error: "Could not resolve MoneyPings wallet for this customer",
                    details: initData?.message || initData?.error || `MoneyPings API returned HTTP ${initRes.status}`
                });
            }
        }

        // Amount in kobo (MoneyPings prefers integer kobo via amount_minor)
        const amountMinor = Math.round(Number(amount) * 100);
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        const email = (dbUser?.email || user.email || customer.email || "customer@papaego.com").trim();

        const payInRes = await fetch(`https://moneypings.com/api/partner/wallets/${walletRef}/pay-in`, {
            method: "POST",
            headers: { "X-API-Key": mpKey, "Content-Type": "application/json" },
            body: JSON.stringify({ amount_minor: amountMinor, email })
        });

        const payInData: any = await payInRes.json().catch(() => ({}));

        if (!payInRes.ok) {
            console.error("[MoneyPings] Pay-in account generation failed:", payInRes.status, payInData);
            return res.status(502).json({
                error: "Failed to generate pay-in account",
                details: payInData?.message || payInData?.error || `MoneyPings API returned HTTP ${payInRes.status}`
            });
        }

        return res.json({
            accountNumber: payInData.data?.account_number,
            accountName: payInData.data?.account_name,
            bankName: payInData.data?.bank_name,
            amount: payInData.data?.amount,
            amountMinor: payInData.data?.amount_minor,
            currency: payInData.data?.currency,
            expiresAt: payInData.data?.expires_at,
            reference: payInData.data?.reference,
            walletReference: payInData.data?.wallet_reference,
            notice: payInData.data?.notice
        });
    } catch (error) {
        console.error("[MoneyPings] Error generating pay-in account:", error);
        return res.status(500).json({ error: "Failed to generate pay-in account" });
    }
});

// --- Wallet & Deposits ---
router.get("/wallet", getMyWallet);
router.post("/wallet/deposits", uploadToCloudinary.single("proof"), createDepositRequest);
router.get("/wallet/deposits", getCustomerDeposits);
router.patch("/wallet/deposits/:id/cancel", cancelDepositRequest);

export default router;
