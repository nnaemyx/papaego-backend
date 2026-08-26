import { Request, Response } from "express";
import prisma from "../../config/db";
import { generateLicenseId } from "../../utils/generateLicenseId";
import { generateOnboardingToken, getOnboardingTokenExpiry } from "../../utils/generateOnboardingToken";
import {
    sendAgentInvitation,
    sendAgentVerificationEmail,
    sendAgentSuspensionEmail
} from "../../services/email.service";

export async function createAgent(req: Request, res: Response) {
    const { email: rawEmail, phone, region, firstName, lastName, role, agentType } = req.body;
    const email = rawEmail?.trim().toLowerCase();

    // Validate required fields
    if (!email) {
        return res.status(400).json({ error: "email is required" });
    }
    if (!region) {
        return res.status(400).json({ error: "region is required" });
    }

    try {
        // Check if email already exists
        const existingUser = await prisma.user.findFirst({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({ error: "Email already exists. Each agent must have a unique email address." });
        }

        // Auto-generate license ID and onboarding token
        const licenseId = await generateLicenseId();
        const onboardingToken = generateOnboardingToken();
        const onboardingTokenExpiry = getOnboardingTokenExpiry();

        const incomingType = (agentType || role || "").toUpperCase();
        const finalAgentType = incomingType.includes("CORPORATE") ? "Corporate Agent" : "Field Agent";
        // Generate referral code from license ID (e.g., PE-AGT-001 → PEAGT001)
        const referralCode = `PE-${licenseId.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`;

        // Create user and agent profile in a single transaction using nested create
        const user = await prisma.user.create({
            data: {
                email,
                phone: phone || "+234000000000", // Temporary phone until onboarding
                role: "AGENT",
                password: "TEMP_PASSWORD", // Will be set during onboarding
                firstName: firstName || null,
                lastName: lastName || null,
                agentProfile: {
                    create: {
                        region,
                        licenseId,
                        lga: "Default",
                        dailyLimit: 50000,
                        monthlyLimit: 500000,
                        onboardingToken,
                        onboardingTokenExpiry,
                        referralCode,
                        agentType: finalAgentType
                    }
                }
            },
            include: {
                agentProfile: true
            }
        });

        // Generate onboarding link (updated to match frontend routes)
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const onboardingLink = `${frontendUrl}/onboarding?token=${onboardingToken}`;

        // Send invitation email
        try {
            await sendAgentInvitation({
                email: user.email!,
                agentName: user.firstName || user.email!.split('@')[0],
                licenseId,
                onboardingLink
            });
            console.log(`✅ Agent invitation email sent to: ${user.email}`);
        } catch (emailError) {
            console.error("❌ Failed to send invitation email:", emailError);
            // Don't fail the entire request if email fails
            // You might want to log this to a monitoring service
        }

        res.json({
            success: true,
            user,
            message: "Agent created successfully. Invitation email sent.",
            onboardingLink // Include this in dev/testing, remove in production
        });
    } catch (error) {
        console.error("❌ Error creating agent:", error);
        res.status(500).json({ error: "Failed to create agent" });
    }
}

export async function getAgents(req: Request, res: Response) {
    const { status, role, region, search, agentType } = req.query;

    const where: any = {};

    if (status) where.status = status;
    
    if (role || region || agentType) {
        where.agentProfile = {};
        if (role) {
            where.agentProfile.agentType = role === "Corporate Agent" || role === "CORPORATE" ? "CORPORATE" : "FIELD";
        }
        if (agentType) {
            where.agentProfile.agentType = agentType as string;
        }
        if (region) where.agentProfile.region = region as string;
    }

    // Add search functionality
    if (search) {
        where.OR = [
            { email: { contains: search as string } },
            { phone: { contains: search as string } }
        ];
    }

    const users = await prisma.user.findMany({
        where: {
            role: "AGENT",
            ...where
        },
        include: {
            agentProfile: true
        }
    });

    // Transform to match frontend format
    const agents = users.map(user => ({
        id: user.id,
        agentId: `#PE-${user.id.slice(0, 5).toUpperCase()}`,
        name: user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user.email || 'Unknown',
        email: user.email,
        role: user.agentProfile?.agentType === "CORPORATE" ? "Corporate Agent" : "Field Agent",
        agentType: user.agentProfile?.agentType || "FIELD",
        region: user.agentProfile?.region || "N/A",
        activeTrades: 0, // Calculate from trades table
        status: user.isActive ? "Active" : "Inactive",
        phone: user.phone,
        createdAt: user.createdAt
    }));

    res.json(agents);
}

export async function activateAgent(req: Request, res: Response) {
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: true },
        include: { agentProfile: true }
    });

    if (user.agentProfile) {
        await prisma.agentProfile.update({
            where: { userId: user.id },
            data: { onboardingStatus: "APPROVED" }
        });
    }

    if (user.email) {
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const loginLink = `${frontendUrl}/agent/login`;
        try {
            await sendAgentVerificationEmail({
                email: user.email,
                agentName: user.firstName || user.email.split('@')[0],
                loginLink
            });
        } catch (error) {
            console.error("Failed to send verification email to:", user.email);
        }
    }

    res.json({ success: true });
}

