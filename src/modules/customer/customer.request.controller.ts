import { Request, Response } from "express";
import prisma from "../../config/db";
import { sendTradeInitiatedEmail } from "../../services/email.service";
import { createNotification } from "../notifications/notification.service";
import { checkAndRefreshTradeRequestExpiry } from "./customer.portal.routes";
import { assertSufficientBalance, reserveFunds, releaseReservation, checkWalletBalance, InsufficientFundsError } from "../wallet/wallet.service";



/**
 * Customer initiates a trade request
 * POST /api/customer/portal/trade-requests
 */
export async function createTradeRequest(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        if (!customerId) {
            return res.status(403).json({ error: "Customer profile not found" });
        }

        const {
            amount,
            sendCurrency,
            receiveCurrency,
            agentId,
            purpose,
            tradeType,
            receiptUrl,
            invoiceUrl,
            supplierId,
            // Fallback raw fields if supplierId is not used
            businessName,
            bankName,
            accountNumber,
            sector,
            address,
        } = req.body;

        if (!amount) {
            return res.status(400).json({ error: "Amount is required" });
        }

        // Enforce wallet funding: a submitted (non-draft) request must be fully
        // backed by the customer's available wallet balance in the send currency.
        const willSubmit = req.body.status !== "DRAFT";
        if (willSubmit) {
            try {
                await assertSufficientBalance(customerId, parseFloat(String(amount)));
            } catch (err) {
                if (err instanceof InsufficientFundsError) {
                    const balanceInfo = await checkWalletBalance(customerId, parseFloat(String(amount)));
                    return res.status(402).json({
                        error: "Insufficient ledger balance. Please deposit via Paystack or bank transfer to fund your trade.",
                        code: "INSUFFICIENT_FUNDS",
                        detail: err.message,
                        ...balanceInfo,
                    });
                }
                throw err;
            }
        }

        let actualSupplierBusinessName = businessName || null;
        let actualSupplierBankName = bankName || null;
        let actualSupplierAccountNumber = accountNumber || null;
        let actualSupplierSector = sector || null;
        let actualSupplierAddress = address || null;

        if (supplierId) {
            const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
            if (supplier && supplier.customerId === customerId) {
                actualSupplierBusinessName = supplier.beneficiaryName;
                actualSupplierBankName = supplier.bankName;
                actualSupplierAccountNumber = supplier.accountNumber;
                actualSupplierSector = supplier.routingCode; // Using routing code as sector mapping fallback
                actualSupplierAddress = supplier.address;
            }
        }

        // Create the request and, if submitting, reserve the wallet funds in the
        // SAME db transaction so a submitted request is always fully backed. If
        // the reserve fails (e.g. a concurrent submission drained the balance),
        // the whole thing rolls back and nothing is created.
        const tradeRequest = await prisma.$transaction(async (tx) => {
            const created = await tx.tradeRequest.create({
                data: {
                    customerId,
                    agentId: agentId || null,
                    amount: parseFloat(String(amount)),
                    sendCurrency,
                    receiveCurrency,
                    purpose,
                    tradeType: tradeType || "BUY",
                    receiptUrl,
                    status: req.body.status === "DRAFT" ? "DRAFT" : "PENDING",
                    invoiceUrl,
                    supplierId: supplierId || null,
                    supplierBusinessName: actualSupplierBusinessName,
                    supplierBankName: actualSupplierBankName,
                    supplierAccountNumber: actualSupplierAccountNumber,
                    supplierSector: actualSupplierSector,
                    supplierAddress: actualSupplierAddress,
                },
            });

            if (created.status !== "DRAFT") {
                await reserveFunds(
                    customerId,
                    parseFloat(String(amount)),
                    {
                        description: `Funds reserved for trade request ${created.id.slice(0, 8).toUpperCase()}`,
                        tradeRequestId: created.id,
                        actorId: (req as any).user.id,
                    },
                    tx
                );
            }

            return created;
        }, {
            timeout: 15000,
        });

        // Re-fetch with includes outside the transaction to avoid timeout
        const fullTradeRequest = await prisma.tradeRequest.findUnique({
            where: { id: tradeRequest.id },
            include: {
                customer: { include: { user: true } },
                agent: true,
            },
        });

        if (fullTradeRequest && fullTradeRequest.status !== "DRAFT") {
            // Notify all ADMIN users about the new trade request
            const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
            await Promise.allSettled(
                admins.map((admin) =>
                    createNotification(
                        admin.id,
                        "New Trade Request",
                        `Customer ${fullTradeRequest.customer?.fullName || 'Unknown'} has submitted a trade request for ${amount} ${sendCurrency} → ${receiveCurrency}.`,
                        "INFO"
                    )
                )
            );

            // Also notify agent and admins via email
            const adminEmails = admins.map(a => a.email).filter((e): e is string => !!e);
            if (fullTradeRequest.agent?.email) {
                await sendTradeInitiatedEmail({
                    agentEmail: fullTradeRequest.agent.email,
                    agentName: fullTradeRequest.agent.firstName || "Agent",
                    customerName: fullTradeRequest.customer?.fullName || 'Unknown',
                    amount: amount.toString(),
                    currency: sendCurrency,
                    tradeId: fullTradeRequest.id.slice(0, 8).toUpperCase(),
                    adminEmails,
                });
            }
        }

        res.status(201).json(fullTradeRequest || tradeRequest);
    } catch (error) {
        if (error instanceof InsufficientFundsError) {
            return res.status(402).json({
                error: "Insufficient wallet balance. Please fund your wallet before submitting this trade.",
                code: "INSUFFICIENT_FUNDS",
                detail: error.message,
            });
        }
        console.error("Error creating trade request:", error);
        res.status(500).json({ error: "Failed to initiate trade request" });
    }
}


