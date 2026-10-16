const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const { autoAssignLead } = require('../services/assignmentService');
const { notifyAdminNewLead } = require('../services/whatsapp');

const generateLeadCode = async () => {
  const count = await Lead.countDocuments();
  return `VK-${10000 + count + 1}`;
};

// First matching, non-empty field wins — JustDial itself has no public
// webhook for most listings, so this is designed to sit behind a no-code
// relay (Zapier "Email Parser" → "Webhooks by Zapier" is the easiest path,
// see crm/README.md) whose exact field names you control when you set it
// up, or JustDial's own Lead Manager API if your account has it.
const pick = (body, ...keys) => {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') return String(body[k]).trim();
  }
  return undefined;
};

// POST /api/webhooks/justdial
const receiveJustdialLead = async (req, res) => {
  try {
    const configuredToken = process.env.JUSTDIAL_WEBHOOK_TOKEN;
    if (configuredToken) {
      const givenToken = req.query.token || req.headers['x-webhook-token'];
      if (givenToken !== configuredToken) {
        return res.status(401).json({ success: false, message: 'Invalid webhook token' });
      }
    }

    const body = req.body || {};
    const name = pick(body, 'name', 'Name', 'customer_name', 'customerName', 'lead_name') || 'JustDial Lead';
    const mobile = pick(body, 'mobile', 'phone', 'Mobile', 'Phone', 'contact_number', 'contactNumber', 'customer_mobile');
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'No mobile number found in payload' });
    }
    const email = pick(body, 'email', 'Email');
    const message = pick(body, 'message', 'query', 'enquiry', 'Enquiry', 'requirement', 'Message');

    const duplicateOf = await Lead.findOne({ mobile, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

    const lead = await Lead.create({
      leadCode: await generateLeadCode(),
      name, mobile, email,
      source: 'JustDial',
      notes: message,
      isDuplicate: !!duplicateOf,
      duplicateOfLead: duplicateOf?._id,
    });

    await LeadActivity.create({ leadId: lead._id, type: 'note', message: 'Lead captured automatically from JustDial' });
    await autoAssignLead(lead);
    notifyAdminNewLead(lead).catch(() => {});

    return res.status(201).json({ success: true, data: { leadCode: lead.leadCode } });
  } catch (error) {
    console.error('crm receiveJustdialLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process lead' });
  }
};

module.exports = { receiveJustdialLead };
