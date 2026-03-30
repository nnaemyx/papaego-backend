import { Request, Response } from "express";
import prisma from "../../config/db";
import { sendAdminMessageEmail } from "../../services/email.service";

// Get all customers with filters
export async function getCustomers(req: Request, res: Response) {
    try {
        const { status, search, type, activityLevel, sector } = req.query;
        const where: any = {};

        // Add search functionality
        if (search) {
            where.OR = [
                { fullName: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
                { bvn: { contains: search as string } }
            ];
        }

        if (status === 'Verified') {
            where.verified = true;
        } else if (status === 'Pending' || status === 'Failed') {
            where.verified = false;
        }

        if (type === 'Business') {
            where.companyName = { not: null };
        } else if (type === 'Individual') {
            where.companyName = null;
        }

        if (sector && sector !== 'All') {
            where.companySector = sector as string;
        }

        // Exclude soft-deleted customers by checking if the email doesn't start with deleted_
        where.user = {
            OR: [
                { email: null },
                { email: { not: { startsWith: 'deleted_' } } }
            ]
        };

        const customers = await prisma.customer.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        phone: true,
                        isActive: true,
                        createdAt: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Get transaction counts for each customer
        const customersWithTrades = await Promise.all(
            customers.map(async (customer) => {
                const trades = await prisma.trade.findMany({
                    where: { customerId: customer.id },
                    select: {
                        id: true,
                        createdAt: true,
                        status: true
                    }
                });

                const lastTrade = trades.length > 0
                    ? trades.reduce((latest, trade) =>
                        trade.createdAt > latest.createdAt ? trade : latest
                    )
                    : null;

                return {
                    id: customer.id,
                    customerId: `PE-${customer.id.slice(0, 6).toUpperCase()}`,
                    name: customer.fullName,
                    lastTrade: lastTrade ? lastTrade.createdAt.toISOString() : null,
                    totalTransactions: trades.length,
                    verificationStatus: customer.verified ? 'Verified' : 'Pending',
                    email: customer.email,
                    phone: customer.phone || customer.user.phone,
                    createdAt: customer.createdAt,
                    customerType: customer.companyName ? 'Business' : 'Individual',
                    companySector: customer.companySector
                };
            })
        );

        res.json(customersWithTrades);
    } catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
}

// Get customer statistics
export async function getCustomerStats(req: Request, res: Response) {
    try {
        const totalCustomers = await prisma.customer.count();
        const verifiedCustomers = await prisma.customer.count({
            where: { verified: true }
        });

        // Get high-value customers (those with > 5 trades)
        const allCustomers = await prisma.customer.findMany({
            select: { id: true }
        });

        const highValueCount = await Promise.all(
            allCustomers.map(async (customer) => {
                const tradeCount = await prisma.trade.count({
                    where: { customerId: customer.id }
                });
                return tradeCount > 5 ? 1 : 0;
            })
        );

        const highValueCustomers = highValueCount.reduce((sum: number, val) => sum + val, 0);

        // Get active customers today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const activeTodayIds = await prisma.trade.findMany({
            where: {
                createdAt: {
                    gte: today
                }
            },
            select: { customerId: true },
            distinct: ['customerId']
        });

        res.json({
            totalCustomers,
            verifiedCustomers,
            highValueCustomers,
            activeCustomersToday: activeTodayIds.length
        });
    } catch (error) {
        console.error("Error fetching customer stats:", error);
        res.status(500).json({ error: "Failed to fetch customer stats" });
    }
}

