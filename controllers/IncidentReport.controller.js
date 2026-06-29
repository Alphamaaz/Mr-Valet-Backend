import reportIncidentModel from '../models/ReportIncident.js';

const createIncidentReport = async (req, res) => {
  try {
    const { ticketId, incidentType, description } = req.body;
    const newIncidentReport = new reportIncidentModel({
      ticketId,
      incidentType,
      description
    });
    await newIncidentReport.save();
    res.status(201).json(newIncidentReport);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getAllIncidentReports = async (req, res) => {
  try {
    const incidentReports = await reportIncidentModel.find();
    res.status(200).json(incidentReports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateIncidentReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updatedIncidentReport = await reportIncidentModel.findByIdAndUpdate(
      id,
      { status },
        { new: true }
    );
    if (!updatedIncidentReport) {
      return res.status(404).json({ message: 'Incident report not found' });
    }
    res.status(200).json(updatedIncidentReport);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteIncidentReport = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedIncidentReport = await reportIncidentModel.findByIdAndDelete(id);
    if (!deletedIncidentReport) {
      return res.status(404).json({ message: 'Incident report not found' });
    }
    res.status(200).json({ message: 'Incident report deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export { createIncidentReport, getAllIncidentReports, updateIncidentReport, deleteIncidentReport };