import { Router } from "express";
import {
  bulkCreatePaperTickets,
  listPaperTickets,
  voidPaperTicket,
} from "../controllers/paperTicket.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(requireAuth);

router.post(
  "/bulk",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(bulkCreatePaperTickets),
);

router.get(
  "/",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(listPaperTickets),
);

router.patch(
  "/:id/void",
  requireRoles(ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(voidPaperTicket),
);

export default router;
