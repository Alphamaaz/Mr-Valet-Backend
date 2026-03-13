import mongoose from "mongoose";

const employeeProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    employeeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    // ─── Other Details ──────────────────────────────────────────────
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    performancePoints: {
      type: Number,
      default: 0,
    },
    assignedLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      default: null,
    },
    shiftStart: {
      type: String,
      default: "",
      trim: true,
    },
    shiftEnd: {
      type: String,
      default: "",
      trim: true,
    },
    // ─── Key Handover Details ───────────────────────────────────────
    timesDelayed: {
      type: Number,
      default: 0,
    },
    avgKeyDeliveryTime: {
      type: Number,
      default: 0,
    },
    // ─── Violations / Badges ────────────────────────────────────────
    violations: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const EmployeeProfile = mongoose.model("EmployeeProfile", employeeProfileSchema);
