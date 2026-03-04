import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ROLES, STAFF_ROLES } from "../constants/roles.js";
import {
  checkInAttendance,
  checkOutAttendance,
  generateAttendanceQrToken,
  getMyAttendanceStatus,
} from "../controllers/attendance.controller.js";

const router = Router();

router.use(requireAuth);
router.use(requireRoles(...STAFF_ROLES));

router.get("/status", asyncHandler(getMyAttendanceStatus));
router.post("/check-in", asyncHandler(checkInAttendance));
router.post("/check-out", asyncHandler(checkOutAttendance));
router.get("/qr-token", requireRoles(ROLES.RECEPTIONIST), asyncHandler(generateAttendanceQrToken));

export default router;

 
