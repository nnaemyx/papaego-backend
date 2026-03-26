import { Router, Request, Response } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/rbac.middleware";
import prisma from "../../config/db";
import { customerSignup, uploadCustomerDocument } from "./customer.signup.controller";
import { createTradeRequest, getCustomerTradeRequests } from "./customer.request.controller";
import { upsertBankDetails, getBankDetails } from "./customer.bank.controller";
import { uploadToCloudinary } from "../../middlewares/upload.middleware";
import { getSuppliers } from "./customer.supplier.controller";
import { sendReceiptUploadedEmail } from "../../services/email.service";

const router = Router();

// --- Public: Customer signup ---
router.post("/signup", customerSignup);
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
        res.json(fullCustomer);
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
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// --- Trade Requests ---
router.post("/trade-requests", createTradeRequest);
router.get("/trade-requests", getCustomerTradeRequests);

// --- Bank Details ---
router.post("/bank-details", upsertBankDetails);
router.get("/bank-details", getBankDetails);

// --- Suppliers ---
router.get("/suppliers", getSuppliers);

/**
 * GET /customer/portal/trades
 */
router.get("/trades", async (req: Request, res: Response) => {
    try {
        const customer = (req as any).user.customer;
        const { status, page = 1, limit = 20 } = req.query;
        const where: any = { customerId: customer.id };
        if (status && status !== "ALL") where.status = status;

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

        const trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id },
        });
        if (!trade) return res.status(404).json({ error: "Trade not found" });

        // Build timeline from audit logs
        const auditLogs = await prisma.auditLog.findMany({
            where: { entityId: trade.id, entity: "Trade" },
            orderBy: { createdAt: "asc" },
        });

        res.json({
            id: trade.id,
            tradeId: `PE-${trade.id.slice(0, 5).toUpperCase()}`,
            amount: trade.amount.toString(),
            sendCurrency: trade.sendCurrency,
            receiveCurrency: trade.receiveCurrency,
            fxRate: trade.fxRate?.toString() || null,
            status: trade.status,
            paymentMethod: trade.paymentMethod,
            paymentSource: trade.paymentSource,
            payoutMethod: trade.payoutMethod,
            recipientName: trade.recipientName,
            recipientDetails: trade.recipientDetails,
            payoutAmount: trade.payoutAmount,
            paymentProofUrl: trade.paymentProofUrl,
            lockedUntil: trade.lockedUntil,
            paymentAccountName: trade.paymentAccountName,
            paymentAccountNumber: trade.paymentAccountNumber,
            paymentBankName: trade.paymentBankName,
            paymentAmount: trade.paymentAmount?.toString() || null,
            createdAt: trade.createdAt.toISOString(),
            timeline: auditLogs.map((log) => ({
                action: log.action,
                createdAt: log.createdAt.toISOString(),
            })),
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

        const trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id },
            include: { agent: true }
        });
        if (!trade) return res.status(404).json({ error: "Trade not found" });

        const updatedTrade = await prisma.trade.update({
            where: { id: trade.id },
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
                entityId: trade.id,
                ip: req.ip || "127.0.0.1",
            },
        });

        // Notify Admin
        const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
        if (adminUser && adminUser.email) {
            await sendReceiptUploadedEmail({
                adminEmail: adminUser.email,
                customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer',
                tradeId: trade.id.slice(0, 8).toUpperCase(),
                dashboardLink: `${process.env.FRONTEND_URL || "http://localhost:3000"}/admin/transactions/${trade.id}`,
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

        const trade = await prisma.trade.findFirst({
            where: { id: req.params.id, customerId: customer.id }
        });

        if (!trade) return res.status(404).json({ error: "Trade not found" });

        await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CUSTOMER_CONFIRMED" }
        });

        await prisma.auditLog.create({
            data: {
                actorId: userId,
                role: "CUSTOMER",
                action: "SUPPLIER_AND_RATE_CONFIRMED",
                entity: "Trade",
                entityId: trade.id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, status: "CUSTOMER_CONFIRMED" });
    } catch (error) {
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

        const trade = await prisma.trade.findUnique({ where: { id } });
        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }

        const updatedTrade = await prisma.trade.update({
            where: { id },
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

export default router;
