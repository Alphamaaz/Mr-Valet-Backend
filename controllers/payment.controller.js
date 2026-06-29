import axios from "axios";
import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { PaymentIntent, PAYMENT_INTENT_PURPOSE, PAYMENT_INTENT_STATUS } from "../models/PaymentIntent.js";
import { Ticket } from "../models/Ticket.js";
import { Payment } from "../models/Payment.js";
import { TicketRating } from "../models/TicketRating.js";
import { ROLES } from "../constants/roles.js";
import { PAYMENT_STATUS } from "../constants/paymentStatus.js";

const STAFF_PAYMENT_ROLES = [
  ROLES.RECEPTIONIST,
  ROLES.SUPERVISOR,
  ROLES.OPERATIONS_MANAGER,
];

const initiateSadadSchema = z.object({
  ticketId: z.string().trim().min(1),
  amount: z.coerce.number().positive().optional(),
  currency: z.string().trim().min(3).max(3).default("QAR"),
});

const sadadVerifySchema = z.object({
  paymentIntentId: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  orderId: z.string().trim().optional(),
  orderid: z.string().trim().optional(),
  transactionId: z.string().trim().optional(),
  transactionno: z.string().trim().optional(),
  "transaction id": z.string().trim().optional(),
  providerReference: z.string().trim().optional(),
  status: z.string().trim().optional(),
  transactionStatus: z.string().trim().optional(),
  amount: z.coerce.number().optional(),
}).passthrough();

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

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function getCallbackReference(payload) {
  return payload.reference || payload.paymentIntentId || payload.orderId || payload.orderid || payload.ORDER_ID || "";
}

function getCallbackStatus(payload) {
  return String(payload.status || payload.transactionStatus || payload.STATUS || "").toUpperCase();
}

function isSuccessStatus(status) {
  return ["3", "PAID", "SUCCESS", "TXN_SUCCESS", "APPROVED", "COMPLETED"].includes(status);
}

function isFailureStatus(status) {
  return ["2", "FAILED", "FAILURE", "TXN_FAILURE", "REJECTED", "CANCELLED", "CANCELED", "EXPIRED"].includes(status);
}

function getSadadTokenUrl() {
  if (process.env.SADAD_TOKEN_URL) {
    return process.env.SADAD_TOKEN_URL;
  }

  return process.env.SADAD_ENVIRONMENT === "production"
    ? "https://api.sadadqatar.com/api-v4/userbusinesses/getsdktoken"
    : "https://api.sadadqatar.com/api-v5/userbusinesses/getsdktoken";
}

