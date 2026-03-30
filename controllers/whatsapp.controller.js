import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
import { Vehicle } from "../models/Vehicle.js";
import { OWNER_TYPES } from "../constants/ownerTypes.js";
import { TICKET_STATUS, canTransitionStatus } from "../constants/ticketStatus.js";
import { isValidWhatsAppSignature, sendWhatsAppTextMessage } from "../services/whatsapp.service.js";

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
    message: "Use one of these commands:\n/park my car BB 777\n/request BB 777\n(Valet code also works)",
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
    status: { $nin: [TICKET_STATUS.CANCELLED, TICKET_STATUS.COMPLETED] },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .populate("assignedDriver", "fullName")
    .populate("vehicle", "plate")
    .lean();
}

async function handleParkCommand({ from, identifier }) {
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
      message: `Valet code ${valetCode} is linked to another number. Please contact reception.`,
    });
    return;
  }

  if (!linkedOwnerPhone) {
    await Ticket.updateOne({ _id: ticket._id }, { $set: { ownerPhone: from } });
  }

  const driverName = ticket.assignedDriver?.fullName || "Assigned driver";
  const paymentLink = buildPaymentLink(ticket.ticketNumber);
  const paymentLine = paymentLink ? `\nPayment link: ${paymentLink}` : "";

  await sendWhatsAppTextMessage({
    phone: from,
    message: `Ticket #${ticket.ticketNumber}\nYour runner is "${driverName}".\nYour car is received and being parked.${paymentLine}`,
  });
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
      message: `Valet code ${valetCode} is linked to another number. Please contact reception.`,
    });
    return;
  }

  if (ticket.status === TICKET_STATUS.RETRIEVAL_REQUESTED || ticket.status === TICKET_STATUS.ON_THE_WAY) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `Retrieval already in progress for ticket #${ticket.ticketNumber}.`,
    });
    return;
  }

  if (!canTransitionStatus(ticket.status, TICKET_STATUS.RETRIEVAL_REQUESTED)) {
    await sendWhatsAppTextMessage({
      phone: from,
      message: `Cannot request retrieval while ticket is ${ticket.status}. Please contact reception.`,
    });
    return;
  }

  ticket.status = TICKET_STATUS.RETRIEVAL_REQUESTED;
  if (!linkedOwnerPhone) {
    ticket.ownerPhone = from;
  }
  await ticket.save();

  await TicketEvent.create({
    ticket: ticket._id,
    status: TICKET_STATUS.RETRIEVAL_REQUESTED,
    actor: null,
    note: "Retrieval requested by owner via WhatsApp",
    meta: { from },
  });

  await sendWhatsAppTextMessage({
    phone: from,
    message: `Retrieval requested for ticket #${ticket.ticketNumber}. Your driver is on the way.`,
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
