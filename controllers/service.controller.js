import mongoose from "mongoose";
import { z } from "zod";
import { badRequest, notFound } from "../errors/AppError.js";
import { AdditionalService } from "../models/AdditionalService.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const createServiceSchema = z.object({
  name:        z.string().trim().min(1, "Name is required"),
  description: z.string().trim().max(300).optional(),
  price:       z.coerce.number().min(0, "Price must be 0 or more"),
  currency:    z.string().trim().max(5).default("SAR"),
  pricingType: z.enum(["FIXED", "PER_UNIT"]).default("FIXED"),
  unit:        z.string().trim().max(30).optional(),
  icon:        z.string().trim().max(200).optional(), // Can also be passed as string if no file uploaded
});

const updateServiceSchema = z.object({
  name:        z.string().trim().min(1).optional(),
  description: z.string().trim().max(300).optional(),
  price:       z.coerce.number().min(0).optional(),
  currency:    z.string().trim().max(5).optional(),
  pricingType: z.enum(["FIXED", "PER_UNIT"]).optional(),
  unit:        z.string().trim().max(30).optional(),
  icon:        z.string().trim().max(200).optional(),
  isActive:    z.coerce.boolean().optional(),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatService(s) {
  return {
    id:          String(s._id),
    name:        s.name,
    description: s.description || "",
    price:       s.price,
    currency:    s.currency,
    pricingType: s.pricingType,
    unit:        s.unit || "",
    icon:        s.icon || "",
    isActive:    s.isActive,
  };
}

// ─── POST /api/v1/services ────────────────────────────────────────────────────
// Owner creates a new additional service

export async function createService(req, res) {
  const parsed = createServiceSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Invalid service data", parsed.error.flatten());

  const serviceData = { ...parsed.data };
  
  if (req.file) {
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    serviceData.icon = `${baseUrl}/public/services/${req.file.filename}`;
  }

  const service = await AdditionalService.create(serviceData);

  return res.status(201).json(
    new ApiResponse(201, { service: formatService(service) }, "Service created successfully"),
  );
}

// ─── GET /api/v1/services ─────────────────────────────────────────────────────
// Everyone can view active services
// Owner can see all (including inactive) via ?all=true

export async function getServices(req, res) {
  const filter = { isActive: true };

  if (req.query.all === "true" && ["OWNER", "SUPER_ADMIN"].includes(req.user.role)) {
    delete filter.isActive;
  }

  const services = await AdditionalService.find(filter).sort({ name: 1 }).lean();

  return res.json(
    new ApiResponse(200, { services: services.map(formatService) }, "Services fetched successfully"),
  );
}

// ─── PATCH /api/v1/services/:id ──────────────────────────────────────────────
// Owner updates a service (name, price, pricingType etc.)

export async function updateService(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid service ID");

  const parsed = updateServiceSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Invalid update data", parsed.error.flatten());

  const updates = { ...parsed.data };
  
  if (req.file) {
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    updates.icon = `${baseUrl}/public/services/${req.file.filename}`;
  }

  const service = await AdditionalService.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true },
  ).lean();

  if (!service) throw notFound("Service not found");

  return res.json(
    new ApiResponse(200, { service: formatService(service) }, "Service updated successfully"),
  );
}

// ─── DELETE /api/v1/services/:id ─────────────────────────────────────────────
// Owner deletes a service (hard delete from DB)

export async function deleteService(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid service ID");

  const service = await AdditionalService.findByIdAndDelete(id).lean();
  if (!service) throw notFound("Service not found");

  return res.json(
    new ApiResponse(200, { serviceId: id, name: service.name }, `"${service.name}" deleted successfully`),
  );
}
