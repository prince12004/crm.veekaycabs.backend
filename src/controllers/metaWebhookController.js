const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const { autoAssignLead } = require('../services/assignmentService');
const { notifyAdminNewLead } = require('../services/whatsapp');

const generateLeadCode = async () => {
  const count = await Lead.countDocuments();
  return `VK-${10000 + count + 1}`;
};

// GET /api/webhooks/meta — Meta's one-time handshake when you register the
// webhook URL in the Developer dashboard (Webhooks > Page > leadgen).
// Meta calls this with hub.mode/hub.verify_token/hub.challenge and expects
// the raw challenge string echoed back if the token matches.
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

// Pulls the actual submitted field values for one lead from the Graph API —
// the webhook payload itself only carries the leadgen_id, not the answers.
const fetchLeadFields = async (leadgenId) => {
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Graph API error ${res.status}`);
  const data = await res.json();
  const fields = {};
  (data.field_data || []).forEach((f) => { fields[f.name] = f.values?.[0]; });
  return fields;
};

// POST /api/webhooks/meta — fired for every new Lead Ads submission once
// subscribed. One request can bundle multiple entries/changes.
const handleWebhook = async (req, res) => {
  // Acknowledge immediately — Meta retries aggressively on anything but a
  // fast 200, and the actual processing (a Graph API round-trip per lead)
  // shouldn't hold that up.
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue;
        const { leadgen_id, form_id, ad_id, campaign_id } = change.value || {};
        if (!leadgen_id) continue;

        const fields = await fetchLeadFields(leadgen_id);
        const name = fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || 'Meta Lead';
        const mobile = fields.phone_number || '';
        if (!mobile) continue; // can't create a lead without a contactable number

        const duplicateOf = await Lead.findOne({ mobile, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

        const lead = await Lead.create({
          leadCode: await generateLeadCode(),
          name, mobile,
          email: fields.email,
          source: 'Meta Ads',
          campaign: campaign_id,
          utm: { campaign: campaign_id, content: ad_id },
          isDuplicate: !!duplicateOf,
          duplicateOfLead: duplicateOf?._id,
          notes: `Meta form: ${form_id}`,
        });

        await LeadActivity.create({ leadId: lead._id, type: 'note', message: 'Lead captured automatically from Meta Ads' });
        await autoAssignLead(lead);
        notifyAdminNewLead(lead).catch(() => {});
      }
    }
  } catch (error) {
    // Already responded 200 to Meta — just log for now so a bad lead
    // doesn't trigger their retry storm.
    console.error('crm meta webhook processing error:', error);
  }
};

module.exports = { verifyWebhook, handleWebhook };
