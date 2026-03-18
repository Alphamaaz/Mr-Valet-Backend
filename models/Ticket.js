import mongoose from "mongoose";
import { OWNER_TYPES } from "../constants/ownerTypes.js";
import { TICKET_STATUS } from "../constants/ticketStatus.js";
import { ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    valetCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    ownerType: {
      type: String,
      enum: Object.values(OWNER_TYPES),
      required: true,
      index: true,
    },
    ownerPhone: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    ownerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(TICKET_STATUS),
      default: TICKET_STATUS.CREATED,
      index: true,
    },
    assignedDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    entryMethod: {
      type: String,
      enum: ENTRY_METHOD_VALUES,
      default: undefined,
      index: true,
    },
    slot: {
      type: String,
      default: "",
    },
    garage: {
      type: String,
      default: "",
    },
    keyTag: {
      type: String,
      default: "",
    },
    parkedAt: {
      type: Date,
      default: null,
      index: true,
    },
    keyReceivedAt: {
      type: Date,
      default: null,
      index: true,
    },
    keyReceivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    keyNote: {
      type: String,
      default: "",
    },
    receivingPoint: {
      type: String,
      default: "",
    },
    services: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: "",
    },
    payment: {
      amount: {
        type: Number,
        default: 0,
      },
      method: {
        type: String,
        default: "",
      },
      status: {
        type: String,
        enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
        default: "PENDING",
      },
      receiptLink: {
        type: String,
        default: "",
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Ticket = mongoose.model("Ticket", ticketSchema);
