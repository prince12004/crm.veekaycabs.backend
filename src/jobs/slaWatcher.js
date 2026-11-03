const cron = require('node-cron');
const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const CrmUser = require('../models/CrmUser');
const { pickNextSalesperson, SLA_MINUTES } = require('../services/assignmentService');

// Statuses where the SLA clock is no longer relevant — a closed-out lead
// doesn't need to be chased, breached or not.
// Escalated leads sit with Super Admin for review, so they're out of the
// salesperson rotation too.
const CLOSED_STATUSES = [
  'Booking Confirmed', 'Lost', 'Cancelled', 'Duplicate', 'Invalid Lead',
  ...Lead.SUPER_ADMIN_REVIEW_STATUSES,
];

// SRS 5.2 — a lead whose owner hasn't logged a call/WhatsApp (the "valid
// first action") within 15 minutes of assignment gets automatically handed
// to the next eligible salesperson, and the previous owner + Super Admin
// both see it in the lead's timeline.
const checkSlaBreaches = async () => {
  const now = new Date();
  const overdue = await Lead.find({
    assignedTo: { $ne: null },
    firstActionAt: null,
    slaBreached: false,
    slaDeadline: { $lte: now },
    isDeleted: { $ne: true },
    status: { $nin: CLOSED_STATUSES },
  }).populate('assignedTo', 'name');

  for (const lead of overdue) {
    try {
      const currentLead = await Lead.findOne({
        _id: lead._id,
        assignedTo: { $ne: null },
        firstActionAt: null,
        slaBreached: false,
        slaDeadline: { $lte: new Date() },
        isDeleted: { $ne: true },
        status: { $nin: CLOSED_STATUSES },
      }).populate('assignedTo', 'name');
      if (!currentLead) continue;

      const previousOwner = currentLead.assignedTo;
      const nextOwner = await pickNextSalesperson(previousOwner?._id);

      if (!nextOwner) {
        // Nobody else to hand it to — flag the breach and leave it with the
        // same owner rather than silently looping it back to themselves.
        currentLead.slaBreached = true;
        currentLead.slaBreachCount += 1;
        await currentLead.save();
        await LeadActivity.create({
          leadId: currentLead._id,
          type: 'sla_breach',
          message: `SLA breached — no other active salesperson available to reassign to. Still with ${previousOwner?.name || 'current owner'}.`,
        });
        continue;
      }

      currentLead.assignedTo = nextOwner._id;
      currentLead.assignedAt = now;
      currentLead.slaDeadline = new Date(now.getTime() + SLA_MINUTES * 60 * 1000);
      currentLead.slaBreached = false; // reset for the NEW owner's fresh 15-minute window
      currentLead.slaBreachCount += 1; // but the lifetime count keeps climbing
      currentLead.firstActionAt = null;
      await currentLead.save();

      nextOwner.lastAssignedAt = now;
      await nextOwner.save();

      await LeadActivity.create({
        leadId: currentLead._id,
        type: 'reassignment',
        message: `SLA breached — reassigned from ${previousOwner?.name || 'previous owner'} to ${nextOwner.name}`,
        meta: { from: previousOwner?._id, to: nextOwner._id, reason: 'SLA Breach' },
      });
    } catch (error) {
      console.error(`slaWatcher: failed to process lead ${lead._id}:`, error);
    }
  }

  if (overdue.length > 0) {
    console.log(`slaWatcher: processed ${overdue.length} SLA-breached lead(s)`);
  }
};

const startSlaWatcher = () => {
  // Every minute — the SLA window is 15 minutes, so this is frequent enough
  // that a breach is caught within ~60s of actually happening.
  cron.schedule('* * * * *', () => {
    checkSlaBreaches().catch((err) => console.error('slaWatcher run failed:', err));
  });
  console.log('SLA watcher started (checks every minute)');
};

module.exports = { startSlaWatcher, checkSlaBreaches };
