import { Request, Response } from "express";
import prisma from "../../config/db";
import { generateLicenseId } from "../../utils/generateLicenseId";
import { generateOnboardingToken, getOnboardingTokenExpiry } from "../../utils/generateOnboardingToken";
import { sendAgentInvitation } from "../../services/email.service";

export async function createAgent(req: Request, res: Response) {
    const { email, phone, region, firstName, lastName } = req.body;

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
                        onboardingTokenExpiry
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
    const { status, role, region, search } = req.query;

    const where: any = {};

    if (status) where.status = status;
    if (role) where.role = role;

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
        role: user.role,
        region: user.agentProfile?.region || "N/A",
        activeTrades: 0, // Calculate from trades table
        status: user.isActive ? "Active" : "Inactive",
        phone: user.phone,
        createdAt: user.createdAt
    }));

    res.json(agents);
}

export async function activateAgent(req: Request, res: Response) {
    await prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: true }
    });

    res.json({ success: true });
}

export async function suspendAgent(req: Request, res: Response) {
    await prisma.user.update({
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

    res.json({ suspended: true });
}

export async function setFxMargin(req: Request, res: Response) {
    const { countryId, margin } = req.body;

    await prisma.fxMargin.upsert({
        where: { countryId },
        update: { margin },
        create: { countryId, margin }
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

        const [trades, total] = await Promise.all([
            prisma.trade.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
                skip
            }),
            prisma.trade.count({ where })
        ]);

        // Fetch agents + customers in bulk to avoid N+1
        const agentIds = [...new Set(trades.map(t => t.agentId).filter(Boolean))];
        const customerIds = [...new Set(trades.map(t => t.customerId).filter(Boolean))];

        const [agentUsers, customerRecords] = await Promise.all([
            prisma.user.findMany({
                where: { id: { in: agentIds } },
                select: { id: true, firstName: true, lastName: true, email: true }
            }),
            prisma.customer.findMany({
                where: { id: { in: customerIds } },
                select: { id: true, fullName: true, email: true }
            })
        ]);

        const agentMap: Record<string, string> = {};
        agentUsers.forEach(u => {
            agentMap[u.id] = u.firstName && u.lastName
                ? `${u.firstName} ${u.lastName}`
                : u.email?.split('@')[0] || 'Agent';
        });

        const customerMap: Record<string, string> = {};
        customerRecords.forEach(c => {
            customerMap[c.id] = c.fullName || c.email || 'Customer';
        });

        // Filter by search on formatted data if needed
        let formatted = trades.map(trade => {
            const agentName = agentMap[trade.agentId] || 'N/A';
            const customerName = customerMap[trade.customerId] || 'N/A';
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
                agentId: trade.agentId ? `#PE-${trade.agentId.slice(0, 5).toUpperCase()}` : '—',
                transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
                amount: `₦${Number(trade.amount).toLocaleString()}`,
                status: statusMap[trade.status] || trade.status,
                verification: 'Verified',
                createdAt: trade.createdAt
            };
        });

        if (search) {
            const s = (search as string).toLowerCase();
            formatted = formatted.filter(t =>
                t.tradeId.toLowerCase().includes(s) ||
                t.agent.toLowerCase().includes(s) ||
                t.customer.toLowerCase().includes(s)
            );
        }

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
        const totalTransactions = await prisma.trade.count();
        const activeAgents = await prisma.user.count({
            where: { role: "AGENT", isActive: true }
        });
        const pendingReviews = await prisma.complianceFlag.count({
            where: {
                createdAt: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
            }
        });

        // Calculate trade volume
        const trades = await prisma.trade.findMany({
            select: { amount: true }
        });
        const tradeVolume = trades.reduce((sum, trade) => sum + Number(trade.amount), 0);

        res.json({
            totalTransactions,
            tradeVolume,
            activeAgents,
            pendingReviews
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

        res.json(trade);
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

        res.json({
            ...user,
            agentId: `#PE-${user.id.slice(0, 5).toUpperCase()}`,
            name: user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.firstName || user.lastName || user.email?.split('@')[0] || 'Agent',
            status: user.isActive ? 'Active' : 'Inactive',
            region: user.agentProfile?.region || 'N/A',
            licenseId: user.agentProfile?.licenseId || 'N/A',
            onboardingStatus: user.agentProfile?.onboardingStatus || 'PENDING',
            statistics: {
                totalTrades,
                activeTrades,
                completedTrades,
                flaggedTransactions: flags.length
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

        // Delete agent profile first (due to foreign key constraint)
        if (user.agentProfile) {
            await prisma.agentProfile.delete({
                where: { userId: id }
            });
        }

        // Delete user
        await prisma.user.delete({
            where: { id }
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

// Update agent details
export async function updateAgent(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { firstName, lastName, phone, region, isActive } = req.body;

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

        // Update agent profile if region is provided
        if (region && user.agentProfile) {
            await prisma.agentProfile.update({
                where: { userId: id },
                data: { region }
            });
        }

        res.json(user);
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
