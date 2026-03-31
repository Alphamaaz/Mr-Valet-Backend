import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createService,
  getServices,
  updateService,
  deleteService,
} from "../controllers/service.controller.js";
import { uploadServiceIcon } from "../middleware/uploadServiceIcon.js";

const router = Router();

router.use(requireAuth);

// GET  /api/v1/services        — list active services (everyone)
router.get("/", asyncHandler(getServices));

// POST /api/v1/services        — create a service (OWNER only)
router.post("/", requireRoles("OWNER", "SUPER_ADMIN"), uploadServiceIcon, asyncHandler(createService));

// PATCH /api/v1/services/:id   — update a service (OWNER only)
router.patch("/:id", requireRoles("OWNER", "SUPER_ADMIN"), uploadServiceIcon, asyncHandler(updateService));

// DELETE /api/v1/services/:id  — delete a service (OWNER only)
router.delete("/:id", requireRoles("OWNER", "SUPER_ADMIN"), asyncHandler(deleteService));

export default router;
