import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
import { DamageReport } from "../models/DamageReport.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Branch } from "../models/Branch.js";
import { OWNER_TYPES } from "../constants/ownerTypes.js";
import { ROLES } from "../constants/roles.js";
import { TICKET_STATUS, canTransitionStatus } from "../constants/ticketStatus.js";
import { ENTRY_METHODS, ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";
import { generateTicketNumber, generateValetCode } from "../utils/idGenerator.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendTextSms } from "../services/twilio.service.js";

const createTicketSchema = z.object({
  ownerType: z.enum(Object.values(OWNER_TYPES)),
  ownerPhone: z.string().trim().min(8).max(20).optional(),
  ownerUserId: z.string().trim().optional(),
  locationId: z.string().trim().min(1).optional(),
  vehicle: z.object({
    plate: z.string().trim().min(2).max(20),
    make: z.string().trim().max(60).optional(),
    model: z.string().trim().max(60).optional(),
    color: z.string().trim().max(40).optional(),
    photo: z.string().trim().min(1).optional(),
  }),
  notes: z.string().trim().max(500).optional(),
});

const manualCarArrivalSchema = z.object({
  ownerPhone: z.string().trim().min(8).max(20).optional(),
  vehicle: z.object({
    plate: z.string().trim().min(2).max(20),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    color: z.string().trim().min(1).max(40),
    photo: z.string().trim().min(1).optional(),
  }),
  notes: z.string().trim().max(500).optional(),
});

const assignDriverSchema = z.object({
  driverId: z.string().trim().min(1),
  vehicle: z.object({
    plate: z.string().trim().min(2).max(20).optional(),
    make: z.string().trim().min(1).max(60).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    color: z.string().trim().min(1).max(40).optional(),
    photo: z.string().trim().min(1).max(500).optional(),
  }).optional(),
  slot: z.string().trim().max(60).optional(),
  garage: z.string().trim().max(60).optional(),
  keyTag: z.string().trim().max(40).optional(),
  keyNote: z.string().trim().max(200).optional(),
  receivingPoint: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

const updateTicketStatusSchema = z.object({
  status: z.enum(Object.values(TICKET_STATUS)),
  slot: z.string().trim().max(40).optional(),
  garage: z.string().trim().max(40).optional(),
  keyTag: z.string().trim().max(40).optional(),
  keyNote: z.string().trim().max(200).optional(),
  receivingPoint: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

const myAssignedTicketsQuerySchema = z.object({
  status: z.enum(Object.values(TICKET_STATUS)).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const claimDamageSchema = z.object({
  zones: z.array(z.string().trim().min(1).max(80)).default([]),
  photos: z.array(z.string().trim().min(1).max(500)).default([]),
  notes: z.string().trim().max(1000).optional(),
});

const markKeyReceivedSchema = z.object({
  notes: z.string().trim().max(300).optional(),
});

const keyControllerQueueQuerySchema = z.object({
  status: z.enum([
    TICKET_STATUS.ASSIGNED,
    TICKET_STATUS.NOT_PARKED,
    TICKET_STATUS.PARKED,
    TICKET_STATUS.RETRIEVAL_REQUESTED,
  ]).optional(),
  keyStatus: z.enum(["KEY_PENDING", "KEY_RECEIVED"]).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const KEY_HANDOVER_SLA_MINUTES = Number(process.env.KEY_HANDOVER_SLA_MINUTES || 3);

const processEntryMethodSchema = z.object({
  entryMethod: z.enum(ENTRY_METHOD_VALUES),
  ownerHasApp: z.boolean().default(false),
  ownerPhone: z.string().trim().min(8).max(20).optional(),
  services: z.array(z.string().trim().min(1).max(80)).optional(),
}).superRefine((data, ctx) => {
  if (data.entryMethod === ENTRY_METHODS.SMS && !data.ownerPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerPhone"],
      message: "ownerPhone is required when entryMethod is SMS",
    });
  }
});

const requestRetrievalSchema = z.object({
  receivingPoint: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).optional(),
});

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function normalizeStringArray(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof input === "string") {
    const value = input.trim();
    if (!value) {
      return [];
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item || "").trim())
            .filter(Boolean);
        }
      } catch {
        // fallback to comma-separated parsing
      }
    }

    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function resolveParkedAt(ticket) {
  if (ticket?.parkedAt) {
    return new Date(ticket.parkedAt);
  }
  if (ticket?.status === TICKET_STATUS.PARKED && ticket?.updatedAt) {
    return new Date(ticket.updatedAt);
  }
  return null;
}

function buildKeyControlMeta(ticket) {
  const parkedAt = resolveParkedAt(ticket);
  const keyReceivedAt = ticket?.keyReceivedAt ? new Date(ticket.keyReceivedAt) : null;
  const slaMinutes = Number.isFinite(KEY_HANDOVER_SLA_MINUTES) && KEY_HANDOVER_SLA_MINUTES > 0
    ? KEY_HANDOVER_SLA_MINUTES
    : 3;

  const dueAt = parkedAt ? new Date(parkedAt.getTime() + slaMinutes * 60 * 1000) : null;
  const isDelayed = Boolean(
    parkedAt
    && !keyReceivedAt
    && dueAt
    && Date.now() > dueAt.getTime(),
  );
  const delaySeconds = isDelayed && dueAt
    ? Math.floor((Date.now() - dueAt.getTime()) / 1000)
    : 0;

  const keyStatus = keyReceivedAt
    ? "KEY_RECEIVED"
    : parkedAt
      ? "KEY_PENDING"
      : "NOT_APPLICABLE";

  return {
    keyStatus,
    parkedAt,
    keyReceivedAt,
    keyReceivedBy: ticket?.keyReceivedBy ? String(ticket.keyReceivedBy) : null,
    handoverSlaMinutes: slaMinutes,
    handoverDueAt: dueAt,
    isDelayed,
    delaySeconds,
  };
}

function buildWhatsAppPrefillLink(identifier) {
  const value = String(identifier || "").trim();
  const command = `/park my car ${value}`;
  const businessPhone = (process.env.WHATSAPP_BUSINESS_PHONE || "").replace(/\D/g, "");
  const encodedText = encodeURIComponent(command);

  if (!businessPhone) {
    return {
      command,
      link: `https://wa.me/?text=${encodedText}`,
    };
  }

  return {
    command,
    link: `https://wa.me/${businessPhone}?text=${encodedText}`,
  };
}

function buildPaymentLink(ticket) {
  const baseUrl = process.env.PAYMENT_BASE_URL || process.env.APP_BASE_URL || "";
  if (!baseUrl) {
    return "";
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/pay?ticket=${encodeURIComponent(ticket.ticketNumber)}`;
}

function buildOwnerAppScanPayload(ticket) {
  return JSON.stringify({
    type: "OWNER_REQUEST",
    ticketNumber: ticket.ticketNumber,
    valetCode: ticket.valetCode,
  });
}

function buildTicketSmsBody({
  ticket,
  vehicle,
  businessPhone,
  paymentLink,
}) {
  const businessContact = businessPhone ? `+${businessPhone}` : "";
  const lines = [
    `Ticket #${ticket.ticketNumber}`,
    `Valet Code: ${ticket.valetCode}`,
    `Plate Number: ${vehicle.plate}`,
  ];

  if (businessContact) {
    lines.push(`Contact: ${businessContact}`);
  }
  if (paymentLink) {
    lines.push(`Link: ${paymentLink}`);
  }

  return lines.join("\n");
}

async function logTicketEvent({ ticketId, status, actor, note, meta }) {
  await TicketEvent.create({
    ticket: ticketId,
    status,
    actor: actor || null,
    note: note || "",
    meta: meta || null,
  });
}

async function emitTicketAssignedToDriver({
  req,
  ticket,
  driverId,
  vehicleDetails = null,
}) {
  try {
    const io = req.app?.get("io");
    if (!io || !driverId) {
      return;
    }

    let resolvedVehicle = vehicleDetails;
    if (!resolvedVehicle && ticket?.vehicle && isValidObjectId(ticket.vehicle)) {
      const vehicle = await Vehicle.findById(ticket.vehicle)
        .select("plate make model color")
        .lean();
      if (vehicle) {
        resolvedVehicle = {
          plate: vehicle.plate || "",
          make: vehicle.make || "",
          model: vehicle.model || "",
          color: vehicle.color || "",
        };
      }
    }

    io.to(`user_${String(driverId)}`).emit("ticket_assigned", {
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      valetCode: ticket.valetCode,
      status: ticket.status,
      ownerType: ticket.ownerType,
      assignedDriverId: String(driverId),
      branchId: ticket.branch ? String(ticket.branch) : "",
      assignedAt: new Date().toISOString(),
      vehicle: resolvedVehicle,
    });
  } catch (error) {
    console.error("[Socket.IO] Failed to emit ticket_assigned:", error?.message || error);
  }
}

async function emitRetrievalRequestedToOps({
  req,
  ticket,
}) {
  try {
    const io = req.app?.get("io");
    if (!io || !ticket?.branch) {
      return;
    }

    const recipients = await User.find({
      branch: ticket.branch,
      role: { $in: [ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR] },
      isActive: true,
    })
      .select("_id role fullName")
      .lean();

    if (!recipients.length) {
      return;
    }

    let vehicleDetails = null;
    if (ticket.vehicle && isValidObjectId(ticket.vehicle)) {
      const vehicle = await Vehicle.findById(ticket.vehicle)
        .select("plate make model color")
        .lean();
      if (vehicle) {
        vehicleDetails = {
          plate: vehicle.plate || "",
          make: vehicle.make || "",
          model: vehicle.model || "",
          color: vehicle.color || "",
        };
      }
    }

    const payload = {
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      valetCode: ticket.valetCode,
      status: ticket.status,
      receivingPoint: ticket.receivingPoint || "",
      branchId: String(ticket.branch),
      requestedAt: new Date().toISOString(),
      requestedBy: {
        id: String(req.user.id),
        role: req.user.role,
      },
      vehicle: vehicleDetails,
    };

    recipients.forEach((user) => {
      io.to(`user_${String(user._id)}`).emit("retrieval_requested", payload);
    });
  } catch (error) {
    console.error("[Socket.IO] Failed to emit retrieval_requested:", error?.message || error);
  }
}

// ─── Real-time: Notify car OWNER when ticket status changes ───────────────────
// Covers: PARKED, ON_THE_WAY, DELIVERED

const STATUS_MESSAGES = {
  [TICKET_STATUS.PARKED]:               "Your car has been parked safely.",
  [TICKET_STATUS.ON_THE_WAY]:           "Your car is on the way to the receiving point.",
  [TICKET_STATUS.DELIVERED]:            "Your car is ready for pickup. Please mark as complete.",
  [TICKET_STATUS.RETRIEVAL_REQUESTED]:  "Your retrieval request is being processed.",
};

async function emitTicketStatusToOwner({ req, ticket }) {
  try {
    const io = req.app?.get("io");
    if (!io) return;

    // Resolve the owner's userId from the ticket
    let ownerUserId = ticket.ownerUser ? String(ticket.ownerUser) : null;

    // Fallback: look up by phone
    if (!ownerUserId && ticket.ownerPhone) {
      const ownerUser = await User.findOne({ phone: ticket.ownerPhone })
        .select("_id")
        .lean();
      if (ownerUser) ownerUserId = String(ownerUser._id);
    }

    if (!ownerUserId) return; // anonymous owner — cannot push

    const message = STATUS_MESSAGES[ticket.status] || `Ticket status updated to ${ticket.status}`;

    io.to(`user_${ownerUserId}`).emit("ticket_status_update", {
      ticketId:       String(ticket._id),
      ticketNumber:   ticket.ticketNumber,
      status:         ticket.status,
      message,
      receivingPoint: ticket.receivingPoint || null,
      updatedAt:      new Date().toISOString(),
    });

    console.log(`[Socket.IO] Emitted ticket_status_update (${ticket.status}) → owner ${ownerUserId}`);
  } catch (error) {
    console.error("[Socket.IO] Failed to emit ticket_status_update:", error?.message || error);
  }
}


export async function assignDriver(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const parsed = assignDriverSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const { driverId } = parsed.data;
  if (!isValidObjectId(driverId)) {
    throw badRequest("driverId must be a valid ObjectId");
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId });

  if (!ticket) {
    throw notFound("Ticket not found");
  }

  const driver = await User.findById(driverId).lean();

  if (
    !driver
    || driver.role !== ROLES.DRIVER
    || !driver.isActive
    || String(driver.branch) !== String(ticket.branch)
  ) {
    throw badRequest("Selected user is not an active driver");
  }

  const previousStatus = ticket.status;
  const previousDriverId = ticket.assignedDriver ? String(ticket.assignedDriver) : null;
  const canSwitchToAssigned = canTransitionStatus(ticket.status, TICKET_STATUS.ASSIGNED);
  const canReassignWithoutStatusChange = [
    TICKET_STATUS.ASSIGNED,
    TICKET_STATUS.NOT_PARKED,
    TICKET_STATUS.PARKED,
    TICKET_STATUS.RETRIEVAL_REQUESTED,
  ].includes(ticket.status);

  if (!canSwitchToAssigned && !canReassignWithoutStatusChange) {
    throw conflict(`Cannot assign driver while ticket is in ${ticket.status}`);
  }

  if (
    ticket.status === TICKET_STATUS.RETRIEVAL_REQUESTED
    && ![ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR].includes(req.user.role)
  ) {
    throw forbidden("Only key controller or supervisor can assign driver after retrieval request");
  }

  let updatedVehicle = null;
  if (parsed.data.vehicle && ticket.vehicle && isValidObjectId(ticket.vehicle)) {
    const vehicleUpdates = {};
    if (parsed.data.vehicle.plate !== undefined) vehicleUpdates.plate = parsed.data.vehicle.plate;
    if (parsed.data.vehicle.make !== undefined) vehicleUpdates.make = parsed.data.vehicle.make;
    if (parsed.data.vehicle.model !== undefined) vehicleUpdates.model = parsed.data.vehicle.model;
    if (parsed.data.vehicle.color !== undefined) vehicleUpdates.color = parsed.data.vehicle.color;
    if (parsed.data.vehicle.photo !== undefined) vehicleUpdates.photo = parsed.data.vehicle.photo;

    if (Object.keys(vehicleUpdates).length > 0) {
      updatedVehicle = await Vehicle.findByIdAndUpdate(
        ticket.vehicle,
        { $set: vehicleUpdates },
        { new: true, runValidators: true },
      ).lean();
    }
  }

  ticket.assignedDriver = driverId;
  if (canSwitchToAssigned) {
    ticket.status = TICKET_STATUS.ASSIGNED;
  }
  if (parsed.data.slot !== undefined) ticket.slot = parsed.data.slot;
  if (parsed.data.garage !== undefined) ticket.garage = parsed.data.garage;
  if (parsed.data.keyTag !== undefined) ticket.keyTag = parsed.data.keyTag;
  if (parsed.data.keyNote !== undefined) ticket.keyNote = parsed.data.keyNote;
  if (parsed.data.receivingPoint !== undefined) ticket.receivingPoint = parsed.data.receivingPoint;
  if (parsed.data.notes !== undefined) ticket.notes = parsed.data.notes;
  await ticket.save();

  await logTicketEvent({
    ticketId,
    status: ticket.status,
    actor: req.user?.id,
    note: previousDriverId ? "Driver reassigned" : "Driver assigned",
    meta: {
      previousStatus,
      previousDriverId,
      newDriverId: String(driverId),
      vehicleUpdated: Boolean(updatedVehicle),
    },
  });

  void emitTicketAssignedToDriver({
    req,
    ticket,
    driverId,
  });

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: populatedTicket || ticket,
      },
      "Driver assigned successfully",
    ),
  );
}

