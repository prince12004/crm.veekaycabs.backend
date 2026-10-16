const express = require('express');
const router = express.Router();
const { getAllUsers, createUser, updateUser, toggleUser } = require('../controllers/usersController');
const { protect, superAdminOnly } = require('../middleware/auth');

router.use(protect, superAdminOnly);

router.get('/', getAllUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/toggle', toggleUser);

module.exports = router;
