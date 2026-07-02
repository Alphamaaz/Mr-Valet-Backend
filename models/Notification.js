import mongoose from "mongoose";

export const NOTIFICATION_TYPES = Object.freeze({
  TICKET: "TICKET",
  CHAT: "CHAT",
  SYSTEM: "SYSTEM",
});

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      default: NOTIFICATION_TYPES.SYSTEM,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    data: {
      type: Map,
      of: String,
      default: {},
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

notificationSchema.index({ user: 1, deletedAt: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1, deletedAt: 1 });

export const Notification = mongoose.model("Notification", notificationSchema);
