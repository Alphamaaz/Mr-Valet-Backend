import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
  {
    plate: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    make: {
      type: String,
      trim: true,
      default: "",
    },
    model: {
      type: String,
      trim: true,
      default: "",
    },
    color: {
      type: String,
      trim: true,
      default: "",
    },
    photo: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Vehicle = mongoose.model("Vehicle", vehicleSchema);