/**
 * Get customer's trade requests
 * GET /api/customer/portal/trade-requests
 */
export async function getCustomerTradeRequests(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { page = 1, limit = 20, search } = req.query;

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const where: any = { customerId };
        if (search) {
            const cleanSearch = (search as string).trim().toLowerCase();
            const rawIdSearch = cleanSearch.replace("pe-", "");
            where.AND = [
                {
                    OR: [
                        { id: { contains: rawIdSearch } },
                        { supplierBusinessName: { contains: cleanSearch, mode: "insensitive" } },
                        { sendCurrency: { contains: cleanSearch, mode: "insensitive" } },
                        { receiveCurrency: { contains: cleanSearch, mode: "insensitive" } },
                    ]
                }
            ];
        }

        const [requests, total] = await Promise.all([
            prisma.tradeRequest.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.tradeRequest.count({ where })
        ]);

        // Fetch linked trades to find their IDs
        const requestIds = requests.map((r) => r.id);
        const linkedTrades = await prisma.trade.findMany({
            where: { tradeRequestId: { in: requestIds } },
            select: { id: true, tradeRequestId: true },
        });

        const tradeMap = new Map(
            linkedTrades.map((t) => [t.tradeRequestId, t.id])
        );

        const requestsWithLinkedTrade = requests.map((r) => ({
            ...r,
            linkedTradeId: tradeMap.get(r.id) || null,
        }));

        res.json({ requests: requestsWithLinkedTrade, total, page: Number(page), limit: Number(limit) });
    } catch (error) {
        console.error("Error fetching customer trade requests:", error);
        res.status(500).json({ error: "Failed to fetch trade requests" });
    }
}

/**
 * Get a single customer trade request by ID
 * GET /api/customer/portal/trade-requests/:id
 */
