const mongoose = require('mongoose');

// Read-only lookups into the MAIN Veekay Cabs website's collections (same
// MongoDB database, different Node app) — just enough fields to show
// "this customer already has an account / past bookings" on a lead (SRS
// section 11). Never written to from here; the main site owns these.
const MainUserSchema = new mongoose.Schema({
  name: String,
  mobile: String,
  email: String,
}, { strict: false, collection: 'users' });

const MainBookingSchema = new mongoose.Schema({
  bookingId: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'MainUser' },
  carId: mongoose.Schema.Types.ObjectId,
  startTime: Date,
  endTime: Date,
  totalAmount: Number,
  status: String,
}, { strict: false, collection: 'bookings' });

const MainUser = mongoose.model('MainUser', MainUserSchema);
const MainBooking = mongoose.model('MainBooking', MainBookingSchema);

module.exports = { MainUser, MainBooking };
