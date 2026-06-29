import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";

const ATTENDANCE_TIMEZONE = process.env.ATTENDANCE_TIMEZONE || "Asia/Karachi";

export function getAttendanceDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function autoCheckoutStaleAttendances({ userId = null } = {}) {
  const todayDateKey = getAttendanceDateKey(new Date());
  const filter = {
    status: "ACTIVE",
    dateKey: { $ne: todayDateKey },
  };

  if (userId) {
    filter.user = userId;
  }

  const staleAttendances = await Attendance.find(filter).select("_id user").lean();
  if (!staleAttendances.length) {
    return { updatedCount: 0, userIds: [] };
  }

  const attendanceIds = staleAttendances.map((attendance) => attendance._id);
  const userIds = [...new Set(staleAttendances.map((attendance) => String(attendance.user)))];
  const now = new Date();

  const result = await Attendance.updateMany(
    { _id: { $in: attendanceIds }, status: "ACTIVE" },
    {
      $set: {
        status: "AUTO_CHECKED_OUT",
        checkOutTime: now,
        autoCheckoutReason: "Forgot checkout. Auto checked out at next day start.",
      },
    },
  );

  if (userIds.length) {
    await User.updateMany(
      { _id: { $in: userIds } },
      { $set: { attendanceStatus: "CHECKED_OUT" } },
    );
  }

  return {
    updatedCount: result.modifiedCount || 0,
    userIds,
  };
}
