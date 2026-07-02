import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Ticket } from "../models/Ticket.js";
import { TicketEvent } from "../models/TicketEvent.js";
import { EmployeeProfile } from "../models/EmployeeProfile.js";
import { Branch } from "../models/Branch.js";
import { ROLES, STAFF_ROLES } from "../constants/roles.js";
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

function getLiveTicketFilter(baseFilter = {}) {
  return {
    ...baseFilter,
    $or: [
      { status: { $ne: TICKET_STATUS.DELIVERED } },
      { status: TICKET_STATUS.DELIVERED, ownerCompletedAt: null },
    ],
  };
}

function buildManagerBranchFilter(req) {
  const requestedBranchId = req.query.branchId ? String(req.query.branchId) : "";
  const isGlobalManager = req.user?.role === ROLES.SUPER_ADMIN;

  if (requestedBranchId && !mongoose.Types.ObjectId.isValid(requestedBranchId)) {
    throw forbidden("Invalid branch filter");
  }

  if (isGlobalManager) {
    return requestedBranchId ? { branch: new mongoose.Types.ObjectId(requestedBranchId) } : {};
  }

  if (!req.user?.branchId || !mongoose.Types.ObjectId.isValid(req.user.branchId)) {
    throw forbidden("You are not assigned to a valid branch");
  }

  if (requestedBranchId && requestedBranchId !== req.user.branchId) {
    throw forbidden("You can only view your assigned branch");
  }

  return { branch: new mongoose.Types.ObjectId(req.user.branchId) };
}

function normalizeManagerStatusCounts(rows = []) {
  const counts = Object.fromEntries(Object.values(TICKET_STATUS).map((status) => [status, 0]));

  for (const row of rows) {
    if (row?._id) {
      counts[row._id] = row.count || 0;
    }
  }

  return {
    received: counts[TICKET_STATUS.READY_TO_BE_PARKED],
    readyToPark: counts[TICKET_STATUS.READY_TO_BE_PARKED],
    onTheWayToParking: counts[TICKET_STATUS.ON_THE_WAY_TO_PARKING],
    parkedIn: counts[TICKET_STATUS.PARKED_IN],
    requested: counts[TICKET_STATUS.RETRIEVAL_REQUESTED],
    onTheWayToDelivery: counts[TICKET_STATUS.ON_THE_WAY_TO_DELIVERY],
    delivered: counts[TICKET_STATUS.DELIVERED],
    delayed: 0,
    raw: counts,
  };
}

function normalizeVipNormalCounts(rows = []) {
  const counts = { vip: 0, normal: 0 };

  for (const row of rows) {
    if (row?._id === "VIP") {
      counts.vip = row.count || 0;
    } else {
      counts.normal += row?.count || 0;
    }
  }

  return counts;
}

async function countDelayedTickets(matchFilter) {
  const now = new Date();
  const [result] = await Ticket.aggregate([
    {
      $match: {
        ...matchFilter,
        parkedAt: { $ne: null },
        keyReceivedAt: null,
        status: {
          $in: [
            TICKET_STATUS.PARKED_IN,
            TICKET_STATUS.RETRIEVAL_REQUESTED,
            TICKET_STATUS.ON_THE_WAY_TO_DELIVERY,
          ],
        },
      },
    },
    {
      $lookup: {
        from: "branches",
        localField: "branch",
        foreignField: "_id",
        as: "branchInfo",
      },
    },
    { $unwind: { path: "$branchInfo", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        keyReturnDueAt: {
          $add: [
            "$parkedAt",
            { $multiply: [{ $ifNull: ["$branchInfo.keyReturnSlaSeconds", 90] }, 1000] },
          ],
        },
      },
    },
    { $match: { keyReturnDueAt: { $lt: now } } },
    { $count: "count" },
  ]);

  return result?.count || 0;
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
  const myProfile = await EmployeeProfile.findOne({ user: req.user.id })
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
      status: { $in: [TICKET_STATUS.DELIVERED] },
      updatedAt: { $gte: todayStart, $lte: todayEnd },
    }),
    Ticket.countDocuments({ branch: branchId, createdAt: { $gte: yStart, $lte: yEnd } }),
    Ticket.countDocuments({
      branch: branchId,
      status: { $in: [TICKET_STATUS.DELIVERED] },
      updatedAt: { $gte: yStart, $lte: yEnd },
    }),
  ]);


  // Uses TicketEvent pairs: READY_TO_BE_PARKED timestamp -> DELIVERED timestamp per ticket
  const todayTicketIds = await Ticket.find({
    branch: branchId,
    status: { $in: [TICKET_STATUS.DELIVERED] },
    updatedAt: { $gte: todayStart, $lte: todayEnd },
  }).distinct("_id");

  // Get READY_TO_BE_PARKED and DELIVERED events for today's completed tickets
  const waitEvents = await TicketEvent.aggregate([
    { $match: { ticket: { $in: todayTicketIds }, status: { $in: [TICKET_STATUS.READY_TO_BE_PARKED, TICKET_STATUS.DELIVERED] } } },
    { $sort: { createdAt: 1 } },
    { $group: {
        _id: "$ticket",
        createdAt:   { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.READY_TO_BE_PARKED] }, "$createdAt", null] } },
        closedAt: { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.DELIVERED] }, "$createdAt", null] } },
    }},
    { $match: { createdAt: { $ne: null }, closedAt: { $ne: null } } },
    { $project: { waitSeconds: { $divide: [{ $subtract: ["$closedAt", "$createdAt"] }, 1000] } } },
    { $group: { _id: null, avgWaitSeconds: { $avg: "$waitSeconds" } } },
  ]);

  // Yesterday's avg wait for percent comparison
  const yTicketIds = await Ticket.find({
    branch: branchId,
    status: { $in: [TICKET_STATUS.DELIVERED] },
    updatedAt: { $gte: yStart, $lte: yEnd },
  }).distinct("_id");

  const yWaitEvents = await TicketEvent.aggregate([
    { $match: { ticket: { $in: yTicketIds }, status: { $in: [TICKET_STATUS.READY_TO_BE_PARKED, TICKET_STATUS.DELIVERED] } } },
    { $sort: { createdAt: 1 } },
    { $group: {
        _id: "$ticket",
        createdAt:   { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.READY_TO_BE_PARKED] }, "$createdAt", null] } },
        closedAt: { $first: { $cond: [{ $eq: ["$status", TICKET_STATUS.DELIVERED] }, "$createdAt", null] } },
    }},
    { $match: { createdAt: { $ne: null }, closedAt: { $ne: null } } },
    { $project: { waitSeconds: { $divide: [{ $subtract: ["$closedAt", "$createdAt"] }, 1000] } } },
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

