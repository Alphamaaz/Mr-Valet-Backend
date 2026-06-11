import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
import { TicketIssueIntent, TICKET_ISSUE_INTENT_STATUS } from "../models/TicketIssueIntent.js";
import { Vehicle } from "../models/Vehicle.js";
import { OWNER_TYPES } from "../constants/ownerTypes.js";
import { TICKET_STATUS, canTransitionStatus } from "../constants/ticketStatus.js";
import { ENTRY_METHODS } from "../constants/entryMethods.js";
import { isValidWhatsAppSignature, sendWhatsAppTextMessage } from "../services/whatsapp.service.js";
import { issueTicketFromPayload } from "./ticket.controller.js";

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function buildPaymentLink(ticketNumber) {
  const baseUrl = process.env.PAYMENT_BASE_URL || process.env.APP_BASE_URL || "";
  if (!baseUrl) {
    return "";
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/pay?ticket=${encodeURIComponent(ticketNumber)}`;
}

function escapeRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIdentifier(input) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function parseCommand(text) {
  const input = String(text || "").trim();
  if (!input) {
    return null;
  }

  const parkMatch = input.match(/^\/park\s+my\s+car\s+(.+)$/i);
  if (parkMatch) {
    return { type: "PARK", identifier: normalizeIdentifier(parkMatch[1]) };
  }

  const requestMatch = input.match(/^\/request\s+(.+)$/i);
  if (requestMatch) {
    return { type: "REQUEST", identifier: normalizeIdentifier(requestMatch[1]) };
  }

  return null;
}

function extractIncomingMessages(payload) {
  const extracted = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const message of messages) {
        if (message?.type !== "text") {
          continue;
        }

        extracted.push({
          id: String(message?.id || ""),
          from: normalizePhone(message?.from),
          text: String(message?.text?.body || ""),
        });
      }
    }
  }

  return extracted;
}

async function sendUsageHelp(phone) {
  await sendWhatsAppTextMessage({
    phone,
    message: "Use one of these commands:\n/park my car DM-123\n/request DM-123\nUse the valet code shown on your ticket.",
  });
}

async function findWhatsAppTicketByIdentifier(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    return null;
  }

  const byValetCode = await Ticket.findOne({
    valetCode: normalized,
    ownerType: OWNER_TYPES.WHATSAPP,
  })
    .populate("assignedDriver", "fullName")
    .populate("vehicle", "plate")
    .lean();
  if (byValetCode) {
    return byValetCode;
  }

  const platePattern = `^${escapeRegex(normalized).replace(/\s+/g, "\\s*")}$`;
  const plateRegex = new RegExp(platePattern, "i");
  const vehicles = await Vehicle.find({ plate: plateRegex }).select("_id").lean();
  const vehicleIds = vehicles.map((vehicle) => vehicle._id);
  if (!vehicleIds.length) {
    return null;
  }

  return Ticket.findOne({
    vehicle: { $in: vehicleIds },
    ownerType: OWNER_TYPES.WHATSAPP,
    status: { $ne: TICKET_STATUS.CLOSED },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate("assignedDriver", "fullName")
    .populate("vehicle", "plate")
    .lean();
}

async function findWhatsAppIntentByReference(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    return null;
  }

  return TicketIssueIntent.findOne({
    reference: normalized,
    entryMethod: ENTRY_METHODS.WHATSAPP,
    status: {
      $in: [
        TICKET_ISSUE_INTENT_STATUS.PENDING,
        TICKET_ISSUE_INTENT_STATUS.PROCESSING,
        TICKET_ISSUE_INTENT_STATUS.COMPLETED,
      ],
    },
  }).lean();
}

async function replyWithTicketConfirmation({ phone, ticket }) {
  const driverName = ticket.assignedDriver?.fullName || "Assigned driver";
  const paymentLink = buildPaymentLink(ticket.ticketNumber);
  const paymentLine = paymentLink ? `\nPayment link: ${paymentLink}` : "";

  await sendWhatsAppTextMessage({
    phone,
    message: `Ticket #${ticket.ticketNumber}\nValet code: ${ticket.valetCode}\nYour runner is "${driverName}".\nYour car is received and being parked.${paymentLine}\n\nTo request your car later, send:\n/request ${ticket.valetCode}`,
  });
}

