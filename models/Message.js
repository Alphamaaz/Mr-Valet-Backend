import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatGroup",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["text", "voice"],
      default: "text",
    },
    text: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    voice: {
      url: { type: String, default: "" },        
      duration: { type: Number, default: 0 },       
      mimeType: { type: String, default: "" },      
      fileSize: { type: Number, default: 0 },        
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// For efficient pagination of messages within a group
messageSchema.index({ group: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
