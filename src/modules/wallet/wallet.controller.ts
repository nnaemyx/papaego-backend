/**
 * Wallet Controller — read-only wallet views for customers and admins.
 */

import { Request, Response } from "express";
import prisma from "../../config/db";
import { getWalletSummary } from "./wallet.service";

/**
 * GET /customer/portal/wallet
 * Returns the authenticated customer's wallet balance + recent transactions.
 */
export async function getMyWallet(req: Request, res: Response) {
    try {
        const customer = (req as any).user.customer;
        if (!customer) return res.status(403).json({ error: "Customer profile not found" });

        const { wallet, transactions } = await getWalletSummary(customer.id);
        res.json({
            id: wallet.id,
            currency: wallet.currency,
            availableBalance: wallet.availableBalance.toString(),
            reservedBalance: wallet.reservedBalance.toString(),
            totalDeposited: wallet.totalDeposited.toString(),
            transactions: transactions.map((t) => ({
                id: t.id,
                type: t.type,
                amount: t.amount.toString(),
                balanceAfter: t.balanceAfter.toString(),
                description: t.description,
                createdAt: t.createdAt.toISOString(),
            })),
        });
    } catch (error) {
        console.error("Error fetching wallet:", error);
        res.status(500).json({ error: "Failed to fetch wallet" });
    }
}

/**
 * GET /admin/customers/:customerId/wallet
 * Admin views a customer's wallet.
 */
export async function getCustomerWalletForAdmin(req: Request, res: Response) {
    try {
        const { customerId } = req.params;
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer) return res.status(404).json({ error: "Customer not found" });

        const { wallet, transactions } = await getWalletSummary(customerId);
        res.json({
            id: wallet.id,
            currency: wallet.currency,
            availableBalance: wallet.availableBalance.toString(),
            reservedBalance: wallet.reservedBalance.toString(),
            totalDeposited: wallet.totalDeposited.toString(),
            transactions: transactions.map((t) => ({
                id: t.id,
                type: t.type,
                amount: t.amount.toString(),
                balanceAfter: t.balanceAfter.toString(),
                description: t.description,
                createdAt: t.createdAt.toISOString(),
            })),
        });
    } catch (error) {
        console.error("Error fetching customer wallet:", error);
        res.status(500).json({ error: "Failed to fetch customer wallet" });
    }
}
