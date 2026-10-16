const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const { autoAssignLead } = require('../services/assignmentService');
const { notifyAdminNewLead } = require('../services/whatsapp');

const generateLeadCode = async () => {
  const count = await Lead.countDocuments();
  return `VK-${10000 + count + 1}`;
};

// Google's Lead Form "Webhook integration" (set up on the Lead Form asset
// itself — Assets → Lead form → Lead delivery → Webhook — no Google Ads
// API/OAuth needed, just this URL + a shared key) posts a fixed shape:
// { google_key, api_version, user_column_data: [{ column_id, string_value, column_name }, ...], campaign_id, gcl_id, is_test }
const extractField = (userColumnData, columnId) =>
  (userColumnData || []).find((c) => c.column_id === columnId)?.string_value;

// POST /api/webhooks/google-ads
const receiveGoogleAdsLead = async (req, res) => {
  try {
    const body = req.body || {};

    // Google sends a validation ping (is_test: true, no real data) when you
    // first save the webhook in the Lead Form asset — just acknowledge it.
    const configuredKey = process.env.GOOGLE_ADS_WEBHOOK_KEY;
    if (configuredKey && body.google_key !== configuredKey) {
      return res.status(401).json({ success: false, message: 'Invalid webhook key' });
    }
    if (body.is_test) {
      return res.status(200).json({ success: true, message: 'Test payload acknowledged' });
    }

    const columns = body.user_column_data;
    const name = extractField(columns, 'FULL_NAME')
      || [extractField(columns, 'FIRST_NAME'), extractField(columns, 'LAST_NAME')].filter(Boolean).join(' ')
      || 'Google Lead';
    // Google sends +91XXXXXXXXXX; the website sends 10 digits. Store Indian
    // numbers as 10 digits so duplicate detection matches across sources.
    const rawMobile = extractField(columns, 'PHONE_NUMBER');
    if (!rawMobile) {
      return res.status(400).json({ success: false, message: 'No phone number in payload' });
    }
    const digits = rawMobile.replace(/\D/g, '');
    const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : (digits || rawMobile);
    const email = extractField(columns, 'EMAIL');
    const city = extractField(columns, 'CITY');

    // Any other answers on the form (custom questions etc.) go into notes so
    // the salesperson sees everything the customer filled in.
    const KNOWN = ['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'PHONE_NUMBER', 'EMAIL', 'CITY'];
    const extras = (columns || [])
      .filter((c) => !KNOWN.includes(c.column_id) && c.string_value)
      .map((c) => `${c.column_name || c.column_id}: ${c.string_value}`);

    const duplicateOf = await Lead.findOne({ mobile, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

    const lead = await Lead.create({
      leadCode: await generateLeadCode(),
      name, mobile, email,
      pickupLocation: city,
      notes: extras.length ? extras.join('\n') : undefined,
      source: 'Google Ads',
      campaign: body.campaign_id,
      utm: { source: 'google', campaign: body.campaign_id, gclid: body.gcl_id },
      isDuplicate: !!duplicateOf,
      duplicateOfLead: duplicateOf?._id,
    });

    await LeadActivity.create({ leadId: lead._id, type: 'note', message: 'Lead captured automatically from Google Lead Form' });
    await autoAssignLead(lead);
    notifyAdminNewLead(lead).catch(() => {});

    return res.status(200).json({ success: true, data: { leadCode: lead.leadCode } });
  } catch (error) {
    console.error('crm receiveGoogleAdsLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process lead' });
  }
};

module.exports = { receiveGoogleAdsLead };
