const mongoose = require('mongoose');

// Super Admin and Salesperson share one collection — `role` controls access.
// Kept in its own `crm_users` collection (separate from the main site's
// `admins`/`users` collections) since CRM logins are independent of the
// main Veekay Cabs website/admin panel.
const CrmUserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  mobile: { type: String, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['super_admin', 'salesperson'], default: 'salesperson' },
  isActive: { type: Boolean, default: true },
  // Used by the "Working Hours" assignment rule (Phase 3) to exclude
  // off-shift salespersons from round-robin assignment.
  workingHours: {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '19:00' },
  },
  lastLoginAt: { type: Date },
  // Round Robin picks whoever has gone longest without a new lead — this
  // is what "longest" is measured against. Bumped every time a lead lands
  // on them, whether by auto-assignment or a manual/reassignment pick.
  lastAssignedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('CrmUser', CrmUserSchema, 'crm_users');
