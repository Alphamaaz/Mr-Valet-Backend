import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
import { EmployeeProfile } from "../models/EmployeeProfile.js";
import { STAFF_ROLES } from "../constants/roles.js";
import { TICKET_STATUS } from "../constants/ticketStatus.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { forbidden } from "../errors/AppError.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
}

// Start and end of today in UTC
function todayRange() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

// Start and end of yesterday in UTC
function yesterdayRange() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 1);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

// Percent change vs yesterday (positive = increase, negative = decrease)
function changePercent(today, yesterday) {
  if (yesterday === 0) return today > 0 ? 100 : 0;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

// ─── GET /api/v1/dashboard ────────────────────────────────────────────────────
// Returns all stats shown on the Dashboard tab:
//   Shift Start / End, Total / CheckedIn / OnBreak counts,
//   Cars In/Out (today vs yesterday), Avg. wait time

export async function getDashboardStats(req, res) {
  const branchId = req.user?.branchId;
  if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) {
    throw forbidden("You are not assigned to a valid branch");
  }

  const { start: todayStart, end: todayEnd } = todayRange();
  const { start: yStart, end: yEnd } = yesterdayRange();

  // ── Shift times from the logged-in user's EmployeeProfile ─────────────────
  const myProfile = await EmployeeProfile.findOne({ user: req.user._id })
    .select("shiftStart shiftEnd")
    .lean();

  // ── Employee headcount for this branch ───────────────────────────────────
  const [totalEmployees, checkedIn, onBreak] = await Promise.all([
    User.countDocuments({ branch: branchId, isActive: true, role: { $in: STAFF_ROLES } }),
    User.countDocuments({ branch: branchId, isActive: true, role: { $in: STAFF_ROLES }, attendanceStatus: "CHECKED_IN" }),
    User.countDocuments({ branch: branchId, isActive: true, role: { $in: STAFF_ROLES }, attendanceStatus: "ON_BREAK" }),
  ]);

  // ── Cars In = tickets created today, Cars Out = tickets delivered today ───
  const [carsInToday, carsOutToday, carsInYesterday, carsOutYesterday] = await Promise.all([
    Ticket.countDocuments({ branch: branchId, createdAt: { $gte: todayStart, $lte: todayEnd } }),
    Ticket.countDocuments({
      branch: branchId,
      status: { $in: [TICKET_STATUS.DELIVERED, TICKET_STATUS.COMPLETED, TICKET_STATUS.PAID] },
      updatedAt: { $gte: todayStart, $lte: todayEnd },
    }),
    Ticket.countDocuments({ branch: branchId, createdAt: { $gte: yStart, $lte: yEnd } }),
    Ticket.countDocuments({
      branch: branchId,
      status: { $in: [TICKET_STATUS.DELIVERED, TICKET_STATUS.COMPLETED, TICKET_STATUS.PAID] },
      updatedAt: { $gte: yStart, $lte: yEnd },
    }),
  ]);


  // Uses TicketEvent pairs: CREATED timestamp → DELIVERED timestamp per ticket
  const todayTicketIds = await Ticket.find({
    branch: branchId,
    status: { $in: [TICKET_STATUS.DELIVERED, TICKET_STATUS.COMPLETED, TICKET_STATUS.PAID] },
    updatedAt: { $gte: todayStart, $lte: todayEnd },
  }).distinct("_id");

  // Get CREATED and DELIVERED events for today's completed tickets
  const waitEvents = await TicketEvent.aggregate([
    { $match: { ticket: { $in: todayTicketIds }, status: { $in: [TICKET_STATUS.CREATED, TICKET_STATUS.DELIVERED] } } },
    { $sort: { createdAt: 1 } },
    { $group: {
        _id: "$ticket",
        createdAt:   { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.CREATED] }, "$createdAt", null] } },
        deliveredAt: { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.DELIVERED] }, "$createdAt", null] } },
    }},
    { $match: { createdAt: { $ne: null }, deliveredAt: { $ne: null } } },
    { $project: { waitSeconds: { $divide: [{ $subtract: ["$deliveredAt", "$createdAt"] }, 1000] } } },
    { $group: { _id: null, avgWaitSeconds: { $avg: "$waitSeconds" } } },
  ]);

  // Yesterday's avg wait for percent comparison
  const yTicketIds = await Ticket.find({
    branch: branchId,
    status: { $in: [TICKET_STATUS.DELIVERED, TICKET_STATUS.COMPLETED, TICKET_STATUS.PAID] },
    updatedAt: { $gte: yStart, $lte: yEnd },
  }).distinct("_id");

  const yWaitEvents = await TicketEvent.aggregate([
    { $match: { ticket: { $in: yTicketIds }, status: { $in: [TICKET_STATUS.CREATED, TICKET_STATUS.DELIVERED] } } },
    { $sort: { createdAt: 1 } },
    { $group: {
        _id: "$ticket",
        createdAt:   { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.CREATED] }, "$createdAt", null] } },
        deliveredAt: { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.DELIVERED] }, "$createdAt", null] } },
    }},
    { $match: { createdAt: { $ne: null }, deliveredAt: { $ne: null } } },
    { $project: { waitSeconds: { $divide: [{ $subtract: ["$deliveredAt", "$createdAt"] }, 1000] } } },
    { $group: { _id: null, avgWaitSeconds: { $avg: "$waitSeconds" } } },
  ]);

  const avgWaitSecondsToday     = Math.round(waitEvents[0]?.avgWaitSeconds ?? 0);
  const avgWaitSecondsYesterday = Math.round(yWaitEvents[0]?.avgWaitSeconds ?? 0);

  return res.json(
    new ApiResponse(
      200,
      {
        // Shift times for the logged-in user
        shift: {
          start: myProfile?.shiftStart || null,
          end:   myProfile?.shiftEnd   || null,
        },

        // Employee headcount (Total / Checked In / On Break cards)
        employees: {
          total:     totalEmployees,
          checkedIn: checkedIn,
          onBreak:   onBreak,
        },

        // Cars In / Out today with % change vs yesterday
        cars: {
          in:            carsInToday,
          out:           carsOutToday,
          changePercent: changePercent(carsInToday, carsInYesterday),
        },

        // Average customer wait time today with % change vs yesterday
        avgWait: {
          seconds:       avgWaitSecondsToday,
          formatted:     formatDuration(avgWaitSecondsToday),
          changePercent: changePercent(avgWaitSecondsToday, avgWaitSecondsYesterday),
        },
      },
      "Dashboard stats fetched successfully",
    ),
  );
}