export async function processEntryMethod(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = processEntryMethodSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId })
    .populate("vehicle", "plate make model color")
    .populate("assignedDriver", "fullName phone role");
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (!ticket.assignedDriver) {
    throw conflict("Assign a driver first before selecting entry method");
  }

  const branch = await Branch.findOne({ _id: req.user.branchId, isActive: true }).lean();
  if (!branch) {
    throw badRequest("Your branch is invalid or inactive");
  }

  const supportedEntryMethods = Array.isArray(branch.supportedEntryMethods) && branch.supportedEntryMethods.length
    ? branch.supportedEntryMethods
    : [...ENTRY_METHOD_VALUES];
  if (!supportedEntryMethods.includes(parsed.data.entryMethod)) {
    throw badRequest(`Entry method ${parsed.data.entryMethod} is not enabled for this branch`, {
      allowedEntryMethods: supportedEntryMethods,
    });
  }

  const isSmsEntry = parsed.data.entryMethod === ENTRY_METHODS.SMS;
  const isPrintEntry = [
    ENTRY_METHODS.PRINTER,
    ENTRY_METHODS.SERIALIZED_PAPER,
  ].includes(parsed.data.entryMethod);
  const ownerType = parsed.data.ownerHasApp ? OWNER_TYPES.APP : OWNER_TYPES.WHATSAPP;

  if (parsed.data.ownerPhone !== undefined) {
    ticket.ownerPhone = parsed.data.ownerPhone;
  }
  ticket.ownerType = ownerType;
  ticket.entryMethod = parsed.data.entryMethod;
  if (parsed.data.services !== undefined) {
    ticket.services = parsed.data.services;
  }
  await ticket.save();

  const vehicleDetails = {
    plate: ticket.vehicle?.plate || "",
    make: ticket.vehicle?.make || "",
    model: ticket.vehicle?.model || "",
    color: ticket.vehicle?.color || "",
  };
  const paymentLink = buildPaymentLink(ticket);
  const whatsappIdentifier = String(vehicleDetails.plate || ticket.valetCode || "").trim();
  const { command: whatsappCommand, link: whatsappPrefillLink } = buildWhatsAppPrefillLink(whatsappIdentifier);
  const ownerAppQrPayload = buildOwnerAppScanPayload(ticket);

  let qrTarget = "APP_SCANNER";
  let qrTargetLink = ownerAppQrPayload;

  if (isPrintEntry) {
    qrTarget = "PRINT";
    qrTargetLink = "";
  } else if (isSmsEntry) {
    qrTarget = "SMS";
    qrTargetLink = "";
  } else if (!parsed.data.ownerHasApp) {
    qrTarget = "WHATSAPP";
    qrTargetLink = whatsappPrefillLink;
  }

  let smsDelivery = null;
  if (isSmsEntry) {
    const businessPhone = (process.env.WHATSAPP_BUSINESS_PHONE || "").replace(/\D/g, "");
    const smsBody = buildTicketSmsBody({
      ticket,
      vehicle: vehicleDetails,
      businessPhone,
      paymentLink,
    });

    try {
      await sendTextSms({
        phone: parsed.data.ownerPhone,
        body: smsBody,
      });
      smsDelivery = {
        status: "SENT",
        to: parsed.data.ownerPhone,
      };
    } catch (error) {
      smsDelivery = {
        status: "FAILED",
        to: parsed.data.ownerPhone,
        error: error?.message || "SMS delivery failed",
      };
    }
  }

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: `Entry method selected: ${parsed.data.entryMethod}`,
    meta: {
      entryMethod: parsed.data.entryMethod,
      ownerType,
      qrTarget,
      smsDelivery,
    },
  });

  const ownerFlow = {
    ownerType,
    entryMethod: parsed.data.entryMethod,
    qrTarget,
    qrTargetLink,
    instantConfirmation: "Your car has been received and is being parked.",
    vehicleDetails,
    paymentLink,
    smsDelivery,
    printableTicket: isPrintEntry
      ? {
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        plate: vehicleDetails.plate,
        make: vehicleDetails.make,
        model: vehicleDetails.model,
        color: vehicleDetails.color,
        garage: ticket.garage || "",
        slot: ticket.slot || "",
        keyTag: ticket.keyTag || "",
        receivingPoint: ticket.receivingPoint || "",
      }
      : null,
  };

  if (qrTarget === "WHATSAPP") {
    ownerFlow.whatsappCommand = whatsappCommand;
    ownerFlow.whatsappPrefillLink = whatsappPrefillLink;
  }
  if (qrTarget === "APP_SCANNER") {
    ownerFlow.ownerAppQrPayload = ownerAppQrPayload;
  }

  const responseMessage = smsDelivery?.status === "FAILED"
    ? "Entry method saved, but SMS delivery failed"
    : isPrintEntry
      ? "Entry method processed successfully (print ticket ready)"
      : "Entry method processed successfully";

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        status: ticket.status,
        driver: ticket.assignedDriver
          ? {
            id: String(ticket.assignedDriver._id),
            fullName: ticket.assignedDriver.fullName,
            phone: ticket.assignedDriver.phone,
          }
          : null,
        ownerFlow,
      },
      responseMessage,
    ),
  );
}

