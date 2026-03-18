import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getDashboardStats } from "../controllers/dashboard.controller.js";

const router = Router();

router.use(requireAuth);

// GET /api/v1/dashboard  — Dashboard tab stats
router.get("/", asyncHandler(getDashboardStats));

export default router;
