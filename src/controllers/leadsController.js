const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const CrmUser = require('../models/CrmUser');
const { MainUser, MainBooking } = require('../models/MainSiteRefs');
const { autoAssignLead } = require('../services/assignmentService');

const SLA_MINUTES = 15;

const generateLeadCode = async () => {
  const count = await Lead.countDocuments();
  return `VK-${10000 + count + 1}`;
};

const log = (leadId, type, { message, meta, by } = {}) =>
  LeadActivity.create({ leadId, type, message, meta, by }).catch((e) => console.error('leadActivity log failed:', e));

// GET /api/leads — Super Admin sees everything (with filters); a
// salesperson only ever sees their own assigned leads, regardless of any
// assignedTo filter they try to pass — enforced server-side, not just hidden in the UI.
const getAllLeads = async (req, res) => {
  try {
    const { status, source, search, page = 1, limit = 20, assignedTo, followUpDue } = req.query;
    const filter = { isDeleted: { $ne: true } };

    if (req.crmUser.role === 'salesperson') {
      filter.assignedTo = req.crmUser._id;
    } else if (assignedTo) {
      filter.assignedTo = assignedTo === 'unassigned' ? null : assignedTo;
    }

    if (status) filter.status = status;
    if (source) filter.source = source;
    if (followUpDue === 'true') filter.nextFollowUpAt = { $lte: new Date() };
    if (search) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { mobile: regex }, { leadCode: regex }, { email: regex }];
    }

    const parsedLimit = Math.max(parseInt(limit) || 20, 1);
    const parsedPage = Math.max(parseInt(page) || 1, 1);

    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter)
        .populate('assignedTo', 'name email')
        .sort({ createdAt: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit),
    ]);

    return res.json({
      success: true,
      data: leads,
      total,
      page: parsedPage,
      pages: Math.max(Math.ceil(total / parsedLimit), 1),
    });
  } catch (error) {
    console.error('crm getAllLeads error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load leads' });
  }
};

// GET /api/leads/stats — dashboard KPI cards (SRS section 8), scoped the
// same way as the list (salesperson sees only their own numbers).
const getStats = async (req, res) => {
  try {
    const base = { isDeleted: { $ne: true } };
    if (req.crmUser.role === 'salesperson') base.assignedTo = req.crmUser._id;

    const [total, newLeads, contacted, interested, followUpsDue, slaBreaches, booked, lost] = await Promise.all([
      Lead.countDocuments(base),
      Lead.countDocuments({ ...base, status: 'New' }),
      Lead.countDocuments({ ...base, firstActionAt: { $ne: null } }),
      Lead.countDocuments({ ...base, status: 'Interested' }),
      Lead.countDocuments({ ...base, nextFollowUpAt: { $lte: new Date() } }),
      Lead.countDocuments({ ...base, slaBreachCount: { $gt: 0 } }),
      Lead.countDocuments({ ...base, status: 'Booking Confirmed' }),
      Lead.countDocuments({ ...base, status: { $in: ['Lost', 'Not Interested'] } }),
    ]);

    return res.json({
      success: true,
      data: { total, newLeads, contacted, interested, followUpsDue, slaBreaches, booked, lost },
    });
  } catch (error) {
    console.error('crm getStats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
};

// GET /api/leads/:id
const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('assignedTo', 'name email')
      .populate('duplicateOfLead', 'leadCode name mobile');
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (req.crmUser.role === 'salesperson' && String(lead.assignedTo?._id) !== String(req.crmUser._id)) {
      return res.status(403).json({ success: false, message: 'This lead is not assigned to you' });
    }

    const [activities, otherLeads, mainUser] = await Promise.all([
      LeadActivity.find({ leadId: lead._id }).populate('by', 'name').sort({ createdAt: -1 }),
      Lead.find({ mobile: lead.mobile, _id: { $ne: lead._id }, isDeleted: { $ne: true } })
        .select('leadCode status source createdAt').sort({ createdAt: -1 }),
      MainUser.findOne({ mobile: lead.mobile }).select('name mobile email'),
    ]);

    let pastBookings = [];
    if (mainUser) {
      pastBookings = await MainBooking.find({ userId: mainUser._id })
        .select('bookingId startTime endTime totalAmount status')
        .sort({ createdAt: -1 })
        .limit(10);
    }

    return res.json({
      success: true,
      data: { lead, activities, otherLeadsForMobile: otherLeads, mainSiteCustomer: mainUser || null, pastBookings },
    });
  } catch (error) {
    console.error('crm getLeadById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load lead' });
  }
};