export async function getTradeRequestById(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { id } = req.params;

        let request = await prisma.tradeRequest.findFirst({
            where: { id, customerId },
        });

        if (!request) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        // Check expiry & auto-refresh
        const activeRequest = await checkAndRefreshTradeRequestExpiry(request);
        if (!activeRequest) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        const linkedTrade = await prisma.trade.findFirst({
            where: { tradeRequestId: id },
            select: { id: true },
        });

        let rateExpiresIn: number | null = null;
        if (activeRequest.status === "QUOTED" && (activeRequest as any).quotedAt) {
            const msLeft = new Date((activeRequest as any).quotedAt).getTime() + 10 * 60 * 1000 - Date.now();
            rateExpiresIn = msLeft > 0 ? Math.floor(msLeft / 1000) : 0;
        }

        res.json({
            ...activeRequest,
            linkedTradeId: linkedTrade?.id || null,
            rateExpiresIn,
        });
    } catch (error) {
        console.error("Error fetching trade request by ID:", error);
        res.status(500).json({ error: "Failed to fetch trade request" });
    }
}

/**
 * Update customer's trade request (draft or pending)
 * PUT /api/customer/portal/trade-requests/:id
 */
export async function updateCustomerTradeRequest(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({
            where: { id }
        });

        if (!request || request.customerId !== customerId) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        if (request.status !== "DRAFT" && request.status !== "PENDING" && request.status !== "POOL") {
            return res.status(400).json({ error: "Only draft, pending, or pool trade requests can be updated" });
        }

        const {
            amount,
            sendCurrency,
            receiveCurrency,
            purpose,
            tradeType,
            receiptUrl,
            invoiceUrl,
            supplierId,
            businessName,
            bankName,
            accountNumber,
            sector,
            address,
            status, // e.g. publish from DRAFT to PENDING
        } = req.body;

        let actualSupplierBusinessName = businessName !== undefined ? businessName : request.supplierBusinessName;
        let actualSupplierBankName = bankName !== undefined ? bankName : request.supplierBankName;
        let actualSupplierAccountNumber = accountNumber !== undefined ? accountNumber : request.supplierAccountNumber;
        let actualSupplierSector = sector !== undefined ? sector : request.supplierSector;
        let actualSupplierAddress = address !== undefined ? address : request.supplierAddress;

        if (supplierId) {
            const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
            if (supplier && supplier.customerId === customerId) {
                actualSupplierBusinessName = supplier.beneficiaryName;
                actualSupplierBankName = supplier.bankName;
                actualSupplierAccountNumber = supplier.accountNumber;
                actualSupplierSector = supplier.routingCode;
                actualSupplierAddress = supplier.address;
            }
        }

        const oldStatus = request.status;
        const newStatus = status === "PENDING" ? "PENDING" : request.status;
        const isPublishing = oldStatus === "DRAFT" && newStatus === "PENDING";
        const effectiveAmount = amount !== undefined ? parseFloat(String(amount)) : Number(request.amount);

        // If publishing a draft, ensure the wallet can back the trade before we
        // even attempt the update, so we can return a clean 402 to the client.
        if (isPublishing) {
            try {
                await assertSufficientBalance(customerId, effectiveAmount);
            } catch (err) {
                if (err instanceof InsufficientFundsError) {
                    const balanceInfo = await checkWalletBalance(customerId, effectiveAmount);
                    return res.status(402).json({
                        error: "Insufficient ledger balance. Please deposit via Paystack or bank transfer to fund your trade.",
                        code: "INSUFFICIENT_FUNDS",
                        detail: err.message,
                        ...balanceInfo,
                    });
                }
                throw err;
            }
        }

        // Update the request and — when publishing DRAFT→PENDING — reserve the
        // wallet funds atomically so the submitted request is fully backed.
        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.tradeRequest.update({
                where: { id },
                data: {
                    amount: amount !== undefined ? parseFloat(String(amount)) : undefined,
                    sendCurrency,
                    receiveCurrency,
                    purpose,
                    tradeType,
                    receiptUrl,
                    invoiceUrl,
                    supplierId: supplierId || undefined,
                    supplierBusinessName: actualSupplierBusinessName,
                    supplierBankName: actualSupplierBankName,
                    supplierAccountNumber: actualSupplierAccountNumber,
                    supplierSector: actualSupplierSector,
                    supplierAddress: actualSupplierAddress,
                    status: newStatus,
                },
            });

            if (isPublishing) {
                await reserveFunds(
                    customerId,
                    effectiveAmount,
                    {
                        description: `Funds reserved for trade request ${u.id.slice(0, 8).toUpperCase()}`,
                        tradeRequestId: u.id,
                        actorId: (req as any).user.id,
                    },
                    tx
                );
            }

            return u;
        }, {
            timeout: 15000,
        });

        // Re-fetch with includes outside transaction
        const fullUpdated = await prisma.tradeRequest.findUnique({
            where: { id: updated.id },
            include: {
                customer: { include: { user: true } },
                agent: true,
            },
        });


        // If transitioning from DRAFT to PENDING, notify admins & agents
        if (oldStatus === "DRAFT" && newStatus === "PENDING" && fullUpdated) {
            const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
            await Promise.allSettled(
                admins.map((admin) =>
                    createNotification(
                        admin.id,
                        "New Trade Request (Published)",
                        `Customer ${fullUpdated.customer?.fullName || 'Unknown'} has submitted a trade request for ${fullUpdated.amount} ${fullUpdated.sendCurrency} → ${fullUpdated.receiveCurrency}.`,
                        "INFO"
                    )
                )
            );

            const adminEmails = admins.map(a => a.email).filter((e): e is string => !!e);
            if (fullUpdated.agent?.email) {
                await sendTradeInitiatedEmail({
                    agentEmail: fullUpdated.agent.email,
                    agentName: fullUpdated.agent.firstName || "Agent",
                    customerName: fullUpdated.customer?.fullName || 'Unknown',
                    amount: fullUpdated.amount.toString(),
                    currency: fullUpdated.sendCurrency,
                    tradeId: fullUpdated.id.slice(0, 8).toUpperCase(),
                    adminEmails,
                });
            }
        }

        res.json(fullUpdated || updated);
    } catch (error) {
        if (error instanceof InsufficientFundsError) {
            return res.status(402).json({
                error: "Insufficient wallet balance. Please fund your wallet before submitting this trade.",
                code: "INSUFFICIENT_FUNDS",
                detail: error.message,
            });
        }
        console.error("Error updating trade request:", error);
        res.status(500).json({ error: "Failed to update trade request" });
    }
}


