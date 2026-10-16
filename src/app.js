const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const leadsRoutes = require('./routes/leads');
const publicLeadsRoutes = require('./routes/publicLeads');
const webhookRoutes = require('./routes/webhooks');

const app = express();

// Two different kinds of browser caller hit this server: the CRM's own
// frontend (authenticated routes) and the main public website's forms
// (the public lead-intake endpoint) — both need a CORS allowlist entry.
// Ad-platform webhooks (Meta) aren't browser requests, so CORS doesn't
// apply to them at all.
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  process.env.MAIN_SITE_URL,
  'http://localhost:3000',
  'http://localhost:4100',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ success: true, service: 'veekay-crm-server' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/public/leads', publicLeadsRoutes);
app.use('/api/webhooks', webhookRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('CRM server error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = app;
