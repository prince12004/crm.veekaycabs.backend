const mongoose = require('mongoose');

// Complete, append-only timeline for a lead — assignment, reassignment,
// status changes, calls/WhatsApp logged, notes. Never edited or deleted,
// so it doubles as the audit trail the SRS requires (section 1.1, 13).
const LeadActivitySchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  type: {
    type: String,
    enum: ['assignment', 'reassignment', 'status_change', 'call', 'whatsapp', 'note', 'follow_up_scheduled', 'sla_breach'],
    required: true,
  },
  message: { type: String, trim: true },
  meta: { type: mongoose.Schema.Types.Mixed }, // e.g. { from: statusA, to: statusB } or { fromUser, toUser, reason }
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmUser' }, // null for system-generated entries (e.g. auto-reassignment)
}, { timestamps: true });

LeadActivitySchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model('LeadActivity', LeadActivitySchema);
