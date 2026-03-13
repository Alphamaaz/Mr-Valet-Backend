import { Router } from "express";
import { createPlatformUser, getPlatformUserById, getPlatformUsers, updatePlatformUser, updateProfileImage, deleteAccount } from "../controllers/user.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { uploadProfile } from "../middleware/uploadProfile.js";
import { ROLES } from "../constants/roles.js";

const router = Router();

// router.use(requireAuth);

// ─── Profile APIs (authenticated user) ────────────────────────────────
router.patch(
  "/profile/image",
  requireAuth,
  uploadProfile,
  asyncHandler(updateProfileImage),
);

router.delete(
  "/profile",
  requireAuth,
  asyncHandler(deleteAccount),
);

// ─── Platform User CRUD ───────────────────────────────────────────────
router.post(
  "/platform",
  // requireRoles(ROLES.SUPERVISOR),
  asyncHandler(createPlatformUser),
);
router.get(
  "/platform",
  // requireRoles(ROLES.SUPERVISOR),
  asyncHandler(getPlatformUsers),
);
router.get(
  "/platform/:id",
  // requireRoles(ROLES.SUPERVISOR),
  asyncHandler(getPlatformUserById),
);

router.patch(
  "/platform/:id",
  // requireRoles(ROLES.SUPERVISOR),
  asyncHandler(updatePlatformUser),
);

export default router;
