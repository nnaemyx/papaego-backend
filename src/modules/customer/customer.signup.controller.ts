import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../config/db";

export async function uploadCustomerDocument(req: Request, res: Response) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        res.json({ url: req.file.path }); // Returns the Cloudinary secure URL
    } catch (error) {
        console.error("Error uploading signup document:", error);
        res.status(500).json({ error: "Failed to upload document" });
    }
}

/**
 * Customer self-registration endpoint
 * Creates a User (role=CUSTOMER) and associated Customer profile in one transaction
 */
export async function customerSignup(req: Request, res: Response, next: NextFunction) {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            password,
            // KYC details
            gender,
            dateOfBirth,
            homeAddress,
            bvn,
            nin,
            companyName,
            companySector,
            // Document URLs (uploaded separately via file upload endpoints)
            governmentIdUrl,
            proofOfAddressUrl,
        } = req.body;

        if (!email || !password || !phone || !firstName || !lastName) {
            return res.status(400).json({ error: "First name, last name, email, phone, and password are required" });
        }

        if (!bvn) {
            return res.status(400).json({ error: "BVN is required" });
        }

        // Check if email already exists
        const existingUser = await prisma.user.findFirst({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: "An account with this email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user and customer profile in a transaction
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    phone,
                    firstName,
                    lastName,
                    role: "CUSTOMER",
                    isActive: true,
                },
            });

            const customer = await tx.customer.create({
                data: {
                    userId: user.id,
                    fullName: `${firstName} ${lastName}`,
                    email,
                    phone,
                    bvn: bvn || "",
                    nin: nin || null,
                    gender: gender || null,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    homeAddress: homeAddress || null,
                    companyName: companyName || null,
                    companySector: companySector || null,
                    governmentIdUrl: governmentIdUrl || null,
                    proofOfAddressUrl: proofOfAddressUrl || null,
                    verified: false,
                },
            });

            return { user, customer };
        });

        const token = jwt.sign(
            { id: result.user.id, role: result.user.role },
            process.env.JWT_SECRET || "secret",
            { expiresIn: "1d" }
        );

        res.status(201).json({
            user: {
                id: result.user.id,
                email: result.user.email,
                firstName: result.user.firstName,
                lastName: result.user.lastName,
                role: result.user.role,
                isActive: result.user.isActive,
            },
            customer: {
                id: result.customer.id,
                fullName: result.customer.fullName,
                verified: result.customer.verified,
            },
            token,
        });
    } catch (error) {
        console.error("Customer signup error:", error);
        next(error);
    }
}