export async function suspendAgent(req: Request, res: Response) {
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: false }
    });

    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "ADMIN",
            action: "AGENT_SUSPENDED",
            entity: "User",
            entityId: req.params.id,
            ip: req.ip || "127.0.0.1"
        }
    });

    if (user.email) {
        try {
            await sendAgentSuspensionEmail({
                email: user.email,
                agentName: user.firstName || user.email.split('@')[0],
            });
        } catch (error) {
            console.error("Failed to send suspension email to:", user.email);
        }
    }

    res.json({ suspended: true });
}

export async function getFxMargin(req: Request, res: Response) {
    try {
        const countryId = (req.query.countryId as string) || "NGA";

        const margin = await prisma.fxMargin.findUnique({
            where: { countryId }
        });

        res.json({ countryId, margin: margin?.margin || 0 });
    } catch (error) {
        console.error("Error fetching fx margin:", error);
        res.status(500).json({ error: "Failed to fetch FX margin" });
    }
}

export async function setFxMargin(req: Request, res: Response) {
    const { countryId, margin } = req.body;

    // Log the previous margin value before updating
    const previousMargin = await prisma.fxMargin.findUnique({ where: { countryId } });

    await prisma.fxMargin.upsert({
        where: { countryId },
        update: { margin },
        create: { countryId, margin }
    });

    // Audit log for margin change
    await prisma.auditLog.create({
        data: {
            actorId: (req as any).user.id,
            role: "ADMIN",
            action: "FX_MARGIN_CHANGED",
            entity: "FxMargin",
            entityId: countryId,
            ip: req.ip || "127.0.0.1",
            metadata: {
                countryId,
                previousMargin: previousMargin?.margin?.toString() || "0",
                newMargin: margin.toString(),
            },
        },
    });

    res.json({ updated: true });
}

