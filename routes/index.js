import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import ticketRoutes from "./ticket.routes.js";
import userRoutes from "./user.routes.js";
import branchRoutes from "./branch.routes.js";
import attendanceRoutes from "./attendance.routes.js";
import whatsappRoutes from "./whatsapp.routes.js";

const router = Router();

router.use("/v1/health", healthRoutes);
router.use("/v1/auth", authRoutes);
router.use("/v1/tickets", ticketRoutes);
router.use("/v1/users", userRoutes);
router.use("/v1/branches", branchRoutes);
router.use("/v1/attendance", attendanceRoutes);
router.use("/v1/whatsapp", whatsappRoutes);

export default router;
