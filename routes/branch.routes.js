import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { ROLES } from "../constants/roles.js";
import { createBranch, deleteBranch, getAllBranches, getMyBranch } from "../controllers/branch.controller.js";

const router = Router();

// router.use(requireAuth);

// router.post("/", requireRoles(ROLES.SUPERVISOR), asyncHandler(createBranch));

router.post("/", asyncHandler(createBranch));
router.get("/", asyncHandler(getAllBranches));
router.get("/me", asyncHandler(getMyBranch));
router.delete("/:id", asyncHandler(deleteBranch));

export default router;

