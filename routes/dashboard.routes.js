import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getDashboardStats, getManagerDashboardStats } from "../controllers/dashboard.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(getDashboardStats));

router.get(
  "/manager",
  requireRoles(ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER, ROLES.SUPER_ADMIN),
  asyncHandler(getManagerDashboardStats),
);

export default router;
