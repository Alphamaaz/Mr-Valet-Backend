import mongoose from "mongoose";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { badRequest, notFound, forbidden } from "../errors/AppError.js";
import { ChatGroup } from "../models/ChatGroup.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { publishEvent } from "../utils/redis.js";
import { STAFF_ROLES } from "../constants/roles.js";

// ─── Validation Schemas ───────────────────────────────────────────────

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(100),
  description: z.string().trim().max(500).optional(),
  memberIds: z.array(z.string().trim().min(1)).optional().default([]),
  branchId: z.string().trim().min(1).optional(),
}).refine((d) => d.memberIds.length > 0 || d.branchId, {
  message: "Provide memberIds or branchId (or both)",
});

const addMembersSchema = z.object({
  memberIds: z.array(z.string().trim().min(1)).optional().default([]),
  branchId: z.string().trim().min(1).optional(),
}).refine((d) => d.memberIds.length > 0 || d.branchId, {
  message: "Provide memberIds or branchId (or both)",
});

const removeMemberSchema = z.object({
  memberId: z.string().trim().min(1, "memberId is required"),
});

const sendMessageSchema = z.object({
  groupId: z.string().trim().min(1, "groupId is required"),
  text: z.string().trim().min(1, "Message text is required").max(2000),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

// ─── 1. Create a Group ────────────────────────────────────────────────

export async function createGroup(req, res) {
  const { name, description, memberIds, branchId } = createGroupSchema.parse(req.body);
  const creatorId = req.user.id;

  // Validate all member IDs
  for (const id of memberIds) {
    if (!isValidObjectId(id)) throw badRequest(`Invalid member ID: ${id}`);
  }

  // If branchId provided, fetch all active staff from that branch
  let branchUserIds = [];
  if (branchId) {
    if (!isValidObjectId(branchId)) throw badRequest("Invalid branchId");
    const branchUsers = await User.find({ branch: branchId, isActive: true })
      .select("_id")
      .lean();
    if (branchUsers.length === 0) throw badRequest("No active users found in this branch");
    branchUserIds = branchUsers.map((u) => String(u._id));
  }

  // Make sure creator is always a member
  const uniqueMembers = [...new Set([creatorId, ...memberIds, ...branchUserIds])];

  // Verify all members exist and are active
  const users = await User.find({
    _id: { $in: uniqueMembers },
    isActive: true,
  }).lean();

  if (users.length !== uniqueMembers.length) {
    throw badRequest("One or more members not found or inactive");
  }

  // Build initial unread counts (0 for everyone)
  const unreadCounts = {};
  for (const memberId of uniqueMembers) {
    unreadCounts[memberId] = 0;
  }

  const group = await ChatGroup.create({
    name,
    description: description || "",
    members: uniqueMembers,
    createdBy: creatorId,
    unreadCounts,
  });

  const populated = await ChatGroup.findById(group._id)
    .populate("members", "fullName phone role")
    .populate("createdBy", "fullName phone role")
    .lean();

  // Notify all members via Redis Pub/Sub
  await publishEvent("chat:group:created", {
    group: populated,
  });

  // Notify via Socket.IO
  const io = req.app.get("io");
  if (io) {
    for (const memberId of uniqueMembers) {
      io.to(`user_${memberId}`).emit("group_created", { group: populated });
    }
  }

  res.status(201).json(
    new ApiResponse(201, { group: populated }, "Group created successfully"),
  );
}

// ─── 2. Get My Groups ────────────────────────────────────────────────

export async function getMyGroups(req, res) {
  const { page, limit } = paginationSchema.parse(req.query);
  const userId = req.user.id;
  const skip = (page - 1) * limit;

  const filter = (req.query.filter || "all").toLowerCase();

  const matchStage = {
    members: new mongoose.Types.ObjectId(userId),
    isActive: true,
  };

  const groups = await ChatGroup.find(matchStage)
    .sort({ "lastMessage.createdAt": -1, updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("members", "fullName phone role")
    .populate("createdBy", "fullName phone role")
    .lean();

  const results = groups
    .map((g) => ({
      _id: g._id,
      name: g.name,
      description: g.description,
      members: g.members,
      createdBy: g.createdBy,
      lastMessage: g.lastMessage,
      unreadCount: g.unreadCounts?.[userId] || 0,
      memberCount: g.members.length,
      updatedAt: g.updatedAt,
    }))
    .filter((g) => {
      if (filter === "unread") return g.unreadCount > 0;
      if (filter === "read") return g.unreadCount === 0;
      return true;
    });

  const total = await ChatGroup.countDocuments(matchStage);

  res.status(200).json(
    new ApiResponse(200, {
      groups: results,
      pagination: { page, limit, total },
    }, "Groups fetched successfully"),
  );
}

// ─── 3. Get Single Group Details ──────────────────────────────────────

export async function getGroupDetails(req, res) {
  const { groupId } = req.params;
  const userId = req.user.id;

  if (!isValidObjectId(groupId)) throw badRequest("Invalid group ID");

  const group = await ChatGroup.findOne({
    _id: groupId,
    members: userId,
    isActive: true,
  })
    .populate("members", "fullName phone role")
    .populate("createdBy", "fullName phone role")
    .lean();

  if (!group) throw notFound("Group not found or you are not a member");

  res.status(200).json(
    new ApiResponse(200, {
      group: {
        ...group,
        unreadCount: group.unreadCounts?.[userId] || 0,
      },
    }, "Group details fetched"),
  );
}

// ─── 4. Send Message to Group ─────────────────────────────────────────

export async function sendGroupMessage(req, res) {
  const { groupId, text } = sendMessageSchema.parse(req.body);
  const senderId = req.user.id;

  if (!isValidObjectId(groupId)) throw badRequest("Invalid group ID");

  // Verify sender is a member of this group
  const group = await ChatGroup.findOne({
    _id: groupId,
    members: senderId,
    isActive: true,
  });

  if (!group) throw forbidden("You are not a member of this group");

  // Create the message
  const message = await Message.create({
    group: group._id,
    sender: senderId,
    text,
    readBy: [senderId],
  });

  // Update group's lastMessage & increment unread for ALL other members
  const updateOps = {
    lastMessage: {
      text,
      sender: senderId,
      createdAt: message.createdAt,
    },
  };

  for (const memberId of group.members) {
    const mId = String(memberId);
    if (mId !== senderId) {
      const current = group.unreadCounts?.get(mId) || 0;
      updateOps[`unreadCounts.${mId}`] = current + 1;
    }
  }

  await ChatGroup.findByIdAndUpdate(group._id, updateOps);

  // Populate sender info
  const populatedMessage = await Message.findById(message._id)
    .populate("sender", "fullName phone role")
    .lean();

  // Publish to Redis Pub/Sub (for multi-server scaling)
  await publishEvent(`chat:group:${groupId}`, {
    type: "new_message",
    groupId: String(group._id),
    message: populatedMessage,
  });

  // Emit via Socket.IO to all group members except sender
  const io = req.app.get("io");
  if (io) {
    for (const memberId of group.members) {
      const mId = String(memberId);
      if (mId !== senderId) {
        io.to(`user_${mId}`).emit("new_group_message", {
          groupId: String(group._id),
          groupName: group.name,
          message: populatedMessage,
        });
      }
    }
  }

  res.status(201).json(
    new ApiResponse(201, {
      groupId: group._id,
      message: populatedMessage,
    }, "Message sent successfully"),
  );
}

// ─── 5. Get Messages in a Group ───────────────────────────────────────

export async function getGroupMessages(req, res) {
  const { groupId } = req.params;
  const { page, limit } = paginationSchema.parse(req.query);
  const userId = req.user.id;
  const skip = (page - 1) * limit;

  if (!isValidObjectId(groupId)) throw badRequest("Invalid group ID");

  // Verify user is a member
  const group = await ChatGroup.findOne({
    _id: groupId,
    members: userId,
    isActive: true,
  });

  if (!group) throw forbidden("You are not a member of this group");

  const [messages, total] = await Promise.all([
    Message.find({ group: groupId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "fullName phone role")
      .lean(),
    Message.countDocuments({ group: groupId }),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      groupId,
      groupName: group.name,
      messages: messages.reverse(),
      pagination: { page, limit, total },
    }, "Messages fetched successfully"),
  );
}

// ─── 6. Mark Messages as Read in Group ────────────────────────────────

export async function markGroupAsRead(req, res) {
  const { groupId } = req.params;
  const userId = req.user.id;

  if (!isValidObjectId(groupId)) throw badRequest("Invalid group ID");

  const group = await ChatGroup.findOne({
    _id: groupId,
    members: userId,
    isActive: true,
  });

  if (!group) throw forbidden("You are not a member of this group");

  await Message.updateMany(
    {
      group: groupId,
      sender: { $ne: userId },
      readBy: { $ne: userId },
    },
    { $addToSet: { readBy: userId } },
  );

  await ChatGroup.findByIdAndUpdate(groupId, {
    [`unreadCounts.${userId}`]: 0,
  });

  res.status(200).json(
    new ApiResponse(200, { groupId }, "Messages marked as read"),
  );
}

// ─── 7. Add Members to Group ──────────────────────────────────────────

export async function addMembers(req, res) {
  const { groupId } = req.params;
  const { memberIds, branchId } = addMembersSchema.parse(req.body);
  const userId = req.user.id;

  if (!isValidObjectId(groupId)) throw badRequest("Invalid group ID");

  for (const id of memberIds) {
    if (!isValidObjectId(id)) throw badRequest(`Invalid member ID: ${id}`);
  }

  // If branchId provided, fetch all active staff from that branch
  let branchUserIds = [];
  if (branchId) {
    if (!isValidObjectId(branchId)) throw badRequest("Invalid branchId");
    const branchUsers = await User.find({ branch: branchId, isActive: true })
      .select("_id")
      .lean();
    if (branchUsers.length === 0) throw badRequest("No active users found in this branch");
    branchUserIds = branchUsers.map((u) => String(u._id));
  }

  const allMemberIds = [...new Set([...memberIds, ...branchUserIds])];

  const group = await ChatGroup.findOne({
    _id: groupId,
    members: userId,
    isActive: true,
  });

  if (!group) throw forbidden("You are not a member of this group");

  const newUsers = await User.find({
    _id: { $in: allMemberIds },
    isActive: true,
  }).lean();

  if (newUsers.length !== allMemberIds.length) {
    throw badRequest("One or more members not found or inactive");
  }

  const existingIds = group.members.map((m) => String(m));
  const toAdd = allMemberIds.filter((id) => !existingIds.includes(id));

  if (toAdd.length === 0) {
    throw badRequest("All specified users are already members");
  }

  const updateOps = {
    $push: { members: { $each: toAdd } },
  };
  for (const id of toAdd) {
    updateOps[`unreadCounts.${id}`] = 0;
  }

  await ChatGroup.findByIdAndUpdate(groupId, updateOps);

  const updated = await ChatGroup.findById(groupId)
    .populate("members", "fullName phone role")
    .lean();

  const io = req.app.get("io");
  if (io) {
    for (const id of toAdd) {
      io.to(`user_${id}`).emit("added_to_group", {
        groupId: String(group._id),
        groupName: group.name,
      });
    }
  }

  res.status(200).json(
    new ApiResponse(200, { group: updated }, "Members added successfully"),
  );
}

// ─── 8. Remove Member from Group ──────────────────────────────────────

export async function removeMember(req, res) {
  const { groupId } = req.params;
  const { memberId } = removeMemberSchema.parse(req.body);
  const userId = req.user.id;

  if (!isValidObjectId(groupId)) throw badRequest("Invalid group ID");
  if (!isValidObjectId(memberId)) throw badRequest("Invalid member ID");

  const group = await ChatGroup.findOne({
    _id: groupId,
    isActive: true,
  });

  if (!group) throw notFound("Group not found");

  const isCreator = String(group.createdBy) === userId;
  const isSelf = memberId === userId;

  if (!isCreator && !isSelf) {
    throw forbidden("Only the group creator can remove members");
  }

  const isMember = group.members.some((m) => String(m) === memberId);
  if (!isMember) throw badRequest("User is not a member of this group");

  if (String(group.createdBy) === memberId && !isSelf) {
    throw forbidden("Cannot remove the group creator");
  }

  await ChatGroup.findByIdAndUpdate(groupId, {
    $pull: { members: memberId },
    $unset: { [`unreadCounts.${memberId}`]: "" },
  });

  const io = req.app.get("io");
  if (io) {
    io.to(`user_${memberId}`).emit("removed_from_group", {
      groupId: String(group._id),
      groupName: group.name,
    });
  }

  res.status(200).json(
    new ApiResponse(200, { groupId, removedMemberId: memberId }, "Member removed"),
  );
}

// ─── 9. Get Unread Count Across All Groups ────────────────────────────

export async function getUnreadCount(req, res) {
  const userId = req.user.id;

  const groups = await ChatGroup.find({
    members: userId,
    isActive: true,
  }).lean();

  let totalUnread = 0;
  for (const g of groups) {
    totalUnread += g.unreadCounts?.[userId] || 0;
  }

  res.status(200).json(
    new ApiResponse(200, { totalUnread }, "Unread count fetched"),
  );
}

// ─── 10. Search Users to Add to Group ─────────────────────────────────

export async function searchChatUsers(req, res) {
  const userId = req.user.id;
  const search = (req.query.q || "").trim();

  const query = {
    _id: { $ne: userId },
    isActive: true,
    role: { $in: STAFF_ROLES },
  };

  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(query)
    .select("fullName phone role branch")
    .limit(50)
    .lean();

  res.status(200).json(
    new ApiResponse(200, { users }, "Users fetched successfully"),
  );
}

// ─── 11. Send Voice Message to Group ──────────────────────────────────

export async function sendVoiceMessage(req, res) {
  const senderId = req.user.id;
  const groupId = req.body.groupId;
  const duration = Number(req.body.duration) || 0;

  if (!groupId || !isValidObjectId(groupId)) {
    throw badRequest("Invalid or missing groupId");
  }

  if (!req.file) {
    throw badRequest("Voice file is required");
  }

  // Verify sender is a member of this group
  const group = await ChatGroup.findOne({
    _id: groupId,
    members: senderId,
    isActive: true,
  });

  if (!group) throw forbidden("You are not a member of this group");

  // Build the public URL path
  const voiceUrl = `/public/voices/${req.file.filename}`;

  // Create the voice message
  const message = await Message.create({
    group: group._id,
    sender: senderId,
    type: "voice",
    text: "",
    voice: {
      url: voiceUrl,
      duration,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
    },
    readBy: [senderId],
  });

  // Update group's lastMessage & increment unread for ALL other members
  const lastText = `Voice message (${duration}s)`;
  const updateOps = {
    lastMessage: {
      text: lastText,
      sender: senderId,
      createdAt: message.createdAt,
    },
  };

  for (const memberId of group.members) {
    const mId = String(memberId);
    if (mId !== senderId) {
      const current = group.unreadCounts?.get(mId) || 0;
      updateOps[`unreadCounts.${mId}`] = current + 1;
    }
  }

  await ChatGroup.findByIdAndUpdate(group._id, updateOps);

  // Populate sender info
  const populatedMessage = await Message.findById(message._id)
    .populate("sender", "fullName phone role")
    .lean();

  // Publish to Redis Pub/Sub
  await publishEvent(`chat:group:${groupId}`, {
    type: "new_voice_message",
    groupId: String(group._id),
    message: populatedMessage,
  });

  // Emit via Socket.IO to all group members except sender
  const io = req.app.get("io");
  if (io) {
    for (const memberId of group.members) {
      const mId = String(memberId);
      if (mId !== senderId) {
        io.to(`user_${mId}`).emit("new_group_message", {
          groupId: String(group._id),
          groupName: group.name,
          message: populatedMessage,
        });
      }
    }
  }

  res.status(201).json(
    new ApiResponse(201, {
      groupId: group._id,
      message: populatedMessage,
    }, "Voice message sent successfully"),
  );
}

// ─── 12. Delete Message ───────────────────────────────────────────────

export async function deleteMessage(req, res) {
  const { messageId } = req.params;
  const userId = req.user.id;

  if (!isValidObjectId(messageId)) throw badRequest("Invalid message ID");

  const message = await Message.findById(messageId);
  if (!message) throw notFound("Message not found");

  // Only the sender can delete their own message
  if (String(message.sender) !== userId) {
    throw forbidden("You can only delete your own messages");
  }

  const groupId = String(message.group);

  // If it's a voice message, delete the file from disk
  if (message.type === "voice" && message.voice?.url) {
    const filePath = path.join(process.cwd(), message.voice.url);
    fs.unlink(filePath, () => {});
  }

  await Message.findByIdAndDelete(messageId);

  // Emit via Socket.IO so clients can remove the message in real-time
  const io = req.app.get("io");
  if (io) {
    const group = await ChatGroup.findById(groupId).lean();
    if (group) {
      for (const memberId of group.members) {
        const mId = String(memberId);
        if (mId !== userId) {
          io.to(`user_${mId}`).emit("message_deleted", {
            groupId,
            messageId,
          });
        }
      }
    }
  }

  res.status(200).json(
    new ApiResponse(200, { messageId, groupId }, "Message deleted successfully"),
  );
}
