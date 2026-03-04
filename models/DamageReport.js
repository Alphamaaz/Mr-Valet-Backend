import mongoose from "mongoose";

const damageReportSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    zones: {
      type: [String],
      default: [],
    },
    photos: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const DamageReport = mongoose.model("DamageReport", damageReportSchema);

