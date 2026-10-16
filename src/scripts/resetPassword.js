// Resets the password of an existing CRM login (Super Admin or Salesperson).
// Usage: npm run reset:password -- --email prince@veekaycabs.com --password NewSecret123
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const CrmUser = require('../models/CrmUser');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const email = arg('--email');
  const password = arg('--password');
  if (!email || !password) {
    console.log('Usage: npm run reset:password -- --email you@veekaycabs.com --password NewSecret123');
    process.exit(1);
  }
  if (password.length < 8) {
    console.log('Password must be at least 8 characters.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const user = await CrmUser.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.log(`No CRM user with email ${email}.`);
    process.exit(1);
  }

  user.password = await bcrypt.hash(password, 10);
  user.isActive = true;
  await user.save();

  console.log(`Password reset for ${user.name} (${user.role}) — ${user.email}`);
  process.exit(0);
})().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