export async function listAllTrades(req: Request, res: Response) {
    try {
        const { status, search, limit = '50', page = '1' } = req.query;
        const take = parseInt(limit as string, 10);
        const skip = (parseInt(page as string, 10) - 1) * take;

        const where: any = {};
        if (status && status !== 'All') where.status = (status as string).toUpperCase();

        if (search) {
            const cleanSearch = (search as string).trim().toLowerCase();
            const rawIdSearch = cleanSearch.replace("#pe-", "").replace("pe-", "");
            where.OR = [
                { id: { contains: rawIdSearch } },
                {
                    customer: {
                        fullName: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    customer: {
                        email: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    agent: {
                        firstName: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    agent: {
                        lastName: { contains: cleanSearch, mode: 'insensitive' }
                    }
                },
                {
                    agent: {
                        email: { contains: cleanSearch, mode: 'insensitive' }
                    }
                }
            ];
        }

        const [trades, total] = await Promise.all([
            prisma.trade.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip
            }),
            prisma.trade.count({ where })
        ]);

        // Fetch customer records including referringAgentId to resolve actual agent attribution
        const customerIds = [...new Set(trades.map(t => t.customerId).filter(Boolean))];

        const customerRecords = await prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, fullName: true, email: true, referringAgentId: true }
        });

        const customerMap: Record<string, { name: string; referringAgentId: string | null }> = {};
        const referringAgentIds: string[] = [];
        customerRecords.forEach(c => {
            customerMap[c.id] = {
                name: c.fullName || c.email || 'Customer',
                referringAgentId: c.referringAgentId
            };
            if (c.referringAgentId) {
                referringAgentIds.push(c.referringAgentId);
            }
        });

        // Collect all potential agent IDs (executing agentId + customer referringAgentId)
        const executingAgentIds = trades.map(t => t.agentId).filter(Boolean);
        const allAgentIds = [...new Set([...executingAgentIds, ...referringAgentIds])];

        const agentUsers = await prisma.user.findMany({
            where: { id: { in: allAgentIds } },
            select: { id: true, firstName: true, lastName: true, email: true }
        });

        const agentMap: Record<string, string> = {};
        agentUsers.forEach(u => {
            agentMap[u.id] = u.firstName && u.lastName
                ? `${u.firstName} ${u.lastName}`
                : u.email?.split('@')[0] || 'Agent';
        });

        const formatted = trades.map(trade => {
            const customerData = customerMap[trade.customerId];
            const customerName = customerData?.name || 'N/A';
            
            // Resolve the actual agent to display: referring agent, falling back to executing agent
            const resolvedAgentId = customerData?.referringAgentId || trade.agentId;
            const agentName = agentMap[resolvedAgentId] || 'N/A';
            const agentIdDisplay = resolvedAgentId ? `#PE-${resolvedAgentId.slice(0, 5).toUpperCase()}` : '—';
            
            const dateObj = new Date(trade.createdAt);

            const statusMap: Record<string, string> = {
                COMPLETED: 'Completed', CANCELLED: 'Cancelled',
                AWAITING_PAYMENT: 'Pending', PAYMENT_CONFIRMED: 'In Progress',
                FLAGGED: 'Pending', UNDER_REVIEW: 'Pending',
                INITIATED: 'Pending', QUOTED: 'Pending',
                SENT_TO_CUSTOMER: 'Pending', CUSTOMER_CONFIRMED: 'Pending',
                CUSTOMER_VERIFIED: 'Pending', EXPIRED: 'Cancelled'
            };

            return {
                id: trade.id,
                tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
                date: dateObj.toLocaleDateString('en-GB'),
                time: dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                customer: customerName,
                agent: agentName,
                agentId: agentIdDisplay,
                transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
                amount: `₦${Number(trade.amount).toLocaleString()}`,
                status: statusMap[trade.status] || trade.status,
                verification: 'Verified',
                createdAt: trade.createdAt
            };
        });

        res.json({ trades: formatted, total, page: parseInt(page as string, 10), limit: take });
    } catch (error) {
        console.error("Error fetching trades:", error);
        res.status(500).json({ error: "Failed to fetch trades" });
    }
}

export async function approveOverride(req: Request, res: Response) {
    const override = await prisma.overrideApproval.findUnique({
        where: { id: req.params.id }
    });

    if (!override) return res.status(404).json({ error: "Override not found" });

    if (override.requestedBy === (req as any).user.id) {
        return res.status(403).json({ error: "Maker cannot approve" });
    }

    await prisma.overrideApproval.update({
        where: { id: override.id },
        data: {
            status: "APPROVED",
            approvedBy: (req as any).user.id
        }
    });

    res.json({ approved: true });
}