async function generateSadadSdkToken() {
  const sadadId = process.env.SADAD_MERCHANT_ID || "";
  const secretKey = process.env.SADAD_SECRET_KEY || "";
  const domain = process.env.SADAD_REGISTERED_DOMAIN || "";
  if (!sadadId || !secretKey || !domain) {
    throw conflict("SADAD credentials are not configured");
  }

  const isTest = process.env.SADAD_ENVIRONMENT !== "production";
  const response = await axios.post(
    getSadadTokenUrl(),
    {
      sadadId,
      secretKey,
      domain,
      ...(isTest ? { isTest: true } : {}),
    },
    {
      timeout: Number(process.env.SADAD_TOKEN_TIMEOUT_MS || 10000),
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  const token = response.data?.accessToken || response.data?.data?.accessToken || response.data?.token || "";
  if (!token) {
    throw badRequest("SADAD token response did not include accessToken", response.data);
  }

  return token;
}

function normalizeProviderVerificationPayload(payload, fallbackPayload) {
  const source = payload?.data || payload || {};
  return {
    ...fallbackPayload,
    ...source,
    status: source.status || source.transactionStatus || source.STATUS || fallbackPayload.status,
    transactionStatus: source.transactionStatus || source.status || source.STATUS || fallbackPayload.transactionStatus,
    transactionId: source.transactionId || source.transactionno || source["transaction id"] || source.txnId || fallbackPayload.transactionId,
    transactionno: source.transactionno || source.transactionId || source["transaction id"] || fallbackPayload.transactionno,
    providerReference: source.providerReference || source.reference || source.transactionId || fallbackPayload.providerReference,
    amount: source.amount ?? source.TXN_AMOUNT ?? fallbackPayload.amount,
  };
}

async function verifySadadTransactionWithProvider(payload) {
  const verifyUrl = process.env.SADAD_VERIFY_URL || "";
  if (!verifyUrl) {
    return payload;
  }

  const response = await axios.post(
    verifyUrl,
    {
      orderId: payload.reference || payload.orderId || payload.paymentIntentId,
      transactionId: payload.transactionId || payload.transactionno || payload["transaction id"] || "",
      amount: payload.amount,
    },
    {
      timeout: Number(process.env.SADAD_VERIFY_TIMEOUT_MS || 10000),
      headers: {
        "Content-Type": "application/json",
        secretkey: process.env.SADAD_SECRET_KEY || "",
        Authorization: process.env.SADAD_ACCESS_TOKEN ? `Bearer ${process.env.SADAD_ACCESS_TOKEN}` : undefined,
      },
    },
  );

  return normalizeProviderVerificationPayload(response.data, payload);
}

async function findIntentByReference(reference) {
  const filters = [{ reference }];
  if (isValidObjectId(reference)) {
    filters.push({ _id: reference });
  }
  return PaymentIntent.findOne({ $or: filters });
}

function buildFlutterPaymentPayload({ intent, ticket }) {
  const vehicle = ticket.vehicle && typeof ticket.vehicle === "object" ? ticket.vehicle : null;
  const customerName = ticket.ownerName || "Mr Valet Customer";
  const mobile = ticket.ownerPhone || "";

  return {
    orderId: intent.reference,
    productDetail: [
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        plate: vehicle?.plate || "",
        vehicle: [vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
        serviceType: ticket.serviceType || "",
      },
    ],
    customerName,
    amount: intent.amount,
    email: "",
    mobile,
    token: intent.sdkToken,
    packageMode: process.env.SADAD_ENVIRONMENT === "production" ? "live" : "debug",
    merchantSadadId: process.env.SADAD_MERCHANT_ID || "",
    isWalletEnabled: true,
    paymentTypes: ["creditCard", "debitCard", "sadadPay"],
    titleText: "Mr Valet",
    googleMerchantID: process.env.SADAD_GOOGLE_MERCHANT_ID || "123456789",
    googleMerchantName: process.env.SADAD_GOOGLE_MERCHANT_NAME || "Mr Valet",
  };
}

function buildFlutterTipPaymentPayload({ intent, ticket }) {
  return {
    orderId: intent.reference,
    productDetail: [
      {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        valetCode: ticket.valetCode,
        type: "TIP",
        tipTarget: intent.tip?.target || "",
      },
    ],
    customerName: ticket.ownerName || "Mr Valet Customer",
    amount: intent.amount,
    email: "",
    mobile: ticket.ownerPhone || "",
    token: intent.sdkToken,
    packageMode: process.env.SADAD_ENVIRONMENT === "production" ? "live" : "debug",
    merchantSadadId: process.env.SADAD_MERCHANT_ID || "",
    isWalletEnabled: true,
    paymentTypes: ["creditCard", "debitCard", "sadadPay"],
    titleText: "Mr Valet Driver Tip",
    googleMerchantID: process.env.SADAD_GOOGLE_MERCHANT_ID || "123456789",
    googleMerchantName: process.env.SADAD_GOOGLE_MERCHANT_NAME || "Mr Valet",
  };
}

function userCanAccessTicket(ticket, user) {
  if (!ticket || !user) {
    return false;
  }

  if (STAFF_PAYMENT_ROLES.includes(user.role)) {
    return Boolean(user.branchId && String(ticket.branch) === String(user.branchId));
  }

  if (user.role !== ROLES.OWNER) {
    return false;
  }

  if (ticket.ownerUser && String(ticket.ownerUser) === String(user.id)) {
    return true;
  }

  return Boolean(
    ticket.ownerPhone
      && user.phone
      && normalizePhone(ticket.ownerPhone) === normalizePhone(user.phone),
  );
}

async function applySuccessfulSadadPayment({ intent, payload }) {
  if (intent.status === PAYMENT_INTENT_STATUS.PAID) {
    return intent;
  }

  if (intent.expiresAt.getTime() < Date.now()) {
    intent.status = PAYMENT_INTENT_STATUS.EXPIRED;
    intent.callbackPayload = payload;
    await intent.save();
    throw conflict("Payment intent has expired");
  }

  const ticket = await Ticket.findById(intent.ticket);
  if (!ticket) {
    throw notFound("Ticket not found for payment intent");
  }

  const callbackStatus = getCallbackStatus(payload);
  if (isFailureStatus(callbackStatus)) {
    intent.status = PAYMENT_INTENT_STATUS.FAILED;
    intent.failureReason = callbackStatus || "Payment failed";
    intent.callbackPayload = payload;
    await intent.save();
    if (intent.purpose === PAYMENT_INTENT_PURPOSE.TIP && intent.tip?.rating) {
      await TicketRating.updateOne(
        { _id: intent.tip.rating },
        { $set: { tipPaymentStatus: "FAILED", tipPaymentIntent: intent._id } },
      );
    }
    return intent;
  }

  if (!isSuccessStatus(callbackStatus)) {
    throw badRequest("Unsupported or missing SADAD payment status", { status: callbackStatus });
  }

  const amount = payload.amount ?? intent.amount;
  if (Number(amount) !== Number(intent.amount)) {
    throw badRequest("SADAD paid amount does not match payment intent amount", {
      expectedAmount: intent.amount,
      receivedAmount: amount,
    });
  }

  const providerReference = payload.providerReference || payload.transactionno || payload.transactionId || payload["transaction id"] || intent.reference;
  const paidAt = new Date();

  if (intent.purpose === PAYMENT_INTENT_PURPOSE.TIP) {
    await TicketRating.updateOne(
      { _id: intent.tip?.rating },
      {
        $set: {
          tipPaymentStatus: "PAID",
          tipPaymentIntent: intent._id,
        },
      },
    );

    await Payment.create({
      ticket: ticket._id,
      amount: intent.amount,
      method: "ONLINE",
      status: PAYMENT_STATUS.PAID,
      providerReference,
      processedBy: intent.createdBy,
    });

    intent.status = PAYMENT_INTENT_STATUS.PAID;
    intent.providerReference = providerReference;
    intent.providerTransactionId = payload.transactionId || payload.transactionno || payload["transaction id"] || "";
    intent.callbackPayload = payload;
    intent.paidAt = paidAt;
    await intent.save();

    return intent;
  }

  ticket.payment = {
    ...(ticket.payment?.toObject ? ticket.payment.toObject() : ticket.payment || {}),
    amount: intent.amount,
    method: "ONLINE",
    status: PAYMENT_STATUS.PAID,
    currency: intent.currency,
    online: {
      ...(ticket.payment?.online?.toObject ? ticket.payment.online.toObject() : ticket.payment?.online || {}),
      provider: "SADAD",
      paymentReference: providerReference,
      paidAt,
    },
    pos: {
      ...(ticket.payment?.pos?.toObject ? ticket.payment.pos.toObject() : ticket.payment?.pos || {}),
      confirmationStatus: "PROVIDER_CONFIRMED",
      confirmedAt: paidAt,
    },
  };
  await ticket.save();

  await Payment.create({
    ticket: ticket._id,
    amount: intent.amount,
    method: "ONLINE",
    status: PAYMENT_STATUS.PAID,
    providerReference,
    processedBy: intent.createdBy,
  });

  intent.status = PAYMENT_INTENT_STATUS.PAID;
  intent.providerReference = providerReference;
  intent.providerTransactionId = payload.transactionId || payload.transactionno || payload["transaction id"] || "";
  intent.callbackPayload = payload;
  intent.paidAt = paidAt;
  await intent.save();

  return intent;
}

export async function initiateSadadPayment(req, res) {
  const parsed = initiateSadadSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const { ticketId, currency } = parsed.data;
  if (!isValidObjectId(ticketId)) {
    throw badRequest("ticketId must be a valid ObjectId");
  }

  const ticket = await Ticket.findById(ticketId).populate("vehicle");
  if (!ticket) {
    throw notFound("Ticket not found");
  }

  if (!userCanAccessTicket(ticket, req.user)) {
    throw forbidden("You do not have access to this ticket payment");
  }

  if (ticket.payment?.status === PAYMENT_STATUS.PAID) {
    throw conflict("Ticket is already paid");
  }

  const amount = parsed.data.amount ?? ticket.payment?.amount;
  if (!amount || amount <= 0) {
    throw badRequest("Payment amount is required. Set ticket payment amount first or send amount in request.");
  }

  const existingIntent = await PaymentIntent.findOne({
    ticket: ticket._id,
    provider: "SADAD",
    purpose: PAYMENT_INTENT_PURPOSE.TICKET_PAYMENT,
    status: PAYMENT_INTENT_STATUS.PENDING,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (existingIntent) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          paymentIntentId: String(existingIntent._id),
          reference: existingIntent.reference,
          orderId: existingIntent.reference,
          provider: existingIntent.provider,
          amount: existingIntent.amount,
          currency: existingIntent.currency,
          sdkToken: existingIntent.sdkToken,
          flutterPayment: buildFlutterPaymentPayload({ intent: existingIntent, ticket }),
          merchantId: process.env.SADAD_MERCHANT_ID || "",
          callbackUrl: process.env.SADAD_CALLBACK_URL || "",
          status: existingIntent.status,
          purpose: existingIntent.purpose,
          ticketId: String(ticket._id),
          expiresAt: existingIntent.expiresAt,
        },
        "Existing SADAD payment intent returned",
      ),
    );
  }

  const reference = buildPaymentReference();
  const expiresAt = new Date(Date.now() + Number(process.env.PAYMENT_INTENT_TTL_MINUTES || 30) * 60 * 1000);
  let sdkToken = "";
  try {
    sdkToken = await generateSadadSdkToken();
  } catch (error) {
    throw badRequest("Unable to generate SADAD SDK token", {
      message: error?.response?.data?.message || error?.message || "SADAD token request failed",
      status: error?.response?.status || null,
      data: error?.response?.data || null,
    });
  }

  const intent = await PaymentIntent.create({
    reference,
    provider: "SADAD",
    status: PAYMENT_INTENT_STATUS.PENDING,
    purpose: PAYMENT_INTENT_PURPOSE.TICKET_PAYMENT,
    amount,
    currency,
    branch: ticket.branch,
    createdBy: req.user.id,
    ticket: ticket._id,
    sdkToken,
    expiresAt,
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        paymentIntentId: String(intent._id),
        reference: intent.reference,
        orderId: intent.reference,
        provider: intent.provider,
        amount: intent.amount,
        currency: intent.currency,
        sdkToken: intent.sdkToken,
        flutterPayment: buildFlutterPaymentPayload({ intent, ticket }),
        merchantId: process.env.SADAD_MERCHANT_ID || "",
        callbackUrl: process.env.SADAD_CALLBACK_URL || "",
        status: intent.status,
        purpose: intent.purpose,
        ticketId: String(ticket._id),
        expiresAt: intent.expiresAt,
      },
      "SADAD payment intent created successfully",
    ),
  );
}