export async function updateTicketStatus(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const parsed = updateTicketStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId });
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  const nextStatus = parsed.data.status;
  if (!canTransitionStatus(ticket.status, nextStatus)) {
    throw conflict(`Invalid status transition: ${ticket.status} -> ${nextStatus}`);
  }

  if (
    nextStatus === TICKET_STATUS.RETRIEVAL_REQUESTED
    && ![ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR].includes(req.user.role)
  ) {
    throw forbidden("Only receptionist, key controller, or supervisor can request retrieval");
  }

  if ([TICKET_STATUS.ON_THE_WAY, TICKET_STATUS.DELIVERED].includes(nextStatus)) {
    if (req.user.role !== ROLES.DRIVER) {
      throw forbidden(`Only assigned driver can update status to ${nextStatus}`);
    }

    if (!ticket.assignedDriver || String(ticket.assignedDriver) !== String(req.user.id)) {
      throw forbidden("Only assigned driver can update this ticket status");
    }
  }

  ticket.status = nextStatus;
  if (nextStatus === TICKET_STATUS.PARKED && !ticket.parkedAt) {
    ticket.parkedAt = new Date();
  }
  if (nextStatus === TICKET_STATUS.NOT_PARKED) {
    ticket.parkedAt = null;
    ticket.keyReceivedAt = null;
    ticket.keyReceivedBy = null;
  }
  if (parsed.data.slot !== undefined) ticket.slot = parsed.data.slot;
  if (parsed.data.garage !== undefined) ticket.garage = parsed.data.garage;
  if (parsed.data.keyTag !== undefined) ticket.keyTag = parsed.data.keyTag;
  if (parsed.data.keyNote !== undefined) ticket.keyNote = parsed.data.keyNote;
  if (parsed.data.receivingPoint !== undefined) ticket.receivingPoint = parsed.data.receivingPoint;
  if (parsed.data.notes !== undefined) ticket.notes = parsed.data.notes;

  await ticket.save();

  await logTicketEvent({
    ticketId,
    status: nextStatus,
    actor: req.user?.id,
    note: "Status updated",
  });

  if (nextStatus === TICKET_STATUS.RETRIEVAL_REQUESTED) {
    void emitRetrievalRequestedToOps({
      req,
      ticket,
    });
  }

  // ── Notify car owner in real-time for key status changes ──────────────────
  const ownerNotifyStatuses = [
    TICKET_STATUS.PARKED,
    TICKET_STATUS.ON_THE_WAY,
    TICKET_STATUS.DELIVERED,
    TICKET_STATUS.RETRIEVAL_REQUESTED,
  ];
  if (ownerNotifyStatuses.includes(nextStatus)) {
    void emitTicketStatusToOwner({ req, ticket });
  }

  return res.status(200).json({
    message: "Ticket status updated successfully",
    ticket,
  });
}

