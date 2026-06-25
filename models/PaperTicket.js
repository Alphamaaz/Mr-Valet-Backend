import mongoose from "mongoose";

export const PAPER_TICKET_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  USED: "USED",
  VOIDED: "VOIDED",
});

const paperTicketSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    serialNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: Object.values(PAPER_TICKET_STATUS),
      default: PAPER_TICKET_STATUS.AVAILABLE,
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
    usedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidReason: {
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

paperTicketSchema.index({ branch: 1, serialNumber: 1 }, { unique: true });
paperTicketSchema.index({ branch: 1, status: 1, updatedAt: -1 });

export const PaperTicket = mongoose.model("PaperTicket", paperTicketSchema);