async function createTicketFromWhatsAppIntent({ intent, from }) {
  const lockResult = await TicketIssueIntent.updateOne(
    {
      _id: intent._id,
      status: TICKET_ISSUE_INTENT_STATUS.PENDING,
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        status: TICKET_ISSUE_INTENT_STATUS.PROCESSING,
        ownerPhone: from,
      },
    },
  );

  if (lockResult.modifiedCount !== 1) {
    const latest = await TicketIssueIntent.findById(intent._id)
      .populate({
        path: "ticket",
        populate: [
          { path: "assignedDriver", select: "fullName" },
          { path: "vehicle", select: "plate" },
        ],
      })
      .lean();

    if (latest?.status === TICKET_ISSUE_INTENT_STATUS.COMPLETED && latest.ticket) {
      return latest.ticket;
    }

    return null;
  }

  try {
    const { ticket } = await issueTicketFromPayload({
      data: {
        ...intent.ticketPayload,
        ownerHasApp: false,
        ownerPhone: from,
      },
      actorUser: {
        id: String(intent.createdBy),
        branchId: String(intent.branch),
      },
    });

    await TicketIssueIntent.updateOne(
      { _id: intent._id },
      {
        $set: {
          status: TICKET_ISSUE_INTENT_STATUS.COMPLETED,
          ticket: ticket._id,
          ownerPhone: from,
          completedAt: new Date(),
        },
      },
    );

    return Ticket.findById(ticket._id)
      .populate("assignedDriver", "fullName")
      .populate("vehicle", "plate")
      .lean();
  } catch (error) {
    await TicketIssueIntent.updateOne(
      { _id: intent._id, status: TICKET_ISSUE_INTENT_STATUS.PROCESSING },
      {
        $set: {
          status: TICKET_ISSUE_INTENT_STATUS.PENDING,
          meta: {
            lastError: error?.message || "Ticket creation failed",
            lastErrorAt: new Date(),
          },
        },
      },
    );
    throw error;
  }
}

async function handleParkCommand({ from, identifier }) {
  const intent = await findWhatsAppIntentByReference(identifier);
  if (intent) {
    if (intent.status === TICKET_ISSUE_INTENT_STATUS.PROCESSING) {
      await sendWhatsAppTextMessage({
        phone: from,
        message: "Ticket creation is already processing. Please wait a moment.",
      });
      return;
    }

    if (intent.status === TICKET_ISSUE_INTENT_STATUS.COMPLETED) {
      const ticket = await Ticket.findById(intent.ticket)
        .populate("assignedDriver", "fullName")
        .populate("vehicle", "plate")
        .lean();
      if (ticket) {
        await replyWithTicketConfirmation({ phone: from, ticket });
        return;
      }
    }

    if (intent.expiresAt && new Date(intent.expiresAt).getTime() < Date.now()) {
      await TicketIssueIntent.updateOne(
        { _id: intent._id, status: TICKET_ISSUE_INTENT_STATUS.PENDING },
        { $set: { status: TICKET_ISSUE_INTENT_STATUS.EXPIRED } },
      );
      await sendWhatsAppTextMessage({
        phone: from,
        message: "This WhatsApp ticket QR has expired. Please ask reception to generate a new one.",
      });
      return;
    }

    try {
      const createdTicket = await createTicketFromWhatsAppIntent({ intent, from });
      if (createdTicket) {
        await replyWithTicketConfirmation({ phone: from, ticket: createdTicket });
        return;
      }

      await sendWhatsAppTextMessage({
        phone: from,
        message: "Ticket creation is already in progress. Please wait a moment.",
      });
      return;
    } catch (error) {
      await sendWhatsAppTextMessage({
        phone: from,
        message: `Ticket could not be created. Please contact reception. Reason: ${error?.message || "Unknown error"}`,
      });
      return;
    }
  }

  const ticket = await findWhatsAppTicketByIdentifier(identifier);

  if (!ticket) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `No active ticket found for "${identifier}". Please scan the employee QR again.`,
    });
    return;
  }

  const linkedOwnerPhone = normalizePhone(ticket.ownerPhone);
  if (linkedOwnerPhone && linkedOwnerPhone !== from) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `Ticket "${identifier}" is linked to another number. Please contact reception.`,
    });
    return;
  }

  if (!linkedOwnerPhone) {
    await Ticket.updateOne({ _id: ticket._id }, { $set: { ownerPhone: from } });
  }

  await replyWithTicketConfirmation({ phone: from, ticket });
}

