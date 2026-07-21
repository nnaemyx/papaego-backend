import prisma from "../../config/db";
import { recordStatusChange } from "../compliance/status.service";

// ─────────────────────────────────────────────────────
// Create a new organization (Draft status)
// ─────────────────────────────────────────────────────
export async function createOrganization(ownerId: string, data: {
    businessName: string;
    businessType: string;
    countryOfRegistration: string;
    registrationNumber?: string;
    industry: string;
    businessAddress: string;
    city: string;
    state?: string;
    postalCode?: string;
    country: string;
    contactEmail: string;
    contactPhone: string;
    website?: string;
    authorizedRepName: string;
    authorizedRepTitle: string;
}) {
    // Prevent duplicate org per owner
    const existing = await prisma.organization.findFirst({ where: { ownerId } });
    if (existing) {
        throw new Error("You have already created an organization. Only one organization per account is permitted.");
    }

    const org = await prisma.organization.create({
        data: { ownerId, ...data }
    });

    // Auto-add owner as OWNER member
    await prisma.organizationMember.create({
        data: { organizationId: org.id, userId: ownerId, role: "OWNER" }
    });

    await recordStatusChange({
        organizationId: org.id,
        entityType: "ORGANIZATION",
        fromStatus: null,
        toStatus: "DRAFT",
        changedBy: ownerId,
        reason: "Organization created"
    });

    return org;
}

// ─────────────────────────────────────────────────────
// Get organization by ID (with qualification & compliance status)
// ─────────────────────────────────────────────────────
export async function getOrganizationById(orgId: string, requesterId: string) {
    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        include: {
            qualification: true,
            kycRequests: {
                orderBy: { createdAt: "desc" },
                take: 1
            },
            kybRequest: true,
            members: {
                include: { user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } } }
            }
        }
    });

    if (!org) throw new Error("Organization not found.");

    // Verify requester is a member
    const isMember = org.members.some(m => m.userId === requesterId);
    if (!isMember) throw new Error("Access denied. You are not a member of this organization.");

    return org;
}

// ─────────────────────────────────────────────────────
// Update organization details (only allowed in DRAFT status)
// ─────────────────────────────────────────────────────
export async function updateOrganization(orgId: string, requesterId: string, data: Record<string, unknown>) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new Error("Organization not found.");
    if (org.ownerId !== requesterId) throw new Error("Only the organization owner can update details.");

    if (org.status === "ACTIVE") {
        throw new Error("Organization details cannot be updated after activation. Contact support.");
    }

    return prisma.organization.update({
        where: { id: orgId },
        data
    });
}

// ─────────────────────────────────────────────────────
// Get organization for the authenticated user
// ─────────────────────────────────────────────────────
export async function getMyOrganization(userId: string) {
    const membership = await prisma.organizationMember.findFirst({
        where: { userId },
        include: {
            organization: {
                include: {
                    qualification: true,
                    kycRequests: { orderBy: { createdAt: "desc" }, take: 1 },
                    kybRequest: true
                }
            }
        }
    });

    if (!membership) return null;
    return membership.organization;
}

// ─────────────────────────────────────────────────────
// List members of an organization
// ─────────────────────────────────────────────────────
export async function getOrganizationMembers(orgId: string, requesterId: string) {
    const member = await prisma.organizationMember.findFirst({
        where: { organizationId: orgId, userId: requesterId }
    });
    if (!member) throw new Error("Access denied.");

    return prisma.organizationMember.findMany({
        where: { organizationId: orgId },
        include: {
            user: { select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true } }
        }
    });
}

// ─────────────────────────────────────────────────────
// Invite a user to join an organization
// ─────────────────────────────────────────────────────
export async function inviteMember(orgId: string, requesterId: string, email: string, role: string) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new Error("Organization not found.");
    if (org.ownerId !== requesterId) throw new Error("Only the organization owner can invite members.");

    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (!user) throw new Error("No account found with that email address.");

    const existing = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: user.id } }
    });
    if (existing) throw new Error("This user is already a member of the organization.");

    return prisma.organizationMember.create({
        data: { organizationId: orgId, userId: user.id, role }
    });
}
