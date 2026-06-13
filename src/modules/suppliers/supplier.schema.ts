import { z } from "zod";

export const supplierCreateSchema = z.object({
  body: z.object({
    beneficiaryName: z.string().min(2, "Beneficiary name is required"),
    bankName: z.string().min(2, "Bank name is required"),
    accountNumber: z.string().min(5, "Account number is required"),
    swiftBic: z
      .union([
        z.literal(""),
        z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "Invalid SWIFT/BIC format"),
      ])
      .optional(),
    iban: z.string().optional().or(z.literal("")),
    routingCode: z.string().optional().or(z.literal("")),
    currency: z.string().min(3, "Currency must be a 3-character ISO code").max(3, "Currency must be a 3-character ISO code"),
    address: z.string().optional().or(z.literal("")),
  })
});

export const supplierUpdateSchema = z.object({
  body: z.object({
    beneficiaryName: z.string().min(2, "Beneficiary name is required").optional(),
    bankName: z.string().min(2, "Bank name is required").optional(),
    accountNumber: z.string().min(5, "Account number is required").optional(),
    swiftBic: z
      .union([
        z.literal(""),
        z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "Invalid SWIFT/BIC format"),
      ])
      .optional(),
    iban: z.string().optional().or(z.literal("")),
    routingCode: z.string().optional().or(z.literal("")),
    currency: z.string().min(3).max(3).optional(),
    address: z.string().optional().or(z.literal("")),
    isArchived: z.boolean().optional(),
  })
});