export async function requestRetrieval(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const parsed = requestRetrievalSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  let ticket = null;
  if (req.user.role === ROLES.OWNER) {
    ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      throw notFound("Ticket not found");
    }

    const ownerByUserId = ticket.ownerUser && String(ticket.ownerUser) === String(req.user.id);
    const ownerByPhone = Boolean(ticket.ownerPhone) && String(ticket.ownerPhone) === String(req.user.phone);
    if (!ownerByUserId && !ownerByPhone) {
      throw forbidden("You do not have permission to request retrieval for this ticket");
    }
  } else {
    if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
      throw forbidden("User is not assigned to a valid branch");
    }
    ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId });
    if (!ticket) {
      throw notFound("Ticket not found");
    }
  }

  if (!canTransitionStatus(ticket.status, TICKET_STATUS.RETRIEVAL_REQUESTED)) {
    throw conflict(`Cannot request retrieval while ticket is in ${ticket.status}`);
  }

  ticket.status = TICKET_STATUS.RETRIEVAL_REQUESTED;
  ticket.receivingPoint = parsed.data.receivingPoint;
  if (parsed.data.notes !== undefined) {
    ticket.notes = parsed.data.notes;
  }
  await ticket.save();

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: req.user.role === ROLES.OWNER
      ? "Retrieval requested by owner"
      : "Retrieval requested by receptionist",
    meta: {
      requestedByRole: req.user.role,
      receivingPoint: ticket.receivingPoint,
    },
  });

  void emitRetrievalRequestedToOps({
    req,
    ticket,
  });

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: populatedTicket,
      },
      "Retrieval requested successfully",
    ),
  );
}

