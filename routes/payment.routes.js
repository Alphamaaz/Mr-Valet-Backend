import { Router } from "express";
import {
  getPaymentIntentStatus,
  handleSadadCallback,
  initiateSadadPayment,
} from "../controllers/payment.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/sadad/callback", asyncHandler(handleSadadCallback));

router.use(requireAuth);

router.post(
  "/sadad/initiate",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(initiateSadadPayment),
);

router.get(
  "/:paymentIntentId/status",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER, ROLES.OWNER),
  asyncHandler(getPaymentIntentStatus),
);

export default router;
