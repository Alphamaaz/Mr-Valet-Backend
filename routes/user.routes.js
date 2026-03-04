import { Router } from "express";
import { createPlatformUser, getPlatformUserById, getPlatformUsers, updatePlatformUser } from "../controllers/user.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";

const router = Router();

// router.use(requireAuth);

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
