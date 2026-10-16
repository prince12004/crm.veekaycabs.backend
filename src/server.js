require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { startSlaWatcher } = require('./jobs/slaWatcher');

const PORT = process.env.PORT || 5050;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Veekay CRM server running on port ${PORT}`));
    startSlaWatcher();
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });
