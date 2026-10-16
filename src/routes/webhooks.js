const express = require('express');
const router = express.Router();
const { verifyWebhook, handleWebhook } = require('../controllers/metaWebhookController');
const { receiveJustdialLead } = require('../controllers/justdialWebhookController');
const { receiveNeodoveLead } = require('../controllers/neodoveWebhookController');
const { receiveGoogleAdsLead } = require('../controllers/googleAdsWebhookController');

router.get('/meta', verifyWebhook);
router.post('/meta', handleWebhook);

router.post('/justdial', receiveJustdialLead);
router.post('/neodove', receiveNeodoveLead);
router.post('/google-ads', receiveGoogleAdsLead);

module.exports = router;
