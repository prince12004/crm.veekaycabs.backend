const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const { autoAssignLead } = require('../services/assignmentService');
const { notifyAdminNewLead } = require('../services/whatsapp');

const generateLeadCode = async () => {
  const count = await Lead.countDocuments();
  return `VK-${10000 + count + 1}`;
};

// POST /api/public/leads — no auth (called by the public website's own
// forms, and eventually ad-platform webhooks). Deliberately accepts only a
// narrow set of fields — never trust a public endpoint with the full Lead
// schema (e.g. no assignedTo, no status override).
const createPublicLead = async (req, res) => {
  try {
    const {
      name, mobile, email, source, campaign, utm,
      pickupLocation, dropLocation, travelDate, vehicleRequirement, message,
    } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: 'Name and mobile are required' });
    }
    // Loose sanity check — not full validation, just rejects obvious junk
    // from bots hitting a public endpoint.
    if (!/^[0-9+\-\s()]{7,15}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: 'Invalid mobile number' });
    }

    const allowedSources = Lead.SOURCES;
    const resolvedSource = allowedSources.includes(source) ? source : 'Website';

    // Same narrow-fields rule as above — copy only known string keys out of
    // the browser-supplied utm object.
    const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content', 'gclid', 'fbclid', 'landingPage', 'referrer'];
    const cleanUtm = {};
    if (utm && typeof utm === 'object') {
      UTM_KEYS.forEach((k) => {
        if (typeof utm[k] === 'string' && utm[k]) cleanUtm[k] = utm[k].slice(0, 500);
      });
    }

    const duplicateOf = await Lead.findOne({ mobile, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

    const lead = await Lead.create({
      leadCode: await generateLeadCode(),
      name, mobile, email,
      source: resolvedSource,
      campaign, utm: cleanUtm,
      pickupLocation, dropLocation,
      travelDate: travelDate || undefined,
      vehicleRequirement,
      notes: message,
      isDuplicate: !!duplicateOf,
      duplicateOfLead: duplicateOf?._id,
    });

    await LeadActivity.create({
      leadId: lead._id,
      type: 'note',
      message: `Lead captured automatically from ${resolvedSource}`,
    });

    await autoAssignLead(lead);
    notifyAdminNewLead(lead).catch(() => {});

    return res.status(201).json({ success: true, data: { leadCode: lead.leadCode } });
  } catch (error) {
    console.error('crm createPublicLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit enquiry' });
  }
};

module.exports = { createPublicLead };
