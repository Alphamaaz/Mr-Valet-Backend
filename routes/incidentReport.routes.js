import {
  createIncidentReport,
  getAllIncidentReports,
  updateIncidentReport,
  deleteIncidentReport
} from "../controllers/IncidentReport.controller.js";
import express from "express";

const router = express.Router();

router.post('/', createIncidentReport);
router.get('/', getAllIncidentReports);
router.put('/:id', updateIncidentReport);
router.delete('/:id', deleteIncidentReport);

export default router;