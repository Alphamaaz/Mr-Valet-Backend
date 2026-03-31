import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createPlan,
  getPlans,
  updatePlan,
  deletePlan,
  subscribe,
  renewSubscription,
  cancelSubscription,
  getMySubscription,
} from "../controllers/subscription.controller.js";

const router = Router();

router.use(requireAuth);

// ─── Plan CRUD — OWNER / SUPER_ADMIN only ────────────────────────────────────

router.post("/plans",      requireRoles("OWNER", "SUPER_ADMIN"), asyncHandler(createPlan));
router.get("/plans",       asyncHandler(getPlans));
router.patch("/plans/:id", requireRoles("OWNER", "SUPER_ADMIN"), asyncHandler(updatePlan));
router.delete("/plans/:id",requireRoles("OWNER", "SUPER_ADMIN"), asyncHandler(deletePlan));



// ─── User Subscription APIs ───────────────────────────────────────────────────

router.get("/my", asyncHandler(getMySubscription));                     // view my plan
router.post("/subscribe", asyncHandler(subscribe));                     // choose a plan
router.post("/renew", asyncHandler(renewSubscription));                 // renew / extend
router.delete("/cancel", asyncHandler(cancelSubscription));             // cancel

export default router;
