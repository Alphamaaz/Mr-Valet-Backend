import { Router } from "express";
import {
  assignDriver,
  claimDamage,
  createManualCarArrival,
  getDamageClaims,
  getKeyControllerQueue,
  getMyAssignedTickets,
  getOwnerActiveTickets,
  getTicketHistory,
  requestRetrieval,
  getTicketById,
  linkOwnerToTicket,
  listTickets,
  listRetrievalRequests,
  markKeyReceived,
  releaseKey,
  recordTicketPayment,
  updateTicketCheckout,
  updateTicketStatus,
  parkCar,
} from "../controllers/ticket.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadDamagePhotos } from "../middleware/uploadDamagePhotos.js";
import { uploadParkedPhoto } from "../middleware/uploadParkedPhoto.js";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
    ROLES.OPERATIONS_MANAGER,
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
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(getKeyControllerQueue),
);

router.get(
  "/retrieval-requests",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(listRetrievalRequests),
);

router.post(
  "/owner/link",
  requireRoles(ROLES.OWNER),
  asyncHandler(linkOwnerToTicket),
);

router.get(
  "/owner/active",
  requireRoles(ROLES.OWNER),
  asyncHandler(getOwnerActiveTickets),
);

router.get(
  "/history",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
    ROLES.OPERATIONS_MANAGER,
    ROLES.OWNER,
  ),
  asyncHandler(getTicketHistory),
);

router.get(
  "/:ticketId",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
    ROLES.OPERATIONS_MANAGER,
  ),
  asyncHandler(getTicketById),
);

router.post(
  "/issue",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(createManualCarArrival),
);

router.patch(
  "/:ticketId/assign-driver",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(assignDriver),
);

router.patch(
  "/:ticketId/payment",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(recordTicketPayment),
);

router.patch(
  "/:ticketId/checkout",
  requireRoles(ROLES.OWNER, ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(updateTicketCheckout),
);

router.patch(
  "/:ticketId/status",
  requireRoles(
    ROLES.RECEPTIONIST,
    ROLES.DRIVER,
    ROLES.KEY_CONTROLLER,
    ROLES.SUPERVISOR,
    ROLES.OPERATIONS_MANAGER,
  ),
  asyncHandler(updateTicketStatus),
);

router.post(
  "/:ticketId/retrieval-request",
  requireRoles(ROLES.OWNER, ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(requestRetrieval),
);

router.patch(
  "/:ticketId/key-received",
  requireRoles(ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(markKeyReceived),
);

router.patch(
  "/:ticketId/key-release",
  requireRoles(ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR),
  asyncHandler(releaseKey),
);

router.post(
  "/:ticketId/damage-claims",
  requireRoles(ROLES.DRIVER),
  uploadDamagePhotos,
  asyncHandler(claimDamage),
);

router.get(
  "/:ticketId/damage-claims",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(getDamageClaims),
);

// PATCH /:ticketId/park  — Driver confirms parking with slot, keyTag, keyNote and optional photo
router.patch(
  "/:ticketId/park",
  requireRoles(ROLES.DRIVER),
  uploadParkedPhoto,
  asyncHandler(parkCar),
);

export default router;
