import mongoose from "mongoose";
import { ENTRY_METHODS } from "../constants/entryMethods.js";

export const TICKET_ISSUE_INTENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

const ticketIssueIntentSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    entryMethod: {
      type: String,
      enum: [ENTRY_METHODS.QR_CODE, ENTRY_METHODS.WHATSAPP],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(TICKET_ISSUE_INTENT_STATUS),
      default: TICKET_ISSUE_INTENT_STATUS.PENDING,
      index: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    ownerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    ownerPhone: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    ticketPayload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ticketIssueIntentSchema.index({ branch: 1, status: 1, createdAt: -1 });
ticketIssueIntentSchema.index({ entryMethod: 1, status: 1, expiresAt: 1 });

export const TicketIssueIntent = mongoose.model("TicketIssueIntent", ticketIssueIntentSchema);
