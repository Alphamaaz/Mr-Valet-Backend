import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES, STAFF_ROLES } from "../constants/roles.js";
import {
  checkInAttendance,
  checkOutAttendance,
  generateAttendanceQrCode,
  getMyAttendanceStatus,
} from "../controllers/attendance.controller.js";

const router = Router();

router.use(requireAuth);
router.use(requireRoles(...STAFF_ROLES));

router.get("/status", asyncHandler(getMyAttendanceStatus));
router.post("/check-in", asyncHandler(checkInAttendance));
router.post("/check-out", asyncHandler(checkOutAttendance));
router.post("/qr-code", requireRoles(ROLES.SUPER_ADMIN), asyncHandler(generateAttendanceQrCode));

export default router;

 
