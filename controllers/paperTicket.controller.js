import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { PaperTicket, PAPER_TICKET_STATUS } from "../models/PaperTicket.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const bulkCreateSchema = z.object({
  serialNumbers: z.array(z.string().trim().min(2).max(80)).min(1).max(1000),
});

const listQuerySchema = z.object({
  status: z.enum(Object.values(PAPER_TICKET_STATUS)).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const voidSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

function normalizeSerial(serialNumber) {
  return String(serialNumber || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function requireBranch(user) {
  if (!user?.branchId) {
    throw forbidden("User is not assigned to a valid branch");
  }

  return user.branchId;
}

function serializePaperTicket(ticket) {
  return {
    id: String(ticket._id),
    branch: String(ticket.branch),
    serialNumber: ticket.serialNumber,
    status: ticket.status,
    ticket: ticket.ticket ? String(ticket.ticket) : null,
    usedAt: ticket.usedAt || null,
    completedAt: ticket.completedAt || null,
    voidedAt: ticket.voidedAt || null,
    voidReason: ticket.voidReason || "",
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export async function bulkCreatePaperTickets(req, res) {
  const branchId = requireBranch(req.user);
  const parsed = bulkCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const serialNumbers = [...new Set(parsed.data.serialNumbers.map(normalizeSerial).filter(Boolean))];
  if (!serialNumbers.length) {
    throw badRequest("At least one valid serial number is required");
  }

  const existing = await PaperTicket.find({
    branch: branchId,
    serialNumber: { $in: serialNumbers },
  })
    .select("serialNumber")
    .lean();
  const existingSet = new Set(existing.map((item) => item.serialNumber));
  const toCreate = serialNumbers
    .filter((serialNumber) => !existingSet.has(serialNumber))
    .map((serialNumber) => ({
      branch: branchId,
      serialNumber,
      registeredBy: req.user.id,
    }));

  if (toCreate.length) {
    await PaperTicket.insertMany(toCreate, { ordered: false });
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        created: toCreate.length,
        skippedExisting: existing.length,
        serialNumbers,
      },
      "Paper tickets registered successfully",
    ),
  );
}

export async function listPaperTickets(req, res) {
  const branchId = requireBranch(req.user);
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const filter = { branch: branchId };
  if (parsed.data.status) {
    filter.status = parsed.data.status;
  }
  if (parsed.data.q) {
    filter.serialNumber = { $regex: parsed.data.q, $options: "i" };
  }

  const tickets = await PaperTicket.find(filter)
    .sort({ updatedAt: -1 })
    .limit(parsed.data.limit)
    .lean();

  return res.json(
    new ApiResponse(
      200,
      {
        count: tickets.length,
        paperTickets: tickets.map(serializePaperTicket),
      },
      "Paper tickets fetched successfully",
    ),
  );
}

export async function voidPaperTicket(req, res) {
  const branchId = requireBranch(req.user);
  const { id } = req.params;
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const paperTicket = await PaperTicket.findOne({ _id: id, branch: branchId });
  if (!paperTicket) {
    throw notFound("Paper ticket not found");
  }

  if (paperTicket.status === PAPER_TICKET_STATUS.USED) {
    throw conflict("Used paper ticket cannot be voided");
  }

  paperTicket.status = PAPER_TICKET_STATUS.VOIDED;
  paperTicket.voidedBy = req.user.id;
  paperTicket.voidedAt = new Date();
  paperTicket.voidReason = parsed.data.reason;
  await paperTicket.save();

  return res.json(
    new ApiResponse(
      200,
      serializePaperTicket(paperTicket),
      "Paper ticket voided successfully",
    ),
  );
}
