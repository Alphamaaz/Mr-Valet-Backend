import mongoose from "mongoose";
import { ROLES, STAFF_ROLES } from "../constants/roles.js";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
      index: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required() {
        return STAFF_ROLES.includes(this.role);
      },
      default: null,
      index: true,
    },
    attendanceStatus: {
      type: String,
      enum: ["CHECKED_IN", "CHECKED_OUT", "ON_BREAK"],
      default: "CHECKED_OUT",
    },
    profileImage: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastAssignedAt: {
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

userSchema.index({ branch: 1, role: 1, isActive: 1, attendanceStatus: 1, lastAssignedAt: 1 });

export const User = mongoose.model("User", userSchema);