// Dashboard Statistics
export async function getDashboardStats(req: Request, res: Response) {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // --- Basic counts & treasury data ---
        const [
            totalTransactions,
            activeAgents,
            allTrades,
            treasuryBalances,
            customerWallets,
            pendingDepositsCount
        ] = await Promise.all([
            prisma.trade.count(),
            prisma.user.count({ where: { role: "AGENT", isActive: true } }),
            prisma.trade.findMany({
                select: { id: true, status: true, amount: true, sendCurrency: true, createdAt: true },
            }),
            prisma.treasuryBalance.findMany(),
            prisma.customerWallet.findMany(),
            prisma.depositRequest.count({ where: { status: "PENDING" } }),
        ]);

        const total = allTrades.length || 1; // avoid /0
        const tradeVolume = allTrades.reduce((sum, t) => sum + Number(t.amount || 0), 0);

        // Calculate real available liquidity & treasury values from treasury balances and customer wallets
        const treasuryTotal = treasuryBalances.reduce((sum, b) => sum + Number(b.totalBalance || 0), 0);
        const treasuryAvailable = treasuryBalances.reduce((sum, b) => sum + Number(b.availableBalance || 0), 0);
        const walletAvailable = customerWallets.reduce((sum, w) => sum + Number(w.availableBalance || 0), 0);
        const walletReserved = customerWallets.reduce((sum, w) => sum + Number(w.reservedBalance || 0), 0);
        const walletTotalDeposited = customerWallets.reduce((sum, w) => sum + Number(w.totalDeposited || 0), 0);

        const inProgressStatuses = ["AWAITING_PAYMENT", "PAYMENT_UPLOADED", "PAYMENT_CONFIRMED", "CUSTOMER_CONFIRMED", "SENT_TO_CUSTOMER", "CUSTOMER_VERIFIED", "PROCESSING", "PROCESSED"];
        const inProgressTrades = allTrades.filter(t => inProgressStatuses.includes(t.status));
        const inProgressTradesSum = inProgressTrades.reduce((sum, t) => sum + Number(t.amount || 0), 0);

        // Treasury position strictly reflects Treasury accounts (0 if none configured)
        const totalTreasuryValue = treasuryTotal;
        const availableLiquidity = treasuryAvailable;
        const pendingSettlement = walletReserved > 0 ? walletReserved : inProgressTradesSum;
        const customerLedgerBalance = walletAvailable + walletReserved;

        // --- Trade health breakdown (%) ---
        const completedStatuses = ["COMPLETED"];
        const pendingStatuses = ["INITIATED", "QUOTED", "REQUESTED"];
        const failedStatuses = ["CANCELLED", "EXPIRED", "FLAGGED", "UNDER_REVIEW"];

        const completedCount = allTrades.filter(t => completedStatuses.includes(t.status)).length;
        const inProgressCount = inProgressTrades.length;
        const pendingCount = allTrades.filter(t => pendingStatuses.includes(t.status)).length;
        const failedCount = allTrades.filter(t => failedStatuses.includes(t.status)).length;

        const tradeHealth = {
            completed: Math.round((completedCount / total) * 100),
            inProgress: Math.round((inProgressCount / total) * 100),
            pending: Math.round((pendingCount / total) * 100),
            failed: Math.round((failedCount / total) * 100),
        };

        // --- Risk & Compliance ---
        const highValueAmount = 1_000_000; // NGN
        const highValueCount = allTrades.filter(t => Number(t.amount) >= highValueAmount).length;

        const [flaggedTodayCount, flaggedUnderReview] = await Promise.all([
            prisma.complianceFlag.count({ where: { createdAt: { gte: todayStart } } }),
            prisma.trade.count({ where: { status: "UNDER_REVIEW" } }),
        ]);

        // Flagged customers: distinct customers who have trades with compliance flags
        const flaggedTradeIds = await prisma.complianceFlag.findMany({ select: { tradeId: true } });
        const flaggedTradeIdSet = [...new Set(flaggedTradeIds.map(f => f.tradeId))];
        const flaggedCustomerIds = flaggedTradeIdSet.length > 0
            ? await prisma.trade.findMany({
                where: { id: { in: flaggedTradeIdSet } },
                select: { customerId: true },
              }).then(rows => new Set(rows.map(r => r.customerId)).size)
            : 0;

        const risk = {
            highValueTradesCount: highValueCount,
            flaggedTodayCount,
            flaggedUnderReview,
            flaggedCustomersCount: flaggedCustomerIds,
        };

        // --- Financial performance ---
        const currencyCount: Record<string, number> = {};
        allTrades.forEach(t => {
            currencyCount[t.sendCurrency] = (currencyCount[t.sendCurrency] || 0) + 1;
        });
        const mostTradedCurrency = Object.entries(currencyCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NGN";

        const completedTrades = allTrades.filter(t => t.status === "COMPLETED");
        let avgProcessingMinutes = 0;
        if (completedTrades.length > 0) {
            const now = Date.now();
            const totalMs = completedTrades.reduce((sum, t) => sum + (now - new Date(t.createdAt).getTime()), 0);
            avgProcessingMinutes = Math.round(totalMs / completedTrades.length / 60_000);
        }

        const pendingReviews = flaggedTodayCount;

        res.json({
            totalTransactions,
            tradeVolume,
            totalTreasuryValue,
            availableLiquidity,
            pendingSettlement,
            customerLedgerBalance,
            unmatchedDepositsCount: pendingDepositsCount,
            activeAgents,
            pendingReviews,
            tradeHealth,
            risk,
            financial: {
                mostTradedCurrency,
                avgProcessingMinutes,
            },
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
}

// Get Admin Transaction Details
export async function getAdminTransaction(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const trade = await prisma.trade.findUnique({
            where: { id }
        });

        if (!trade) {
            return res.status(404).json({ error: "Transaction not found" });
        }

        // Fetch Customer Info
        const customer = await prisma.customer.findUnique({
            where: { id: trade.customerId }
        });

        // Resolve referring agent if available, otherwise executing agent
        const resolvedAgentId = customer?.referringAgentId || trade.agentId;

        // Fetch Agent Info
        const agent = await prisma.user.findUnique({
            where: { id: resolvedAgentId },
            select: { id: true, firstName: true, lastName: true, email: true, phone: true }
        });

        res.json({
            ...trade,
            agent,
            customer
        });
    } catch (error) {
        console.error("Error fetching transaction:", error);
        res.status(500).json({ error: "Failed to fetch transaction" });
    }
}

// Get single agent details
export async function getAgent(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                agentProfile: true
            }
        });

        if (!user || user.role !== 'AGENT') {
            return res.status(404).json({ error: "Agent not found" });
        }

        // Get agent statistics
        const trades = await prisma.trade.findMany({
            where: { agentId: id }
        });

        const totalTrades = trades.length;
        const activeTrades = trades.filter(t =>
            !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(t.status)
        ).length;
        const completedTrades = trades.filter(t => t.status === 'COMPLETED').length;

        // Get compliance flags
        const flags = await prisma.complianceFlag.findMany({
            where: {
                tradeId: { in: trades.map(t => t.id) }
            }
        });

        // Get ratings stats
        const ratings = await prisma.agentRating.findMany({
            where: { agentId: id }
        });
        const totalRatings = ratings.length;
        const averageRating = totalRatings > 0
            ? Number((ratings.reduce((sum: number, r: any) => sum + r.rating, 0) / totalRatings).toFixed(2))
            : null;

        res.json({
            ...user,
            agentId: `#PE-${user.id.slice(0, 5).toUpperCase()}`,
            name: user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.firstName || user.lastName || user.email?.split('@')[0] || 'Agent',
            phone: user.phone || null,
            status: user.isActive ? 'Active' : 'Inactive',
            region: user.agentProfile?.region || 'N/A',
            role: user.agentProfile?.agentType === 'CORPORATE' ? 'Corporate Agent' : 'Field Agent',
            agentType: user.agentProfile?.agentType || 'FIELD',
            licenseId: user.agentProfile?.licenseId || 'N/A',
            onboardingStatus: user.agentProfile?.onboardingStatus || 'PENDING',
            agentProfile: user.agentProfile,
            statistics: {
                totalTrades,
                activeTrades,
                completedTrades,
                flaggedTransactions: flags.length,
                averageRating,
                totalRatings,
            }
        });
    } catch (error) {
        console.error("Error fetching agent:", error);
        res.status(500).json({ error: "Failed to fetch agent" });
    }
}

