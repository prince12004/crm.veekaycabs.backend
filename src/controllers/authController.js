const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const CrmUser = require('../models/CrmUser');

const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await CrmUser.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    return res.json({
      success: true,
      data: {
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
      },
    });
  } catch (error) {
    console.error('crm login error:', error);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// GET /api/auth/me
const me = async (req, res) => {
  const { _id, name, email, mobile, role, isActive } = req.crmUser;
  return res.json({ success: true, data: { id: _id, name, email, mobile, role, isActive } });
};

module.exports = { login, me };
