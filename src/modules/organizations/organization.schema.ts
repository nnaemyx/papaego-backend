import { z } from "zod";

export const createOrganizationSchema = z.object({
    body: z.object({
        businessName: z.string().min(2, "Business name must be at least 2 characters"),
        businessType: z.enum([
            "LLC", "CORPORATION", "SOLE_PROPRIETOR", "PARTNERSHIP", "NGO", "OTHER"
        ]),
        countryOfRegistration: z.string().min(2, "Country is required"),
        registrationNumber: z.string().optional(),
        industry: z.string().min(2, "Industry is required"),
        businessAddress: z.string().min(5, "Business address is required"),
        city: z.string().min(2, "City is required"),
        state: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().min(2, "Country is required"),
        contactEmail: z.string().email("Contact email must be valid"),
        contactPhone: z.string().min(7, "Contact phone is required"),
        website: z.string().url().optional().or(z.literal("")),
        authorizedRepName: z.string().min(2, "Authorized representative name is required"),
        authorizedRepTitle: z.string().min(2, "Authorized representative title is required"),
    })
});

export const updateOrganizationSchema = z.object({
    body: z.object({
        businessName: z.string().min(2).optional(),
        businessType: z.enum([
            "LLC", "CORPORATION", "SOLE_PROPRIETOR", "PARTNERSHIP", "NGO", "OTHER"
        ]).optional(),
        countryOfRegistration: z.string().min(2).optional(),
        registrationNumber: z.string().optional(),
        industry: z.string().min(2).optional(),
        businessAddress: z.string().min(5).optional(),
        city: z.string().min(2).optional(),
        state: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().min(2).optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().min(7).optional(),
        website: z.string().url().optional().or(z.literal("")),
        authorizedRepName: z.string().min(2).optional(),
        authorizedRepTitle: z.string().min(2).optional(),
    })
});

export const inviteMemberSchema = z.object({
    body: z.object({
        email: z.string().email("Valid email required"),
        role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER")
    })
});
