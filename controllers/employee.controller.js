import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, notFound } from "../errors/AppError.js";
import { User } from "../models/User.js";
import { EmployeeProfile } from "../models/EmployeeProfile.js";
import { Ticket } from "../models/Ticket.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { STAFF_ROLES } from "../constants/roles.js";
import "../models/Location.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
}


function buildImageUrl(req, imagePath) {
  if (!imagePath) return null;

  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }
  const base = process.env.APP_BASE_URL
    ? process.env.APP_BASE_URL.replace(/\/$/, "")
    : `${req.protocol}://${req.get("host")}`;
  return `${base}${imagePath}`;
}

// ─── Validation Schemas ───────────────────────────────────────────────────────

// Accepts both 12-hour AM/PM  → "07:00 AM", "06:00 PM"
// and 24-hour format          → "07:00",    "18:00"
const TIME_REGEX =
  /^((0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM))$|^([01]\d|2[0-3]):[0-5]\d$/i;

const updateProfileSchema = z.object({
  rating: z.number().min(0).max(5).optional(),
  performancePoints: z.number().min(0).optional(),
  assignedLocation: z.string().trim().min(1).optional(),
  shiftStart: z
    .string()
    .trim()
    .regex(TIME_REGEX, 'shiftStart must be "HH:MM AM/PM" (e.g. "07:00 AM") or "HH:MM" (e.g. "07:00")')
    .optional(),
  shiftEnd: z
    .string()
    .trim()
    .regex(TIME_REGEX, 'shiftEnd must be "HH:MM AM/PM" (e.g. "06:00 PM") or "HH:MM" (e.g. "18:00")')
    .optional(),
  timesDelayed: z.number().min(0).optional(),
  avgKeyDeliveryTime: z.number().min(0).optional(),
  violations: z.array(z.string().trim().min(1)).optional(),
});

const rateEmployeeSchema = z.object({
  rating: z.number().min(0, "Rating min is 0").max(5, "Rating max is 5"),
});

// ─── 1. GET /api/v1/employees ─────────────────────────────────────────────────
//  List employees — supports ?role=DRIVER filter
//  Driver tab   → ?role=DRIVER
//  Attendant tab → ?role=RECEPTIONIST | KEY_CONTROLLER | SUPERVISOR (or "attendant")

export async function getEmployees(req, res) {
  const roleFilter = (req.query.role || "").toUpperCase().trim();

  // Base filter: only active staff users
  const filter = {
    isActive: true,
    role: { $in: STAFF_ROLES },
  };

  // Scope to the caller's branch if they have one
  if (req.user?.branchId && isValidObjectId(req.user.branchId)) {
    filter.branch = req.user.branchId;
  }

  // Role filter — "ATTENDANT" maps to non-driver staff roles
  if (roleFilter === "ATTENDANT") {
    filter.role = { $in: STAFF_ROLES.filter((r) => r !== "DRIVER") };
  } else if (roleFilter && STAFF_ROLES.includes(roleFilter)) {
    filter.role = roleFilter;
  }

  // Optional status filter: CHECKED_IN | CHECKED_OUT | ON_BREAK
  const statusFilter = (req.query.status || "").toUpperCase().trim();
  if (statusFilter && ["CHECKED_IN", "CHECKED_OUT", "ON_BREAK"].includes(statusFilter)) {
    filter.attendanceStatus = statusFilter;
  }

  const users = await User.find(filter)
    .sort({ fullName: 1 })
    .select("fullName phone role attendanceStatus profileImage branch")
    .populate("branch", "name")
    .lean();

  // Fetch EmployeeProfile for each user (for employeeId)
  const userIds = users.map((u) => u._id);
  const profiles = await EmployeeProfile.find({ user: { $in: userIds } })
    .select("user employeeId rating")
    .lean();

  const profileMap = {};
  for (const p of profiles) {
    profileMap[String(p.user)] = p;
  }

  // Auto-create profiles for users that don't have one yet
  const { generateEmployeeId } = await import("../utils/idGenerator.js");
  const missingUserIds = userIds.filter((id) => !profileMap[String(id)]);
  for (const userId of missingUserIds) {
    const empId = await generateEmployeeId();
    const newProfile = await EmployeeProfile.create({ user: userId, employeeId: empId });
    profileMap[String(userId)] = {
      user: userId,
      employeeId: newProfile.employeeId,
      rating: newProfile.rating,
    };
  }

  const employees = users.map((u) => {
    const prof = profileMap[String(u._id)];
    return {
      id:              String(u._id),         // for navigation to details page
      employeeId:      prof?.employeeId || null, // #EMP231 shown under name
      fullName:        u.fullName,            // name shown in list
      role:            u.role,                // "Driver" / "Attendant" label
      attendanceStatus: u.attendanceStatus,   // "CHECKED_IN" | "CHECKED_OUT" | "ON_BREAK" badge
      profileImageUrl: buildImageUrl(req, u.profileImage), // circular profile photo
    };
  });

  res.status(200).json(
    new ApiResponse(200, { employees }, "Employees fetched successfully"),
  );
}