// Delete agent
export async function deleteAgent(req: Request, res: Response) {
    try {
        const { id } = req.params;

        // Check if agent exists
        const user = await prisma.user.findUnique({
            where: { id },
            include: { agentProfile: true }
        });

        if (!user || user.role !== 'AGENT') {
            return res.status(404).json({ error: "Agent not found" });
        }

        // Use a transaction to ensure all related data is deleted correctly
        await prisma.$transaction(async (tx) => {
            // 1. Delete Commission activities and commissions
            const tradeIds = await tx.trade.findMany({
                where: { agentId: id },
                select: { id: true }
            }).then(trades => trades.map(t => t.id));

            await tx.commissionActivity.deleteMany({
                where: { commission: { agentId: id } }
            });

            await tx.commission.deleteMany({
                where: { agentId: id }
            });

            // 2. Delete Notifications
            await tx.notification.deleteMany({
                where: { userId: id }
            });

            // 3. Delete Agent Documents and Notes (where the user is the agent)
            await tx.customerDocument.deleteMany({
                where: { agentId: id }
            });

            await tx.customerNote.deleteMany({
                where: { agentId: id }
            });

            // 4. Delete Agent Profile if exists
            if (user.agentProfile) {
                await tx.agentProfile.delete({
                    where: { userId: id }
                });
            }

            // 5. Delete Customer profile if exists (causes the reported error)
            await tx.customer.deleteMany({
                where: { userId: id }
            });

            // 6. Handle Trades - In a real system we might not delete trades, 
            // but since Trade.agentId is non-nullable, we must delete them or reassign.
            // Before deleting trades, delete their dependents:
            await tx.complianceFlag.deleteMany({
                where: { tradeId: { in: tradeIds } }
            });

            await tx.complianceReport.deleteMany({
                where: { tradeId: { in: tradeIds } }
            });

            await tx.overrideApproval.deleteMany({
                where: { tradeId: { in: tradeIds } }
            });

            await tx.trade.deleteMany({
                where: { agentId: id }
            });

            // 7. Finally delete the user
            await tx.user.delete({
                where: { id }
            });
        });

        // Create audit log
        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: 'ADMIN',
                action: 'AGENT_DELETED',
                entity: 'User',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });

        res.json({ success: true, message: "Agent deleted successfully" });
    } catch (error) {
        console.error("Error deleting agent:", error);
        res.status(500).json({ error: "Failed to delete agent" });
    }
}

