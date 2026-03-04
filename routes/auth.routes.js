import { Router } from "express";
import { requestOtp, verifyOtp, getMe } from "../controllers/auth.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/otp/request", asyncHandler(requestOtp));
router.post("/otp/verify", asyncHandler(verifyOtp));
router.get("/me", requireAuth, asyncHandler(getMe));

export default router;

