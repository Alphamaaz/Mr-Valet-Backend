import { z } from "zod";
import { badRequest, notFound } from "../errors/AppError.js";
import { DeviceToken, DEVICE_PLATFORM } from "../models/DeviceToken.js";
import { Notification } from "../models/Notification.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const registerTokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(Object.values(DEVICE_PLATFORM)).default(DEVICE_PLATFORM.UNKNOWN),
  deviceId: z.string().trim().max(160).optional(),
  appVersion: z.string().trim().max(60).optional(),
});

const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().trim().optional(),
  unreadOnly: z.coerce.boolean().default(false),
});

function formatNotificationData(data) {
  if (!data) {
    return {};
  }

  if (data instanceof Map) {
    return Object.fromEntries(data);
  }

  if (typeof data === "object") {
    return data;
  }

  return {};
}

function formatNotification(notification) {
  return {
    id: String(notification._id),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: formatNotificationData(notification.data),
    ticket: notification.ticket ? String(notification.ticket) : null,
    readAt: notification.readAt || null,
    createdAt: notification.createdAt,
  };
}

export async function registerFcmToken(req, res) {
  const parsed = registerTokenSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const { token, platform, deviceId = "", appVersion = "" } = parsed.data;

  await DeviceToken.updateMany(
    {
      token,
      user: { $ne: req.user.id },
    },
    { $set: { isActive: false } },
  );

  const deviceToken = await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        user: req.user.id,
        platform,
        deviceId,
        appVersion,
        isActive: true,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return res.json(
    new ApiResponse(
      200,
      {
        id: String(deviceToken._id),
        platform: deviceToken.platform,
        deviceId: deviceToken.deviceId,
      },
      "FCM token registered successfully",
    ),
  );
}

export async function deleteFcmToken(req, res) {
  const token = String(req.body?.token || "").trim();
  if (!token) {
    throw badRequest("token is required");
  }

  await DeviceToken.updateOne(
    { user: req.user.id, token },
    { $set: { isActive: false } },
  );

  return res.json(new ApiResponse(200, null, "FCM token removed successfully"));
}

export async function listNotifications(req, res) {
  const parsed = listNotificationsQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    throw badRequest("Invalid query parameters", parsed.error.flatten());
  }

  const { limit, cursor, unreadOnly } = parsed.data;
  const filter = {
    user: req.user.id,
    deletedAt: null,
  };
  if (unreadOnly) {
    filter.readAt = null;
  }
  if (cursor) {
    filter._id = { $lt: cursor };
  }

  const notifications = await Notification.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = notifications.length > limit;
  const page = hasMore ? notifications.slice(0, limit) : notifications;

  return res.json(
    new ApiResponse(
      200,
      {
        notifications: page.map(formatNotification),
        nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
      },
      "Notifications fetched successfully",
    ),
  );
}

export async function getUnreadNotificationCount(req, res) {
  const count = await Notification.countDocuments({
    user: req.user.id,
    readAt: null,
    deletedAt: null,
  });

  return res.json(new ApiResponse(200, { count }, "Unread notification count fetched successfully"));
}

export async function markNotificationRead(req, res) {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: req.params.id,
      user: req.user.id,
      deletedAt: null,
    },
    { $set: { readAt: new Date() } },
    { new: true },
  );

  if (!notification) {
    throw notFound("Notification not found");
  }

  return res.json(
    new ApiResponse(200, formatNotification(notification), "Notification marked as read"),
  );
}

export async function markAllNotificationsRead(req, res) {
  const result = await Notification.updateMany(
    {
      user: req.user.id,
      readAt: null,
      deletedAt: null,
    },
    { $set: { readAt: new Date() } },
  );

  return res.json(
    new ApiResponse(200, { modifiedCount: result.modifiedCount }, "All notifications marked as read"),
  );
}

export async function deleteNotification(req, res) {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: req.params.id,
      user: req.user.id,
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
    { new: true },
  );

  if (!notification) {
    throw notFound("Notification not found");
  }

  return res.json(new ApiResponse(200, null, "Notification deleted successfully"));
}

export async function deleteAllNotifications(req, res) {
  const result = await Notification.updateMany(
    {
      user: req.user.id,
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
  );

  return res.json(
    new ApiResponse(200, { modifiedCount: result.modifiedCount }, "Notifications deleted successfully"),
  );
}
