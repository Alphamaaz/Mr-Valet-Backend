import jwt from "jsonwebtoken";
import { z } from "zod";
import QRCode from "qrcode";
import { AppError, badRequest, forbidden, unauthorized } from "../errors/AppError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Attendance } from "../models/Attendance.js";
import { Branch } from "../models/Branch.js";
import { User } from "../models/User.js";
import {
  autoCheckoutStaleAttendances,
  getAttendanceDateKey,
} from "../services/attendance.service.js";

const ATTENDANCE_TIMEZONE = process.env.ATTENDANCE_TIMEZONE || "Asia/Karachi";
const MAX_LOCATION_ACCURACY_METERS = Number(process.env.MAX_LOCATION_ACCURACY_METERS || 50);
const MAX_LOCATION_AGE_SECONDS = Number(process.env.MAX_LOCATION_AGE_SECONDS || 15);
// const DYNAMIC_ATTENDANCE_QR_EXPIRY_SECONDS = Number(process.env.ATTENDANCE_QR_EXPIRY_SECONDS || 30); // QR expiry disabled

const attendancePayloadSchema = z.object({
  qrToken: z.string().trim().min(10),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().optional(),
  capturedAt: z.string().datetime().optional(),
  deviceInfo: z.record(z.string(), z.any()).optional(),
});

const dynamicAttendanceQrCodeParamsSchema = z.object({
  branchId: z.string().trim().min(1),
});

function getAttendanceQrSecret() {
  const secret = process.env.ATTENDANCE_QR_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("ATTENDANCE_QR_SECRET or JWT_SECRET is required");
  }
  return secret;
}

function getDistanceMeters(from, to) {
  const earthRadius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;

  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadius * c);
}

function verifyAttendanceQrToken(qrToken, branchId) {
  try {
    const decoded = jwt.verify(qrToken, getAttendanceQrSecret());
    if (decoded.purpose !== "ATTENDANCE") {
      throw badRequest("Invalid QR token purpose");
    }

    if (!decoded.branchId || String(decoded.branchId) !== String(branchId)) {
      throw forbidden("QR token does not belong to your branch");
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw unauthorized("QR token is invalid or expired");
  }
}

function buildAttendanceQrToken({ branch, issuedFor, expiresInSeconds }) {
  return jwt.sign(
    {
      purpose: "ATTENDANCE",
      branchId: String(branch._id),
      branchCode: branch.code,
      jti: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      issuedFor,
    },
    getAttendanceQrSecret(),
    {}, // { expiresIn: expiresInSeconds }, // QR expiry disabled
  );
}

function validateLocationFreshness(capturedAt) {
  if (!capturedAt) {
    return;
  }

  const ageSeconds = Math.floor((Date.now() - new Date(capturedAt).getTime()) / 1000);
  if (ageSeconds > MAX_LOCATION_AGE_SECONDS) {
    throw new AppError(
      `Location is stale. Refresh GPS and retry (older than ${MAX_LOCATION_AGE_SECONDS}s).`,
      { statusCode: 422, code: "STALE_LOCATION", expose: true },
    );
  }
}

function validateLocationAccuracy(accuracyMeters) {
  if (accuracyMeters === undefined || accuracyMeters === null) {
    return;
  }

  if (accuracyMeters > MAX_LOCATION_ACCURACY_METERS) {
    throw new AppError(
      `Low GPS accuracy (${accuracyMeters}m). Move to open sky and retry.`,
      { statusCode: 422, code: "LOW_LOCATION_ACCURACY", expose: true },
    );
  }
}

async function getActiveBranchForUser(req) {
  if (!req.user?.branchId) {
    throw forbidden("User is not assigned to a branch");
  }

  const branch = await Branch.findOne({
    _id: req.user.branchId,
    isActive: true,
  }).lean();

  if (!branch) {
    throw forbidden("Branch is inactive or invalid");
  }

  return branch;
}

async function validateAttendanceScan(req, payload) {
  validateLocationFreshness(payload.capturedAt);
  validateLocationAccuracy(payload.accuracyMeters);

  const branch = await getActiveBranchForUser(req);
  verifyAttendanceQrToken(payload.qrToken, branch._id);

  const distanceMeters = getDistanceMeters(
    { latitude: branch.latitude, longitude: branch.longitude },
    { latitude: payload.latitude, longitude: payload.longitude },
  );

  if (distanceMeters > branch.allowedRadiusMeters) {
    throw new AppError(
      `You are outside your work location by ${distanceMeters - branch.allowedRadiusMeters}m. Move closer and retry.`,
      { statusCode: 403, code: "OUTSIDE_WORK_LOCATION", expose: true },
    );
  }

  return {
    branch,
    distanceMeters,
  };
}

export async function getDynamicAttendanceQrCode(req, res) {
  const parsed = dynamicAttendanceQrCodeParamsSchema.safeParse(req.params || {});
  if (!parsed.success) {
    throw badRequest("Invalid request parameters", parsed.error.flatten());
  }

  const branch = await Branch.findOne({
    _id: parsed.data.branchId,
    isActive: true,
  }).lean();

  if (!branch) {
    throw badRequest("Branch is invalid or inactive");
  }

  // QR expiry disabled — token does not expire
  // const expiresInSeconds = Number.isFinite(DYNAMIC_ATTENDANCE_QR_EXPIRY_SECONDS)
  //   && DYNAMIC_ATTENDANCE_QR_EXPIRY_SECONDS > 0
  //   ? DYNAMIC_ATTENDANCE_QR_EXPIRY_SECONDS
  //   : 30;

  const qrToken = buildAttendanceQrToken({
    branch,
    issuedFor: "DYNAMIC_LOCATION_QR",
    expiresInSeconds: null,
  });

  const qrImageDataUrl = await QRCode.toDataURL(qrToken, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });

  const now = new Date();
  // const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000); // QR expiry disabled

  return res.json(
    new ApiResponse(
      200,
      {
        branch: {
          id: String(branch._id),
          name: branch.name,
          code: branch.code,
          address: branch.address,
        },
        qrToken,
        qrImageDataUrl,
        issuedAt: now,
        // expiresAt,          // QR expiry disabled
        // expiresInSeconds,   // QR expiry disabled
        // refreshAfterSeconds: Math.max(expiresInSeconds - 3, 1), // QR expiry disabled
      },
      "Dynamic attendance QR generated successfully",
    ),
  );
}

