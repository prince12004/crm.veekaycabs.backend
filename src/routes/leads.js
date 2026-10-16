const express = require('express');
const router = express.Router();
const {
  getAllLeads, getStats, getLeadById, createLead, updateLead, assignLead, addActivity,
} = require('../controllers/leadsController');
const { protect, superAdminOnly } = require('../middleware/auth');

router.use(protect);

router.get('/stats', getStats);
router.get('/', getAllLeads);
router.post('/', createLead);
router.get('/:id', getLeadById);
router.put('/:id', updateLead);
router.patch('/:id/assign', superAdminOnly, assignLead);
router.post('/:id/activity', addActivity);

module.exports = router;