export async function claimDamage(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const uploadedPhotoUrls = Array.isArray(req.files)
    ? req.files.map((file) => `/public/damages/${file.filename}`)
    : [];

  const payload = {
    zones: normalizeStringArray(req.body?.zones ?? req.body?.zone),
    photos: [
      ...normalizeStringArray(req.body?.photos),
      ...uploadedPhotoUrls,
    ],
    notes: req.body?.notes,
  };

  const parsed = claimDamageSchema.safeParse(payload);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }
  if (parsed.data.zones.length === 0) {
    throw badRequest("At least one damage zone is required");
  }
  if (parsed.data.photos.length === 0) {
    throw badRequest("At least one damage photo is required");
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId }).lean();
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (!ticket.assignedDriver || String(ticket.assignedDriver) !== String(req.user.id)) {
    throw forbidden("Only the assigned driver can claim damage for this ticket");
  }

  const report = await DamageReport.create({
    ticket: ticket._id,
    reportedBy: req.user.id,
    zones: parsed.data.zones,
    photos: parsed.data.photos,
    notes: parsed.data.notes || "",
  });

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: "Damage claim submitted by driver",
    meta: {
      damageReportId: String(report._id),
      zones: parsed.data.zones,
      photoCount: parsed.data.photos.length,
    },
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        damageReport: {
          id: String(report._id),
          ticketId: String(report.ticket),
          reportedBy: String(report.reportedBy),
          zones: report.zones,
          photos: report.photos,
          notes: report.notes,
          createdAt: report.createdAt,
        },
      },
      "Damage claim submitted successfully",
    ),
  );
}

