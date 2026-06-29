import mongoose from "mongoose";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
import { DamageReport } from "../models/DamageReport.js";
import { Payment } from "../models/Payment.js";
import { PaperTicket, PAPER_TICKET_STATUS } from "../models/PaperTicket.js";
import { NfcTag, NFC_TAG_STATUS } from "../models/NfcTag.js";
import { TicketIssueIntent, TICKET_ISSUE_INTENT_STATUS } from "../models/TicketIssueIntent.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Branch } from "../models/Branch.js";
import { OWNER_TYPES } from "../constants/ownerTypes.js";
import { ROLES } from "../constants/roles.js";
import { TICKET_STATUS, canTransitionStatus } from "../constants/ticketStatus.js";
import { ENTRY_METHODS, ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";
import { PAYMENT_CONDITIONS, PAYMENT_CONDITION_VALUES } from "../constants/paymentConditions.js";
import { PAYMENT_STATUS, PAYMENT_STATUS_VALUES } from "../constants/paymentStatus.js";
import { generateTicketNumber, generateValetCode } from "../utils/idGenerator.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendTextSms } from "../services/vodafone.service.js";

const PAYMENT_METHOD_VALUES = Object.freeze([
  "CASH",
  "CARD",
  "ONLINE",
  "POS",
  "VOUCHER",
  "CAMPAIGN",
  "MEMBERSHIP",
  "FREE_OF_CHARGE",
]);

const immediatePaymentSchema = z.object({
  amount: z.coerce.number().min(0),
  method: z.enum(["CASH", "CARD", "POS"]),
  currency: z.string().trim().min(3).max(3).default("QAR"),
  receiptLink: z.string().trim().max(500).optional(),
  terminalId: z.string().trim().max(80).optional(),
  bankTransactionRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(300).optional(),
}).optional();

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
  ownerHasApp: z.boolean().default(false),
  ownerPhone: z.string().trim().min(8).max(20).optional(),
  ownerName: z.string().trim().min(1).max(80).optional(),
  serviceType: z.string().trim().min(1).max(60).optional(),
  paymentCondition: z.enum(PAYMENT_CONDITION_VALUES).optional(),
  entryMethod: z.enum(ENTRY_METHOD_VALUES),
  paperTicketSerial: z.string().trim().min(2).max(80).optional(),
  nfcTagUid: z.string().trim().min(2).max(120).optional(),
  driverId: z.string().trim().optional(),
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
  keyNote: z.string().trim().max(300).optional(),
  receivingPoint: z.string().trim().max(80).optional(),
  services: z.array(z.string().trim().min(1).max(80)).optional(),
  payment: immediatePaymentSchema,
  notes: z.string().trim().max(500).optional(),
}).superRefine((data, ctx) => {
  if (data.entryMethod === ENTRY_METHODS.SMS && !data.ownerPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerPhone"],
      message: "ownerPhone is required when entryMethod is SMS",
    });
  }

  if (data.paymentCondition === PAYMENT_CONDITIONS.PAY_NOW && !data.payment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment"],
      message: "payment is required when paymentCondition is PAY_NOW",
    });
  }

  if (data.entryMethod === ENTRY_METHODS.SERIALIZED_PAPER && !data.paperTicketSerial) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paperTicketSerial"],
      message: "paperTicketSerial is required when entryMethod is SERIALIZED_PAPER",
    });
  }

  if (data.entryMethod === ENTRY_METHODS.NFC && !data.nfcTagUid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nfcTagUid"],
      message: "nfcTagUid is required when entryMethod is NFC",
    });
  }
});

const ticketIssueIntentSchema = manualCarArrivalSchema.safeExtend({
  entryMethod: z.enum([ENTRY_METHODS.QR_CODE, ENTRY_METHODS.WHATSAPP]),
}).superRefine((data, ctx) => {
  if (data.entryMethod === ENTRY_METHODS.QR_CODE && !data.ownerHasApp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerHasApp"],
      message: "ownerHasApp must be true when entryMethod is QR_CODE",
    });
  }

  if (data.entryMethod === ENTRY_METHODS.WHATSAPP && data.ownerHasApp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerHasApp"],
      message: "ownerHasApp must be false when entryMethod is WHATSAPP",
    });
  }
});

const assignDriverSchema = z.object({
  driverId: z.string().trim().min(1),
  force: z.boolean().default(false),
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

const releaseKeySchema = z.object({
  notes: z.string().trim().max(300).optional(),
});

const recordTicketPaymentSchema = z.object({
  amount: z.coerce.number().min(0).optional(),
  method: z.enum(PAYMENT_METHOD_VALUES),
  status: z.enum(PAYMENT_STATUS_VALUES),
  currency: z.string().trim().min(3).max(3).default("QAR"),
  receiptLink: z.string().trim().max(500).optional(),
  terminalId: z.string().trim().max(80).optional(),
  bankTransactionRef: z.string().trim().max(120).optional(),
  providerReference: z.string().trim().max(120).optional(),
  pos: z.object({
    terminalId: z.string().trim().max(80).optional(),
    bankTransactionRef: z.string().trim().max(120).optional(),
    confirmationStatus: z.string().trim().max(80).optional(),
    confirmedAt: z.coerce.date().optional(),
  }).optional(),
  online: z.object({
    provider: z.string().trim().max(80).optional(),
    paymentReference: z.string().trim().max(120).optional(),
    paidAt: z.coerce.date().optional(),
  }).optional(),
  notes: z.string().trim().max(300).optional(),
}).superRefine((data, ctx) => {
  const resolvedWithoutCash = [
    PAYMENT_STATUS.PREPAID,
    PAYMENT_STATUS.CAMPAIGN,
    PAYMENT_STATUS.MEMBERSHIP,
    PAYMENT_STATUS.FREE_OF_CHARGE,
  ];

  if (data.status === PAYMENT_STATUS.PAID && data.amount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: "amount is required when status is PAID",
    });
  }

  if (resolvedWithoutCash.includes(data.status) && data.amount === undefined) {
    data.amount = 0;
  }
});

const updateTicketCheckoutSchema = z.object({
  services: z.array(z.string().trim().min(1).max(80)).optional(),
  paymentCondition: z.enum(PAYMENT_CONDITION_VALUES).optional(),
  payment: immediatePaymentSchema,
  notes: z.string().trim().max(300).optional(),
}).superRefine((data, ctx) => {
  if (data.paymentCondition === PAYMENT_CONDITIONS.PAY_NOW && !data.payment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment"],
      message: "payment is required when paymentCondition is PAY_NOW",
    });
  }

  if (
    data.services === undefined
    && data.paymentCondition === undefined
    && data.payment === undefined
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["services"],
      message: "Provide services, paymentCondition, or payment",
    });
  }
});

const keyControllerQueueQuerySchema = z.object({
  status: z.enum([
    TICKET_STATUS.READY_TO_BE_PARKED,
    TICKET_STATUS.PARKED_IN,
    TICKET_STATUS.REQUESTED_FOR_DELIVERY,
    TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
    TICKET_STATUS.ON_THE_WAY,
    TICKET_STATUS.ARRIVED_FOR_DELIVERY,
  ]).optional(),
  keyStatus: z.enum(["KEY_PENDING", "KEY_RECEIVED"]).optional(),
  keyReleaseStatus: z.enum(["KEY_RELEASE_PENDING", "KEY_RELEASED", "NOT_APPLICABLE"]).optional(),
  parkState: z.enum(["ALL", "PARKED_IN", "NOT_PARKED_IN"]).default("ALL"),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const retrievalRequestsQuerySchema = z.object({
  status: z.enum([
    TICKET_STATUS.REQUESTED_FOR_DELIVERY,
    TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
    TICKET_STATUS.ON_THE_WAY,
    TICKET_STATUS.ARRIVED_FOR_DELIVERY,
  ]).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ownerLinkTicketSchema = z.object({
  ticketId: z.string().trim().optional(),
  ticketNumber: z.string().trim().optional(),
  valetCode: z.string().trim().optional(),
  qrPayload: z.string().trim().optional(),
  ownerName: z.string().trim().min(1).max(80).optional(),
}).superRefine((data, ctx) => {
  if (!data.ticketId && !data.ticketNumber && !data.valetCode && !data.qrPayload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ticketId"],
      message: "Provide ticketId, ticketNumber, valetCode, or qrPayload",
    });
  }
});

const ownerTicketListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(60).optional(),
});

const ticketHistoryQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(Object.values(TICKET_STATUS)).optional(),
  paymentStatus: z.string().trim().max(40).optional(),
  serviceType: z.string().trim().max(60).optional(),
  branchId: z.string().trim().optional(),
  employeeId: z.string().trim().optional(),
  scope: z.enum(["completed", "active", "all"]).default("completed"),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const KEY_HANDOVER_SLA_SECONDS = Number(
  process.env.KEY_HANDOVER_SLA_SECONDS || Number(process.env.KEY_HANDOVER_SLA_MINUTES || 0) * 60 || 90,
);
const OWNER_TERMINAL_STATUSES = [
  TICKET_STATUS.DELIVERED,
];

const processEntryMethodSchema = z.object({
  entryMethod: z.enum(ENTRY_METHOD_VALUES),
  ownerHasApp: z.boolean().default(false),
  ownerPhone: z.string().trim().min(8).max(20).optional(),
  ownerName: z.string().trim().min(1).max(80).optional(),
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

const publicRetrievalSummaryQuerySchema = z.object({
  token: z.string().trim().min(20),
});

const publicRetrievalRequestSchema = z.object({
  token: z.string().trim().min(20),
  receivingPoint: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).optional(),
});

const serializedPaperDepartureSchema = z.object({
  serialNumber: z.string().trim().min(2).max(80),
  receivingPoint: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).optional(),
});

const nfcDepartureSchema = z.object({
  nfcTagUid: z.string().trim().min(2).max(120),
  receivingPoint: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(500).optional(),
});

const paperTicketBulkCreateSchema = z.object({
  serialNumbers: z.array(z.string().trim().min(2).max(80)).min(1).max(1000),
});

