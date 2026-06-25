import mongoose from "mongoose";

export const NFC_TAG_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  IN_USE: "IN_USE",
  LOST: "LOST",
  INACTIVE: "INACTIVE",
  BLOCKED: "BLOCKED",
});

const nfcTagSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    serialNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
      index: true,
    },
    tagUid: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    cardType: {
      type: String,
      enum: ["STANDARD", "VIP"],
      default: "STANDARD",
      index: true,
    },
    hardwareVersion: {
      type: String,
      trim: true,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      default: "",
    },
    sublocation: {
      type: String,
      trim: true,
      default: "",
    },
    assignedStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(NFC_TAG_STATUS),
      default: NFC_TAG_STATUS.AVAILABLE,
      index: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
      index: true,
    },
    releasedAt: {
      type: Date,
      default: null,
    },
    statusReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

nfcTagSchema.index({ branch: 1, tagUid: 1 }, { unique: true });
nfcTagSchema.index({ branch: 1, status: 1, updatedAt: -1 });
nfcTagSchema.index({ branch: 1, serialNumber: 1 });

export const NfcTag = mongoose.model("NfcTag", nfcTagSchema);
