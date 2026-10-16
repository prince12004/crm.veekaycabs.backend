const jwt = require('jsonwebtoken');
const CrmUser = require('../models/CrmUser');

// Verifies the JWT and attaches the current CRM user (minus password) to
// req.crmUser. Every CRM route except /auth/login sits behind this.
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await CrmUser.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Account not found or deactivated' });
    }
    req.crmUser = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
};

// Gate to Super Admin-only endpoints (salesperson management, assignment
// rules, settings, audit logs — SRS section 2.1).
const superAdminOnly = (req, res, next) => {
  if (req.crmUser?.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required' });
  }
  next();
};

module.exports = { protect, superAdminOnly };
