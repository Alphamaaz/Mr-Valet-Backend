import { Router } from "express";
import {
  assignDriver,
  claimDamage,
  createManualCarArrival,
  getDamageClaims,
  getKeyControllerQueue,
  getMyAssignedTickets,
  requestRetrieval,
  getTicketById,
  listTickets,
  markKeyReceived,
  processEntryMethod,
  updateTicketStatus,
} from "../controllers/ticket.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadDamagePhotos } from "../middleware/uploadDamagePhotos.js";

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
  "/driver/assigned",
  requireRoles(ROLES.DRIVER),
  asyncHandler(getMyAssignedTickets),
);

router.get(
  "/key-controller/queue",
  requireRoles(ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR),
  asyncHandler(getKeyControllerQueue),
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
  "/:ticketId/process-entry-method",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR),
  asyncHandler(processEntryMethod),
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

router.post(
  "/:ticketId/retrieval-request",
  requireRoles(ROLES.OWNER, ROLES.RECEPTIONIST),
  asyncHandler(requestRetrieval),
);

router.patch(
  "/:ticketId/key-received",
  requireRoles(ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR),
  asyncHandler(markKeyReceived),
);

router.post(
  "/:ticketId/damage-claims",
  requireRoles(ROLES.DRIVER),
  uploadDamagePhotos,
  asyncHandler(claimDamage),
);

router.get(
  "/:ticketId/damage-claims",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR),
  asyncHandler(getDamageClaims),
);

export default router;
