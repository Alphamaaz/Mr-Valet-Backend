import mongoose from "mongoose";

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      trim: true,
      uppercase: true,
    },
    billingCycle: {
      type: String,
      enum: ["MONTHLY", "QUARTERLY", "YEARLY"],
      required: true,
    },
    // Duration in days — used to calculate subscription endDate
    durationDays: {
      type: Number,
      required: true,
    },
    features: {
      type: [String],
      default: [],
    },
    isRecommended: {
      type: Boolean,
      default: false,
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

export const SubscriptionPlan = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
