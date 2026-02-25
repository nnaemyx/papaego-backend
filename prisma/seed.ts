import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding database...");

    // Create admin user
    const adminEmail = process.env.ADMIN_EMAIL || "admin@papaego.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
    const adminPhone = process.env.ADMIN_PHONE || "+2348000000000";

    // Check if admin already exists
    const existingAdmin = await prisma.user.findFirst({
        where: {
            email: adminEmail,
            role: "ADMIN",
        },
    });

    if (existingAdmin) {
        console.log(`✅ Admin user already exists: ${adminEmail}`);
        return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create admin user
    const admin = await prisma.user.create({
        data: {
            email: adminEmail,
            phone: adminPhone,
            password: hashedPassword,
            role: "ADMIN",
            isActive: true,
        },
    });

    console.log(`✅ Admin user created successfully!`);
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log(`   ID: ${admin.id}`);
    console.log("");
    console.log("⚠️  IMPORTANT: Change the password after first login!");
}

main()
    .catch((e) => {
        console.error("❌ Error seeding database:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
