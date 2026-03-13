import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadVoice } from "../middleware/uploadVoice.js";
import {
  createGroup,
  getMyGroups,
  getGroupDetails,
  sendGroupMessage,
  sendVoiceMessage,
  getGroupMessages,
  markGroupAsRead,
  addMembers,
  removeMember,
  getUnreadCount,
  searchChatUsers,
  deleteMessage,
} from "../controllers/chat.controller.js";

const router = Router();

// All chat routes require authentication
router.use(requireAuth);

// GET  /api/v1/chat/users                        – Search staff users to add to groups
router.get("/users", asyncHandler(searchChatUsers));

// GET  /api/v1/chat/unread-count                 – Total unread badge count across all groups
router.get("/unread-count", asyncHandler(getUnreadCount));

// POST /api/v1/chat/groups                       – Create a new group
router.post("/groups", asyncHandler(createGroup));

// GET  /api/v1/chat/groups                       – List my groups
router.get("/groups", asyncHandler(getMyGroups));

// GET  /api/v1/chat/groups/:groupId              – Get single group details
router.get("/groups/:groupId", asyncHandler(getGroupDetails));

// POST /api/v1/chat/groups/:groupId/members      – Add members to group
router.post("/groups/:groupId/members", asyncHandler(addMembers));

// DELETE /api/v1/chat/groups/:groupId/members    – Remove member from group
router.delete("/groups/:groupId/members", asyncHandler(removeMember));

// POST /api/v1/chat/messages                     – Send text message to a group
router.post("/messages", asyncHandler(sendGroupMessage));

// POST /api/v1/chat/messages/voice               – Send voice message to a group
router.post("/messages/voice", uploadVoice, asyncHandler(sendVoiceMessage));

// GET  /api/v1/chat/messages/:groupId            – Get messages in a group
router.get("/messages/:groupId", asyncHandler(getGroupMessages));

// DELETE /api/v1/chat/messages/:messageId         – Delete a message (text or voice)
router.delete("/messages/:messageId", asyncHandler(deleteMessage));

// PATCH /api/v1/chat/messages/:groupId/read      – Mark group messages as read
router.patch("/messages/:groupId/read", asyncHandler(markGroupAsRead));

export default router;
