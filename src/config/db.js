const mongoose = require('mongoose');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('CRM server connected to MongoDB');
};

module.exports = connectDB;
