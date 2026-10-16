// One-time setup script — creates the first Super Admin login.
// Usage: npm run seed:admin -- --email you@veekaycabs.com --password Secret123 --name "Prince"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const CrmUser = require('../models/CrmUser');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
};

(async () => {
  const email = arg('--email', 'admin@veekaycabs.com');
  const password = arg('--password', 'Veekay@123');
  const name = arg('--name', 'Super Admin');

  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await CrmUser.findOne({ email });
  if (existing) {
    console.log(`A user with email ${email} already exists (role: ${existing.role}). Nothing created.`);
    process.exit(0);
  }

  const hashed = await bcrypt.hash(password, 10);
  await CrmUser.create({ name, email, password: hashed, role: 'super_admin' });

  console.log('Super Admin created:');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log('Log in and change the password from the CRM once it is running.');
  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
