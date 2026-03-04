import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    checkInTime: {
      type: Date,
      default: Date.now,
    },
    checkInLatitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    checkInLongitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    checkInAccuracyMeters: {
      type: Number,
      default: null,
    },
    checkInDistanceMeters: {
      type: Number,
      default: null,
    },
    checkOutTime: {
      type: Date,
      default: null,
    },
    checkOutLatitude: {
      type: Number,
      default: null,
      min: -90,
      max: 90,
    },
    checkOutLongitude: {
      type: Number,
      default: null,
      min: -180,
      max: 180,
    },
    checkOutAccuracyMeters: {
      type: Number,
      default: null,
    },
    checkOutDistanceMeters: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED"],
      default: "ACTIVE",
      index: true,
    },
    deviceInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

attendanceSchema.index({ user: 1, dateKey: 1 }, { unique: true });
attendanceSchema.index(
  { user: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } },
);

export const Attendance = mongoose.model("Attendance", attendanceSchema);
