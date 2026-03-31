import mongoose from "mongoose";

const additionalServiceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    // Price per unit (e.g. 3.00/litre) or flat rate (e.g. 100 riyal)
    price: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "SAR",
      trim: true,
      uppercase: true,
    },

    // FIXED = flat rate (Tire Air Check: 100 riyal)
    // PER_UNIT = price × quantity (Refueling: 3.00 × litres)
    pricingType: {
      type: String,
      enum: ["FIXED", "PER_UNIT"],
      default: "FIXED",
    },

    // Unit label shown in app e.g. "litre", "km" (only used for PER_UNIT)
    unit: {
      type: String,
      default: "",
      trim: true,
    },

    // Icon identifier used by the mobile app (e.g. "refueling", "tire", "carwash")
    icon: {
      type: String,
      default: "",
      trim: true,
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

export const AdditionalService = mongoose.model("AdditionalService", additionalServiceSchema);