export async function updateAgent(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { firstName, lastName, phone, region, agentType, isActive, role } = req.body;

        const updateData: any = {};
        if (firstName !== undefined) updateData.firstName = firstName;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (phone !== undefined) updateData.phone = phone;
        if (isActive !== undefined) updateData.isActive = isActive;

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            include: { agentProfile: true }
        });

        // Update agent profile if region or agentType/role is provided
        if ((region || agentType || role) && user.agentProfile) {
            const profileUpdate: any = {};
            if (region) profileUpdate.region = region;
            
            const incomingType = (agentType || role || "").toUpperCase();
            if (incomingType) {
                profileUpdate.agentType = incomingType.includes("CORPORATE") ? "Corporate Agent" : "Field Agent";
            }
            
            await prisma.agentProfile.update({
                where: { userId: id },
                data: profileUpdate
            });
        }

        const updatedUser = await prisma.user.findUnique({
            where: { id },
            include: { agentProfile: true }
        });

        if (!updatedUser) {
            return res.status(404).json({ error: "Agent not found" });
        }

        res.json({
            ...updatedUser,
            role: updatedUser.agentProfile?.agentType === "CORPORATE" ? "Corporate Agent" : "Field Agent",
            agentType: updatedUser.agentProfile?.agentType || "FIELD"
        });
    } catch (error) {
        console.error("Error updating agent:", error);
        res.status(500).json({ error: "Failed to update agent" });
    }
}

// Update agent verification status
export async function updateAgentVerification(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const agent = await prisma.agentProfile.update({
            where: { userId: id },
            data: { onboardingStatus: status }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: 'ADMIN',
                action: 'AGENT_VERIFICATION_UPDATED',
                entity: 'AgentProfile',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });

        res.json(agent);
    } catch (error) {
        console.error("Error updating verification:", error);
        res.status(500).json({ error: "Failed to update verification" });
    }
}