export async function getDamageClaims(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId }).lean();
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  const reports = await DamageReport.find({ ticket: ticket._id })
    .sort({ createdAt: -1 })
    .populate("reportedBy", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        count: reports.length,
        reports: reports.map((report) => ({
          id: String(report._id),
          zones: report.zones || [],
          photos: report.photos || [],
          notes: report.notes || "",
          reportedBy: report.reportedBy
            ? {
              id: String(report.reportedBy._id),
              fullName: report.reportedBy.fullName,
              phone: report.reportedBy.phone,
              role: report.reportedBy.role,
            }
            : null,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        })),
      },
      "Damage claims retrieved successfully",
    ),
  );
}

export async function getTicketById(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId })
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .populate("createdBy", "fullName phone role")
    .lean();

  if (!ticket) {
    throw notFound("Ticket not found");
  }

  return res.status(200).json({ ticket });
}

export async function listTickets(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const { status, ownerType } = req.query;
  const filter = { branch: req.user.branchId };

  if (status) {
    if (!Object.values(TICKET_STATUS).includes(status)) {
      throw badRequest("Invalid status filter");
    }
    filter.status = status;
  }

  if (ownerType) {
    if (!Object.values(OWNER_TYPES).includes(ownerType)) {
      throw badRequest("Invalid ownerType filter");
    }
    filter.ownerType = ownerType;
  }

  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .lean();

  return res.status(200).json({ count: tickets.length, tickets });
}

