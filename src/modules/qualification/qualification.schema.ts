import { z } from "zod";

export const qualificationSchema = z.object({
    body: z.object({
        organizationId: z.string().uuid("Valid organization ID required"),
        hasInternationalPayments: z.boolean({
            message: "Please indicate if you have international payment needs"
        }),
        expectedMonthlyVolume: z.number().positive().optional(),
        supplierPaymentFrequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "AD_HOC"]).optional(),
        countriesOfOperation: z.array(z.string().min(2)).min(1, "At least one country of operation required"),
        primaryUseCase: z.string().max(500).optional(),
        additionalContext: z.string().max(1000).optional()
    })
});