// Get agent activities
export async function getAgentActivities(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const activities = await prisma.auditLog.findMany({
            where: { actorId: id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        const formattedActivities = activities.map(activity => ({
            date: activity.createdAt.toLocaleDateString(),
            time: activity.createdAt.toLocaleTimeString(),
            transaction: activity.action,
            reference: activity.entityId || '—'
        }));

        res.json(formattedActivities);
    } catch (error) {
        console.error("Error fetching agent activities:", error);
        res.status(500).json({ error: "Failed to fetch activities" });
    }
}

// Get agent transactions
export async function getAgentTransactions(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const trades = await prisma.trade.findMany({
            where: { agentId: id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        const formattedTrades = trades.map(trade => ({
            id: trade.id,
            tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
            date: trade.createdAt.toLocaleDateString(),
            time: trade.createdAt.toLocaleTimeString(),
            transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
            amount: `₦${Number(trade.amount).toLocaleString()}`,
            status: trade.status
        }));

        res.json(formattedTrades);
    } catch (error) {
        console.error("Error fetching agent transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
}

// Export agents to CSV
export async function exportAgents(req: Request, res: Response) {
    try {
        const users = await prisma.user.findMany({
            where: { role: 'AGENT' },
            include: { agentProfile: true }
        });

        const csvData = users.map(user => {
            const activeTrades = 0; // This would require counting trades
            return {
                'Agent ID': `#PE-${user.id.slice(0, 5).toUpperCase()}`,
                'Name': user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.email || '',
                'Email': user.email || '',
                'Phone': user.phone,
                'Role': user.role,
                'Region': user.agentProfile?.region || 'N/A',
                'Active Trades': activeTrades,
                'Status': user.isActive ? 'Active' : 'Inactive',
                'Date Joined': user.createdAt.toLocaleDateString()
            };
        });

        // Generate CSV
        const headers = ['Agent ID', 'Name', 'Email', 'Phone', 'Role', 'Region', 'Active Trades', 'Status', 'Date Joined'];
        const csvRows = [headers.join(',')];

        csvData.forEach(row => {
            const values = headers.map(h => {
                const value = row[h as keyof typeof row];
                return value?.toString() || '';
            });
            csvRows.push(values.join(','));
        });

        const csv = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=agents-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (error) {
        console.error("Error exporting agents:", error);
        res.status(500).json({ error: "Failed to export agents" });
    }
}

// Delete a transaction (Hard Delete)
export async function deleteTransaction(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const trade = await prisma.trade.findUnique({
            where: { id }
        });

        if (!trade) {
            return res.status(404).json({ error: "Transaction not found" });
        }

        // Delete associated records first (e.g. Commissions or ComplianceFlags)
        // Prisma will handle cascades if configured, but manually deleting related records ensures safety

        // Delete Chat messages
        await prisma.chatMessage.deleteMany({
            where: { tradeId: id }
        });

        // Get commissions to safely delete commission activities
        const commissions = await prisma.commission.findMany({
            where: { tradeId: id }
        });
        const commissionIds = commissions.map(c => c.id);

        if (commissionIds.length > 0) {
            await prisma.commissionActivity.deleteMany({
                where: { commissionId: { in: commissionIds } }
            });
        }

        await prisma.complianceFlag.deleteMany({
            where: { tradeId: id }
        });

        await prisma.complianceReport.deleteMany({
            where: { tradeId: id }
        });

        await prisma.overrideApproval.deleteMany({
            where: { tradeId: id }
        });

        await prisma.commission.deleteMany({
            where: { tradeId: id }
        });

        // Finally, delete the trade itself
        await prisma.trade.delete({
            where: { id }
        });

        // Log the deletion
        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: 'ADMIN',
                action: 'TRANSACTION_DELETED',
                entity: 'Trade',
                entityId: id,
                ip: req.ip || '127.0.0.1'
            }
        });

        res.json({ success: true, message: "Transaction deleted successfully" });
    } catch (error) {
        console.error("Error deleting transaction:", error);
        res.status(500).json({ error: "Failed to delete transaction" });
    }
}

// ── FX Rates CRUD (stored in SystemConfig as a JSON blob) ────────────────────

const FX_RATES_KEY = "fx_rates";

interface StoredFxRate {
    pair: string;
    baseCurrency: string;
    quoteCurrency: string;
    buy: number;
    sell: number;
    lastUpdated: string;
    isActive: boolean;
}

async function loadRates(): Promise<StoredFxRate[]> {
    const config = await prisma.systemConfig.findUnique({ where: { key: FX_RATES_KEY } });
    if (!config) return [];
    const data = config.value as any;
    return Array.isArray(data) ? data : [];
}

async function saveRates(rates: StoredFxRate[]): Promise<void> {
    await prisma.systemConfig.upsert({
        where: { key: FX_RATES_KEY },
        update: { value: rates as any },
        create: { key: FX_RATES_KEY, value: rates as any },
    });
}

/** GET /admin/fx-rates — returns all FX rates */
export async function getFxRates(req: Request, res: Response) {
    try {
        const rates = await loadRates();
        res.json(rates);
    } catch (error) {
        console.error("Error fetching FX rates:", error);
        res.status(500).json({ error: "Failed to fetch FX rates" });
    }
}

/** POST /admin/fx-rates — create or update a single rate pair */
export async function upsertFxRate(req: Request, res: Response) {
    try {
        const { pair, baseCurrency, quoteCurrency, buy, sell } = req.body;
        if (!pair || !baseCurrency || !quoteCurrency || buy == null || sell == null) {
            return res.status(400).json({ error: "pair, baseCurrency, quoteCurrency, buy, and sell are required" });
        }

        const rates = await loadRates();
        const existing = rates.findIndex(r => r.pair === pair);
        const before = existing >= 0 ? { ...rates[existing] } : null;

        const updated: StoredFxRate = {
            pair,
            baseCurrency,
            quoteCurrency,
            buy: Number(buy),
            sell: Number(sell),
            lastUpdated: new Date().toISOString(),
            isActive: true,
        };

        // Log rate change (only if updating existing)
        if (existing >= 0) {
            const prev = rates[existing];
            await prisma.rateChangeLog.create({
                data: {
                    pair,
                    previousBuy: prev.buy,
                    previousSell: prev.sell,
                    newBuy: Number(buy),
                    newSell: Number(sell),
                    changedBy: (req as any).user.id,
                    reason: req.body.reason || "Manual update",
                },
            });
            rates[existing] = updated;
        } else {
            // New rate - log as creation
            await prisma.rateChangeLog.create({
                data: {
                    pair,
                    previousBuy: 0,
                    previousSell: 0,
                    newBuy: Number(buy),
                    newSell: Number(sell),
                    changedBy: (req as any).user.id,
                    reason: req.body.reason || "Rate created",
                },
            });
            rates.push(updated);
        }

        await saveRates(rates);

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: 'ADMIN',
                action: 'FX_RATE_UPDATED',
                entity: 'SystemConfig',
                entityId: FX_RATES_KEY,
                ip: req.ip || '127.0.0.1',
                metadata: {
                    pair,
                    before,
                    after: updated
                } as any
            }
        });

        res.json(updated);
    } catch (error) {
        console.error("Error upserting FX rate:", error);
        res.status(500).json({ error: "Failed to upsert FX rate" });
    }
}

