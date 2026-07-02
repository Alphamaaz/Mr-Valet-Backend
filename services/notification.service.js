import { DeviceToken } from "../models/DeviceToken.js";
import { Notification, NOTIFICATION_TYPES } from "../models/Notification.js";
import { getFirebaseMessaging } from "./firebase.service.js";

function normalizeData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function isInvalidFcmTokenError(error) {
  const code = error?.errorInfo?.code || error?.code || "";
  return [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
    "messaging/invalid-argument",
  ].includes(code);
}

export async function saveNotificationForUser({
  userId,
  title,
  body,
  type = NOTIFICATION_TYPES.SYSTEM,
  ticketId = null,
  data = {},
}) {
  if (!userId || !title || !body) {
    return null;
  }

  return Notification.create({
    user: userId,
    type,
    title,
    body,
    ticket: ticketId,
    data: normalizeData(data),
  });
}

export async function sendPushToUser({
  userId,
  title,
  body,
  type = NOTIFICATION_TYPES.SYSTEM,
  ticketId = null,
  data = {},
  persist = true,
}) {
  if (!userId || !title || !body) {
    return { saved: null, sent: 0, failed: 0 };
  }

  const saved = persist
    ? await saveNotificationForUser({ userId, title, body, type, ticketId, data })
    : null;

  const messaging = getFirebaseMessaging();
  if (!messaging) {
    return { saved, sent: 0, failed: 0, skipped: "FIREBASE_NOT_CONFIGURED" };
  }

  const tokens = await DeviceToken.find({
    user: userId,
    isActive: true,
  })
    .select("_id token")
    .lean();

  if (!tokens.length) {
    return { saved, sent: 0, failed: 0, skipped: "NO_ACTIVE_TOKENS" };
  }

  const payloadData = normalizeData({
    ...data,
    notificationId: saved ? String(saved._id) : "",
    type,
    ticketId,
  });

  const results = await Promise.allSettled(
    tokens.map((item) => messaging.send({
      token: item.token,
      notification: { title, body },
      data: payloadData,
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    })),
  );

  const invalidTokenIds = [];
  let sent = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }
    failed += 1;
    if (isInvalidFcmTokenError(result.reason)) {
      invalidTokenIds.push(tokens[index]._id);
    }
  });

  if (invalidTokenIds.length) {
    await DeviceToken.updateMany(
      { _id: { $in: invalidTokenIds } },
      { $set: { isActive: false } },
    );
  }

  return { saved, sent, failed };
}

export { NOTIFICATION_TYPES };
