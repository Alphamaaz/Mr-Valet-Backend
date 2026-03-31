import { z } from "zod";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { conflict, badRequest, forbidden, notFound } from "../errors/AppError.js";
import { User } from "../models/User.js";
import { ROLES, STAFF_ROLES } from "../constants/roles.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Branch } from "../models/Branch.js";
import { ChatGroup } from "../models/ChatGroup.js";
import { Message } from "../models/Message.js";

const PLATFORM_USER_ROLES = Object.freeze([...STAFF_ROLES, ROLES.OWNER]);

const createPlatformUserSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(20),
  role: z.enum(PLATFORM_USER_ROLES),
  branchId: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function sanitizePhone(phone) {
  return phone.replace(/\s+/g, "");
}

function toUserResponse(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    branchId: user.branch?._id ? String(user.branch._id) : user.branch ? String(user.branch) : null,
    branchName: user.branch?.name || null,
    attendanceStatus: user.attendanceStatus,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function createPlatformUser(req, res) {
  // TODO: Commented for testing - branch assignment not required to create users
  // if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
  //   throw forbidden("You are not assigned to a valid branch");
  // }

  const parsed = createPlatformUserSchema.safeParse(req.body);
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const branchErrors = flattened.fieldErrors?.branchId || [];
    if (branchErrors.length > 0) {
      throw badRequest("branchId is required and must be valid", flattened);
    }
    throw badRequest("Invalid request payload", flattened);
  }

  const payload = parsed.data;
  const phone = sanitizePhone(payload.phone);
  const isStaffRole = STAFF_ROLES.includes(payload.role);

  let branch = null;
  if (isStaffRole) {
    if (!payload.branchId || !isValidObjectId(payload.branchId)) {
      throw badRequest("branchId is required and must be a valid ObjectId for staff users");
    }

    branch = await Branch.findOne({ _id: payload.branchId, isActive: true }).lean();
    if (!branch) {
      throw badRequest("The specified branch is invalid or inactive");
    }
  }

  const existingUser = await User.findOne({ phone }).lean();
  if (existingUser) {
    throw conflict("A user with this phone number already exists");
  }

  const user = await User.create({
    fullName: payload.fullName,
    phone,
    role: payload.role,
    branch: isStaffRole ? (branch?._id || null) : null,
    isActive: payload.isActive ?? true,
  });

  await user.populate("branch", "name");

  return res
    .status(201)
    .json(new ApiResponse(201, toUserResponse(user), "Platform user created successfully"));
}

export async function getPlatformUsers(req, res) {
  // if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
  //   throw forbidden("You are not assigned to a valid branch");
  // }

  const users = await User.find({
    role: { $in: STAFF_ROLES },
    // branch: req.user.branchId,
  })
    .populate("branch", "name")
    .lean();
  const userResponses = users.map(toUserResponse);
  return res.json(new ApiResponse(200, userResponses, "Platform users retrieved successfully"));
}

export async function getPlatformUserById(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("You are not assigned to a valid branch");
  }

  const userId = req.params.id;

  const user = await User.findOne({
    _id: userId,
    // branch: req.user.branchId,
  })
    .populate("branch", "name")
    .lean();
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw badRequest("Platform user not found");
  }
  return res.json(
    new ApiResponse(200, toUserResponse(user), "Platform user retrieved successfully"),
  );
}


export async function updatePlatformUser(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("You are not assigned to a valid branch");
  }

  const userId = req.params.id;

  const parsed = createPlatformUserSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const payload = parsed.data;

  const user = await User.findOne({
    _id: userId,
    branch: req.user.branchId,
  });
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw badRequest("Platform user not found");
  }

  if (payload.phone) {
    const phone = sanitizePhone(payload.phone);
    const existingUser = await User.findOne({ phone, _id: { $ne: userId } }).lean();
    if (existingUser) {
      throw conflict("A user with this phone number already exists");
    }
    user.phone = phone;
  }

  if (payload.fullName !== undefined) {
    user.fullName = payload.fullName;
  }
  if (payload.role !== undefined) {
    user.role = payload.role;
  }
  if (payload.isActive !== undefined) {
    user.isActive = payload.isActive;
  }

  await user.save();
  await user.populate("branch", "name");

  return res.json(
    new ApiResponse(200, toUserResponse(user), "Platform user updated successfully"),
  );
}

// ─── Update Profile Image ─────────────────────────────────────────────

export async function updateProfileImage(req, res) {
  const userId = req.user.id;

  if (!req.file) {
    throw badRequest("Image file is required");
  }

  const user = await User.findById(userId);
  if (!user) throw notFound("User not found");

  // Delete old image if exists
  if (user.profileImage) {
    const oldPath = path.join(process.cwd(), user.profileImage);
    fs.unlink(oldPath, () => {});
  }

  const imageUrl = `/public/profiles/${req.file.filename}`;
  user.profileImage = imageUrl;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, { profileImage: imageUrl }, "Profile image updated successfully"),
  );
}

// ─── Delete Account ───────────────────────────────────────────────────

export async function deleteAccount(req, res) {
  const userId = req.user.id;

  const user = await User.findById(userId);
  if (!user) throw notFound("User not found");

  // Delete profile image from disk if exists
  if (user.profileImage) {
    const imgPath = path.join(process.cwd(), user.profileImage);
    fs.unlink(imgPath, () => {});
  }

  // Remove user from all chat groups
  await ChatGroup.updateMany(
    { members: userId },
    {
      $pull: { members: userId },
      $unset: { [`unreadCounts.${userId}`]: "" },
    },
  );

  // Soft delete: deactivate the account
  user.isActive = false;
  user.phone = `deleted_${userId}_${user.phone}`;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, null, "Account deleted successfully"),
  );
}