export async function scanAttendance(req, res) {
  const parsed = attendancePayloadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const { branch, distanceMeters } = await validateAttendanceScan(req, payload);
  await autoCheckoutStaleAttendances({ userId: req.user.id });
  const dateKey = getAttendanceDateKey(new Date());

  const activeAttendance = await Attendance.findOne({
    user: req.user.id,
    status: "ACTIVE",
    dateKey,
  });

  if (activeAttendance) {
    activeAttendance.checkOutTime = new Date();
    activeAttendance.checkOutLatitude = payload.latitude;
    activeAttendance.checkOutLongitude = payload.longitude;
    activeAttendance.checkOutAccuracyMeters = payload.accuracyMeters ?? null;
    activeAttendance.checkOutDistanceMeters = distanceMeters;
    activeAttendance.status = "COMPLETED";

    await activeAttendance.save();
    await User.findByIdAndUpdate(req.user.id, { attendanceStatus: "CHECKED_OUT" });

    return res.json(
      new ApiResponse(
        200,
        {
          action: "CHECK_OUT",
          attendanceId: String(activeAttendance._id),
          status: activeAttendance.status,
          checkOutTime: activeAttendance.checkOutTime,
          branchId: String(branch._id),
        },
        "Check-out marked successfully",
      ),
    );
  }

  const todayAttendance = await Attendance.findOne({
    user: req.user.id,
    dateKey,
  }).lean();

  if (todayAttendance) {
    throw new AppError(
      "Attendance already checked out for today. Duplicate check-in is not allowed.",
      { statusCode: 409, code: "ATTENDANCE_ALREADY_COMPLETED_TODAY", expose: true },
    );
  }

  const attendance = await Attendance.create({
    user: req.user.id,
    branch: branch._id,
    dateKey,
    checkInTime: new Date(),
    checkInLatitude: payload.latitude,
    checkInLongitude: payload.longitude,
    checkInAccuracyMeters: payload.accuracyMeters ?? null,
    checkInDistanceMeters: distanceMeters,
    status: "ACTIVE",
    deviceInfo: payload.deviceInfo || null,
  });

  await User.findByIdAndUpdate(req.user.id, { attendanceStatus: "CHECKED_IN" });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        action: "CHECK_IN",
        attendanceId: String(attendance._id),
        status: attendance.status,
        checkInTime: attendance.checkInTime,
        branchId: String(branch._id),
      },
      "Check-in marked successfully",
    ),
  );
}

export async function getMyAttendanceStatus(req, res) {
  await autoCheckoutStaleAttendances({ userId: req.user.id });
  const todayDateKey = getAttendanceDateKey(new Date());

  const todayAttendance = await Attendance.findOne({
    user: req.user.id,
    dateKey: todayDateKey,
  }).lean();

  if (!todayAttendance) {
    await User.findByIdAndUpdate(req.user.id, { attendanceStatus: "ON_BREAK" });
    return res.json(
      new ApiResponse(
        200,
        { checkedIn: false, status: "ON_BREAK", dateKey: todayDateKey },
        "No check-in found today. User marked as ON_BREAK.",
      ),
    );
  }

  if (todayAttendance.status === "ACTIVE") {
    await User.findByIdAndUpdate(req.user.id, { attendanceStatus: "CHECKED_IN" });
    return res.json(
      new ApiResponse(
        200,
        {
          checkedIn: true,
          status: "CHECKED_IN",
          attendanceId: String(todayAttendance._id),
          checkInTime: todayAttendance.checkInTime,
          dateKey: todayDateKey,
        },
        "Active attendance found for today",
      ),
    );
  }

  await User.findByIdAndUpdate(req.user.id, { attendanceStatus: "CHECKED_OUT" });
  return res.json(
    new ApiResponse(
      200,
      {
        checkedIn: false,
        status: "CHECKED_OUT",
        attendanceId: String(todayAttendance._id),
        checkInTime: todayAttendance.checkInTime,
        checkOutTime: todayAttendance.checkOutTime,
        dateKey: todayDateKey,
      },
      "Attendance already checked out for today",
    ),
  );
}