export async function verifySadadPayment(req, res) {
  const parsed = sadadVerifySchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const reference = getCallbackReference(payload);
  if (!reference) {
    throw badRequest("paymentIntentId, reference, or orderId is required");
  }

  const intent = await findIntentByReference(reference);
  if (!intent) {
    throw notFound("Payment intent not found");
  }

  const ticket = await Ticket.findById(intent.ticket);
  if (!ticket) {
    throw notFound("Ticket not found for payment intent");
  }

  if (!userCanAccessTicket(ticket, req.user)) {
    throw forbidden("You do not have access to verify this ticket payment");
  }

  let providerPayload = payload;
  try {
    providerPayload = await verifySadadTransactionWithProvider({
      ...payload,
      reference: intent.reference,
      amount: payload.amount ?? intent.amount,
    });
  } catch (error) {
    throw badRequest("SADAD transaction verification failed", {
      message: error?.response?.data?.message || error?.message || "Verification request failed",
      status: error?.response?.status || null,
      data: error?.response?.data || null,
    });
  }

  const updatedIntent = await applySuccessfulSadadPayment({ intent, payload: providerPayload });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        paymentIntentId: String(updatedIntent._id),
        reference: updatedIntent.reference,
        status: updatedIntent.status,
        purpose: updatedIntent.purpose,
        ticketId: String(updatedIntent.ticket),
        providerReference: updatedIntent.providerReference || "",
        paidAt: updatedIntent.paidAt,
      },
      updatedIntent.status === PAYMENT_INTENT_STATUS.PAID
        ? "SADAD payment verified successfully"
        : "SADAD payment status recorded",
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

  await applySuccessfulSadadPayment({ intent, payload });

  return res.status(200).json(
    new ApiResponse(200, null, "SADAD callback processed successfully"),
  );
}

