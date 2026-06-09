import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { PaymentIntent, PAYMENT_INTENT_STATUS } from "../models/PaymentIntent.js";
import { ENTRY_METHODS, ENTRY_METHOD_VALUES } from "../constants/entryMethods.js";
import { PAYMENT_CONDITIONS } from "../constants/paymentConditions.js";
import { issueTicketFromPayload } from "./ticket.controller.js";

const initiateSadadSchema = z.object({
  ownerHasApp: z.boolean().default(false),
  ownerPhone: z.string().trim().min(8).max(20).optional(),
  ownerName: z.string().trim().min(1).max(80).optional(),
  serviceType: z.string().trim().min(1).max(60).optional(),
  paymentCondition: z.literal(PAYMENT_CONDITIONS.PAY_NOW),
  entryMethod: z.enum(ENTRY_METHOD_VALUES),
  driverId: z.string().trim().optional(),
  vehicle: z.object({
    plate: z.string().trim().min(2).max(20),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    color: z.string().trim().min(1).max(40),
    photo: z.string().trim().min(1).optional(),
  }),
  garage: z.string().trim().max(60).optional(),
  slot: z.string().trim().max(60).optional(),
  keyTag: z.string().trim().max(40).optional(),
  keyNote: z.string().trim().max(300).optional(),
  receivingPoint: z.string().trim().max(80).optional(),
  services: z.array(z.string().trim().min(1).max(80)).optional(),
  payment: z.object({
    amount: z.coerce.number().positive(),
    method: z.literal("ONLINE"),
    currency: z.string().trim().min(3).max(3).default("QAR"),
  }),
  notes: z.string().trim().max(500).optional(),
}).superRefine((data, ctx) => {
  if (data.entryMethod === ENTRY_METHODS.SMS && !data.ownerPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerPhone"],
      message: "ownerPhone is required when entryMethod is SMS",
    });
  }
});

const sadadCallbackSchema = z.object({
  reference: z.string().trim().optional(),
  paymentIntentId: z.string().trim().optional(),
  orderId: z.string().trim().optional(),
  ORDER_ID: z.string().trim().optional(),
  status: z.string().trim().optional(),
  transactionStatus: z.string().trim().optional(),
  STATUS: z.string().trim().optional(),
  transactionId: z.string().trim().optional(),
  transactionno: z.string().trim().optional(),
  providerReference: z.string().trim().optional(),
  amount: z.coerce.number().optional(),
}).passthrough();

function buildPaymentReference() {
  return `MRV-SADAD-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function getCallbackReference(payload) {
  return payload.reference || payload.paymentIntentId || payload.orderId || payload.ORDER_ID || "";
}

function getCallbackStatus(payload) {
  return String(payload.status || payload.transactionStatus || payload.STATUS || "").toUpperCase();
}

function isSuccessStatus(status) {
  return ["PAID", "SUCCESS", "TXN_SUCCESS", "APPROVED", "COMPLETED"].includes(status);
}

function isFailureStatus(status) {
  return ["FAILED", "FAILURE", "TXN_FAILURE", "REJECTED", "CANCELLED", "CANCELED", "EXPIRED"].includes(status);
}

async function findIntentByReference(reference) {
  const filters = [{ reference }];
  if (isValidObjectId(reference)) {
    filters.push({ _id: reference });
  }
  return PaymentIntent.findOne({ $or: filters });
}

export async function initiateSadadPayment(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("User is not assigned to a valid branch");
  }

  const parsed = initiateSadadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const { payment, ...ticketPayload } = parsed.data;
  const reference = buildPaymentReference();
  const expiresAt = new Date(Date.now() + Number(process.env.PAYMENT_INTENT_TTL_MINUTES || 30) * 60 * 1000);

  const intent = await PaymentIntent.create({
    reference,
    provider: "SADAD",
    status: PAYMENT_INTENT_STATUS.PENDING,
    amount: payment.amount,
    currency: payment.currency,
    branch: req.user.branchId,
    createdBy: req.user.id,
    ticketPayload,
    expiresAt,
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        paymentIntentId: String(intent._id),
        reference: intent.reference,
        provider: intent.provider,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        callbackUrl: process.env.SADAD_CALLBACK_URL || "https://appdev.mrvalet.info/api/v1/payments/sadad/callback",
        expiresAt: intent.expiresAt,
      },
      "SADAD payment intent created successfully",
    ),
  );
}

export async function handleSadadCallback(req, res) {
  const parsed = sadadCallbackSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid callback payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const reference = getCallbackReference(payload);
  if (!reference) {
    throw badRequest("Payment reference is required");
  }

  const intent = await findIntentByReference(reference);
  if (!intent) {
    throw notFound("Payment intent not found");
  }

  if (intent.ticket) {
    return res.status(200).json(
      new ApiResponse(200, null, "Payment callback already processed"),
    );
  }

  if (intent.expiresAt.getTime() < Date.now()) {
    intent.status = PAYMENT_INTENT_STATUS.EXPIRED;
    intent.callbackPayload = payload;
    await intent.save();
    throw conflict("Payment intent has expired");
  }

  const callbackStatus = getCallbackStatus(payload);
  if (isFailureStatus(callbackStatus)) {
    intent.status = PAYMENT_INTENT_STATUS.FAILED;
    intent.failureReason = callbackStatus || "Payment failed";
    intent.callbackPayload = payload;
    await intent.save();
    return res.status(200).json(new ApiResponse(200, null, "Payment failure recorded"));
  }

  if (!isSuccessStatus(callbackStatus)) {
    throw badRequest("Unsupported or missing SADAD payment status", { status: callbackStatus });
  }

  const providerReference = payload.providerReference || payload.transactionno || payload.transactionId || reference;
  const { ticket } = await issueTicketFromPayload({
    data: intent.ticketPayload,
    actorUser: {
      id: String(intent.createdBy),
      branchId: String(intent.branch),
    },
    verifiedPayment: {
      amount: intent.amount,
      method: "ONLINE",
      currency: intent.currency,
      provider: "SADAD",
      providerReference,
      notes: "SADAD online payment verified",
    },
  });

  intent.status = PAYMENT_INTENT_STATUS.PAID;
  intent.ticket = ticket._id;
  intent.providerReference = providerReference;
  intent.providerTransactionId = payload.transactionId || payload.transactionno || "";
  intent.callbackPayload = payload;
  intent.paidAt = new Date();
  await intent.save();

  return res.status(200).json(
    new ApiResponse(200, null, "Payment verified and ticket issued successfully"),
  );
}

export async function getPaymentIntentStatus(req, res) {
  const { paymentIntentId } = req.params;
  const intent = await findIntentByReference(paymentIntentId);
  if (!intent) {
    throw notFound("Payment intent not found");
  }

  if (
    req.user?.branchId
    && String(intent.branch) !== String(req.user.branchId)
    && String(intent.createdBy) !== String(req.user.id)
  ) {
    throw forbidden("You do not have access to this payment intent");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        paymentIntentId: String(intent._id),
        reference: intent.reference,
        provider: intent.provider,
        status: intent.status,
        amount: intent.amount,
        currency: intent.currency,
        ticketId: intent.ticket ? String(intent.ticket) : null,
        providerReference: intent.providerReference || "",
        expiresAt: intent.expiresAt,
        paidAt: intent.paidAt,
      },
      "Payment intent status retrieved successfully",
    ),
  );
}
