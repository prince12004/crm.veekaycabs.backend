const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const { autoAssignLead } = require('../services/assignmentService');
const { notifyAdminNewLead } = require('../services/whatsapp');

const generateLeadCode = async () => {
  const count = await Lead.countDocuments();
  return `VK-${10000 + count + 1}`;
};

// NeoDove's exact webhook field names depend on how the integration is
// configured on their dashboard — this accepts several common variants so
// it works without knowing the precise schema in advance; every payload is
// logged in full below, so the mapping can be tightened once a real one is
// seen.
const pick = (body, ...keys) => {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') return String(body[k]).trim();
  }
  return undefined;
};

// NeoDove is Veekay's existing aggregation point — Google Ads leads and
// IVR/call leads already land there today, and this endpoint receives
// EVERYTHING NeoDove forwards, not just calls. Whatever NeoDove says the
// original source was gets mapped onto our own source enum so reporting
// still shows "Google Ads" vs "Phone Call" correctly, instead of lumping
// every NeoDove-forwarded lead under one generic label.
const mapSource = (raw) => {
  const s = (raw || '').toLowerCase();
  if (s.includes('google')) return 'Google Ads';
  if (s.includes('meta') || s.includes('facebook') || s.includes('instagram')) return 'Meta Ads';
  if (s.includes('justdial')) return 'JustDial';
  if (s.includes('whatsapp')) return 'WhatsApp';
  if (s.includes('ivr') || s.includes('call') || s.includes('phone')) return 'Phone Call';
  if (s.includes('web') || s.includes('site')) return 'Website';
  return 'Referral'; // NeoDove-sourced but origin not recognized — still visible, just not mis-labeled as a Call
};

// POST /api/webhooks/neodove — fired by NeoDove on any new lead/call it
// receives (from Google Ads, IVR, or anything else connected to it there).
const receiveNeodoveLead = async (req, res) => {
  try {
    const configuredToken = process.env.NEODOVE_WEBHOOK_TOKEN;
    if (configuredToken) {
      const givenToken = req.query.token || req.headers['x-webhook-token'];
      if (givenToken !== configuredToken) {
        return res.status(401).json({ success: false, message: 'Invalid webhook token' });
      }
    }

    const body = req.body || {};
    console.log('[NeoDove webhook] payload:', JSON.stringify(body));

    const mobile = pick(body, 'caller_number', 'callerNumber', 'customer_number', 'phone', 'mobile', 'from_number', 'contact_number', 'lead_phone');
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'No phone number found in payload' });
    }
    const name = pick(body, 'name', 'customer_name', 'caller_name', 'lead_name') || `NeoDove Lead ${mobile.slice(-4)}`;
    const email = pick(body, 'email');
    const rawSource = pick(body, 'source', 'lead_source', 'channel', 'campaign_source', 'origin');
    const agent = pick(body, 'agent', 'agent_name', 'executive');
    const callStatus = pick(body, 'call_status', 'status', 'disposition');
    const duration = pick(body, 'duration', 'call_duration');
    const recordingUrl = pick(body, 'recording_url', 'recordingUrl', 'call_recording');
    const message = pick(body, 'message', 'query', 'enquiry', 'remarks');

    // Idempotency — if NeoDove retries the same event (e.g. because our
    // server was briefly unreachable), this skips creating a duplicate
    // instead of erroring the retry.
    const externalId = pick(body, 'lead_id', 'call_id', 'id', 'event_id', 'uuid');
    const externalRef = externalId ? `neodove:${externalId}` : undefined;
    if (externalRef) {
      const already = await Lead.findOne({ externalRef });
      if (already) {
        return res.status(200).json({ success: true, data: { leadCode: already.leadCode, duplicate: true } });
      }
    }

    const duplicateOf = await Lead.findOne({ mobile, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

    const notesParts = [
      message || null,
      callStatus ? `Call status: ${callStatus}` : null,
      duration ? `Duration: ${duration}s` : null,
      agent ? `NeoDove agent: ${agent}` : null,
      recordingUrl ? `Recording: ${recordingUrl}` : null,
    ].filter(Boolean);

    const lead = await Lead.create({
      leadCode: await generateLeadCode(),
      name, mobile, email,
      source: mapSource(rawSource),
      notes: notesParts.join(' · '),
      isDuplicate: !!duplicateOf,
      duplicateOfLead: duplicateOf?._id,
      externalRef,
    });

    await LeadActivity.create({
      leadId: lead._id,
      type: 'note',
      message: `Lead captured automatically via NeoDove (original source: ${rawSource || 'unspecified'})`,
    });
    await autoAssignLead(lead);
    notifyAdminNewLead(lead).catch(() => {});

    return res.status(201).json({ success: true, data: { leadCode: lead.leadCode } });
  } catch (error) {
    // Duplicate externalRef slipping through a race (two retries landing
    // at the same instant) — treat as success, not a failure to report back.
    if (error?.code === 11000) {
      return res.status(200).json({ success: true, data: { duplicate: true } });
    }
    console.error('crm receiveNeodoveLead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process lead' });
  }
};

module.exports = { receiveNeodoveLead };
