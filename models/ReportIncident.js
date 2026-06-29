import mongoose from 'mongoose';

const reportIncidentSchema = new mongoose.Schema({
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
 incidentType: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },    
  status: {
    type: String,
    enum: ['pending', 'resolved'],
    default: 'pending'
  }
});

export default mongoose.model('ReportIncident', reportIncidentSchema);