// ─── 2. GET /api/v1/employees/:id ─────────────────────────────────────────────
//  Employee profile — "Information" tab (personal details + other details + key handover)

export async function getEmployeeDetails(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw badRequest("Invalid employee ID");

  const user = await User.findOne({ _id: id, isActive: true })
    .select("fullName phone role attendanceStatus profileImage branch")
    .populate("branch", "name address")
    .lean();

  if (!user) throw notFound("Employee not found");

  // ── Get or create EmployeeProfile ─────────────────────────────────────────
  let profile = await EmployeeProfile.findOne({ user: id })
    .populate("assignedLocation", "name address")
    .lean();

  if (!profile) {
    const { generateEmployeeId } = await import("../utils/idGenerator.js");
    const employeeId = await generateEmployeeId();
    profile = await EmployeeProfile.create({ user: id, employeeId });
    profile = profile.toObject();
  }

  // ── Build profile image URL ────────────────────────────────────────────────
  // Uses APP_BASE_URL env var OR auto-detects from request (req.protocol + host).
  const profileImageUrl = buildImageUrl(req, user.profileImage);

  // ── Normalize empty strings → null ────────────────────────────────────────
  // null clearly signals "not configured yet" to the frontend.
  const shiftStart      = profile.shiftStart || null;
  const shiftEnd        = profile.shiftEnd   || null;
  const timing          = shiftStart && shiftEnd ? `${shiftStart} - ${shiftEnd}` : null;
  const location        = user.branch?.name    || null;
  const locationAddress = user.branch?.address || null;

  // ── Build response ─────────────────────────────────────────────────────────
  const result = {
    // ── Header (profile photo, name, status badge, violation badge)
    id:               String(user._id),
    fullName:         user.fullName,
    attendanceStatus: user.attendanceStatus,
    profileImageUrl,                          // full URL for <Image /> tag
    violations:       profile.violations,     // ["Key delivery violation"] → red badge

    // ── Personal Details section
    employeeId: profile.employeeId,           // #EMP231
    role:       user.role,                    // Driver
    phone:      user.phone,                   // Contact: +971 50 123 4567

    // ── Other Details section
    rating:            profile.rating,        // 5.0
    performancePoints: profile.performancePoints, // 320
    location,                                 // Dubai Mall Parking
    timing,                                   // 08:00 AM - 05:00 PM  (null if not set)

    // ── Key Handover Details section
    timesDelayed:               profile.timesDelayed,        // 4
    avgKeyDeliveryTimeFormatted: formatDuration(profile.avgKeyDeliveryTime), // 2m 30s
  };

  res.status(200).json(
    new ApiResponse(200, { employee: result }, "Employee details fetched successfully"),
  );
}

// ─── 3. GET /api/v1/employees/:id/tickets ─────────────────────────────────────
//  Ticket history — "Tickets History" tab
//  Shows: plate, ticket#, keyTag, vehicle, location, paymentStatus