// POST /api/leads — manual creation (SRS 3 "Manual" source) or the future
// webhook endpoints can call the same logic directly.
const createLead = async (req, res) => {
  try {
    const {
      name, mobile, alternateMobile, email, source, campaign, utm,
      pickupLocation, dropLocation, travelDate, travelTime, vehicleRequirement,
      passengers, priority, notes,
    } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: 'Name and mobile are required' });
    }

    // Flag (never silently drop) duplicate submissions from the same number.
    const duplicateOf = await Lead.findOne({ mobile, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

    const lead = await Lead.create({
      leadCode: await generateLeadCode(),
      name, mobile, alternateMobile, email,
      source: source || 'Manual',
      campaign, utm,
      pickupLocation, dropLocation,
      travelDate: travelDate || undefined,
      travelTime, vehicleRequirement, passengers,
      priority: priority || 'Normal',
      notes,
      isDuplicate: !!duplicateOf,
      duplicateOfLead: duplicateOf?._id,
      createdBy: req.crmUser._id,
    });

    await log(lead._id, 'note', { message: 'Lead created', by: req.crmUser._id });
    if (duplicateOf) {
      await log(lead._id, 'note', {
        message: `Possible duplicate of ${duplicateOf.leadCode} (same mobile number)`,
        meta: { duplicateOfLead: duplicateOf._id },
      });
    }

    await autoAssignLead(lead);

    return res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error('crm createLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create lead' });
  }
};

// PUT /api/leads/:id — field edits + status transitions. Status changes to
// Not Interested/Lost require a reason (SRS 4.1); any status change is
// logged to the timeline.
const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (req.crmUser.role === 'salesperson' && String(lead.assignedTo) !== String(req.crmUser._id)) {
      return res.status(403).json({ success: false, message: 'This lead is not assigned to you' });
    }

    const editable = [
      'name', 'mobile', 'alternateMobile', 'email', 'pickupLocation', 'dropLocation',
      'travelDate', 'travelTime', 'vehicleRequirement', 'passengers', 'priority',
      'notes', 'nextFollowUpAt', 'bookingReference', 'reason',
    ];
    editable.forEach((f) => { if (req.body[f] !== undefined) lead[f] = req.body[f]; });

    const prevStatus = lead.status;
    if (req.body.status && req.body.status !== prevStatus) {
      const newStatus = req.body.status;
      if (Lead.REASON_REQUIRED_STATUSES.includes(newStatus) && !req.body.reason && !lead.reason) {
        return res.status(400).json({ success: false, message: `A reason is required to mark this lead "${newStatus}"` });
      }
      lead.status = newStatus;
      await log(lead._id, 'status_change', {
        message: `Status changed from "${prevStatus}" to "${newStatus}"`,
        meta: { from: prevStatus, to: newStatus, reason: req.body.reason },
        by: req.crmUser._id,
      });

      // A salesperson marking a lead "Not Interested" or any of the issue
      // statuses (Customer/Price/Payment/Service/Other Issue) hands it to
      // Super Admin for review rather than leaving it to quietly sit in
      // that salesperson's own closed-out leads — the full assignment/status
      // history stays intact either way (nothing here ever deletes it).
      if (Lead.ESCALATION_STATUSES.includes(newStatus) && req.crmUser.role !== 'super_admin') {
        const previousOwner = lead.assignedTo;
        const superAdmin = await CrmUser.findOne({ role: 'super_admin', isActive: true }).sort({ lastAssignedAt: 1 });
        if (superAdmin && String(superAdmin._id) !== String(previousOwner)) {
          lead.assignedTo = superAdmin._id;
          await log(lead._id, 'reassignment', {
            message: `Marked "${newStatus}" by ${req.crmUser.name} (reason: ${req.body.reason || lead.reason || 'N/A'}) — moved to ${superAdmin.name} for review`,
            meta: { from: previousOwner, to: superAdmin._id, reason: newStatus },
            by: req.crmUser._id,
          });
        }
      }
    }

    await lead.save();

    if (req.body.nextFollowUpAt) {
      await log(lead._id, 'follow_up_scheduled', {
        message: `Follow-up scheduled for ${new Date(req.body.nextFollowUpAt).toLocaleString('en-IN')}`,
        by: req.crmUser._id,
      });
    }

    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email');
    return res.json({ success: true, data: populated });
  } catch (error) {
    console.error('crm updateLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update lead' });
  }
};

