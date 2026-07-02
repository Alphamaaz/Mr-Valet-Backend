import mongoose from "mongoose";

export const DEVICE_PLATFORM = Object.freeze({
  ANDROID: "ANDROID",
  IOS: "IOS",
  WEB: "WEB",
  UNKNOWN: "UNKNOWN",
});

const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORM),
      default: DEVICE_PLATFORM.UNKNOWN,
    },
    deviceId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    appVersion: {
      type: String,
      trim: true,
      default: "",
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

deviceTokenSchema.index({ user: 1, deviceId: 1 });
deviceTokenSchema.index({ user: 1, isActive: 1, lastSeenAt: -1 });

export const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema);
