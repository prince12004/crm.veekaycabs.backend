const CrmUser = require('../models/CrmUser');
const LeadActivity = require('../models/LeadActivity');

const SLA_MINUTES = 15;

// Round Robin: whichever active salesperson has gone longest without a new
// lead (lastAssignedAt oldest/null first) gets the next one. `excludeId`
// lets SLA-breach reassignment skip the salesperson who just missed it.
const pickNextSalesperson = async (excludeId) => {
  const filter = { role: 'salesperson', isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };
  return CrmUser.findOne(filter).sort({ lastAssignedAt: 1 });
};

// Shared by every lead-creation path (manual, website form, Meta webhook,
// and any future source) so Round Robin behaves identically everywhere —
// one place to change the assignment strategy later (SRS section 16).
const autoAssignLead = async (lead) => {
  let candidate = await pickNextSalesperson();
  let fallback = false;
  if (!candidate) {
    // SRS 16 "Fallback User" — no active salesperson at all, so the lead
    // still needs an owner rather than sitting invisible to everyone.
    candidate = await CrmUser.findOne({ role: 'super_admin', isActive: true });
    fallback = true;
  }
  if (!candidate) return null; // genuinely no one to assign to

  const now = new Date();
  lead.assignedTo = candidate._id;
  lead.assignedAt = now;
  lead.slaDeadline = new Date(now.getTime() + SLA_MINUTES * 60 * 1000);
  lead.slaBreached = false;
  lead.firstActionAt = null;
  if (lead.status === 'New') lead.status = 'Assigned';
  await lead.save();

  candidate.lastAssignedAt = now;
  await candidate.save();

  await LeadActivity.create({
    leadId: lead._id,
    type: 'assignment',
    message: fallback
      ? `No active salesperson available — assigned to ${candidate.name} (Super Admin fallback)`
      : `Auto-assigned to ${candidate.name} (Round Robin)`,
    meta: { to: candidate._id, strategy: fallback ? 'fallback' : 'round_robin' },
  });

  return candidate;
};

module.exports = { autoAssignLead, pickNextSalesperson, SLA_MINUTES };
