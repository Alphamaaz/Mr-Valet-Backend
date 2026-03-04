import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors/AppError.js";
import { Branch } from "../models/Branch.js";
import { User } from "../models/User.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const createBranchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20),
  address: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  allowedRadiusMeters: z.number().min(10).max(1000).optional(),
});

function toBranchResponse(branch) {
  return {
    id: String(branch._id),
    name: branch.name,
    code: branch.code,
    address: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    allowedRadiusMeters: branch.allowedRadiusMeters,
    isActive: branch.isActive,
    createdAt: branch.createdAt,
  };
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

export async function createBranch(req, res) {
  const parsed = createBranchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  // TODO: Commented for testing - users can create branch regardless of existing branch assignment
  // if (req.user?.branchId) {
  //   throw forbidden("Branch users cannot create another branch");
  // }

  const payload = parsed.data;
  const code = payload.code.toUpperCase();

  const existingBranch = await Branch.findOne({ code }).lean();
  if (existingBranch) {
    throw conflict("Branch code already exists");
  }

  const branch = await Branch.create({
    name: payload.name,
    code,
    address: payload.address || "",
    latitude: payload.latitude,
    longitude: payload.longitude,
    allowedRadiusMeters: payload.allowedRadiusMeters ?? 120,
  });

  // Bootstrap flow: creator without a branch becomes part of this new branch.
  // await User.findByIdAndUpdate(req.user.id, { branch: branch._id });

  return res
    .status(201)
    .json(new ApiResponse(201, toBranchResponse(branch), "Branch created successfully"));
}

export async function getMyBranch(req, res) {
  if (!req.user?.branchId || !isValidObjectId(req.user.branchId)) {
    throw forbidden("You are not assigned to a branch");
  }

  const branch = await Branch.findById(req.user.branchId).lean();
  if (!branch || !branch.isActive) {
    throw notFound("Branch not found");
  }

  return res.json(new ApiResponse(200, toBranchResponse(branch), "Branch retrieved successfully"));
}

export async function getBranchById(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    throw badRequest("Invalid branch ID");
  }

  const branch = await Branch.findById(id).lean();
  if (!branch || !branch.isActive) {
    throw notFound("Branch not found");
  }

  return res.json(new ApiResponse(200, toBranchResponse(branch), "Branch retrieved successfully"));
}

export async function getAllBranches(req, res) {
  const branches = await Branch.find({ isActive: true }).lean();
  const responseData = branches.map(toBranchResponse);
  return res.json(new ApiResponse(200, responseData, "Branches retrieved successfully"));
}

export async function updateBranch(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    throw badRequest("Invalid branch ID");
  }

  const parsed = createBranchSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }

  const payload = parsed.data;

  const branch = await Branch.findById(id);
  if (!branch || !branch.isActive) {
    throw notFound("Branch not found");
  }

  if (payload.code && payload.code.toUpperCase() !== branch.code) {
    const existingBranch = await Branch.findOne({ code: payload.code.toUpperCase() }).lean();
    if (existingBranch) {
      throw conflict("Branch code already exists");
    }
    branch.code = payload.code.toUpperCase();
  }

  if (payload.name) branch.name = payload.name;
  if (payload.address !== undefined) branch.address = payload.address;
  if (payload.latitude !== undefined) branch.latitude = payload.latitude;
  if (payload.longitude !== undefined) branch.longitude = payload.longitude;
  if (payload.allowedRadiusMeters !== undefined) branch.allowedRadiusMeters = payload.allowedRadiusMeters;

  await branch.save();

  return res.json(new ApiResponse(200, toBranchResponse(branch), "Branch updated successfully"));
}

export async function deleteBranch(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    throw badRequest("Invalid branch ID");
  }

  const branch = await Branch.findByIdAndDelete(id);
  if (!branch) {
    throw notFound("Branch not found");
  }

  return res.json(new ApiResponse(200, null, "Branch deleted successfully"));
} 
