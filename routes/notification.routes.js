import { Router } from "express";
import {
  deleteAllNotifications,
  deleteFcmToken,
  deleteNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerFcmToken,
} from "../controllers/notification.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(requireAuth);

router.post("/fcm-token", asyncHandler(registerFcmToken));
router.delete("/fcm-token", asyncHandler(deleteFcmToken));

router.get("/", asyncHandler(listNotifications));
router.get("/unread-count", asyncHandler(getUnreadNotificationCount));
router.patch("/read-all", asyncHandler(markAllNotificationsRead));
router.delete("/", asyncHandler(deleteAllNotifications));
router.patch("/:id/read", asyncHandler(markNotificationRead));
router.delete("/:id", asyncHandler(deleteNotification));

export default router;
