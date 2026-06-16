import mongoose from "mongoose";

export const PAYMENT_INTENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

const paymentIntentSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["SADAD"],
      default: "SADAD",
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_INTENT_STATUS),
      default: PAYMENT_INTENT_STATUS.PENDING,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "QAR",
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
    ticketPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    sdkToken: {
      type: String,
      default: "",
    },
    providerReference: {
      type: String,
      default: "",
      index: true,
    },
    providerTransactionId: {
      type: String,
      default: "",
      index: true,
    },
    callbackPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    failureReason: {
      type: String,
      default: "",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

paymentIntentSchema.index({ branch: 1, status: 1, createdAt: -1 });
paymentIntentSchema.index({ createdBy: 1, status: 1, createdAt: -1 });

export const PaymentIntent = mongoose.model("PaymentIntent", paymentIntentSchema);
