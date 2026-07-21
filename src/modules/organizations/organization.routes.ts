import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
    createOrganization,
    getOrganization,
    getMyOrganization,
    updateOrganization,
    getOrganizationMembers,
    inviteMember
} from "./organization.controller";
import { createOrganizationSchema, updateOrganizationSchema, inviteMemberSchema } from "./organization.schema";

const router = Router();

// All routes require authentication
router.use(auth);

router.post("/", validate(createOrganizationSchema), createOrganization);
router.get("/me", getMyOrganization);
router.get("/:id", getOrganization);
router.patch("/:id", validate(updateOrganizationSchema), updateOrganization);
router.get("/:id/members", getOrganizationMembers);
router.post("/:id/members", validate(inviteMemberSchema), inviteMember);

export default router;
