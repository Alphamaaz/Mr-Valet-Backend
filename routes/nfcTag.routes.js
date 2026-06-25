import { Router } from "express";
import {
  listNfcTags,
  registerNfcTag,
  updateNfcTagStatus,
} from "../controllers/nfcTag.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(requireAuth);

router.post(
  "/register",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(registerNfcTag),
);

router.get(
  "/",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(listNfcTags),
);

router.patch(
  "/:id/status",
  requireRoles(ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(updateNfcTagStatus),
);

export default router;
