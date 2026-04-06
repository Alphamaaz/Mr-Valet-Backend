import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getEmployees,
  getFreeDrivers,
  getEmployeeDetails,
  getEmployeeTickets,
  updateEmployeeProfile,
  rateEmployee,
  toggleBreak,
} from "../controllers/employee.controller.js";

const router = Router();

// All employee routes require authentication
router.use(requireAuth);

// GET  /api/v1/employees                         – List employees (filter by role)
router.get("/", asyncHandler(getEmployees));

// GET  /api/v1/employees/drivers/free            – List fully available drivers
router.get(
  "/drivers/free",
  requireRoles(ROLES.OWNER, ROLES.SUPER_ADMIN, ROLES.RECEPTIONIST, ROLES.SUPERVISOR, ROLES.KEY_CONTROLLER),
  asyncHandler(getFreeDrivers),
);

// GET  /api/v1/employees/:id                     – Employee details (personal + other + key handover)
router.get("/:id", asyncHandler(getEmployeeDetails));

// GET  /api/v1/employees/:id/tickets             – Employee ticket history
router.get("/:id/tickets", asyncHandler(getEmployeeTickets));

// PATCH /api/v1/employees/:id/profile            – Update employee profile data
router.patch("/:id/profile", asyncHandler(updateEmployeeProfile));

// POST /api/v1/employees/:id/rate                – Rate an employee
router.post("/:id/rate", asyncHandler(rateEmployee));

// PATCH /api/v1/employees/:id/break              – Toggle On Break / Checked In
router.patch("/:id/break", asyncHandler(toggleBreak));

export default router;
