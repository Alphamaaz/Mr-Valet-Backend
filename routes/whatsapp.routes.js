import { Router } from "express";
import { receiveWebhook, verifyWebhook } from "../controllers/whatsapp.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/webhook", verifyWebhook);
router.post("/webhook", asyncHandler(receiveWebhook));

export default router;
