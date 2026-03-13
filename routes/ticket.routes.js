import { Router } from "express";
import {
  assignDriver,
  createManualCarArrival,
  getTicketById,
  listTickets,
  updateTicketStatus,
} from "../controllers/ticket.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
  ),
  asyncHandler(listTickets),
);

router.get(
  "/:ticketId",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
  ),
  asyncHandler(getTicketById),
);

router.post(
  "/manual/car-arrival",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR),
  asyncHandler(createManualCarArrival),
);

router.patch(
  "/:ticketId/assign-driver",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR),
  asyncHandler(assignDriver),
);

router.patch(
  "/:ticketId/status",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
  ),
  asyncHandler(updateTicketStatus),
);

export default router;
