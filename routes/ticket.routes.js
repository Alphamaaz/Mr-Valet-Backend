import { Router } from "express";
import {
  assignDriver,
  createTicket,
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
    ROLES.AREA_SUPERVISOR,
    ROLES.AOM,
    ROLES.OM,
    ROLES.HEAD_OF_OPERATIONS,
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
    ROLES.AREA_SUPERVISOR,
    ROLES.AOM,
    ROLES.OM,
    ROLES.HEAD_OF_OPERATIONS,
  ),
  asyncHandler(getTicketById),
);

router.post(
  "/",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR),
  asyncHandler(createTicket),
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