async function handleRequestCommand({ from, identifier }) {
  const ticket = await findWhatsAppTicketByIdentifier(identifier);

  if (!ticket) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `No active ticket found for "${identifier}". Please scan the employee QR again.`,
    });
    return;
  }

  const linkedOwnerPhone = normalizePhone(ticket.ownerPhone);
  if (linkedOwnerPhone && linkedOwnerPhone !== from) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `Ticket "${identifier}" is linked to another number. Please contact reception.`,
    });
    return;
  }

  if ([
    TICKET_STATUS.REQUESTED_FOR_DELIVERY,
    TICKET_STATUS.ASSIGNED_FOR_DELIVERY,
    TICKET_STATUS.ON_THE_WAY,
    TICKET_STATUS.ARRIVED_FOR_DELIVERY,
  ].includes(ticket.status)) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `Retrieval already in progress for ticket #${ticket.ticketNumber}.`,
    });
    return;
  }

  if (!canTransitionStatus(ticket.status, TICKET_STATUS.REQUESTED_FOR_DELIVERY)) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `Cannot request retrieval while ticket is ${ticket.status}. Please contact reception.`,
    });
    return;
  }

  if (!linkedOwnerPhone) {
    await Ticket.updateOne({ _id: ticket._id }, { $set: { ownerPhone: from } });
  }

  await Ticket.updateOne(
    { _id: ticket._id },
    {
      $set: {
        status: TICKET_STATUS.REQUESTED_FOR_DELIVERY,
        assignedDriver: null,
        deliveryDriver: null,
        ownerPhone: linkedOwnerPhone || from,
        "retrieval.requestedAt": new Date(),
        "retrieval.requestedBy": null,
        "retrieval.requestedByRole": "WHATSAPP",
        "retrieval.assignedAt": null,
        "retrieval.assignedBy": null,
        "retrieval.keyReleasedAt": null,
        "retrieval.keyReleasedBy": null,
        "retrieval.keyReleasedTo": null,
        "retrieval.arrivedAt": null,
        "retrieval.deliveredAt": null,
      },
    },
  );

  await TicketEvent.create({
    ticket: ticket._id,
    status: TICKET_STATUS.REQUESTED_FOR_DELIVERY,
    actor: null,
    note: "Retrieval request created via WhatsApp",
    meta: {
      from,
    },
  });

  await sendWhatsAppTextMessage({
    phone: from,
    message: `Retrieval requested for ticket #${ticket.ticketNumber}. We are assigning a driver now.`,
  });
}

async function processIncomingMessage(message) {
  if (!message.from || !message.text) {
    return;
  }

  const command = parseCommand(message.text);
  if (!command) {
    await sendUsageHelp(message.from);
    return;
  }

  if (command.type === "PARK") {
    await handleParkCommand({ from: message.from, identifier: command.identifier });
    return;
  }

  if (command.type === "REQUEST") {
    await handleRequestCommand({ from: message.from, identifier: command.identifier });
    return;
  }

  await sendUsageHelp(message.from);
}

export function verifyWebhook(req, res) {
  const mode = String(req.query["hub.mode"] || "");
  const verifyToken = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";

  if (!expectedToken) {
    return res.status(500).json({ message: "WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured" });
  }

  if (mode === "subscribe" && verifyToken === expectedToken) {
    return res.status(200).send(challenge);
  }

  return res.status(403).json({ message: "Webhook verification failed" });
}

export async function receiveWebhook(req, res) {
  const appSecret = process.env.META_APP_SECRET || "";
  if (appSecret) {
    const signatureHeader = req.headers["x-hub-signature-256"];
    const isValid = isValidWhatsAppSignature({
      rawBody: req.rawBody,
      signatureHeader,
    });

    if (!isValid) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }
  }

  const messages = extractIncomingMessages(req.body);
  await Promise.allSettled(messages.map((message) => processIncomingMessage(message)));

  return res.sendStatus(200);
}