// Get single customer details
export async function getCustomer(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        phone: true,
                        email: true,
                        isActive: true,
                        createdAt: true
                    }
                },
                notes: {
                    include: {
                        agent: {
                            select: {
                                firstName: true,
                                lastName: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        // Get customer trades
        const trades = await prisma.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        // Calculate trade statistics
        const totalTrades = trades.length;
        const allTrades = await prisma.trade.findMany({
            where: { customerId: id }
        });

        const buyTrades = allTrades.filter(t => t.sendCurrency === 'NGN').length;
        const sellTrades = allTrades.filter(t => t.receiveCurrency === 'NGN').length;

        const totalVolume = allTrades.reduce((sum, trade) => sum + Number(trade.amount), 0);
        
        // Find most traded pair
        const pairCounts: Record<string, number> = {};
        let mostTradedPair = "None";
        let maxPairCount = 0;
        allTrades.forEach(t => {
            const pair = `${t.sendCurrency} → ${t.receiveCurrency}`;
            pairCounts[pair] = (pairCounts[pair] || 0) + 1;
            if (pairCounts[pair] > maxPairCount) {
                maxPairCount = pairCounts[pair];
                mostTradedPair = pair;
            }
        });

        // Compute linked agents from distinct trades
        const uniqueAgentIds = Array.from(new Set(allTrades.map(t => t.agentId)));
        
        const agents = await prisma.user.findMany({
            where: { id: { in: uniqueAgentIds } },
            include: { agentProfile: true }
        });
        
        const agentMap = new Map();
        agents.forEach(a => agentMap.set(a.id, a));

        const linkedAgentsMap = new Map();
        allTrades.forEach(t => {
            const agentUser = agentMap.get(t.agentId);
            if (agentUser) {
                if (!linkedAgentsMap.has(t.agentId)) {
                    linkedAgentsMap.set(t.agentId, {
                        name: `${agentUser.firstName} ${agentUser.lastName}`,
                        agentId: `#PE-${t.agentId.slice(0,5).toUpperCase()}`,
                        role: "Agent",
                        region: agentUser.agentProfile?.region || "Unknown",
                        tradesHandled: 1
                    });
                } else {
                    const existing = linkedAgentsMap.get(t.agentId);
                    existing.tradesHandled += 1;
                }
            }
        });
        const linkedAgents = Array.from(linkedAgentsMap.values());

        // Construct Activity Timeline
        const auditLogs = await prisma.auditLog.findMany({
            where: {
                OR: [
                    { entity: "Customer", entityId: id },
                    { entity: "Trade", entityId: { in: allTrades.map(t => t.id) } }
                ]
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        const activityTimeline = auditLogs.map(log => {
            let eventText = `${log.action} action on ${log.entity}`;
            if (log.action === "CUSTOMER_APPROVED") eventText = "Account KYC documents verified";
            else if (log.action === "TRADE_CREATED") eventText = `Trade initiated`;
            else if (log.action === "TRADE_COMPLETED") eventText = `Trade completed`;
            else if (log.action === "TRADE_CANCELLED") eventText = `Trade cancelled`;

            return {
                date: log.createdAt.toLocaleDateString(),
                time: log.createdAt.toLocaleTimeString(),
                event: eventText,
                type: log.entity === "Customer" ? "kyc" : (log.action === "TRADE_CANCELLED" ? "cancel" : "trade")
            };
        });

        // Add a registration event manually at the bottom
        activityTimeline.push({
            date: customer.createdAt.toLocaleDateString(),
            time: customer.createdAt.toLocaleTimeString(),
            event: "Account registered on PapaEgo",
            type: "register"
        });

        const lastTrade = trades.length > 0 ? trades[0] : null;

        res.json({
            ...customer,
            name: customer.fullName,
            phone: customer.phone || customer.user?.phone || null,
            dateJoined: customer.createdAt.toISOString(),
            customerId: `PE-${customer.id.slice(0, 6).toUpperCase()}`,
            verificationStatus: customer.verified ? 'Verified' : 'Pending',
            totalTransactions: allTrades.length,
            totalVolume: `₦${totalVolume.toLocaleString()}`,
            mostTradedPair,
            customerType: customer.companyName ? 'Business' : 'Individual',
            lastTrade: lastTrade?.createdAt.toISOString() || null,
            recentTrades: trades.map(trade => {
                const agentUser = agentMap.get(trade.agentId);
                return {
                    id: trade.id,
                    tradeId: `#PE-${trade.id.slice(0, 5).toUpperCase()}`,
                    date: trade.createdAt.toLocaleDateString(),
                    time: trade.createdAt.toLocaleTimeString(),
                    transaction: `${trade.sendCurrency} → ${trade.receiveCurrency}`,
                    amount: `${trade.receiveCurrency === 'NGN' ? '₦' : trade.receiveCurrency === 'USD' ? '$' : '£'}${Number(trade.amount).toLocaleString()}`,
                    status: trade.status,
                    agent: agentUser ? `${agentUser.firstName} ${agentUser.lastName}` : "System"
                };
            }),
            notes: customer.notes.map(n => ({
                id: n.id,
                content: n.content,
                createdAt: n.createdAt.toISOString(),
                createdBy: n.agent ? `${n.agent.firstName} ${n.agent.lastName}` : "System"
            })),
            linkedAgents,
            activityTimeline
        });
    } catch (error) {
        console.error("Error fetching customer:", error);
        res.status(500).json({ error: "Failed to fetch customer" });
    }
}

// Add customer note
export async function addCustomerNote(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const agentId = (req as any).user.id;

        if (!content) {
            return res.status(400).json({ error: "Note content is required" });
        }

        const note = await prisma.customerNote.create({
            data: {
                customerId: id,
                agentId,
                content
            },
            include: {
                agent: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            }
        });

        res.json(note);
    } catch (error) {
        console.error("Error adding customer note:", error);
        res.status(500).json({ error: "Failed to add note" });
    }
}

// Get customer transactions
export async function getCustomerTransactions(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const trades = await prisma.trade.findMany({
            where: { customerId: id },
            orderBy: { createdAt: 'desc' }
        });

        res.json(trades);
    } catch (error) {
        console.error("Error fetching customer transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
}

// Approve (Verify) Customer
export async function approveCustomer(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const customer = await prisma.customer.update({
            where: { id },
            data: { verified: true }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "CUSTOMER_APPROVED",
                entity: "Customer",
                entityId: id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, customer });
    } catch (error) {
        console.error("Error approving customer:", error);
        res.status(500).json({ error: "Failed to approve customer" });
    }
}

// Export customers to CSV
export async function exportCustomers(req: Request, res: Response) {
    try {
        const customers = await prisma.customer.findMany({
            include: {
                user: true
            }
        });

        const csvData = customers.map(customer => ({
            'Customer ID': `PE-${customer.id.slice(0, 6).toUpperCase()}`,
            'Name': customer.fullName,
            'Email': customer.email || '',
            'Phone': customer.phone || customer.user.phone,
            'BVN': customer.bvn,
            'Verification': customer.verified ? 'Verified' : 'Pending',
            'Date Joined': customer.createdAt.toLocaleDateString()
        }));

        // Generate CSV
        const headers = ['Customer ID', 'Name', 'Email', 'Phone', 'BVN', 'Verification', 'Date Joined'];
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
        res.setHeader('Content-Disposition', `attachment; filename=customers-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (error) {
        console.error("Error exporting customers:", error);
        res.status(500).json({ error: "Failed to export customers" });
    }
}

// ---------------------- ADMIN CUSTOMER ACTIONS ----------------------

// Safe/Soft Delete a customer
export async function deleteCustomer(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: { user: true, trades: true }
        });

        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        const hasTrades = customer.trades.length > 0;

        if (hasTrades) {
            // Soft delete: restrict account, anonymize login so it's effectively "deleted" but trades remain
            await prisma.user.update({
                where: { id: customer.userId },
                data: {
                    isActive: false,
                    email: `deleted_${Date.now()}_${customer.user.email || customer.email || id}`,
                }
            });

            // Note: we're not touching the customer.email so the historical data still looks okayish, 
            // but we freed up the User login email in case they want to sign up again.

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "ADMIN",
                    action: "CUSTOMER_SOFT_DELETED",
                    entity: "Customer",
                    entityId: id,
                    ip: req.ip || "127.0.0.1"
                }
            });

            return res.json({ success: true, message: "Customer soft-deleted successfully (retained trades)." });
        } else {
            // Hard delete: safe because there are no trades
            await prisma.$transaction(async (tx: any) => {
                await tx.customerNote.deleteMany({ where: { customerId: id } });
                await tx.customerDocument.deleteMany({ where: { customerId: id } });
                await tx.customerBankDetails.deleteMany({ where: { customerId: id } });
                await tx.tradeRequest.deleteMany({ where: { customerId: id } });
                await tx.customer.delete({ where: { id } });
                await tx.user.delete({ where: { id: customer.userId } });
            });

            await prisma.auditLog.create({
                data: {
                    actorId: (req as any).user.id,
                    role: "ADMIN",
                    action: "CUSTOMER_HARD_DELETED",
                    entity: "Customer",
                    entityId: id,
                    ip: req.ip || "127.0.0.1"
                }
            });

            return res.json({ success: true, message: "Customer strictly deleted." });
        }
    } catch (error) {
        console.error("Error deleting customer:", error);
        res.status(500).json({ error: "Failed to delete customer" });
    }
}

// Toggle customer account restriction
export async function restrictCustomer(req: Request, res: Response) {
    try {
        const { id } = req.params;

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: { user: true }
        });

        if (!customer) return res.status(404).json({ error: "Customer not found" });

        const newState = !customer.user.isActive;

        await prisma.user.update({
            where: { id: customer.userId },
            data: { isActive: newState }
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: newState ? "CUSTOMER_REACTIVATED" : "CUSTOMER_RESTRICTED",
                entity: "Customer",
                entityId: id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, isActive: newState });
    } catch (error) {
        console.error("Error restricting customer:", error);
        res.status(500).json({ error: "Failed to update customer status" });
    }
}

// Send email message to customer
export async function sendCustomerMessage(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { subject, message } = req.body;

        if (!message) return res.status(400).json({ error: "Message is required" });

        const customer = await prisma.customer.findUnique({
            where: { id },
            include: { user: true }
        });

        if (!customer || !customer.email) {
            return res.status(404).json({ error: "Customer not found or has no email address" });
        }

        await sendAdminMessageEmail({
            email: customer.email,
            customerName: customer.fullName.split(' ')[0],
            subject: subject || "Message from Administration",
            message
        });

        await prisma.auditLog.create({
            data: {
                actorId: (req as any).user.id,
                role: "ADMIN",
                action: "CUSTOMER_EMAILED",
                entity: "Customer",
                entityId: id,
                ip: req.ip || "127.0.0.1"
            }
        });

        res.json({ success: true, message: "Email sent successfully" });
    } catch (error) {
        console.error("Error sending message to customer:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
}
