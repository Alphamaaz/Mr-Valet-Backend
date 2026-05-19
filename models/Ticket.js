import mongoose from "mongoose";
import { OWNER_TYPES } from "../constants/ownerTypes.js";
import { TICKET_STATUS } from "../constants/ticketStatus.js";
import { ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";
import { PAYMENT_CONDITION_VALUES, PAYMENT_CONDITIONS } from "../constants/paymentConditions.js";
import { PAYMENT_STATUS_VALUES, PAYMENT_STATUS } from "../constants/paymentStatus.js";

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
    ownerName: {
      type: String,
      trim: true,
      default: "",
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
    parkingDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    deliveryDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sourceTicket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    entryMethod: {
      type: String,
      enum: ENTRY_METHOD_VALUES,
      default: undefined,
      index: true,
    },
    serviceType: {
      type: String,
      trim: true,
      default: "NORMAL_VALET",
      index: true,
    },
    paymentCondition: {
      type: String,
      enum: PAYMENT_CONDITION_VALUES,
      default: PAYMENT_CONDITIONS.PAY_LATER,
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
    keyReleasedAt: {
      type: Date,
      default: null,
      index: true,
    },
    keyReleasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    keyReleasedTo: {
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
    retrieval: {
      requestedAt: {
        type: Date,
        default: null,
      },
      requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      requestedByRole: {
        type: String,
        default: "",
      },
      assignedAt: {
        type: Date,
        default: null,
      },
      assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      keyReleasedAt: {
        type: Date,
        default: null,
      },
      keyReleasedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      keyReleasedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      arrivedAt: {
        type: Date,
        default: null,
      },
      deliveredAt: {
        type: Date,
        default: null,
      },
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
        enum: PAYMENT_STATUS_VALUES,
        default: PAYMENT_STATUS.UNPAID,
      },
      currency: {
        type: String,
        default: "QAR",
      },
      receiptLink: {
        type: String,
        default: "",
      },
      pos: {
        terminalId: {
          type: String,
          default: "",
        },
        bankTransactionRef: {
          type: String,
          default: "",
        },
        confirmationStatus: {
          type: String,
          default: "",
        },
        confirmedAt: {
          type: Date,
          default: null,
        },
      },
      online: {
        provider: {
          type: String,
          default: "",
        },
        paymentReference: {
          type: String,
          default: "",
        },
        paidAt: {
          type: Date,
          default: null,
        },
      },
    },
    approvals: {
      freeOfCharge: {
        requestedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        status: {
          type: String,
          enum: ["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"],
          default: "NOT_REQUIRED",
        },
        reason: {
          type: String,
          default: "",
        },
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
