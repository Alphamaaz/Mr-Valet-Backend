import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
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
  ownerHasApp: z.boolean().default(false),
  driverId: z.string().trim().min(1),
  entryMethod: z.enum(ENTRY_METHOD_VALUES).default("CAMERA"),
  vehicle: z.object({
    plate: z.string().trim().min(2).max(20),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    color: z.string().trim().min(1).max(40),
    photo: z.string().trim().min(1).optional(),
  }),
  garage: z.string().trim().max(60).optional(),
  slot: z.string().trim().max(60).optional(),
  keyTag: z.string().trim().max(40).optional(),
  keyNote: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
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

const assignDriverSchema = z.object({
  driverId: z.string().trim().min(1),
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

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function buildWhatsAppPrefillLink(valetCode) {
  const command = `/park my car ${valetCode}`;
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

  if (!canTransitionStatus(ticket.status, TICKET_STATUS.ASSIGNED)) {
    throw conflict(`Cannot assign driver while ticket is in ${ticket.status}`);
  }

  ticket.assignedDriver = driverId;
  ticket.status = TICKET_STATUS.ASSIGNED;
  await ticket.save();

  await logTicketEvent({
    ticketId,
    status: TICKET_STATUS.ASSIGNED,
    actor: req.user?.id,
    note: "Driver assigned",
    meta: { driverId },
  });

  return res.status(200).json({
    message: "Driver assigned successfully",
    ticket,
  });
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

  ticket.status = nextStatus;
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

  return res.status(200).json({
    message: "Ticket status updated successfully",
    ticket,
  });
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

export async function createManualCarArrival(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = manualCarArrivalSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const data = parsed.data;
  if (!isValidObjectId(data.driverId)) {
    throw badRequest("driverId must be a valid ObjectId");
  }

  const [branch, driver] = await Promise.all([
    Branch.findOne({ _id: req.user.branchId, isActive: true }).lean(),
    User.findById(data.driverId).lean(),
  ]);

  if (!branch) {
    throw badRequest("Your branch is invalid or inactive");
  }

  if (
    !driver
    || driver.role !== ROLES.DRIVER
    || !driver.isActive
    || String(driver.branch) !== String(branch._id)
  ) {
    throw badRequest("Selected driver is invalid or not from your branch");
  }

  const supportedEntryMethods = Array.isArray(branch.supportedEntryMethods) && branch.supportedEntryMethods.length
    ? branch.supportedEntryMethods
    : [...ENTRY_METHOD_VALUES];
  if (!supportedEntryMethods.includes(data.entryMethod)) {
    throw badRequest(`Entry method ${data.entryMethod} is not enabled for this branch`, {
      allowedEntryMethods: supportedEntryMethods,
    });
  }

  const vehicle = await Vehicle.create({
    plate: data.vehicle.plate,
    make: data.vehicle.make,
    model: data.vehicle.model,
    color: data.vehicle.color,
    photo: data.vehicle.photo || null,
  });

  const isSmsEntry = data.entryMethod === ENTRY_METHODS.SMS;
  const ownerType = data.ownerHasApp ? OWNER_TYPES.APP : OWNER_TYPES.WHATSAPP;
  const valetCode = generateValetCode(branch.code || "LSA");

  const ticket = await Ticket.create({
    ticketNumber: generateTicketNumber(),
    valetCode,
    ownerType,
    ownerPhone: data.ownerPhone || "",
    ownerUser: null,
    branch: branch._id,
    vehicle: vehicle._id,
    location: null,
    status: TICKET_STATUS.ASSIGNED,
    assignedDriver: driver._id,
    slot: data.slot || "",
    garage: data.garage || "",
    keyTag: data.keyTag || "",
    keyNote: data.keyNote || "",
    notes: data.notes || "",
    services: data.services || [],
    createdBy: req.user.id,
  });

  await Promise.all([
    logTicketEvent({
      ticketId: ticket._id,
      status: TICKET_STATUS.CREATED,
      actor: req.user.id,
      note: `Ticket created via ${data.entryMethod}`,
    }),
    logTicketEvent({
      ticketId: ticket._id,
      status: TICKET_STATUS.ASSIGNED,
      actor: req.user.id,
      note: "Driver assigned at reception",
      meta: { driverId: String(driver._id) },
    }),
  ]);

  const { command: whatsappCommand, link: whatsappPrefillLink } = buildWhatsAppPrefillLink(ticket.valetCode);
  const ownerAppQrPayload = buildOwnerAppScanPayload(ticket);
  const paymentLink = buildPaymentLink(ticket);
  const businessPhone = (process.env.WHATSAPP_BUSINESS_PHONE || "").replace(/\D/g, "");

  const vehicleDetails = {
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
  };

  let smsDelivery = null;
  if (isSmsEntry) {
    const smsBody = buildTicketSmsBody({
      ticket,
      vehicle: vehicleDetails,
      businessPhone,
      paymentLink,
    });

    try {
      await sendTextSms({
        phone: data.ownerPhone,
        body: smsBody,
      });
      smsDelivery = {
        status: "SENT",
        to: data.ownerPhone,
      };
    } catch (error) {
      smsDelivery = {
        status: "FAILED",
        to: data.ownerPhone,
        error: error?.message || "SMS delivery failed",
      };
    }

    await logTicketEvent({
      ticketId: ticket._id,
      status: TICKET_STATUS.ASSIGNED,
      actor: req.user.id,
      note: smsDelivery.status === "SENT" ? "Ticket SMS sent to owner" : "Ticket SMS delivery failed",
      meta: {
        entryMethod: data.entryMethod,
        smsDelivery,
      },
    });
  }

  const qrTarget = isSmsEntry
    ? "SMS"
    : ownerType === OWNER_TYPES.WHATSAPP
      ? "WHATSAPP"
      : "APP_SCANNER";
  const qrTargetLink = isSmsEntry
    ? ""
    : ownerType === OWNER_TYPES.WHATSAPP
      ? whatsappPrefillLink
      : ownerAppQrPayload;

  const responseMessage = smsDelivery?.status === "FAILED"
    ? "Car received and assigned, but SMS delivery failed"
    : "Car received and assigned successfully";

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        status: ticket.status,
        driver: {
          id: String(driver._id),
          fullName: driver.fullName,
          phone: driver.phone,
        },
        vehicle: vehicleDetails,
        ownerFlow: {
          ownerType,
          entryMethod: data.entryMethod,
          qrTarget,
          qrTargetLink,
          whatsappCommand,
          whatsappPrefillLink: !isSmsEntry && ownerType === OWNER_TYPES.WHATSAPP ? whatsappPrefillLink : "",
          ownerAppQrPayload: ownerType === OWNER_TYPES.APP ? ownerAppQrPayload : "",
          smsDelivery,
          instantConfirmation: "Your car has been received and is being parked.",
          vehicleDetails,
          paymentLink,
        },
      },
      responseMessage,
    ),
  );
}
