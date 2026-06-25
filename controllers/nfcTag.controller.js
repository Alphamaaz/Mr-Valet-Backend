import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { NfcTag, NFC_TAG_STATUS } from "../models/NfcTag.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const registerNfcTagSchema = z.object({
  tagUid: z.string().trim().min(2).max(120),
  serialNumber: z.string().trim().min(2).max(80).optional(),
  cardType: z.enum(["STANDARD", "VIP"]).default("STANDARD"),
  hardwareVersion: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  sublocation: z.string().trim().max(120).optional(),
  assignedStaff: z.string().trim().optional(),
});

const listNfcTagsQuerySchema = z.object({
  status: z.enum(Object.values(NFC_TAG_STATUS)).optional(),
  cardType: z.enum(["STANDARD", "VIP"]).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const updateNfcStatusSchema = z.object({
  status: z.enum([
    NFC_TAG_STATUS.AVAILABLE,
    NFC_TAG_STATUS.LOST,
    NFC_TAG_STATUS.INACTIVE,
    NFC_TAG_STATUS.BLOCKED,
  ]),
  reason: z.string().trim().max(300).optional(),
});

function normalizeTagUid(tagUid) {
  return String(tagUid || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

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

function serializeNfcTag(tag) {
  return {
    id: String(tag._id),
    branch: String(tag.branch),
    serialNumber: tag.serialNumber || "",
    tagUid: tag.tagUid,
    cardType: tag.cardType,
    hardwareVersion: tag.hardwareVersion || "",
    location: tag.location || "",
    sublocation: tag.sublocation || "",
    assignedStaff: tag.assignedStaff || null,
    status: tag.status,
    ticket: tag.ticket ? String(tag.ticket) : null,
    usedAt: tag.usedAt || null,
    lastUsedAt: tag.lastUsedAt || null,
    releasedAt: tag.releasedAt || null,
    statusReason: tag.statusReason || "",
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

export async function registerNfcTag(req, res) {
  const branchId = requireBranch(req.user);
  const parsed = registerNfcTagSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const tagUid = normalizeTagUid(parsed.data.tagUid);
  if (!tagUid) {
    throw badRequest("tagUid is required");
  }

  const existing = await NfcTag.findOne({ branch: branchId, tagUid });
  if (existing) {
    throw conflict("NFC tag is already registered for this branch", {
      tagUid,
      nfcTagId: String(existing._id),
      status: existing.status,
    });
  }

  const tag = await NfcTag.create({
    branch: branchId,
    tagUid,
    serialNumber: normalizeSerial(parsed.data.serialNumber) || tagUid,
    cardType: parsed.data.cardType,
    hardwareVersion: parsed.data.hardwareVersion || "",
    location: parsed.data.location || "",
    sublocation: parsed.data.sublocation || "",
    assignedStaff: parsed.data.assignedStaff || null,
    registeredBy: req.user.id,
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      serializeNfcTag(tag),
      "NFC tag registered successfully",
    ),
  );
}

export async function listNfcTags(req, res) {
  const branchId = requireBranch(req.user);
  const parsed = listNfcTagsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const filter = { branch: branchId };
  if (parsed.data.status) filter.status = parsed.data.status;
  if (parsed.data.cardType) filter.cardType = parsed.data.cardType;
  if (parsed.data.q) {
    const q = parsed.data.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { tagUid: { $regex: q, $options: "i" } },
      { serialNumber: { $regex: q, $options: "i" } },
    ];
  }

  const [totalCards, activeCards, availableCards, lostOrInactiveCards, tags] = await Promise.all([
    NfcTag.countDocuments({ branch: branchId }),
    NfcTag.countDocuments({ branch: branchId, status: NFC_TAG_STATUS.IN_USE }),
    NfcTag.countDocuments({ branch: branchId, status: NFC_TAG_STATUS.AVAILABLE }),
    NfcTag.countDocuments({
      branch: branchId,
      status: { $in: [NFC_TAG_STATUS.LOST, NFC_TAG_STATUS.INACTIVE, NFC_TAG_STATUS.BLOCKED] },
    }),
    NfcTag.find(filter)
      .sort({ updatedAt: -1 })
      .limit(parsed.data.limit)
      .populate("assignedStaff", "fullName phone role profileImage")
      .lean(),
  ]);

  return res.json(
    new ApiResponse(
      200,
      {
        summary: {
          totalCards,
          activeCards,
          availableCards,
          lostOrInactiveCards,
        },
        count: tags.length,
        nfcTags: tags.map(serializeNfcTag),
      },
      "NFC tags fetched successfully",
    ),
  );
}

export async function updateNfcTagStatus(req, res) {
  const branchId = requireBranch(req.user);
  const parsed = updateNfcStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const tag = await NfcTag.findOne({ _id: req.params.id, branch: branchId });
  if (!tag) {
    throw notFound("NFC tag not found");
  }

  if (tag.status === NFC_TAG_STATUS.IN_USE && parsed.data.status !== NFC_TAG_STATUS.AVAILABLE) {
    throw conflict("NFC tag is currently linked to an active ticket");
  }

  tag.status = parsed.data.status;
  tag.statusReason = parsed.data.reason || "";
  if (parsed.data.status === NFC_TAG_STATUS.AVAILABLE) {
    tag.ticket = null;
    tag.usedAt = null;
    tag.releasedAt = new Date();
  }
  await tag.save();

  return res.json(
    new ApiResponse(
      200,
      serializeNfcTag(tag),
      "NFC tag status updated successfully",
    ),
  );
}