export async function getEmployeeTickets(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw badRequest("Invalid employee ID");

  const user = await User.findOne({ _id: id, isActive: true })
    .select("fullName role")
    .lean();
  if (!user) throw notFound("Employee not found");

  // Find tickets where this user was the assigned driver or created the ticket
  const tickets = await Ticket.find({
    $or: [
      { assignedDriver: id },
      { createdBy: id },
    ],
  })
    .sort({ createdAt: -1 })
    .populate("vehicle", "plate make model color")
    .populate("location", "name address")
    .populate("branch", "name address")
    .lean();

  const ticketResults = tickets.map((t) => ({
    id:           String(t._id),
    ticketNumber: t.ticketNumber,          // e.g. "921680" — Ticket Number column
    numberPlate:  t.vehicle?.plate || "",  // e.g. "BB 777" — Number Plate column
    vehicleDisplay: t.vehicle             // e.g. "BMW - X6" — vehicle make+model
      ? `${t.vehicle.make} - ${t.vehicle.model}`.trim()
      : "",
    vehicleColor: t.vehicle?.color || "", // e.g. "Black" — shown below vehicle name
    keyTag:       t.keyTag || "",         // e.g. "28" — Key Tag column
    location:     t.location?.name || t.branch?.name || "", // e.g. "Al Jeewan Street"
    paymentStatus: t.payment?.status || "PENDING", // "PAID" / "PENDING" badge
    createdAt:    t.createdAt,
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      { tickets: ticketResults },
      "Employee tickets fetched successfully",
    ),
  );
}

// ─── 4. PATCH /api/v1/employees/:id/profile ───────────────────────────────────
//  Update employee profile — set shift timing, performancePoints, violations, etc.

export async function updateEmployeeProfile(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw badRequest("Invalid employee ID");

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }
  const data = parsed.data;

  const user = await User.findOne({ _id: id, isActive: true }).lean();
  if (!user) throw notFound("Employee not found");

  if (data.assignedLocation && !isValidObjectId(data.assignedLocation)) {
    throw badRequest("Invalid assignedLocation ID");
  }

  // Find or auto-create profile
  let profile = await EmployeeProfile.findOne({ user: id });
  if (!profile) {
    const { generateEmployeeId } = await import("../utils/idGenerator.js");
    const employeeId = await generateEmployeeId();
    profile = await EmployeeProfile.create({ user: id, employeeId });
  }

  // Update only the provided fields
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      profile[key] = value;
    }
  }

  await profile.save();

  // Reload to get assignedLocation populated (name/address)
  const updated = await EmployeeProfile.findById(profile._id)
    .populate("assignedLocation", "name address")
    .populate("user", "fullName role")
    .lean();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        employeeId:      updated.employeeId,
        fullName:        updated.user?.fullName || null,
        role:            updated.user?.role    || null,
        rating:          updated.rating,
        performancePoints: updated.performancePoints,
        shiftStart:      updated.shiftStart || null,
        shiftEnd:        updated.shiftEnd   || null,
        timing:          updated.shiftStart && updated.shiftEnd
          ? `${updated.shiftStart} - ${updated.shiftEnd}`
          : null,
        assignedLocation: updated.assignedLocation || null,
        timesDelayed:    updated.timesDelayed,
        avgKeyDeliveryTime:          updated.avgKeyDeliveryTime,
        avgKeyDeliveryTimeFormatted: formatDuration(updated.avgKeyDeliveryTime),
        violations:      updated.violations,
      },
      "Employee profile updated successfully",
    ),
  );
}

// ─── 5. POST /api/v1/employees/:id/rate ───────────────────────────────────────
//  Rate an employee (0–5 stars)

export async function rateEmployee(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw badRequest("Invalid employee ID");

  const parsed = rateEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }
  const { rating } = parsed.data;

  const user = await User.findOne({ _id: id, isActive: true }).lean();
  if (!user) throw notFound("Employee not found");

  // Find or auto-create profile
  let profile = await EmployeeProfile.findOne({ user: id });
  if (!profile) {
    const { generateEmployeeId } = await import("../utils/idGenerator.js");
    const employeeId = await generateEmployeeId();
    profile = await EmployeeProfile.create({ user: id, employeeId });
  }

  profile.rating = rating;
  await profile.save();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        employeeId: id,
        employeeName: user.fullName,
        rating: profile.rating,
      },
      "Employee rated successfully",
    ),
  );
}

// ─── 6. PATCH /api/v1/employees/:id/break ─────────────────────────────────────
//  Toggle an employee between ON_BREAK ↔ CHECKED_IN.
//  Only allowed when employee is currently CHECKED_IN or ON_BREAK.
//
//  No body needed — just call the endpoint.
//  Response tells you the new status.

export async function toggleBreak(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw badRequest("Invalid employee ID");

  const user = await User.findOne({ _id: id, isActive: true });
  if (!user) throw notFound("Employee not found");

  // Can only toggle break if employee is currently checked in or on break
  if (user.attendanceStatus === "CHECKED_OUT") {
    throw badRequest(
      "Employee is not checked in. You can only go on break when checked in.",
    );
  }

  // Toggle: CHECKED_IN → ON_BREAK, ON_BREAK → CHECKED_IN
  const newStatus =
    user.attendanceStatus === "ON_BREAK" ? "CHECKED_IN" : "ON_BREAK";

  user.attendanceStatus = newStatus;
  await user.save();

  const message =
    newStatus === "ON_BREAK"
      ? `${user.fullName} is now on break`
      : `${user.fullName} is back and checked in`;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        employeeId: id,
        employeeName: user.fullName,
        attendanceStatus: newStatus,
      },
      message,
    ),
  );
}
