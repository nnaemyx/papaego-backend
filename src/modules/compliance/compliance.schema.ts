import { z } from "zod";

export const kycSubmitSchema = z.object({
    body: z.object({
        organizationId: z.string().uuid("Valid organization ID required"),
        fullName: z.string().min(2, "Full name is required"),
        dateOfBirth: z.string().refine(d => !isNaN(Date.parse(d)), "Valid date of birth required"),
        nationality: z.string().min(2, "Nationality is required"),
        residentialAddress: z.string().min(5, "Residential address is required"),
        phone: z.string().min(7, "Phone number is required"),
        email: z.string().email("Valid email is required"),
        idType: z.enum([
            "PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"
        ])
    })
});

export const kybSubmitSchema = z.object({
    body: z.object({
        organizationId: z.string().uuid("Valid organization ID required"),
        companyName: z.string().min(2, "Company name is required"),
        registrationNumber: z.string().min(2, "Registration number is required"),
        countryOfIncorporation: z.string().min(2, "Country of incorporation is required"),
        businessAddress: z.string().min(5, "Business address is required"),
        taxIdentification: z.string().optional(),
        directors: z.array(z.object({
            name: z.string().min(2),
            role: z.string().min(2),
            dateOfBirth: z.string().optional(),
            nationality: z.string().optional()
        })).min(1, "At least one director is required"),
        ubos: z.array(z.object({
            name: z.string().min(2),
            ownershipPercentage: z.number().min(0).max(100),
            nationality: z.string().optional(),
            dateOfBirth: z.string().optional()
        })).optional()
    })
});

export const documentUploadSchema = z.object({
    body: z.object({
        organizationId: z.string().uuid(),
        kycRequestId: z.string().uuid().optional(),
        kybRequestId: z.string().uuid().optional(),
        documentType: z.enum([
            "PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE", "SELFIE",
            "PROOF_OF_ADDRESS", "CERTIFICATE_OF_INCORPORATION",
            "MEMORANDUM_OF_ASSOCIATION", "ARTICLES_OF_ASSOCIATION",
            "TAX_ID_DOCUMENT", "DIRECTOR_ID", "UBO_DOCUMENT", "OTHER"
        ])
    })
});
