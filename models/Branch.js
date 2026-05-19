import mongoose from "mongoose";
import { ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";
import { PAYMENT_CONDITION_VALUES, PAYMENT_CONDITIONS } from "../constants/paymentConditions.js";

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
    defaultEntryMethod: {
      type: String,
      enum: ENTRY_METHOD_VALUES,
      default: undefined,
    },
    serviceTypes: {
      type: [
        {
          code: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
          },
          name: {
            type: String,
            required: true,
            trim: true,
          },
          basePrice: {
            type: Number,
            default: 0,
            min: 0,
          },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
      ],
      default: () => [{ code: "NORMAL_VALET", name: "Normal Valet", basePrice: 0, isActive: true }],
    },
    allowedPaymentConditions: {
      type: [String],
      enum: PAYMENT_CONDITION_VALUES,
      default: () => [
        PAYMENT_CONDITIONS.PAY_LATER,
        PAYMENT_CONDITIONS.PAY_NOW,
        PAYMENT_CONDITIONS.PREPAID_VOUCHER,
        PAYMENT_CONDITIONS.CAMPAIGN,
        PAYMENT_CONDITIONS.MEMBERSHIP,
        PAYMENT_CONDITIONS.FREE_OF_CHARGE,
      ],
    },
    dedicatedKeyController: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    keyReturnSlaSeconds: {
      type: Number,
      default: 90,
      min: 30,
      max: 1800,
    },
    tax: {
      vatPercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
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
