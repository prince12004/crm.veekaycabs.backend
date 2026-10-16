const express = require('express');
const router = express.Router();
const { createPublicLead } = require('../controllers/publicLeadsController');

router.post('/', createPublicLead);

module.exports = router;