export async function getMyAssignedTickets(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = myAssignedTicketsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const { status, q, limit } = parsed.data;
  const filter = {
    branch: req.user.branchId,
    assignedDriver: req.user.id,
  };
  if (status) {
    filter.status = status;
  }

  const fetchLimit = q ? Math.max(limit, 300) : limit;
  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .limit(fetchLimit)
    .populate("vehicle")
    .populate("createdBy", "fullName")
    .lean();

  const queryText = (q || "").toLowerCase().trim();
  const filtered = queryText
    ? tickets.filter((ticket) => {
      const ticketNumber = String(ticket.ticketNumber || "").toLowerCase();
      const plate = String(ticket.vehicle?.plate || "").toLowerCase();
      return ticketNumber.includes(queryText) || plate.includes(queryText);
    })
    : tickets;

  const trimmed = filtered.slice(0, limit);

  return res.status(200).json({
    count: trimmed.length,
    tickets: trimmed,
  });
}

export async function getKeyControllerQueue(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = keyControllerQueueQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const { status, keyStatus, q, limit } = parsed.data;
  const filter = {
    branch: req.user.branchId,
    status: status
      ? status
      : {
        $in: [
          TICKET_STATUS.ASSIGNED,
          TICKET_STATUS.NOT_PARKED,
          TICKET_STATUS.PARKED,
          TICKET_STATUS.RETRIEVAL_REQUESTED,
        ],
      },
  };

  const fetchLimit = q ? Math.max(limit, 300) : limit;
  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .limit(fetchLimit)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .lean();

  const queryText = (q || "").toLowerCase().trim();
  let filtered = queryText
    ? tickets.filter((ticket) => {
      const ticketNumber = String(ticket.ticketNumber || "").toLowerCase();
      const plate = String(ticket.vehicle?.plate || "").toLowerCase();
      return ticketNumber.includes(queryText) || plate.includes(queryText);
    })
    : tickets;

  filtered = filtered
    .map((ticket) => ({
      ...ticket,
      keyControl: buildKeyControlMeta(ticket),
    }))
    .filter((ticket) => (keyStatus ? ticket.keyControl.keyStatus === keyStatus : true))
    .slice(0, limit);

  return res.status(200).json({
    count: filtered.length,
    tickets: filtered,
  });
}