// GET /api/v1/dashboard/manager
// Read-only manager overview for live valet operations across one branch or all branches.
export async function getManagerDashboardStats(req, res) {
  const branchFilter = buildManagerBranchFilter(req);
  const receivingPoint = req.query.receivingPoint ? String(req.query.receivingPoint).trim() : "";
  const baseFilter = receivingPoint ? { ...branchFilter, receivingPoint } : branchFilter;
  const liveFilter = getLiveTicketFilter(baseFilter);

  const { start: todayStart, end: todayEnd } = todayRange();
  const { start: yStart, end: yEnd } = yesterdayRange();

  const branchSelect = "name code address isActive";
  const locationsFilter = req.user?.role === ROLES.SUPER_ADMIN
    ? { isActive: true }
    : { _id: req.user.branchId, isActive: true };

  const [
    locations,
    receivingPoints,
    totalStaff,
    statusRows,
    vipNormalRows,
    delayedTickets,
    todayLiveTickets,
    yesterdayLiveTickets,
  ] = await Promise.all([
    Branch.find(locationsFilter).select(branchSelect).sort({ name: 1 }).lean(),
    Ticket.distinct("receivingPoint", {
      ...branchFilter,
      receivingPoint: { $nin: ["", null] },
    }),
    User.countDocuments({ ...branchFilter, isActive: true, role: { $in: STAFF_ROLES } }),
    Ticket.aggregate([
      { $match: liveFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Ticket.aggregate([
      { $match: liveFilter },
      {
        $project: {
          bucket: {
            $cond: [
              { $regexMatch: { input: { $toUpper: "$serviceType" }, regex: "VIP" } },
              "VIP",
              "NORMAL",
            ],
          },
        },
      },
      { $group: { _id: "$bucket", count: { $sum: 1 } } },
    ]),
    countDelayedTickets(liveFilter),
    Ticket.countDocuments({ ...liveFilter, createdAt: { $gte: todayStart, $lte: todayEnd } }),
    Ticket.countDocuments({ ...liveFilter, createdAt: { $gte: yStart, $lte: yEnd } }),
  ]);

  const statusCounts = normalizeManagerStatusCounts(statusRows);
  statusCounts.delayed = delayedTickets;

  const vipNormal = normalizeVipNormalCounts(vipNormalRows);
  const totalVehicles = Object.values(statusCounts.raw).reduce((sum, count) => sum + count, 0);

  return res.json(
    new ApiResponse(
      200,
      {
        filters: {
          selectedBranchId: branchFilter.branch ? String(branchFilter.branch) : "ALL",
          selectedReceivingPoint: receivingPoint || "ALL",
          locations: locations.map((branch) => ({
            id: String(branch._id),
            name: branch.name,
            code: branch.code,
            address: branch.address,
          })),
          receivingPoints: receivingPoints.filter(Boolean).sort(),
        },
        summary: {
          totalStaff,
          totalVehicles,
          vipVehicles: vipNormal.vip,
          normalVehicles: vipNormal.normal,
          delayedVehicles: delayedTickets,
          liveTicketChangePercent: changePercent(todayLiveTickets, yesterdayLiveTickets),
        },
        liveVehicleStatus: {
          updatedAt: new Date().toISOString(),
          totalInPipeline: totalVehicles,
          counts: statusCounts,
          segments: [
            { key: "received", label: "RECEIVED", count: statusCounts.received },
            { key: "readyToPark", label: "READY TO PARK", count: statusCounts.readyToPark },
            { key: "onTheWayToParking", label: "ON THE WAY TO PARKING", count: statusCounts.onTheWayToParking },
            { key: "parkedIn", label: "PARKED IN", count: statusCounts.parkedIn },
            { key: "requested", label: "REQUESTED", count: statusCounts.requested },
            { key: "onTheWayToDelivery", label: "ON THE WAY TO DELIVERY", count: statusCounts.onTheWayToDelivery },
            { key: "delivered", label: "DELIVERED", count: statusCounts.delivered },
            { key: "delayed", label: "DELAYED", count: delayedTickets },
          ],
        },
        vipVsNormal: {
          totalInPipeline: totalVehicles,
          vip: vipNormal.vip,
          normal: vipNormal.normal,
        },
      },
      "Manager dashboard fetched successfully",
    ),
  );
}



