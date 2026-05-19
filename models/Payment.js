import mongoose from "mongoose";
import { PAYMENT_STATUS_VALUES, PAYMENT_STATUS } from "../constants/paymentStatus.js";

const paymentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      enum: ["CASH", "CARD", "ONLINE", "POS", "VOUCHER", "CAMPAIGN", "MEMBERSHIP", "FREE_OF_CHARGE"],
      required: true,
    },
    status: {
      type: String,
      enum: PAYMENT_STATUS_VALUES,
      default: PAYMENT_STATUS.UNPAID,
      index: true,
    },
    terminalId: {
      type: String,
      default: "",
    },
    bankTransactionRef: {
      type: String,
      default: "",
    },
    providerReference: {
      type: String,
      default: "",
    },
    receiptLink: {
      type: String,
      default: "",
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Payment = mongoose.model("Payment", paymentSchema);