/**
 * Cancel customer's trade request
 * PATCH /api/customer/portal/trade-requests/:id/cancel
 */
export async function cancelCustomerTradeRequest(req: Request, res: Response) {
    try {
        const customerId = (req as any).user.customer?.id;
        const { id } = req.params;

        const request = await prisma.tradeRequest.findUnique({ where: { id } });
        if (!request || request.customerId !== customerId) {
            return res.status(404).json({ error: "Trade request not found" });
        }

        if (request.status === "PROCESSED" || request.status === "REJECTED" || request.status === "CANCELLED") {
            return res.status(400).json({ error: `Cannot cancel request in ${request.status} status` });
        }

        // Funds are only reserved once a request leaves DRAFT. When cancelling a
        // reserved request, release the held funds back to available in the same
        // transaction as the status change so the two never drift apart.
        const hadReservedFunds = request.status !== "DRAFT";

        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.tradeRequest.update({
                where: { id },
                data: { status: "CANCELLED" }
            });

            if (hadReservedFunds) {
                await releaseReservation(
                    customerId,
                    Number(request.amount),
                    {
                        description: `Funds released after cancelling trade request ${request.id.slice(0, 8).toUpperCase()}`,
                        tradeRequestId: request.id,
                        actorId: (req as any).user.id,
                    },
                    tx
                );
            }

            return u;
        }, {
            timeout: 15000,
        });


        // Notify assigned agent (if any) or admin
        if (request.agentId) {
            await createNotification(
                request.agentId,
                "Trade Request Cancelled",
                `Customer has cancelled their trade request #${request.id.slice(0, 8).toUpperCase()}.`,
                "WARNING"
            );
        }

        res.json(updated);
    } catch (error) {
        console.error("Error cancelling trade request:", error);
        res.status(500).json({ error: "Failed to cancel trade request" });
    }
}
