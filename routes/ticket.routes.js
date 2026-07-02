import { Router } from "express";
import {
  assignDriver,
  cancelRetrievalAndRepark,
  claimDamage,
  createManualCarArrival,
  getDamageClaims,
  getKeyControllerQueue,
  getManagerActiveTransactions,
  getMyAssignedTickets,
  getOwnerActiveTickets,
  getPublicRetrievalSummary,
  getTicketHistory,
  requestRetrieval,
  requestPublicRetrieval,
  scanNfcForDeparture,
  scanSerializedPaperForDeparture,
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
  rateTicketDriver,
  reparkCar,
} from "../controllers/ticket.controller.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadDamagePhotos } from "../middleware/uploadDamagePhotos.js";
import { uploadParkedPhoto } from "../middleware/uploadParkedPhoto.js";

const router = Router();

router.get(
  "/public/retrieval-summary",
  asyncHandler(getPublicRetrievalSummary),
);

router.post(
  "/public/retrieval-request",
  asyncHandler(requestPublicRetrieval),
);

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

router.get(
  "/manager/transactions",
  requireRoles(ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(getManagerActiveTransactions),
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

router.post(
  "/serialized-paper/departure-scan",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(scanSerializedPaperForDeparture),
);

router.post(
  "/nfc/departure-scan",
  requireRoles(ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(scanNfcForDeparture),
);

router.patch(
  "/:ticketId/repark",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(reparkCar),
);

router.patch(
  "/:ticketId/cancel-retrieval-repark",
  requireRoles(ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER),
  asyncHandler(cancelRetrievalAndRepark),
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

router.post(
  "/:ticketId/rating",
  requireRoles(ROLES.OWNER),
  asyncHandler(rateTicketDriver),
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
