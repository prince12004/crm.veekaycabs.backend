const axios = require('axios');

// Reuses the same AiSensy account the main Veekay Cabs website already
// sends WhatsApp messages from — this only ever messages the BUSINESS
// OWNER (ADMIN_MOBILE), never a customer, so it uses a free-text "session"
// message rather than a template. AiSensy delivers session messages to any
// number that has an open 24h WhatsApp conversation with the business
// number (true as long as the owner periodically messages it — no Meta
// template approval needed for this, unlike customer-facing messages).
const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2/messages';
const AISENSY_USER_NAME = 'VEEKAY CRANES & CABS PRIVATE LIMITED';

const isConfigured = () => process.env.AISENSY_API_KEY && process.env.AISENSY_API_KEY !== 'placeholder';

const cleanMobile = (mobile) => {
  if (!mobile) return null;
  const m = mobile.replace(/\D/g, '');
  if (m.length === 10) return `91${m}`;
  return m;
};

const getAdminMobiles = () =>
  (process.env.ADMIN_MOBILE || '').split(',').map((s) => s.trim()).filter(Boolean);

const sendSessionMessage = async (mobile, message) => {
  const destination = cleanMobile(mobile);
  if (!destination) return { success: false, reason: 'no_mobile' };
  if (!isConfigured()) {
    console.log(`[CRM WhatsApp] To ${destination}: ${message}`);
    return { success: true };
  }
  try {
    const res = await axios.post(AISENSY_API_URL, {
      apiKey: process.env.AISENSY_API_KEY,
      destination,
      userName: AISENSY_USER_NAME,
      source: 'Veekay CRM',
      message,
    }, { timeout: 10000 });
    return { success: true, data: res.data };
  } catch (error) {
    console.error('[CRM AiSensy] session message error:', error.response?.data || error.message);
    return { success: false };
  }
};

// Fired right after a lead is auto-captured (website, Meta Ads, JustDial,
// etc.) so the owner sees it in WhatsApp within seconds, before even
// opening the CRM.
const notifyAdminNewLead = async (lead) => {
  const message =
    `🆕 New Lead — ${lead.source}\n` +
    `Name: ${lead.name}\n` +
    `Mobile: ${lead.mobile}\n` +
    (lead.pickupLocation ? `Pickup: ${lead.pickupLocation}\n` : '') +
    (lead.notes ? `Note: ${lead.notes}\n` : '') +
    `Lead ID: ${lead.leadCode}`;
  return Promise.all(getAdminMobiles().map((mobile) => sendSessionMessage(mobile, message)));
};

module.exports = { sendSessionMessage, notifyAdminNewLead };