// PATCH /api/leads/:id/assign — Super Admin manual assignment/reassignment.
// Starts (or restarts) the 15-minute SLA clock (automation that watches
// this deadline is Phase 3 — the field is tracked from day one either way).
const assignLead = async (req, res) => {
  try {
    const { assignedTo } = req.body;
    if (!assignedTo) return res.status(400).json({ success: false, message: 'assignedTo is required' });

    const [lead, newOwner] = await Promise.all([
      Lead.findOne({ _id: req.params.id, isDeleted: { $ne: true } }),
      CrmUser.findOne({ _id: assignedTo, role: 'salesperson', isActive: true }),
    ]);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!newOwner) return res.status(404).json({ success: false, message: 'Salesperson not found or inactive' });

    const previousOwner = lead.assignedTo;
    const now = new Date();
    lead.assignedTo = newOwner._id;
    lead.assignedAt = now;
    lead.slaDeadline = new Date(now.getTime() + SLA_MINUTES * 60 * 1000);
    lead.slaBreached = false;
    lead.firstActionAt = null;
    if (lead.status === 'New') lead.status = 'Assigned';
    await lead.save();

    // Keep manual picks counted in Round Robin's rotation too, so a
    // manually-assigned salesperson doesn't then get skipped past by
    // auto-assignment for the next several leads.
    newOwner.lastAssignedAt = now;
    await newOwner.save();

    await log(lead._id, previousOwner ? 'reassignment' : 'assignment', {
      message: previousOwner ? `Reassigned to ${newOwner.name}` : `Assigned to ${newOwner.name}`,
      meta: { from: previousOwner, to: newOwner._id },
      by: req.crmUser._id,
    });

    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email');
    return res.json({ success: true, data: populated });
  } catch (error) {
    console.error('crm assignLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign lead' });
  }
};

// POST /api/leads/:id/activity — log a call/WhatsApp/note. A call or
// WhatsApp entry counts as the SRS 5.3 "valid first action" and stops the
// SLA clock the first time it happens after assignment.
const addActivity = async (req, res) => {
  try {
    const { type, message } = req.body;
    if (!['call', 'whatsapp', 'note'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid activity type' });
    }
    const lead = await Lead.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (req.crmUser.role === 'salesperson' && String(lead.assignedTo) !== String(req.crmUser._id)) {
      return res.status(403).json({ success: false, message: 'This lead is not assigned to you' });
    }

    if ((type === 'call' || type === 'whatsapp') && !lead.firstActionAt) {
      lead.firstActionAt = new Date();
      lead.slaBreached = false;
      if (lead.status === 'Assigned') lead.status = 'Contacted';
      await lead.save();
    }

    const activity = await LeadActivity.create({ leadId: lead._id, type, message, by: req.crmUser._id });
    return res.status(201).json({ success: true, data: activity });
  } catch (error) {
    console.error('crm addActivity error:', error);
    return res.status(500).json({ success: false, message: 'Failed to log activity' });
  }
};

module.exports = { getAllLeads, getStats, getLeadById, createLead, updateLead, assignLead, addActivity };