export async function getPaymentIntentStatus(req, res) {
  const { paymentIntentId } = req.params;
  const intent = await findIntentByReference(paymentIntentId);
  if (!intent) {
    throw notFound("Payment intent not found");
  }

  const ticket = await Ticket.findById(intent.ticket).lean();
  if (!ticket) {
    throw notFound("Ticket not found for payment intent");
  }

  if (!userCanAccessTicket(ticket, req.user)) {
    throw forbidden("You do not have access to this payment intent");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        paymentIntentId: String(intent._id),
        reference: intent.reference,
        orderId: intent.reference,
        provider: intent.provider,
        status: intent.status,
        purpose: intent.purpose,
        amount: intent.amount,
        currency: intent.currency,
        ticketId: intent.ticket ? String(intent.ticket) : null,
        tip: intent.purpose === PAYMENT_INTENT_PURPOSE.TIP
          ? {
            target: intent.tip?.target || "",
            driverId: intent.tip?.driver ? String(intent.tip.driver) : null,
            ratingId: intent.tip?.rating ? String(intent.tip.rating) : null,
          }
          : null,
        providerReference: intent.providerReference || "",
        expiresAt: intent.expiresAt,
        paidAt: intent.paidAt,
      },
      "Payment intent status retrieved successfully",
    ),
  );
}
