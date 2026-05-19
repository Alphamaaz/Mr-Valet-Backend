import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { STAFF_ROLES } from "../constants/roles.js";
import {
  getDynamicAttendanceQrCode,
  getMyAttendanceStatus,
  scanAttendance,
} from "../controllers/attendance.controller.js";

const router = Router();

router.get("/dynamic-qr/:branchId", asyncHandler(getDynamicAttendanceQrCode));

router.use(requireAuth);
router.use(requireRoles(...STAFF_ROLES));

router.get("/status", asyncHandler(getMyAttendanceStatus));
router.post("/scan", asyncHandler(scanAttendance));

export default router;

 
