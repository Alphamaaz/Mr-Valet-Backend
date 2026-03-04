import mongoose from "mongoose";
import { TICKET_STATUS } from "../constants/ticketStatus.js";

const ticketEventSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(TICKET_STATUS),
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    note: {
      type: String,
      default: "",
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

export const TicketEvent = mongoose.model("TicketEvent", ticketEventSchema);

