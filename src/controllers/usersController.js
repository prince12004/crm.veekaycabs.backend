const bcrypt = require('bcryptjs');
const CrmUser = require('../models/CrmUser');
const Lead = require('../models/Lead');

// GET /api/users — list all CRM users (Super Admin only)
const getAllUsers = async (req, res) => {
  try {
    const users = await CrmUser.find().sort({ createdAt: -1 });
    const openCounts = await Lead.aggregate([
      { $match: { isDeleted: { $ne: true }, status: { $nin: ['Booking Confirmed', 'Not Interested', 'Lost', 'Cancelled', 'Duplicate', 'Invalid Lead'] } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(openCounts.map((c) => [String(c._id), c.count]));
    const data = users.map((u) => ({ ...u.toObject(), openLeadCount: countMap[String(u._id)] || 0 }));
    return res.json({ success: true, data });
  } catch (error) {
    console.error('crm getAllUsers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load users' });
  }
};

// POST /api/users — create a salesperson or another super admin
const createUser = async (req, res) => {
  try {
    const { name, email, mobile, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }
    const existing = await CrmUser.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A user with this email already exists' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await CrmUser.create({
      name, mobile,
      email: email.toLowerCase().trim(),
      password: hashed,
      role: role === 'super_admin' ? 'super_admin' : 'salesperson',
    });
    const { password: _pw, ...safe } = user.toObject();
    return res.status(201).json({ success: true, data: safe });
  } catch (error) {
    console.error('crm createUser error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create user' });
  }
};

// PUT /api/users/:id — edit name/mobile/role/working hours, optionally reset password
const updateUser = async (req, res) => {
  try {
    const { name, mobile, role, password, workingHours } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (mobile !== undefined) update.mobile = mobile;
    if (role !== undefined) update.role = role === 'super_admin' ? 'super_admin' : 'salesperson';
    if (workingHours !== undefined) update.workingHours = workingHours;
    if (password) update.password = await bcrypt.hash(password, 10);

    const user = await CrmUser.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: user });
  } catch (error) {
    console.error('crm updateUser error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user' });
  }
};

// PATCH /api/users/:id/toggle — deactivate/reactivate a salesperson. A
// deactivated salesperson is excluded from new-lead assignment (Phase 3)
// but keeps their history on already-owned leads.
const toggleUser = async (req, res) => {
  try {
    if (String(req.params.id) === String(req.crmUser._id)) {
      return res.status(400).json({ success: false, message: "You can't deactivate your own account" });
    }
    const user = await CrmUser.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    return res.json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

module.exports = { getAllUsers, createUser, updateUser, toggleUser };
