import { Request, Response } from "express";

/**
 * MOCK Bank Verification Service
 * POST /api/bank/verify
 */
export async function verifyAccount(req: Request, res: Response) {
    try {
        const { bankName, accountNumber } = req.body;

        if (!bankName || !accountNumber) {
            return res.status(400).json({ error: "Bank name and account number are required" });
        }

        // Simulate a delay for API call
        await new Promise(resolve => setTimeout(resolve, 800));

        // Mock logic: If account ends in '1', '3', '5', '7', '9', it's valid
        const isOdd = parseInt(accountNumber.slice(-1)) % 2 !== 0;

        if (isOdd) {
            return res.json({
                success: true,
                accountName: "JOHN DOE (MOCKED)",
                bankName,
                accountNumber,
                status: "VERIFIED"
            });
        }

        return res.status(404).json({
            success: false,
            error: "Account not found or invalid bank details"
        });

    } catch (error) {
        console.error("Bank verification error:", error);
        res.status(500).json({ error: "Bank verification service unavailable" });
    }
}
