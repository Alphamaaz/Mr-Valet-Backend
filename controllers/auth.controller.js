import crypto from "crypto";
import { z } from "zod";
import { badRequest, unauthorized } from "../errors/AppError.js";
import { User } from "../models/User.js";
import { LoginOtp } from "../models/LoginOtp.js";
import { signAccessToken } from "../utils/token.js";
import { sendOtpSms } from "../services/twilio.service.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ROLES } from "../constants/roles.js";

const requestOtpSchema = z.object({
  phone: z.string().trim().min(8).max(20),
});

const verifyOtpSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  otp: z.string().trim().regex(/^\d{4,10}$/),
});

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const MAX_OTP_ATTEMPTS = Number(process.env.MAX_OTP_ATTEMPTS || 5);

function canUseMockOtp() {
  return (process.env.ENABLE_MOCK_OTP || "true").toLowerCase() === "true";
}

function sanitizePhone(phone) {
  return phone.replace(/\s+/g, "");
}

function generateOtpCode(length = 6) {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    const randomIndex = crypto.randomInt(0, digits.length);
    code += digits[randomIndex];
  }
  return code;
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function safeUserResponse(user) {
  return {
    id: String(user._id),
    phone: user.phone,
    role: user.role,
    fullName: user.fullName,
    branchId: user.branch ? String(user.branch) : null,
  };
}

async function upsertLoginOtp({ phone, otpCode }) {
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await LoginOtp.findOneAndUpdate(
    { phone },
    {
      phone,
      otpHash: hashOtp(otpCode),
      expiresAt,
      failedAttempts: 0,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  );
}

export async function requestOtp(req, res) {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const phone = sanitizePhone(parsed.data.phone);
  let member = await User.findOne({ phone });
  if (!member) {
    member = await User.create({
      phone,
      role: ROLES.OWNER,
      fullName: "",
      branch: null,
      isActive: true,
    });
  }

  if (!member.isActive) {
    throw unauthorized("Your account is inactive. Please contact support");
  }

  const otpCode = canUseMockOtp() ? (process.env.MOCK_OTP_CODE || "000000") : generateOtpCode(6);

  await upsertLoginOtp({ phone, otpCode });

  if (!canUseMockOtp()) {
    await sendOtpSms({
      phone,
      otpCode,
    });
  }

  const data = {
    mode: canUseMockOtp() ? "MOCK" : "TWILIO",
    expiresInMinutes: OTP_TTL_MINUTES,
  };

  if (canUseMockOtp()) {
    data.mockOtp = otpCode;
  }

  return res
    .status(200)
    .json(new ApiResponse(200, data, "OTP generated and sent successfully"));
}

export async function verifyOtp(req, res) {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const { otp } = parsed.data;
  const phone = sanitizePhone(parsed.data.phone);
  const user = await User.findOne({ phone, isActive: true });
  if (!user) {
    throw unauthorized("Only registered members can login");
  }

  const storedOtp = await LoginOtp.findOne({ phone });
  if (!storedOtp) {
    throw unauthorized("OTP not found. Please request OTP again");
  }

  if (storedOtp.expiresAt.getTime() < Date.now()) {
    await LoginOtp.deleteOne({ _id: storedOtp._id });
    throw unauthorized("OTP has expired. Please request OTP again");
  }

  const isOtpValid = storedOtp.otpHash === hashOtp(otp);
  if (!isOtpValid) {
    storedOtp.failedAttempts += 1;
    if (storedOtp.failedAttempts >= MAX_OTP_ATTEMPTS) {
      await LoginOtp.deleteOne({ _id: storedOtp._id });
      throw unauthorized("OTP attempts exceeded. Please request a new OTP");
    }

    await storedOtp.save();
    throw unauthorized("Invalid OTP");
  }

  await LoginOtp.deleteOne({ _id: storedOtp._id });

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role,
    phone: user.phone,
    branchId: user.branch ? String(user.branch) : null,
  });

  return res.json(
    new ApiResponse(
      200,
      {
        token: accessToken,
        user: safeUserResponse(user),
      },
      "Login successful",
    ),
  );
}

export async function getMe(req, res) {
  const user = await User.findById(req.user.id).lean();
  if (!user) {
    throw unauthorized("User not found");
  }

  return res.json(
    new ApiResponse(200, safeUserResponse(user), "Profile retrieved successfully"),
  );
}
