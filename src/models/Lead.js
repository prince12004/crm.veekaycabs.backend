const mongoose = require('mongoose');

const LEAD_STATUSES = [
  'New', 'Assigned', 'Contacted', 'Interested', 'Follow-up', 'Quotation Sent',
  'Booking Pending', 'Booking Confirmed',
  'No Response', 'Not Interested', 'Wrong Number', 'Duplicate', 'Invalid Lead',
  'Customer Issue', 'Price Issue', 'Payment Issue', 'Service Issue', 'Service Unavailable', 'Other Issue',
  'Lost', 'Cancelled',
];

const LEAD_SOURCES = ['Meta Ads', 'Google Ads', 'SEO/Organic', 'Website', 'WhatsApp', 'Phone Call', 'JustDial', 'Referral', 'Manual'];

// A salesperson marking a lead with one of these hands it to Super Admin
// for review (see leadsController.updateLead) — the salesperson can't fix
// a pricing/payment/service problem alone.
const ESCALATION_STATUSES = [
  'Not Interested', 'Customer Issue', 'Price Issue', 'Payment Issue',
  'Service Issue', 'Service Unavailable', 'Other Issue',
];

// Statuses that require a reason before they can be saved (SRS 4.1).
const REASON_REQUIRED_STATUSES = [...ESCALATION_STATUSES, 'Lost'];

const LeadSchema = new mongoose.Schema({
  leadCode: { type: String, unique: true }, // e.g. VK-10001, human-facing ID
  name: { type: String, required: true, trim: true },
  mobile: { type: String, required: true, trim: true, index: true }, // primary dedup key
  alternateMobile: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },

  source: { type: String, enum: LEAD_SOURCES, default: 'Manual' },
  campaign: { type: String, trim: true },
  utm: {
    source: String, medium: String, campaign: String, term: String, content: String,
    gclid: String, fbclid: String, landingPage: String, referrer: String,
  },

  pickupLocation: { type: String, trim: true },
  dropLocation: { type: String, trim: true },
  travelDate: { type: Date },
  travelTime: { type: String, trim: true },
  vehicleRequirement: { type: String, trim: true },
  passengers: { type: Number },

  status: { type: String, enum: LEAD_STATUSES, default: 'New' },
  priority: { type: String, enum: ['Low', 'Normal', 'High'], default: 'Normal' },
  reason: { type: String, trim: true }, // required when status is Not Interested/Lost
  notes: { type: String, trim: true },

  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmUser' },
  assignedAt: { type: Date },
  slaDeadline: { type: Date }, // assignedAt + 15 min, cleared once first valid action is logged
  slaBreached: { type: Boolean, default: false }, // true for the CURRENT owner only — reset on reassignment
  slaBreachCount: { type: Number, default: 0 }, // lifetime count, never reset — what reports/escalation key off
  firstActionAt: { type: Date },

  nextFollowUpAt: { type: Date },

  isDuplicate: { type: Boolean, default: false },
  duplicateOfLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },

  // Loose reference only — Phase 1 does not write into the main site's
  // Booking collection yet; this is filled in manually once a booking is
  // created in the main admin, or automatically once conversion is wired up.
  bookingReference: { type: String, trim: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmUser' }, // who manually created it, if applicable
  isDeleted: { type: Boolean, default: false },

  externalRef: { type: String, index: true, sparse: true, unique: true },
}, { timestamps: true });

LeadSchema.index({ status: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, status: 1 });
LeadSchema.index({ nextFollowUpAt: 1 });
LeadSchema.index({ slaDeadline: 1, slaBreached: 1 });

LeadSchema.statics.STATUSES = LEAD_STATUSES;
LeadSchema.statics.SOURCES = LEAD_SOURCES;
LeadSchema.statics.REASON_REQUIRED_STATUSES = REASON_REQUIRED_STATUSES;
LeadSchema.statics.ESCALATION_STATUSES = ESCALATION_STATUSES;

module.exports = mongoose.model('Lead', LeadSchema);
