import mongoose from "mongoose";
import { ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    allowedRadiusMeters: {
      type: Number,
      default: 120,
      min: 10,
      max: 1000,
    },
    supportedEntryMethods: {
      type: [String],
      enum: ENTRY_METHOD_VALUES,
      default: () => [...ENTRY_METHOD_VALUES],
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

export const Branch = mongoose.model("Branch", branchSchema);
