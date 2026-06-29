import mongoose from "mongoose";

export const TIP_TARGETS = Object.freeze({
  DRIVER: "DRIVER",
  WHOLE_TEAM: "WHOLE_TEAM",
});

const ticketRatingSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      unique: true,
      index: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    ownerPhone: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    tipAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    tipTarget: {
      type: String,
      enum: Object.values(TIP_TARGETS),
      default: TIP_TARGETS.DRIVER,
    },
    tipPaymentIntent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentIntent",
      default: null,
      index: true,
    },
    tipPaymentStatus: {
      type: String,
      enum: ["NOT_REQUIRED", "PENDING", "PAID", "FAILED"],
      default: "NOT_REQUIRED",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ticketRatingSchema.index({ branch: 1, createdAt: -1 });
ticketRatingSchema.index({ driver: 1, createdAt: -1 });

export const TicketRating = mongoose.model("TicketRating", ticketRatingSchema);