const paperTicketListQuerySchema = z.object({
  status: z.enum(Object.values(PAPER_TICKET_STATUS)).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const paperTicketVoidSchema = z.object({
  reason: z.string().trim().min(1).max(300),
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

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizePaperTicketSerial(serialNumber) {
  return String(serialNumber || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeNfcTagUid(tagUid) {
  return String(tagUid || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

async function reservePaperTicketSerial({ branchId, serialNumber, ticketId, actorId }) {
  const normalizedSerial = normalizePaperTicketSerial(serialNumber);
  if (!normalizedSerial) {
    throw badRequest("paperTicketSerial is required");
  }

  const existing = await PaperTicket.findOne({ branch: branchId, serialNumber: normalizedSerial });
  if (existing) {
    if (existing.status === PAPER_TICKET_STATUS.VOIDED) {
      throw conflict("This paper ticket serial is voided and cannot be used");
    }

    if (existing.status === PAPER_TICKET_STATUS.USED) {
      throw conflict("This paper ticket serial is already linked to a ticket", {
        serialNumber: normalizedSerial,
        ticketId: existing.ticket ? String(existing.ticket) : null,
      });
    }

    existing.status = PAPER_TICKET_STATUS.USED;
    existing.ticket = ticketId;
    existing.usedBy = actorId || null;
    existing.usedAt = new Date();
    await existing.save();
    return existing;
  }

  throw notFound("This paper ticket serial is not registered for this branch");
}

async function reserveNfcTag({ branchId, tagUid, ticketId }) {
  const normalizedTagUid = normalizeNfcTagUid(tagUid);
  if (!normalizedTagUid) {
    throw badRequest("nfcTagUid is required");
  }

  const tag = await NfcTag.findOne({ branch: branchId, tagUid: normalizedTagUid });
  if (!tag) {
    throw notFound("NFC tag is not registered for this branch");
  }

  if ([NFC_TAG_STATUS.LOST, NFC_TAG_STATUS.INACTIVE, NFC_TAG_STATUS.BLOCKED].includes(tag.status)) {
    throw conflict(`NFC tag cannot be used while status is ${tag.status}`);
  }

  if (tag.status === NFC_TAG_STATUS.IN_USE) {
    throw conflict("NFC tag is already linked to an active ticket", {
      nfcTagUid: normalizedTagUid,
      ticketId: tag.ticket ? String(tag.ticket) : null,
    });
  }

  tag.status = NFC_TAG_STATUS.IN_USE;
  tag.ticket = ticketId;
  tag.usedAt = new Date();
  tag.lastUsedAt = tag.usedAt;
  tag.releasedAt = null;
  tag.statusReason = "";
  await tag.save();
  return tag;
}

function getOwnerPhoneCandidates(phone) {
  const raw = String(phone || "").trim();
  const normalized = normalizePhone(raw);
  return [...new Set(
    [raw, normalized, normalized ? `+${normalized}` : ""]
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
}

function buildOwnerMatchFilter(user) {
  const clauses = [];
  if (user?.id && isValidObjectId(user.id)) {
    clauses.push({ ownerUser: user.id });
  }

  const phoneCandidates = getOwnerPhoneCandidates(user?.phone);
  if (phoneCandidates.length) {
    clauses.push({ ownerPhone: { $in: phoneCandidates } });
  }

  if (!clauses.length) {
    return null;
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function isTicketOwnedByUser(ticket, user) {
  if (!ticket || !user) {
    return false;
  }

  if (ticket.ownerUser && String(ticket.ownerUser) === String(user.id)) {
    return true;
  }

  const ownerPhone = normalizePhone(ticket.ownerPhone);
  const userPhones = getOwnerPhoneCandidates(user.phone).map((phone) => normalizePhone(phone));
  return Boolean(ownerPhone && userPhones.includes(ownerPhone));
}

function matchesTicketSearch(ticket, queryText) {
  if (!queryText) {
    return true;
  }

  const ticketNumber = String(ticket.ticketNumber || "").toLowerCase();
  const valetCode = String(ticket.valetCode || "").toLowerCase();
  const plate = String(ticket.vehicle?.plate || "").toLowerCase();
  return (
    ticketNumber.includes(queryText)
    || valetCode.includes(queryText)
    || plate.includes(queryText)
  );
}

function buildTicketSummary(ticket) {
  const keyControl = buildKeyControlMeta(ticket);
  const activeDriver = ticket.deliveryDriver || ticket.assignedDriver || null;
  const compactDriver = activeDriver
    ? {
      id: String(activeDriver._id || activeDriver),
      fullName: activeDriver.fullName || "",
      phone: activeDriver.phone || "",
      role: activeDriver.role || "",
    }
    : null;
  const compactCreatedBy = ticket.createdBy
    ? {
      id: String(ticket.createdBy._id || ticket.createdBy),
      fullName: ticket.createdBy.fullName || "",
      role: ticket.createdBy.role || "",
    }
    : null;
  const compactPaymentRequirement = buildPaymentRequirement(ticket);
  const compactKeyControl = {
    keyStatus: keyControl.keyStatus,
    keyReleaseStatus: keyControl.keyReleaseStatus,
    isDelayed: keyControl.isDelayed,
    delaySeconds: keyControl.delaySeconds,
  };
  const retrieval = ticket.retrieval?.requestedAt
    ? {
      requestedAt: ticket.retrieval.requestedAt,
      requestedByRole: ticket.retrieval.requestedByRole || "",
      assignedAt: ticket.retrieval.assignedAt || null,
      arrivedAt: ticket.retrieval.arrivedAt || null,
      deliveredAt: ticket.retrieval.deliveredAt || null,
    }
    : null;

  return {
    id: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    valetCode: ticket.valetCode,
    status: ticket.status,
    serviceType: ticket.serviceType || "",
    entryMethod: ticket.entryMethod || "",
    ownerChannel: ticket.ownerType || "",
    owner: {
      name: ticket.ownerName || "",
      phone: ticket.ownerPhone || "",
    },
    branch: ticket.branch,
    vehicle: ticket.vehicle
      ? {
        id: String(ticket.vehicle._id || ticket.vehicle),
        plate: ticket.vehicle.plate || "",
        make: ticket.vehicle.make || "",
        model: ticket.vehicle.model || "",
        color: ticket.vehicle.color || "",
        photo: ticket.vehicle.photo || "",
      }
      : null,
    keyTag: ticket.keyTag || "",
    paperTicketSerial: ticket.paperTicketSerial || "",
    nfcTagUid: ticket.nfcTagUid || "",
    garage: ticket.garage || "",
    slot: ticket.slot || "",
    receivingPoint: ticket.receivingPoint || "",
    services: ticket.services || [],
    payment: {
      amount: ticket.payment?.amount ?? 0,
      currency: ticket.payment?.currency || "QAR",
      status: ticket.payment?.status || "",
      method: ticket.payment?.method || "",
    },
    paymentRequirement: compactPaymentRequirement,
    createdBy: compactCreatedBy,
    assignedDriver: compactDriver,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    parkedAt: ticket.parkedAt || null,
    keyReceivedAt: ticket.keyReceivedAt || null,
    keyReleasedAt: ticket.keyReleasedAt || null,
    keyControl: compactKeyControl,
    retrieval,
  };
}

async function buildTicketIssueResponse(ticket) {
  const assignedDriver = ticket.assignedDriver
    ? {
      id: String(ticket.assignedDriver._id || ticket.assignedDriver),
      fullName: ticket.assignedDriver.fullName || "",
      phone: ticket.assignedDriver.phone || "",
      role: ticket.assignedDriver.role || "",
    }
    : null;

  const response = {
    ticket: {
      id: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      valetCode: ticket.valetCode,
      status: ticket.status,
      entryMethod: ticket.entryMethod || "",
      serviceType: ticket.serviceType || "",
      paymentCondition: ticket.paymentCondition || "",
      services: ticket.services || [],
      vehicle: ticket.vehicle
        ? {
          id: String(ticket.vehicle._id || ticket.vehicle),
          plate: ticket.vehicle.plate || "",
          make: ticket.vehicle.make || "",
          model: ticket.vehicle.model || "",
          color: ticket.vehicle.color || "",
          photo: ticket.vehicle.photo || "",
        }
        : null,
      keyTag: ticket.keyTag || "",
      paperTicketSerial: ticket.paperTicketSerial || "",
      nfcTagUid: ticket.nfcTagUid || "",
      garage: ticket.garage || "",
      slot: ticket.slot || "",
      receivingPoint: ticket.receivingPoint || "",
      assignedDriver,
      payment: {
        amount: ticket.payment?.amount ?? 0,
        currency: ticket.payment?.currency || "QAR",
        status: ticket.payment?.status || PAYMENT_STATUS.UNPAID,
        method: ticket.payment?.method || "",
      },
      createdAt: ticket.createdAt,
    },
  };

  const qr = buildTicketIssueQrPayload(ticket);
  if (qr) {
    qr.imageDataUrl = await QRCode.toDataURL(qr.payload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
    });
    response.qr = qr;
  }

  return response;
}

async function getActorTicketIds(userId, dateFilter = null) {
  const eventFilter = { actor: userId };
  if (dateFilter) {
    eventFilter.createdAt = dateFilter;
  }

  return TicketEvent.distinct("ticket", eventFilter);
}

function resolveParkedAt(ticket) {
  if (ticket?.parkedAt) {
    return new Date(ticket.parkedAt);
  }
  if (ticket?.status === TICKET_STATUS.PARKED_IN && ticket?.updatedAt) {
    return new Date(ticket.updatedAt);
  }
  return null;
}

function buildKeyControlMeta(ticket) {
  const parkedAt = resolveParkedAt(ticket);
  const keyReceivedAt = ticket?.keyReceivedAt ? new Date(ticket.keyReceivedAt) : null;
  const keyReleasedAt = ticket?.keyReleasedAt ? new Date(ticket.keyReleasedAt) : null;
  const slaSeconds = Number.isFinite(KEY_HANDOVER_SLA_SECONDS) && KEY_HANDOVER_SLA_SECONDS > 0
    ? KEY_HANDOVER_SLA_SECONDS
    : 90;

  const dueAt = parkedAt ? new Date(parkedAt.getTime() + slaSeconds * 1000) : null;
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
  const isDeliveryActive = ACTIVE_DELIVERY_STATUSES.includes(ticket?.status);
  const hasDeliveryDriver = Boolean(ticket?.deliveryDriver || (
    ticket?.assignedDriver && DELIVERY_ASSIGNED_STATUSES.includes(ticket?.status)
  ));
  const keyReleaseStatus = keyReleasedAt
    ? "KEY_RELEASED"
    : isDeliveryActive && hasDeliveryDriver
      ? "KEY_RELEASE_PENDING"
      : "NOT_APPLICABLE";

  return {
    keyStatus,
    keyReleaseStatus,
    parkedAt,
    keyReceivedAt,
    keyReceivedBy: ticket?.keyReceivedBy ? String(ticket.keyReceivedBy) : null,
    keyReleasedAt,
    keyReleasedBy: ticket?.keyReleasedBy ? String(ticket.keyReleasedBy) : null,
    keyReleasedTo: ticket?.keyReleasedTo ? String(ticket.keyReleasedTo) : null,
    handoverSlaSeconds: slaSeconds,
    handoverSlaMinutes: Math.ceil(slaSeconds / 60),
    handoverDueAt: dueAt,
    isDelayed,
    delaySeconds,
  };
}

const PARKING_ASSIGNABLE_STATUSES = [
  TICKET_STATUS.READY_TO_BE_PARKED,
];

const PARKING_ASSIGNED_STATUSES = [
  TICKET_STATUS.READY_TO_BE_PARKED,
];

const PARKED_STATUSES = [
  TICKET_STATUS.PARKED_IN,
];

const RETRIEVAL_REQUESTED_STATUSES = [
  TICKET_STATUS.REQUESTED_FOR_DELIVERY,
];

const DELIVERY_ASSIGNED_STATUSES = [
  TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
];

const ACTIVE_DELIVERY_STATUSES = [
  ...RETRIEVAL_REQUESTED_STATUSES,
  ...DELIVERY_ASSIGNED_STATUSES,
  TICKET_STATUS.ON_THE_WAY,
  TICKET_STATUS.ARRIVED_FOR_DELIVERY,
];

const DRIVER_BUSY_STATUSES = [
  TICKET_STATUS.READY_TO_BE_PARKED,
  TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
  TICKET_STATUS.ON_THE_WAY,
  TICKET_STATUS.ARRIVED_FOR_DELIVERY,
];

const PAYMENT_RESOLVED_STATUSES = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PREPAID,
  PAYMENT_STATUS.CAMPAIGN,
  PAYMENT_STATUS.MEMBERSHIP,
  PAYMENT_STATUS.FREE_OF_CHARGE,
];

function isTicketPaymentResolved(ticket) {
  return PAYMENT_RESOLVED_STATUSES.includes(ticket?.payment?.status);
}

function buildPaymentRequirement(ticket, stage = "GENERAL") {
  const paymentStatus = ticket?.payment?.status || PAYMENT_STATUS.UNPAID;
  const paymentCondition = ticket?.paymentCondition || PAYMENT_CONDITIONS.PAY_LATER;
  const isResolved = isTicketPaymentResolved(ticket);
  const isPayLaterDue = paymentCondition === PAYMENT_CONDITIONS.PAY_LATER && !isResolved;

  let message = "";
  if (isPayLaterDue && stage === "RETRIEVAL_REQUEST") {
    message = "Payment is due now. Show payment options before delivery continues.";
  } else if (isPayLaterDue && stage === "DELIVERY") {
    message = "Collect payment before marking this ticket complete.";
  } else if (!isResolved && stage === "COMPLETE") {
    message = "Ticket cannot be completed until payment is resolved.";
  }

  return {
    paymentRequired: isPayLaterDue,
    paymentCondition,
    paymentStatus,
    amount: ticket?.payment?.amount ?? 0,
    currency: ticket?.payment?.currency || "QAR",
    paymentLink: buildPaymentLink(ticket),
    canComplete: isResolved,
    message,
  };
}

function resolveDriverForStatus(ticket, status) {
  if ([
    TICKET_STATUS.ON_THE_WAY,
    TICKET_STATUS.ARRIVED_FOR_DELIVERY,
    TICKET_STATUS.DELIVERED,
  ].includes(status)) {
    return ticket.deliveryDriver || ticket.assignedDriver;
  }

  return ticket.assignedDriver;
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

function getPublicRetrievalSecret() {
  const secret = process.env.PUBLIC_RETRIEVAL_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("PUBLIC_RETRIEVAL_TOKEN_SECRET or JWT_SECRET is required");
  }

  return secret;
}

function buildPublicRetrievalToken(ticket) {
  return jwt.sign(
    {
      purpose: "SMS_RETRIEVAL",
      ticketId: String(ticket._id),
      valetCode: ticket.valetCode,
      ticketNumber: ticket.ticketNumber,
    },
    getPublicRetrievalSecret(),
    {
      issuer: "mr-valet-api",
      audience: "mr-valet-public-retrieval",
    },
  );
}

function verifyPublicRetrievalToken(token) {
  try {
    const payload = jwt.verify(token, getPublicRetrievalSecret(), {
      issuer: "mr-valet-api",
      audience: "mr-valet-public-retrieval",
    });

    if (payload?.purpose !== "SMS_RETRIEVAL" || !payload?.ticketId) {
      throw badRequest("Invalid retrieval token");
    }

    return payload;
  } catch (error) {
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError" || error?.name === "NotBeforeError") {
      throw badRequest("Invalid or expired retrieval link");
    }
    throw error;
  }
}

function buildPublicRetrievalLink(ticket) {
  const baseUrl = process.env.PUBLIC_RETRIEVAL_BASE_URL || process.env.APP_BASE_URL || "";
  if (!baseUrl) {
    return "";
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}token=${encodeURIComponent(buildPublicRetrievalToken(ticket))}`;
}

function buildOwnerAppScanPayload(ticket) {
  return JSON.stringify({
    type: "OWNER_TICKET_LINK",
    ticketId: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    valetCode: ticket.valetCode,
  });
}

function buildTicketIssueQrPayload(ticket) {
  if (ticket.entryMethod === ENTRY_METHODS.QR_CODE) {
    return {
      type: "OWNER_APP",
      payload: buildOwnerAppScanPayload(ticket),
    };
  }

  if (ticket.entryMethod === ENTRY_METHODS.WHATSAPP) {
    const { command, link } = buildWhatsAppPrefillLink(ticket.valetCode);
    return {
      type: "WHATSAPP",
      payload: link,
      command,
    };
  }

  return null;
}

function buildOwnerAppIntentPayload(reference) {
  return JSON.stringify({
    type: "OWNER_APP_TICKET_LINK",
    reference,
  });
}

function getIssueIntentExpiry() {
  const ttlMinutes = Number(process.env.TICKET_ISSUE_INTENT_TTL_MINUTES || 30);
  const ttlMs = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 30 * 60 * 1000;
  return new Date(Date.now() + ttlMs);
}

async function generateIssueIntentReference(entryMethod, branchCode = "MV") {
  const prefix = entryMethod === ENTRY_METHODS.WHATSAPP ? "WI" : "QI";
  const normalizedBranchCode = String(branchCode || "MV")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase() || "MV";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = crypto.randomInt(100000, 999999);
    const reference = `${prefix}-${normalizedBranchCode}-${suffix}`;
    // Unique index also protects us; this avoids common collisions before insert.
    // eslint-disable-next-line no-await-in-loop
    const exists = await TicketIssueIntent.exists({ reference });
    if (!exists) {
      return reference;
    }
  }

  return `${prefix}-${normalizedBranchCode}-${Date.now().toString(36).toUpperCase()}`;
}

async function validateIssueIntentPayload({ data, actorUser }) {
  if (!actorUser?.branchId || !isValidObjectId(actorUser.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const branch = await Branch.findOne({ _id: actorUser.branchId, isActive: true }).lean();
  if (!branch) {
    throw badRequest("Your branch is invalid or inactive");
  }

  const supportedEntryMethods = Array.isArray(branch.supportedEntryMethods) && branch.supportedEntryMethods.length
    ? branch.supportedEntryMethods
    : ENTRY_METHOD_VALUES;
  if (!supportedEntryMethods.includes(data.entryMethod)) {
    throw badRequest(`Entry method ${data.entryMethod} is not enabled for this branch`, {
      allowedEntryMethods: supportedEntryMethods,
    });
  }

  const serviceType = data.serviceType || branch.serviceTypes?.find((item) => item.isActive)?.code || "NORMAL_VALET";
  const activeServiceCodes = Array.isArray(branch.serviceTypes)
    ? branch.serviceTypes.filter((item) => item.isActive).map((item) => item.code)
    : [];
  if (activeServiceCodes.length && !activeServiceCodes.includes(serviceType)) {
    throw badRequest(`Service type ${serviceType} is not enabled for this branch`, {
      allowedServiceTypes: activeServiceCodes,
    });
  }

  const paymentCondition = data.paymentCondition || PAYMENT_CONDITIONS.PAY_LATER;
  const allowedPaymentConditions = Array.isArray(branch.allowedPaymentConditions) && branch.allowedPaymentConditions.length
    ? branch.allowedPaymentConditions
    : PAYMENT_CONDITION_VALUES;
  if (!allowedPaymentConditions.includes(paymentCondition)) {
    throw badRequest(`Payment condition ${paymentCondition} is not enabled for this branch`, {
      allowedPaymentConditions,
    });
  }

  if (data.driverId) {
    if (!isValidObjectId(data.driverId)) {
      throw badRequest("driverId must be a valid ObjectId");
    }

    const driver = await User.findById(data.driverId).select("_id role isActive branch").lean();
    if (
      !driver
      || driver.role !== ROLES.DRIVER
      || !driver.isActive
      || String(driver.branch) !== String(branch._id)
    ) {
      throw badRequest("Selected user is not an active driver in this branch");
    }
  }

  return { branch, serviceType, paymentCondition };
}

function buildTicketSmsBody({
  ticket,
  vehicle,
  businessPhone,
  paymentLink,
  retrievalLink,
}) {
  const businessContact = businessPhone ? `+${businessPhone}` : "";
  const lines = [
    "Mr Valet Ticket",
    `Ticket No: ${ticket.ticketNumber}`,
    `Valet Code: ${ticket.valetCode}`,
    `Plate: ${vehicle.plate || "N/A"}`,
    `Vehicle: ${[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "N/A"}`,
    `Color: ${vehicle.color || "N/A"}`,
  ];

  if (ticket.garage || ticket.slot) {
    lines.push(`Parking: ${[ticket.garage, ticket.slot].filter(Boolean).join(" - ")}`);
  }
  if (ticket.keyTag) {
    lines.push(`Key Tag: ${ticket.keyTag}`);
  }
  if (businessContact) {
    lines.push(`Support: ${businessContact}`);
  }
  if (paymentLink) {
    lines.push("");
    lines.push("Payment Link:");
    lines.push(paymentLink);
  }
  if (retrievalLink) {
    lines.push("");
    lines.push("To retrieve your car, please click this link:");
    lines.push(retrievalLink);
  }
  lines.push("");
  lines.push("Please keep this SMS until your car is delivered.");

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

async function markRetrievalRequestedOnTicket({
  ticket,
  requestedById = null,
  requestedByRole = "",
  receivingPoint = "",
  notes,
}) {
  if (![...PARKED_STATUSES, TICKET_STATUS.PARKED_IN].includes(ticket.status)) {
    throw conflict(`Cannot request retrieval while ticket is in ${ticket.status}`);
  }

  if (ACTIVE_DELIVERY_STATUSES.includes(ticket.status)) {
    throw conflict("A retrieval request is already active for this ticket");
  }

  ticket.status = TICKET_STATUS.REQUESTED_FOR_DELIVERY;
  ticket.deliveryDriver = null;
  ticket.assignedDriver = null;
  ticket.keyReleasedAt = null;
  ticket.keyReleasedBy = null;
  ticket.keyReleasedTo = null;
  ticket.receivingPoint = receivingPoint || ticket.receivingPoint || "";
  if (notes !== undefined) {
    ticket.notes = notes;
  }
  ticket.retrieval = {
    ...(ticket.retrieval?.toObject ? ticket.retrieval.toObject() : ticket.retrieval || {}),
    requestedAt: new Date(),
    requestedBy: requestedById && isValidObjectId(requestedById) ? requestedById : null,
    requestedByRole: requestedByRole || "",
    assignedAt: null,
    assignedBy: null,
    keyReleasedAt: null,
    keyReleasedBy: null,
    keyReleasedTo: null,
    arrivedAt: null,
    deliveredAt: null,
  };

  await ticket.save();

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: requestedById || null,
    note: "Retrieval requested",
    meta: {
      receivingPoint: ticket.receivingPoint,
      requestedByRole,
    },
  });

  return ticket;
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
        id: req.user?.id ? String(req.user.id) : null,
        role: req.user?.role || "PUBLIC_SMS",
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
// Covers owner-visible active ticket status updates.

const STATUS_MESSAGES = {
  [TICKET_STATUS.PARKED_IN]:             "Your car has been parked safely.",
  [TICKET_STATUS.REQUESTED_FOR_DELIVERY]: "Your retrieval request is being processed.",
  [TICKET_STATUS.ASSIGNED_FOR_DELIVERY]: "A driver has been assigned to bring your car.",
  [TICKET_STATUS.ON_THE_WAY]:           "Your car is on the way to the receiving point.",
  [TICKET_STATUS.ARRIVED_FOR_DELIVERY]:  "Your car has arrived at the receiving point.",
  [TICKET_STATUS.DELIVERED]:            "Your valet ticket is completed. Thank you for using Mr Valet.",
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
    const paymentRequirement = buildPaymentRequirement(
      ticket,
      ticket.status === TICKET_STATUS.REQUESTED_FOR_DELIVERY
        ? "RETRIEVAL_REQUEST"
        : ticket.status === TICKET_STATUS.DELIVERED
          ? "DELIVERY"
          : "GENERAL",
    );

    io.to(`user_${ownerUserId}`).emit("ticket_status_update", {
      ticketId:       String(ticket._id),
      ticketNumber:   ticket.ticketNumber,
      status:         ticket.status,
      message,
      receivingPoint: ticket.receivingPoint || null,
      paymentRequirement,
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

  const { driverId, force } = parsed.data;
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

  if (driver.attendanceStatus !== "CHECKED_IN" && !force) {
    throw conflict("Driver is not available for assignment", {
      reason: driver.attendanceStatus === "ON_BREAK"
        ? "Driver is currently on break"
        : "Driver is not checked in",
      attendanceStatus: driver.attendanceStatus,
      guidance: "Select another available driver or resend with force=true if supervisor approves.",
    });
  }

  const previousStatus = ticket.status;
  const isDeliveryAssignment = RETRIEVAL_REQUESTED_STATUSES.includes(ticket.status);
  const previousDriverId = isDeliveryAssignment
    ? (ticket.deliveryDriver ? String(ticket.deliveryDriver) : null)
    : (ticket.assignedDriver ? String(ticket.assignedDriver) : null);
  const canAssignParkingDriver = [
    ...PARKING_ASSIGNABLE_STATUSES,
    ...PARKING_ASSIGNED_STATUSES,
    ...PARKED_STATUSES,
  ].includes(ticket.status);
  const canAssignDeliveryDriver = [
    ...RETRIEVAL_REQUESTED_STATUSES,
    ...DELIVERY_ASSIGNED_STATUSES,
    TICKET_STATUS.ON_THE_WAY,
  ].includes(ticket.status);

  if (!canAssignParkingDriver && !canAssignDeliveryDriver) {
    throw conflict(`Cannot assign driver while ticket is in ${ticket.status}`);
  }

  if (
    isDeliveryAssignment
    && ![ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR].includes(req.user.role)
  ) {
    throw forbidden("Only receptionist, key controller, or supervisor can assign driver after retrieval request");
  }
  if (isDeliveryAssignment && ticket.keyReleasedAt) {
    throw conflict("Cannot change delivery driver after key has been released");
  }

  const busyTicket = await Ticket.findOne({
    _id: { $ne: ticket._id },
    branch: ticket.branch,
    status: { $in: DRIVER_BUSY_STATUSES },
    $or: [
      { assignedDriver: driverId },
      { deliveryDriver: driverId },
    ],
  })
    .select("ticketNumber status assignedDriver deliveryDriver")
    .lean();

  if (busyTicket && !force) {
    throw conflict("Driver is already assigned to an active ticket", {
      currentTicketId: String(busyTicket._id),
      currentTicketNumber: busyTicket.ticketNumber,
      currentTicketStatus: busyTicket.status,
      guidance: "Select a free driver or resend with force=true if supervisor approves.",
    });
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

  if (isDeliveryAssignment) {
    ticket.deliveryDriver = driverId;
    ticket.status = TICKET_STATUS.ASSIGNED_FOR_DELIVERY;
    ticket.retrieval = {
      ...(ticket.retrieval?.toObject ? ticket.retrieval.toObject() : ticket.retrieval || {}),
      assignedAt: new Date(),
      assignedBy: req.user.id,
    };
  } else {
    ticket.assignedDriver = driverId;
    ticket.parkingDriver = driverId;
    if (PARKING_ASSIGNABLE_STATUSES.includes(ticket.status)) {
      ticket.status = TICKET_STATUS.READY_TO_BE_PARKED;
    }
  }
  if (parsed.data.slot !== undefined) ticket.slot = parsed.data.slot;
  if (parsed.data.garage !== undefined) ticket.garage = parsed.data.garage;
  if (parsed.data.keyTag !== undefined) ticket.keyTag = parsed.data.keyTag;
  if (parsed.data.keyNote !== undefined) ticket.keyNote = parsed.data.keyNote;
  if (parsed.data.receivingPoint !== undefined) ticket.receivingPoint = parsed.data.receivingPoint;
  if (parsed.data.notes !== undefined) ticket.notes = parsed.data.notes;
  await ticket.save();
  await User.updateOne({ _id: driverId }, { $set: { lastAssignedAt: new Date() } });

  await logTicketEvent({
    ticketId,
    status: ticket.status,
    actor: req.user?.id,
    note: previousDriverId
      ? (isDeliveryAssignment ? "Delivery driver reassigned" : "Parking driver reassigned")
      : (isDeliveryAssignment ? "Delivery driver assigned" : "Parking driver assigned"),
    meta: {
      previousStatus,
      previousDriverId,
      newDriverId: String(driverId),
      assignmentType: isDeliveryAssignment ? "DELIVERY" : "PARKING",
      vehicleUpdated: Boolean(updatedVehicle),
    },
  });

  void emitTicketAssignedToDriver({
    req,
    ticket,
    driverId,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      null,
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
  if (parsed.data.ownerName !== undefined) {
    ticket.ownerName = parsed.data.ownerName;
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
      retrievalLink: buildPublicRetrievalLink(ticket),
    });

    console.log("[SMS Ticket] Sending ticket SMS", {
      to: parsed.data.ownerPhone,
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      entryMethod: ticket.entryMethod,
      body: smsBody,
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
  const transitionAllowed = canTransitionStatus(ticket.status, nextStatus)
    || (PARKING_ASSIGNED_STATUSES.includes(ticket.status) && PARKED_STATUSES.includes(nextStatus))
    || (PARKED_STATUSES.includes(ticket.status) && RETRIEVAL_REQUESTED_STATUSES.includes(nextStatus))
    || (DELIVERY_ASSIGNED_STATUSES.includes(ticket.status) && nextStatus === TICKET_STATUS.ON_THE_WAY)
    || (ticket.status === TICKET_STATUS.ON_THE_WAY && [
      TICKET_STATUS.ARRIVED_FOR_DELIVERY,
      TICKET_STATUS.DELIVERED,
    ].includes(nextStatus));

  if (!transitionAllowed) {
    throw conflict(`Invalid status transition: ${ticket.status} -> ${nextStatus}`);
  }

  if (nextStatus === TICKET_STATUS.DELIVERED && !isTicketPaymentResolved(ticket)) {
    throw conflict("Ticket cannot be delivered/completed until payment is resolved", {
      currentPaymentStatus: ticket.payment?.status || PAYMENT_STATUS.UNPAID,
      allowedPaymentStatuses: PAYMENT_RESOLVED_STATUSES,
    });
  }

  if (
    RETRIEVAL_REQUESTED_STATUSES.includes(nextStatus)
    && ![ROLES.RECEPTIONIST, ROLES.KEY_CONTROLLER, ROLES.SUPERVISOR].includes(req.user.role)
  ) {
    throw forbidden("Only receptionist, key controller, or supervisor can request retrieval");
  }

  if ([TICKET_STATUS.ON_THE_WAY, TICKET_STATUS.ARRIVED_FOR_DELIVERY, TICKET_STATUS.DELIVERED].includes(nextStatus)) {
    if (req.user.role !== ROLES.DRIVER) {
      throw forbidden(`Only assigned driver can update status to ${nextStatus}`);
    }

    const driverForStatus = resolveDriverForStatus(ticket, nextStatus);
    if (!driverForStatus || String(driverForStatus) !== String(req.user.id)) {
      throw forbidden("Only assigned driver can update this ticket status");
    }
  }

  if (RETRIEVAL_REQUESTED_STATUSES.includes(nextStatus)) {
    await markRetrievalRequestedOnTicket({
      ticket,
      requestedById: req.user.id,
      requestedByRole: req.user.role,
      receivingPoint: parsed.data.receivingPoint ?? ticket.receivingPoint ?? "",
      notes: parsed.data.notes ?? ticket.notes ?? "",
    });
    void emitRetrievalRequestedToOps({
      req,
      ticket,
    });
    void emitTicketStatusToOwner({ req, ticket });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("vehicle")
      .populate("assignedDriver", "fullName phone role")
      .populate("deliveryDriver", "fullName phone role")
      .lean();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          ticket: populatedTicket || ticket,
          paymentRequirement: buildPaymentRequirement(ticket, "RETRIEVAL_REQUEST"),
        },
        "Retrieval requested successfully",
      ),
    );
  }

  ticket.status = nextStatus;
  if (PARKED_STATUSES.includes(nextStatus) && !ticket.parkedAt) {
    ticket.parkedAt = new Date();
  }
  if (nextStatus === TICKET_STATUS.READY_TO_BE_PARKED) {
    ticket.parkedAt = null;
    ticket.keyReceivedAt = null;
    ticket.keyReceivedBy = null;
    ticket.keyReleasedAt = null;
    ticket.keyReleasedBy = null;
    ticket.keyReleasedTo = null;
  }
  if (nextStatus === TICKET_STATUS.ARRIVED_FOR_DELIVERY) {
    ticket.retrieval = {
      ...(ticket.retrieval?.toObject ? ticket.retrieval.toObject() : ticket.retrieval || {}),
      arrivedAt: new Date(),
    };
  }
  if (nextStatus === TICKET_STATUS.DELIVERED) {
    ticket.retrieval = {
      ...(ticket.retrieval?.toObject ? ticket.retrieval.toObject() : ticket.retrieval || {}),
      deliveredAt: new Date(),
    };
    if (ticket.entryMethod === ENTRY_METHODS.SERIALIZED_PAPER && ticket.paperTicketSerial) {
      await PaperTicket.updateOne(
        {
          branch: ticket.branch,
          serialNumber: ticket.paperTicketSerial,
          ticket: ticket._id,
        },
        {
          $set: {
            completedAt: ticket.retrieval.deliveredAt,
          },
        },
      );
    }
    if (ticket.entryMethod === ENTRY_METHODS.NFC && ticket.nfcTagUid) {
      await NfcTag.updateOne(
        {
          branch: ticket.branch,
          tagUid: ticket.nfcTagUid,
          ticket: ticket._id,
        },
        {
          $set: {
            status: NFC_TAG_STATUS.AVAILABLE,
            ticket: null,
            usedAt: null,
            releasedAt: ticket.retrieval.deliveredAt,
            statusReason: "",
          },
        },
      );
    }
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

  // ── Notify car owner in real-time for key status changes ──────────────────
  const ownerNotifyStatuses = [
    TICKET_STATUS.PARKED_IN,
    TICKET_STATUS.ON_THE_WAY,
    TICKET_STATUS.ARRIVED_FOR_DELIVERY,
    TICKET_STATUS.DELIVERED,
    TICKET_STATUS.REQUESTED_FOR_DELIVERY,
    TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
  ];
  if (ownerNotifyStatuses.includes(nextStatus)) {
    void emitTicketStatusToOwner({ req, ticket });
  }

  const responseData = {
    message: "Ticket status updated successfully",
    ticket,
    paymentRequirement: buildPaymentRequirement(
      ticket,
      nextStatus === TICKET_STATUS.DELIVERED ? "DELIVERY" : "GENERAL",
    ),
  };

  return res.status(200).json(responseData);
}

export async function recordTicketPayment(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = recordTicketPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const data = parsed.data;
  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId });
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (ticket.status === TICKET_STATUS.DELIVERED) {
    throw conflict("Payment cannot be changed after ticket is delivered/completed");
  }

  if (
    data.status === PAYMENT_STATUS.FREE_OF_CHARGE
    && ![ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER].includes(req.user.role)
  ) {
    throw forbidden("Only supervisor or operations manager can mark a ticket as free of charge");
  }

  const amount = data.amount ?? ticket.payment?.amount ?? 0;
  const receiptLink = data.receiptLink ?? ticket.payment?.receiptLink ?? "";
  const terminalId = data.pos?.terminalId ?? data.terminalId ?? ticket.payment?.pos?.terminalId ?? "";
  const bankTransactionRef = data.pos?.bankTransactionRef
    ?? data.bankTransactionRef
    ?? ticket.payment?.pos?.bankTransactionRef
    ?? "";
  const providerReference = data.online?.paymentReference
    ?? data.providerReference
    ?? ticket.payment?.online?.paymentReference
    ?? "";

  ticket.payment = {
    ...(ticket.payment?.toObject ? ticket.payment.toObject() : ticket.payment || {}),
    amount,
    method: data.method,
    status: data.status,
    currency: data.currency,
    receiptLink,
    pos: {
      ...(ticket.payment?.pos?.toObject ? ticket.payment.pos.toObject() : ticket.payment?.pos || {}),
      terminalId,
      bankTransactionRef,
      confirmationStatus: data.pos?.confirmationStatus ?? ticket.payment?.pos?.confirmationStatus ?? "",
      confirmedAt: data.pos?.confirmedAt ?? ticket.payment?.pos?.confirmedAt ?? null,
    },
    online: {
      ...(ticket.payment?.online?.toObject ? ticket.payment.online.toObject() : ticket.payment?.online || {}),
      provider: data.online?.provider ?? ticket.payment?.online?.provider ?? "",
      paymentReference: providerReference,
      paidAt: data.online?.paidAt ?? ticket.payment?.online?.paidAt ?? null,
    },
  };

  await ticket.save();

  await Payment.create({
    ticket: ticket._id,
    amount,
    method: data.method,
    status: data.status,
    terminalId,
    bankTransactionRef,
    providerReference,
    receiptLink,
    processedBy: req.user.id,
  });

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: data.notes || "Payment updated",
    meta: {
      payment: {
        amount,
        method: data.method,
        status: data.status,
        currency: data.currency,
        receiptLink,
      },
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        canComplete: isTicketPaymentResolved(ticket),
        payment: ticket.payment,
      },
      "Ticket payment updated successfully",
    ),
  );
}

export async function updateTicketCheckout(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const parsed = updateTicketCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const data = parsed.data;
  const isOwner = req.user?.role === ROLES.OWNER;
  const isStaff = !isOwner;
  if (isStaff && (!req.user?.branchId || !isValidObjectId(req.user.branchId))) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const ticketFilter = isOwner
    ? { _id: ticketId }
    : { _id: ticketId, branch: req.user.branchId };
  const ticket = await Ticket.findOne(ticketFilter);
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (isOwner && !isTicketOwnedByUser(ticket, req.user)) {
    throw forbidden("You can update only your own linked ticket");
  }

  if (isOwner && data.payment) {
    throw forbidden("Owner payment must be processed through the online payment endpoint, not manual checkout update");
  }

  if (ticket.status === TICKET_STATUS.DELIVERED) {
    throw conflict("Checkout details cannot be changed after ticket is delivered/completed");
  }

  if (data.paymentCondition) {
    const branch = await Branch.findOne({ _id: ticket.branch, isActive: true })
      .select("allowedPaymentConditions")
      .lean();
    if (!branch) {
      throw badRequest("Your branch is invalid or inactive");
    }

    const allowedPaymentConditions = Array.isArray(branch.allowedPaymentConditions) && branch.allowedPaymentConditions.length
      ? branch.allowedPaymentConditions
      : PAYMENT_CONDITION_VALUES;
    if (!allowedPaymentConditions.includes(data.paymentCondition)) {
      throw badRequest(`Payment condition ${data.paymentCondition} is not enabled for this branch`, {
        allowedPaymentConditions,
      });
    }

    ticket.paymentCondition = data.paymentCondition;
  }

  if (data.services !== undefined) {
    ticket.services = data.services;
  }

  let paymentLog = null;
  if (data.payment) {
    const payment = data.payment;
    const amount = payment.amount;
    const receiptLink = payment.receiptLink || ticket.payment?.receiptLink || "";
    const terminalId = payment.terminalId || ticket.payment?.pos?.terminalId || "";
    const bankTransactionRef = payment.bankTransactionRef || ticket.payment?.pos?.bankTransactionRef || "";

    ticket.payment = {
      ...(ticket.payment?.toObject ? ticket.payment.toObject() : ticket.payment || {}),
      amount,
      method: payment.method,
      status: PAYMENT_STATUS.PAID,
      currency: payment.currency || "QAR",
      receiptLink,
      pos: {
        ...(ticket.payment?.pos?.toObject ? ticket.payment.pos.toObject() : ticket.payment?.pos || {}),
        terminalId,
        bankTransactionRef,
        confirmationStatus: payment.method === "CASH" ? "CASH_RECEIVED" : "MANUALLY_CONFIRMED",
        confirmedAt: new Date(),
      },
      online: {
        ...(ticket.payment?.online?.toObject ? ticket.payment.online.toObject() : ticket.payment?.online || {}),
      },
    };

    paymentLog = {
      amount,
      method: payment.method,
      status: PAYMENT_STATUS.PAID,
      currency: payment.currency || "QAR",
      receiptLink,
      terminalId,
      bankTransactionRef,
    };
  }

  await ticket.save();

  if (paymentLog) {
    await Payment.create({
      ticket: ticket._id,
      amount: paymentLog.amount,
      method: paymentLog.method,
      status: paymentLog.status,
      terminalId: paymentLog.terminalId,
      bankTransactionRef: paymentLog.bankTransactionRef,
      receiptLink: paymentLog.receiptLink,
      processedBy: req.user.id,
    });
  }

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: data.notes || "Ticket checkout details updated",
    meta: {
      services: data.services,
      paymentCondition: data.paymentCondition,
      payment: paymentLog
        ? {
          amount: paymentLog.amount,
          method: paymentLog.method,
          status: paymentLog.status,
          currency: paymentLog.currency,
        }
        : undefined,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      null,
      "Ticket checkout details updated successfully",
    ),
  );
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

  await markRetrievalRequestedOnTicket({
    ticket,
    requestedById: req.user.id,
    requestedByRole: req.user.role,
    receivingPoint: parsed.data.receivingPoint,
    notes: parsed.data.notes ?? ticket.notes ?? "",
  });

  void emitRetrievalRequestedToOps({
    req,
    ticket,
  });
  void emitTicketStatusToOwner({ req, ticket });

  const populatedSourceTicket = await Ticket.findById(ticket._id)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .populate("deliveryDriver", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: populatedSourceTicket,
        paymentRequirement: buildPaymentRequirement(ticket, "RETRIEVAL_REQUEST"),
      },
      "Retrieval requested successfully",
    ),
  );
}

export async function getPublicRetrievalSummary(req, res) {
  const parsed = publicRetrievalSummaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const tokenPayload = verifyPublicRetrievalToken(parsed.data.token);
  if (!isValidObjectId(tokenPayload.ticketId)) {
    throw badRequest("Invalid retrieval token");
  }

  const ticket = await Ticket.findOne({
    _id: tokenPayload.ticketId,
    valetCode: tokenPayload.valetCode,
    status: { $ne: TICKET_STATUS.DELIVERED },
  })
    .populate("vehicle", "plate make model color photo")
    .populate("assignedDriver", "fullName phone role")
    .populate("deliveryDriver", "fullName phone role")
    .lean();

  if (!ticket) {
    throw notFound("Active ticket not found for this retrieval link");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: buildTicketSummary(ticket),
        paymentRequirement: buildPaymentRequirement(ticket, "RETRIEVAL_REQUEST"),
      },
      "Retrieval ticket loaded successfully",
    ),
  );
}

export async function requestPublicRetrieval(req, res) {
  const parsed = publicRetrievalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const tokenPayload = verifyPublicRetrievalToken(parsed.data.token);
  if (!isValidObjectId(tokenPayload.ticketId)) {
    throw badRequest("Invalid retrieval token");
  }

  const ticket = await Ticket.findOne({
    _id: tokenPayload.ticketId,
    valetCode: tokenPayload.valetCode,
    status: { $ne: TICKET_STATUS.DELIVERED },
  });

  if (!ticket) {
    throw notFound("Active ticket not found for this retrieval link");
  }

  await markRetrievalRequestedOnTicket({
    ticket,
    requestedById: null,
    requestedByRole: "PUBLIC_SMS",
    receivingPoint: parsed.data.receivingPoint,
    notes: parsed.data.notes ?? ticket.notes ?? "",
  });

  void emitRetrievalRequestedToOps({ req, ticket });
  void emitTicketStatusToOwner({ req, ticket });

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("vehicle", "plate make model color photo")
    .populate("assignedDriver", "fullName phone role")
    .populate("deliveryDriver", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: buildTicketSummary(populatedTicket || ticket),
        paymentRequirement: buildPaymentRequirement(populatedTicket || ticket, "RETRIEVAL_REQUEST"),
      },
      "Retrieval requested successfully",
    ),
  );
}

export async function scanSerializedPaperForDeparture(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = serializedPaperDepartureSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const serialNumber = normalizePaperTicketSerial(parsed.data.serialNumber);
  const ticket = await Ticket.findOne({
    branch: req.user.branchId,
    entryMethod: ENTRY_METHODS.SERIALIZED_PAPER,
    paperTicketSerial: serialNumber,
    status: { $ne: TICKET_STATUS.DELIVERED },
  });

  if (!ticket) {
    throw notFound("Active ticket not found for this serialized paper ticket");
  }

  await markRetrievalRequestedOnTicket({
    ticket,
    requestedById: req.user.id,
    requestedByRole: req.user.role,
    receivingPoint: parsed.data.receivingPoint,
    notes: parsed.data.notes ?? ticket.notes ?? "",
  });

  void emitRetrievalRequestedToOps({ req, ticket });
  void emitTicketStatusToOwner({ req, ticket });

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("vehicle", "plate make model color photo")
    .populate("deliveryDriver", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: buildTicketSummary(populatedTicket || ticket),
        paymentRequirement: buildPaymentRequirement(ticket, "RETRIEVAL_REQUEST"),
      },
      "Serialized paper ticket scanned. Retrieval requested successfully",
    ),
  );
}

export async function scanNfcForDeparture(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = nfcDepartureSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const nfcTagUid = normalizeNfcTagUid(parsed.data.nfcTagUid);
  const ticket = await Ticket.findOne({
    branch: req.user.branchId,
    entryMethod: ENTRY_METHODS.NFC,
    nfcTagUid,
    status: { $ne: TICKET_STATUS.DELIVERED },
  });

  if (!ticket) {
    throw notFound("Active ticket not found for this NFC tag");
  }

  await markRetrievalRequestedOnTicket({
    ticket,
    requestedById: req.user.id,
    requestedByRole: req.user.role,
    receivingPoint: parsed.data.receivingPoint,
    notes: parsed.data.notes ?? ticket.notes ?? "",
  });

  void emitRetrievalRequestedToOps({ req, ticket });
  void emitTicketStatusToOwner({ req, ticket });

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("vehicle", "plate make model color photo")
    .populate("deliveryDriver", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: buildTicketSummary(populatedTicket || ticket),
        paymentRequirement: buildPaymentRequirement(ticket, "RETRIEVAL_REQUEST"),
      },
      "NFC tag scanned. Retrieval requested successfully",
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
    .populate("vehicle", "plate make model color photo")
    .populate("assignedDriver", "fullName phone role")
    .populate("parkingDriver", "fullName phone role")
    .populate("deliveryDriver", "fullName phone role")
    .populate("keyReceivedBy", "fullName phone role")
    .populate("keyReleasedBy", "fullName phone role")
    .populate("keyReleasedTo", "fullName phone role")
    .populate("createdBy", "fullName phone role")
    .lean();

  return res.status(200).json({
    count: tickets.length,
    tickets: tickets.map(buildTicketSummary),
  });
}

export async function getTicketHistory(req, res) {
  const parsed = ticketHistoryQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const {
    q,
    status,
    paymentStatus,
    serviceType,
    branchId,
    employeeId,
    scope,
    dateFrom,
    dateTo,
    page,
    limit,
  } = parsed.data;

  const filter = {};
  const dateFilter = {};
  if (dateFrom) {
    dateFilter.$gte = new Date(dateFrom);
  }
  if (dateTo) {
    dateFilter.$lte = new Date(dateTo);
  }
  if (Object.keys(dateFilter).length) {
    filter.createdAt = dateFilter;
  }

  if (status) {
    filter.status = status;
  } else if (scope === "completed") {
    filter.status = { $in: OWNER_TERMINAL_STATUSES };
  } else if (scope === "active") {
    filter.status = { $nin: OWNER_TERMINAL_STATUSES };
  }

  if (paymentStatus) {
    filter["payment.status"] = paymentStatus;
  }
  if (serviceType) {
    filter.serviceType = serviceType;
  }

  const userRole = req.user.role;
  const userId = req.user.id;

  if (userRole === ROLES.OWNER) {
    const ownerFilter = buildOwnerMatchFilter(req.user);
    if (!ownerFilter) {
      throw forbidden("Owner phone or account identity is missing");
    }
    filter.$and = [...(filter.$and || []), ownerFilter];
  } else if (userRole === ROLES.OPERATIONS_MANAGER) {
    if (branchId) {
      if (!isValidObjectId(branchId)) {
        throw badRequest("branchId must be a valid ObjectId");
      }
      filter.branch = branchId;
    }
  } else {
    if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
      throw forbidden("User is not assigned to a valid branch");
    }
    filter.branch = req.user.branchId;
  }

  if (employeeId !== undefined) {
    if (![ROLES.SUPERVISOR, ROLES.OPERATIONS_MANAGER].includes(userRole)) {
      throw forbidden("Only supervisor or operations manager can filter history by employee");
    }
    if (!isValidObjectId(employeeId)) {
      throw badRequest("employeeId must be a valid ObjectId");
    }
  }

  const actorId = employeeId || userId;
  if (userRole === ROLES.RECEPTIONIST || employeeId) {
    const eventTicketIds = await getActorTicketIds(actorId, Object.keys(dateFilter).length ? dateFilter : null);
    filter.$or = [
      ...(filter.$or || []),
      { createdBy: actorId },
      { _id: { $in: eventTicketIds } },
    ];
  } else if (userRole === ROLES.DRIVER) {
    filter.$or = [
      { parkingDriver: userId },
      { deliveryDriver: userId },
      { assignedDriver: userId },
    ];
  } else if (userRole === ROLES.KEY_CONTROLLER) {
    const eventTicketIds = await getActorTicketIds(userId, Object.keys(dateFilter).length ? dateFilter : null);
    filter.$or = [
      { keyReceivedBy: userId },
      { keyReleasedBy: userId },
      { _id: { $in: eventTicketIds } },
    ];
  }

  const queryText = String(q || "").toLowerCase().trim();
  const fetchLimit = queryText ? Math.max(limit * page, 300) : limit;
  const skip = queryText ? 0 : (page - 1) * limit;

  const [total, tickets] = await Promise.all([
    queryText ? Promise.resolve(null) : Ticket.countDocuments(filter),
    Ticket.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(fetchLimit)
      .populate("vehicle", "plate make model color photo")
      .populate("branch", "name code address")
      .populate("createdBy", "fullName phone role")
      .populate("assignedDriver", "fullName phone role")
      .populate("parkingDriver", "fullName phone role")
      .populate("deliveryDriver", "fullName phone role")
      .populate("keyReceivedBy", "fullName phone role")
      .populate("keyReleasedBy", "fullName phone role")
      .populate("keyReleasedTo", "fullName phone role")
      .lean(),
  ]);

  const filtered = queryText
    ? tickets.filter((ticket) => matchesTicketSearch(ticket, queryText))
    : tickets;
  const paged = queryText
    ? filtered.slice((page - 1) * limit, page * limit)
    : filtered;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        role: userRole,
        scope,
        page,
        limit,
        count: paged.length,
        total: queryText ? filtered.length : total,
        tickets: paged.map(buildTicketSummary),
      },
      "Ticket history retrieved successfully",
    ),
  );
}

export async function linkOwnerToTicket(req, res) {
  const parsed = ownerLinkTicketSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const data = { ...parsed.data };
  if (data.qrPayload) {
    let payload = null;
    try {
      payload = JSON.parse(data.qrPayload);
    } catch {
      throw badRequest("qrPayload must be a valid JSON string");
    }

    if (payload?.type !== "OWNER_REQUEST") {
      throw badRequest("qrPayload type must be OWNER_REQUEST");
    }

    if (!data.ticketNumber && payload.ticketNumber) {
      data.ticketNumber = String(payload.ticketNumber).trim();
    }
    if (!data.valetCode && payload.valetCode) {
      data.valetCode = String(payload.valetCode).trim();
    }
  }

  if (data.ticketId && !isValidObjectId(data.ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const filter = data.ticketId
    ? { _id: data.ticketId }
    : (data.ticketNumber
      ? { ticketNumber: data.ticketNumber }
      : { valetCode: data.valetCode });

  const ticket = await Ticket.findOne(filter);
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (ticket.ownerUser && String(ticket.ownerUser) !== String(req.user.id)) {
    throw forbidden("This ticket is linked to another owner");
  }

  const ticketPhone = normalizePhone(ticket.ownerPhone);
  const userPhone = normalizePhone(req.user.phone);
  if (ticketPhone && userPhone && ticketPhone !== userPhone) {
    throw forbidden("This ticket is linked to another phone number");
  }

  const rootTicketId = ticket.sourceTicket ? ticket.sourceTicket : ticket._id;
  const ownerUpdates = {
    ownerUser: req.user.id,
  };
  if (req.user.phone) {
    ownerUpdates.ownerPhone = req.user.phone;
  }
  if (data.ownerName !== undefined) {
    ownerUpdates.ownerName = data.ownerName;
  }

  await Ticket.updateMany(
    {
      $or: [{ _id: rootTicketId }, { sourceTicket: rootTicketId }],
    },
    { $set: ownerUpdates },
  );

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: "Ticket linked to owner app account",
    meta: {
      ownerUserId: String(req.user.id),
      ownerPhone: req.user.phone || "",
      ownerName: data.ownerName || "",
    },
  });

  const linkedTickets = await Ticket.find({
    $or: [{ _id: rootTicketId }, { sourceTicket: rootTicketId }],
  })
    .sort({ createdAt: -1 })
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .populate("sourceTicket", "ticketNumber valetCode status")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        rootTicketId: String(rootTicketId),
        linkedCount: linkedTickets.length,
        tickets: linkedTickets,
      },
      "Owner linked to ticket successfully",
    ),
  );
}

export async function getOwnerActiveTickets(req, res) {
  const parsed = ownerTicketListQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const ownerFilter = buildOwnerMatchFilter(req.user);
  if (!ownerFilter) {
    throw forbidden("Owner phone or account identity is missing");
  }

  const { q, limit } = parsed.data;
  const fetchLimit = q ? Math.max(limit, 300) : Math.max(limit, 150);

  const tickets = await Ticket.find({
    $and: [
      ownerFilter,
      { status: { $nin: OWNER_TERMINAL_STATUSES } },
    ],
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(fetchLimit)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .populate("sourceTicket", "ticketNumber valetCode status")
    .lean();

  const activeRetrievalSourceIds = new Set(
    tickets
      .filter((ticket) => ticket.sourceTicket && !OWNER_TERMINAL_STATUSES.includes(ticket.status))
      .map((ticket) => String(ticket.sourceTicket?._id || ticket.sourceTicket)),
  );

  const queryText = String(q || "").toLowerCase().trim();
  const filtered = tickets
    .filter((ticket) => {
      const sourceId = ticket.sourceTicket ? String(ticket.sourceTicket?._id || ticket.sourceTicket) : null;
      const isSourceTicket = !sourceId;
      if (isSourceTicket && activeRetrievalSourceIds.has(String(ticket._id))) {
        return false;
      }
      return true;
    })
    .filter((ticket) => matchesTicketSearch(ticket, queryText))
    .slice(0, limit);

  return res.status(200).json({
    count: filtered.length,
    tickets: filtered,
  });
}

export async function listRetrievalRequests(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = retrievalRequestsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const { status, q, limit } = parsed.data;
  const filter = {
    branch: req.user.branchId,
    status: status
      ? status
      : {
        $in: ACTIVE_DELIVERY_STATUSES,
      },
  };

  const fetchLimit = q ? Math.max(limit, 300) : limit;
  const requests = await Ticket.find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(fetchLimit)
    .populate("sourceTicket", "ticketNumber valetCode status")
    .populate("vehicle", "plate make model color photo")
    .populate("assignedDriver", "fullName phone role")
    .populate("parkingDriver", "fullName phone role")
    .populate("deliveryDriver", "fullName phone role")
    .populate("createdBy", "fullName phone role")
    .lean();

  const queryText = (q || "").toLowerCase().trim();
  const filtered = queryText
    ? requests.filter((ticket) => {
      const ticketNumber = String(ticket.ticketNumber || "").toLowerCase();
      const valetCode = String(ticket.valetCode || "").toLowerCase();
      const plate = String(ticket.vehicle?.plate || "").toLowerCase();
      return ticketNumber.includes(queryText) || valetCode.includes(queryText) || plate.includes(queryText);
    })
    : requests;

  const trimmed = filtered.slice(0, limit);

  return res.status(200).json({
    count: trimmed.length,
    tickets: trimmed,
  });
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
    $or: [
      { assignedDriver: req.user.id },
      { deliveryDriver: req.user.id },
    ],
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

  const { status, keyStatus, keyReleaseStatus, parkState, q, limit } = parsed.data;
  const filter = {
    branch: req.user.branchId,
    status: status
      ? status
      : {
        $in: [
          TICKET_STATUS.READY_TO_BE_PARKED,
          TICKET_STATUS.PARKED_IN,
          TICKET_STATUS.REQUESTED_FOR_DELIVERY,
          TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
          TICKET_STATUS.ON_THE_WAY,
          TICKET_STATUS.ARRIVED_FOR_DELIVERY,
        ],
      },
  };

  const fetchLimit = q ? Math.max(limit, 300) : limit;
  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .limit(fetchLimit)
    .populate("vehicle")
    .populate("assignedDriver", "fullName phone role")
    .populate("parkingDriver", "fullName phone role")
    .populate("deliveryDriver", "fullName phone role")
    .populate("keyReceivedBy", "fullName phone role")
    .populate("keyReleasedBy", "fullName phone role")
    .populate("keyReleasedTo", "fullName phone role")
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
    .filter((ticket) => {
      if (parkState === "PARKED_IN") {
        return [...PARKED_STATUSES, ...ACTIVE_DELIVERY_STATUSES].includes(ticket.status);
      }
      if (parkState === "NOT_PARKED_IN") {
        return ticket.status === TICKET_STATUS.READY_TO_BE_PARKED;
      }
      return true;
    })
    .filter((ticket) => (keyStatus ? ticket.keyControl.keyStatus === keyStatus : true))
    .filter((ticket) => (keyReleaseStatus ? ticket.keyControl.keyReleaseStatus === keyReleaseStatus : true));

  const summary = filtered.reduce((acc, ticket) => {
    if (ticket.keyControl.keyReleaseStatus === "KEY_RELEASED") {
      acc.keysReleased += 1;
    }
    if (ticket.keyControl.keyReleaseStatus === "KEY_RELEASE_PENDING") {
      acc.keysPendingRelease += 1;
    }
    if (ticket.keyControl.keyStatus === "KEY_PENDING") {
      acc.keysPendingReturn += 1;
    }
    return acc;
  }, {
    keysReleased: 0,
    keysPendingRelease: 0,
    keysPendingReturn: 0,
  });

  filtered = filtered.slice(0, limit);

  return res.status(200).json({
    count: filtered.length,
    summary,
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

  if (!PARKED_STATUSES.includes(ticket.status)) {
    throw conflict("Key can be marked received only when car status is PARKED_IN");
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

export async function releaseKey(req, res) {
  const { ticketId } = req.params;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = releaseKeySchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const ticket = await Ticket.findOne({ _id: ticketId, branch: req.user.branchId });
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (!RETRIEVAL_REQUESTED_STATUSES.includes(ticket.status) && !DELIVERY_ASSIGNED_STATUSES.includes(ticket.status)) {
    throw conflict("Key can be released only after retrieval is requested and a delivery driver is assigned");
  }

  if (!ticket.deliveryDriver) {
    throw conflict("Assign a delivery driver before releasing the key");
  }

  if (!ticket.keyReceivedAt) {
    throw conflict("Key must be marked received before it can be released");
  }

  if (ticket.keyReleasedAt) {
    throw conflict("Key is already released for this retrieval request");
  }

  ticket.keyReleasedAt = new Date();
  ticket.keyReleasedBy = req.user.id;
  ticket.keyReleasedTo = ticket.deliveryDriver;
  ticket.retrieval = {
    ...(ticket.retrieval?.toObject ? ticket.retrieval.toObject() : ticket.retrieval || {}),
    keyReleasedAt: ticket.keyReleasedAt,
    keyReleasedBy: req.user.id,
    keyReleasedTo: ticket.deliveryDriver,
  };
  if (parsed.data.notes !== undefined) {
    ticket.keyNote = parsed.data.notes;
  }
  await ticket.save();

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: req.user.id,
    note: "Key released to delivery driver",
    meta: {
      keyReleasedAt: ticket.keyReleasedAt,
      keyReleasedBy: req.user.id,
      keyReleasedTo: String(ticket.deliveryDriver),
    },
  });

  try {
    const io = req.app?.get("io");
    if (io) {
      io.to(`user_${String(ticket.deliveryDriver)}`).emit("key_released", {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        status: ticket.status,
        keyReleasedAt: ticket.keyReleasedAt,
        releasedBy: String(req.user.id),
      });
    }
  } catch (error) {
    console.error("[Socket.IO] Failed to emit key_released:", error?.message || error);
  }

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("vehicle", "plate make model color photo")
    .populate("deliveryDriver", "fullName phone role")
    .populate("keyReceivedBy", "fullName phone role")
    .populate("keyReleasedBy", "fullName phone role")
    .populate("keyReleasedTo", "fullName phone role")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: {
          ...(populatedTicket || ticket.toObject()),
          keyControl: buildKeyControlMeta(populatedTicket || ticket),
        },
      },
      "Key released successfully",
    ),
  );
}

export async function issueTicketFromPayload({ data, actorUser, verifiedPayment = null }) {
  if (!actorUser?.branchId || !isValidObjectId(actorUser.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const branch = await Branch.findOne({ _id: actorUser.branchId, isActive: true }).lean();

  if (!branch) {
    throw badRequest("Your branch is invalid or inactive");
  }

  const serviceType = data.serviceType || branch.serviceTypes?.find((item) => item.isActive)?.code || "NORMAL_VALET";
  const activeServiceCodes = Array.isArray(branch.serviceTypes)
    ? branch.serviceTypes.filter((item) => item.isActive).map((item) => item.code)
    : [];
  if (activeServiceCodes.length && !activeServiceCodes.includes(serviceType)) {
    throw badRequest(`Service type ${serviceType} is not enabled for this branch`, {
      allowedServiceTypes: activeServiceCodes,
    });
  }

  const paymentCondition = data.paymentCondition || PAYMENT_CONDITIONS.PAY_LATER;
  const allowedPaymentConditions = Array.isArray(branch.allowedPaymentConditions) && branch.allowedPaymentConditions.length
    ? branch.allowedPaymentConditions
    : PAYMENT_CONDITION_VALUES;
  if (!allowedPaymentConditions.includes(paymentCondition)) {
    throw badRequest(`Payment condition ${paymentCondition} is not enabled for this branch`, {
      allowedPaymentConditions,
    });
  }

  const entryMethod = data.entryMethod;
  const supportedEntryMethods = Array.isArray(branch.supportedEntryMethods) && branch.supportedEntryMethods.length
    ? branch.supportedEntryMethods
    : ENTRY_METHOD_VALUES;
  if (entryMethod && !supportedEntryMethods.includes(entryMethod)) {
    throw badRequest(`Entry method ${entryMethod} is not enabled for this branch`, {
      allowedEntryMethods: supportedEntryMethods,
    });
  }

  const paperTicketSerial = entryMethod === ENTRY_METHODS.SERIALIZED_PAPER
    ? normalizePaperTicketSerial(data.paperTicketSerial)
    : "";
  if (entryMethod === ENTRY_METHODS.SERIALIZED_PAPER) {
    if (!paperTicketSerial) {
      throw badRequest("paperTicketSerial is required when entryMethod is SERIALIZED_PAPER");
    }

    const paperTicket = await PaperTicket.findOne({
      branch: branch._id,
      serialNumber: paperTicketSerial,
    }).lean();
    if (!paperTicket) {
      throw notFound("This paper ticket serial is not registered for this branch");
    }
    if (paperTicket?.status === PAPER_TICKET_STATUS.VOIDED) {
      throw conflict("This paper ticket serial is voided and cannot be used");
    }
    if (paperTicket?.status === PAPER_TICKET_STATUS.USED) {
      throw conflict("This paper ticket serial is already linked to a ticket", {
        serialNumber: paperTicketSerial,
        ticketId: paperTicket.ticket ? String(paperTicket.ticket) : null,
      });
    }
  }

  const nfcTagUid = entryMethod === ENTRY_METHODS.NFC
    ? normalizeNfcTagUid(data.nfcTagUid)
    : "";
  if (entryMethod === ENTRY_METHODS.NFC) {
    if (!nfcTagUid) {
      throw badRequest("nfcTagUid is required when entryMethod is NFC");
    }

    const nfcTag = await NfcTag.findOne({
      branch: branch._id,
      tagUid: nfcTagUid,
    }).lean();
    if (!nfcTag) {
      throw notFound("NFC tag is not registered for this branch");
    }
    if ([NFC_TAG_STATUS.LOST, NFC_TAG_STATUS.INACTIVE, NFC_TAG_STATUS.BLOCKED].includes(nfcTag.status)) {
      throw conflict(`NFC tag cannot be used while status is ${nfcTag.status}`);
    }
    if (nfcTag.status === NFC_TAG_STATUS.IN_USE) {
      throw conflict("NFC tag is already linked to an active ticket", {
        nfcTagUid,
        ticketId: nfcTag.ticket ? String(nfcTag.ticket) : null,
      });
    }
  }

  let driver = null;
  if (data.driverId) {
    if (!isValidObjectId(data.driverId)) {
      throw badRequest("driverId must be a valid ObjectId");
    }

    driver = await User.findById(data.driverId).lean();
    if (
      !driver
      || driver.role !== ROLES.DRIVER
      || !driver.isActive
      || String(driver.branch) !== String(branch._id)
    ) {
      throw badRequest("Selected user is not an active driver in this branch");
    }
  }

  const ticketNumber = generateTicketNumber();
  const valetCode = generateValetCode(branch.code || "LSA");
  const vehicleDetails = {
    plate: data.vehicle.plate,
    make: data.vehicle.make,
    model: data.vehicle.model,
    color: data.vehicle.color,
  };
  const ownerUserId = data.ownerUserId && isValidObjectId(data.ownerUserId)
    ? data.ownerUserId
    : null;
  const ownerType = ownerUserId || data.ownerHasApp ? OWNER_TYPES.APP : OWNER_TYPES.WHATSAPP;
  const tempTicketForDelivery = {
    ticketNumber,
    valetCode,
    vehicle: vehicleDetails,
  };
  const paymentLink = buildPaymentLink(tempTicketForDelivery);
  const whatsappIdentifier = String(vehicleDetails.plate || valetCode || "").trim();
  const { command: whatsappCommand, link: whatsappPrefillLink } = buildWhatsAppPrefillLink(whatsappIdentifier);
  const ownerAppQrPayload = JSON.stringify({
    type: "OWNER_REQUEST",
    ticketNumber,
    valetCode,
  });

  let smsDelivery = null;

  const paymentSource = verifiedPayment || data.payment;
  const paymentForCreate = paymentSource
    ? {
      amount: paymentSource.amount,
      method: paymentSource.method,
      status: PAYMENT_STATUS.PAID,
      currency: paymentSource.currency || "QAR",
      receiptLink: paymentSource.receiptLink || "",
      pos: {
        terminalId: paymentSource.terminalId || "",
        bankTransactionRef: paymentSource.bankTransactionRef || "",
        confirmationStatus: paymentSource.method === "CASH"
          ? "CASH_RECEIVED"
          : paymentSource.method === "ONLINE"
            ? "PROVIDER_CONFIRMED"
            : "MANUALLY_CONFIRMED",
        confirmedAt: new Date(),
      },
      online: {
        provider: paymentSource.provider || "",
        paymentReference: paymentSource.providerReference || "",
        paidAt: paymentSource.method === "ONLINE" ? new Date() : null,
      },
    }
    : undefined;

  const vehicle = await Vehicle.create({
    plate: data.vehicle.plate,
    make: data.vehicle.make,
    model: data.vehicle.model,
    color: data.vehicle.color,
    photo: data.vehicle.photo || null,
  });

  const ticket = await Ticket.create({
    ticketNumber,
    valetCode,
    ownerType,
    ownerPhone: data.ownerPhone || "",
    ownerName: data.ownerName || "",
    ownerUser: ownerUserId,
    branch: branch._id,
    vehicle: vehicle._id,
    status: TICKET_STATUS.READY_TO_BE_PARKED,
    assignedDriver: driver?._id || null,
    parkingDriver: driver?._id || null,
    entryMethod,
    paperTicketSerial,
    nfcTagUid,
    serviceType,
    paymentCondition,
    garage: data.garage || "",
    slot: data.slot || "",
    keyTag: data.keyTag || "",
    keyNote: data.keyNote || "",
    receivingPoint: data.receivingPoint || "",
    notes: data.notes || "",
    services: data.services || [],
    ...(paymentForCreate ? { payment: paymentForCreate } : {}),
    createdBy: actorUser.id,
  });

  if (entryMethod === ENTRY_METHODS.SMS) {
    const businessPhone = (process.env.WHATSAPP_BUSINESS_PHONE || "").replace(/\D/g, "");
    const smsBody = buildTicketSmsBody({
      ticket,
      vehicle: vehicleDetails,
      businessPhone,
      paymentLink,
      retrievalLink: buildPublicRetrievalLink(ticket),
    });

    console.log("[SMS Ticket] Sending ticket SMS", {
      to: data.ownerPhone,
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      entryMethod: ticket.entryMethod,
      body: smsBody,
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
  }

  if (entryMethod === ENTRY_METHODS.SERIALIZED_PAPER) {
    const paperTicket = await reservePaperTicketSerial({
      branchId: branch._id,
      serialNumber: paperTicketSerial,
      ticketId: ticket._id,
      actorId: actorUser.id,
    });
    ticket.paperTicket = paperTicket._id;
    await ticket.save();
  }

  if (entryMethod === ENTRY_METHODS.NFC) {
    const nfcTag = await reserveNfcTag({
      branchId: branch._id,
      tagUid: nfcTagUid,
      ticketId: ticket._id,
    });
    ticket.nfcTag = nfcTag._id;
    await ticket.save();
  }

  if (paymentForCreate) {
    await Payment.create({
      ticket: ticket._id,
      amount: paymentForCreate.amount,
      method: paymentForCreate.method,
      status: paymentForCreate.status,
      terminalId: paymentForCreate.pos.terminalId,
      bankTransactionRef: paymentForCreate.pos.bankTransactionRef,
      providerReference: paymentSource.providerReference || "",
      receiptLink: paymentForCreate.receiptLink,
      processedBy: actorUser.id,
    });
  }

  await logTicketEvent({
    ticketId: ticket._id,
    status: ticket.status,
    actor: actorUser.id,
    note: "Ticket issued",
    meta: {
      serviceType,
      paymentCondition,
      entryMethod,
      paperTicketSerial: paperTicketSerial || null,
      nfcTagUid: nfcTagUid || null,
      driverId: driver ? String(driver._id) : null,
      smsDelivery,
      paymentStatus: paymentForCreate ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.UNPAID,
    },
  });

  if (paymentForCreate) {
    await logTicketEvent({
      ticketId: ticket._id,
      status: ticket.status,
      actor: actorUser.id,
      note: paymentSource?.notes || "PAY_NOW payment collected at ticket creation",
      meta: {
        payment: {
          amount: paymentForCreate.amount,
          method: paymentForCreate.method,
          status: paymentForCreate.status,
          currency: paymentForCreate.currency,
        },
      },
    });
  }

  return { ticket };
}

export async function createManualCarArrival(req, res) {
  const parsed = manualCarArrivalSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const { ticket } = await issueTicketFromPayload({
    data: parsed.data,
    actorUser: req.user,
  });

  const createdTicket = await Ticket.findById(ticket._id)
    .populate("vehicle", "plate make model color photo")
    .populate("assignedDriver", "fullName phone role")
    .lean();

  return res.status(201).json(
    new ApiResponse(
      201,
      await buildTicketIssueResponse(createdTicket || ticket),
      "Ticket issued successfully",
    ),
  );
}

// ─── PATCH /api/v1/tickets/:ticketId/park ─────────────────────────────────────
// Driver submits parking details (slot, keyTag, keyNote, photo) after parking
// Transitions ticket status: READY_TO_BE_PARKED -> PARKED_IN

export async function createTicketIssueIntent(req, res) {
  const parsed = ticketIssueIntentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const data = parsed.data;
  const { branch, serviceType, paymentCondition } = await validateIssueIntentPayload({
    data,
    actorUser: req.user,
  });

  if (data.entryMethod === ENTRY_METHODS.WHATSAPP && !process.env.WHATSAPP_BUSINESS_PHONE) {
    throw badRequest("WHATSAPP_BUSINESS_PHONE is required to generate a WhatsApp QR link");
  }

  const reference = await generateIssueIntentReference(data.entryMethod, branch.code);
  const payload = {
    ...data,
    serviceType,
    paymentCondition,
    ownerHasApp: data.entryMethod === ENTRY_METHODS.QR_CODE,
  };

  const intent = await TicketIssueIntent.create({
    reference,
    entryMethod: data.entryMethod,
    branch: branch._id,
    createdBy: req.user.id,
    ticketPayload: payload,
    expiresAt: getIssueIntentExpiry(),
  });

  const response = {
    intentId: String(intent._id),
    reference,
    entryMethod: data.entryMethod,
    expiresAt: intent.expiresAt,
  };

  if (data.entryMethod === ENTRY_METHODS.WHATSAPP) {
    const { command, link } = buildWhatsAppPrefillLink(reference);
    response.payloadType = "WHATSAPP_QR";
    response.qrPayload = link;
    response.command = command;
  } else {
    response.payloadType = "APP_QR";
    response.qrPayload = buildOwnerAppIntentPayload(reference);
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      response,
      "Ticket issue intent created successfully",
    ),
  );
}

export async function confirmOwnerAppIssueIntent(req, res) {
  const { reference } = req.params;
  const normalizedReference = String(reference || "").trim().toUpperCase();
  if (!normalizedReference) {
    throw badRequest("reference is required");
  }

  const intent = await TicketIssueIntent.findOne({ reference: normalizedReference });
  if (!intent) {
    throw notFound("Ticket issue intent not found");
  }

  if (intent.entryMethod !== ENTRY_METHODS.QR_CODE) {
    throw badRequest("This intent is not for owner app QR confirmation");
  }

  if (intent.status === TICKET_ISSUE_INTENT_STATUS.COMPLETED) {
    return res.status(200).json(
      new ApiResponse(200, null, "Ticket already created for this QR code"),
    );
  }

  if (intent.status !== TICKET_ISSUE_INTENT_STATUS.PENDING) {
    throw conflict(`Cannot confirm an intent with status ${intent.status}`);
  }

  if (intent.expiresAt && intent.expiresAt.getTime() < Date.now()) {
    intent.status = TICKET_ISSUE_INTENT_STATUS.EXPIRED;
    await intent.save();
    throw conflict("Ticket QR code has expired. Ask reception to generate a new QR code");
  }

  const { ticket } = await issueTicketFromPayload({
    data: {
      ...intent.ticketPayload,
      ownerHasApp: true,
      ownerUserId: req.user.id,
      ownerPhone: req.user.phone || intent.ticketPayload.ownerPhone || "",
      ownerName: intent.ticketPayload.ownerName || req.user.fullName || "",
    },
    actorUser: {
      id: String(intent.createdBy),
      branchId: String(intent.branch),
    },
  });

  intent.status = TICKET_ISSUE_INTENT_STATUS.COMPLETED;
  intent.ticket = ticket._id;
  intent.ownerUser = req.user.id;
  intent.ownerPhone = req.user.phone || "";
  intent.completedAt = new Date();
  await intent.save();

  const createdTicket = await Ticket.findById(ticket._id)
    .populate("vehicle", "plate make model color photo")
    .populate("assignedDriver", "fullName phone role")
    .lean();

  return res.status(201).json(
    new ApiResponse(
      201,
      await buildTicketIssueResponse(createdTicket || ticket),
      "Ticket linked to owner app successfully",
    ),
  );
}

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

  // Ticket must have a parking driver assigned before it can be parked.
  const allowedStatuses = [TICKET_STATUS.READY_TO_BE_PARKED];
  if (!allowedStatuses.includes(ticket.status)) {
    throw conflict(
      `Cannot park ticket. Current status is "${ticket.status}". Must be READY_TO_BE_PARKED.`,
    );
  }

  // Build the parked car photo path if uploaded
  const baseUrl   = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const photoPath = req.file ? `/public/parked/${req.file.filename}` : null;
  const photoUrl  = photoPath ? `${baseUrl}${photoPath}` : null;

  // Update ticket fields
  const updates = {
    status:  TICKET_STATUS.PARKED_IN,
    slot:    parsed.data.slot    ?? ticket.slot,
    keyTag:  parsed.data.keyTag  ?? ticket.keyTag,
    keyNote: parsed.data.keyNote ?? ticket.keyNote,
    parkedAt: ticket.parkedAt || new Date(),
  };

  if (photoPath) updates["meta.parkedPhotoPath"] = photoPath;

  Object.assign(ticket, updates);
  await ticket.save();

  // Log the parking event
  await TicketEvent.create({
    ticket: ticket._id,
    status: TICKET_STATUS.PARKED_IN,
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