export async function markKeyReceived(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = markKeyReceivedSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId });
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (ticket.status !== TICKET_STATUS.PARKED) {
    throw conflict("Key can be marked received only when car status is PARKED");
  }

  if (ticket.keyReceivedAt) {
    throw conflict("Key is already marked as received");
  }

  ticket.keyReceivedAt = new Date();
  ticket.keyReceivedBy = req.user.id;
  if (parsed.data.notes !== undefined) {
    ticket.keyNote = parsed.data.notes;
  }
  await ticket.save();

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: "Key received by key controller",
    meta: {
      keyReceivedAt: ticket.keyReceivedAt,
      keyReceivedBy: req.user.id,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        keyControl: buildKeyControlMeta(ticket),
      },
      "Key marked as received successfully",
    ),
  );
}

export async function createManualCarArrival(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = manualCarArrivalSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const data = parsed.data;
  const branch = await Branch.findOne({ _id: req.user.branchId, isActive: true }).lean();

  if (!branch) {
    throw badRequest("Your branch is invalid or inactive");
  }

  const vehicle = await Vehicle.create({
    plate: data.vehicle.plate,
    make: data.vehicle.make,
    model: data.vehicle.model,
    color: data.vehicle.color,
    photo: data.vehicle.photo || null,
  });

  const valetCode = generateValetCode(branch.code || "LSA");

  const ticket = await Ticket.create({
    ticketNumber: generateTicketNumber(),
    valetCode,
    ownerType: OWNER_TYPES.WHATSAPP,
    ownerPhone: data.ownerPhone || "",
    ownerUser: null,
    branch: branch._id,
    vehicle: vehicle._id,
    location: null,
    status: TICKET_STATUS.CREATED,
    assignedDriver: null,
    notes: data.notes || "",
    services: [],
    createdBy: req.user.id,
  });

  await logTicketEvent({
    ticketId: ticket._id,
    status: TICKET_STATUS.CREATED,
    actor: req.user.id,
    note: "Car arrived at reception",
  });

  const vehicleDetails = {
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
  };

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        status: ticket.status,
        vehicle: vehicleDetails,
        
      },
      "Car arrival captured successfully",
    ),
  );
}

// ─── PATCH /api/v1/tickets/:ticketId/park ─────────────────────────────────────
// Driver submits parking details (slot, keyTag, keyNote, photo) after parking
// Transitions ticket status: ASSIGNED → PARKED

const parkCarSchema = z.object({
  slot:    z.string().trim().max(60).optional(),
  keyTag:  z.string().trim().max(40).optional(),
  keyNote: z.string().trim().max(300).optional(),
});

export async function parkCar(req, res) {
  const { ticketId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    throw badRequest("Invalid ticket ID");
  }

  const parsed = parkCarSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Invalid parking data", parsed.error.flatten());

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw notFound("Ticket not found");

  // Only the assigned driver can park this ticket
  if (String(ticket.assignedDriver) !== req.user.id) {
    throw forbidden("You are not the assigned driver for this ticket");
  }

  // Ticket must be ASSIGNED or NOT_PARKED to be marked as parked
  const allowedStatuses = [TICKET_STATUS.ASSIGNED, TICKET_STATUS.NOT_PARKED];
  if (!allowedStatuses.includes(ticket.status)) {
    throw conflict(
      `Cannot park ticket. Current status is "${ticket.status}". Must be ASSIGNED or NOT_PARKED.`,
    );
  }

  // Build the parked car photo path if uploaded
  const baseUrl   = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const photoPath = req.file ? `/public/parked/${req.file.filename}` : null;
  const photoUrl  = photoPath ? `${baseUrl}${photoPath}` : null;

  // Update ticket fields
  const updates = {
    status:  TICKET_STATUS.PARKED,
    slot:    parsed.data.slot    ?? ticket.slot,
    keyTag:  parsed.data.keyTag  ?? ticket.keyTag,
    keyNote: parsed.data.keyNote ?? ticket.keyNote,
  };

  if (photoPath) updates["meta.parkedPhotoPath"] = photoPath;

  Object.assign(ticket, updates);
  await ticket.save();

  // Log the parking event
  await TicketEvent.create({
    ticket: ticket._id,
    status: TICKET_STATUS.PARKED,
    actor:  req.user.id,
    note:   parsed.data.keyNote || "",
    meta: {
      slot:       parsed.data.slot   || null,
      keyTag:     parsed.data.keyTag || null,
      photoPath,
    },
  });

  return res.json(
    new ApiResponse(
      200,
      {
        ticketId:     String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        status:       ticket.status,
        slot:         ticket.slot,
        keyTag:       ticket.keyTag,
        keyNote:      ticket.keyNote,
        parkedPhotoUrl: photoUrl,
      },
      "Car parked successfully",
    ),
  );
}