/** PATCH /admin/fx-rates/:pair — update a rate by pair (e.g. USD%2FNGN) */
export async function updateFxRate(req: Request, res: Response) {
    try {
        const pair = decodeURIComponent(req.params.pair);
        const { buy, sell, baseCurrency, quoteCurrency } = req.body;

        const rates = await loadRates();
        const idx = rates.findIndex(r => r.pair === pair);
        if (idx < 0) return res.status(404).json({ error: "Rate not found" });
        const before = { ...rates[idx] };
        // Log rate change before applying
        const prev = rates[idx];
        await prisma.rateChangeLog.create({
            data: {
                pair,
                previousBuy: prev.buy,
                previousSell: prev.sell,
                newBuy: buy != null ? Number(buy) : prev.buy,
                newSell: sell != null ? Number(sell) : prev.sell,
                changedBy: (req as any).user.id,
                reason: req.body.reason || "Manual update",
            },
        });

        if (buy != null) rates[idx].buy = Number(buy);
        if (sell != null) rates[idx].sell = Number(sell);
        if (baseCurrency) rates[idx].baseCurrency = baseCurrency;
        if (quoteCurrency) rates[idx].quoteCurrency = quoteCurrency;
        rates[idx].lastUpdated = new Date().toISOString();

        await saveRates(rates);

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: 'ADMIN',
                action: 'FX_RATE_UPDATED',
                entity: 'SystemConfig',
                entityId: FX_RATES_KEY,
                ip: req.ip || '127.0.0.1',
                metadata: {
                    pair,
                    before,
                    after: rates[idx]
                } as any
            }
        });

        res.json(rates[idx]);
    } catch (error) {
        console.error("Error updating FX rate:", error);
        res.status(500).json({ error: "Failed to update FX rate" });
    }
}

/** DELETE /admin/fx-rates/:pair — remove a rate pair */
export async function deleteFxRate(req: Request, res: Response) {
    try {
        const pair = decodeURIComponent(req.params.pair);

        const rates = await loadRates();
        const deletedRate = rates.find(r => r.pair === pair);
        const filtered = rates.filter(r => r.pair !== pair);
        if (filtered.length === rates.length) {
            return res.status(404).json({ error: "Rate not found" });
        }

        await saveRates(filtered);

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: 'ADMIN',
                action: 'FX_RATE_DELETED',
                entity: 'SystemConfig',
                entityId: FX_RATES_KEY,
                ip: req.ip || '127.0.0.1',
                metadata: {
                    pair,
                    deleted: deletedRate || null
                } as any
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting FX rate:", error);
        res.status(500).json({ error: "Failed to delete FX rate" });
    }
}
