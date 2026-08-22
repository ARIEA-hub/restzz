// api/utils/otpStore.js
// Single shared in-memory OTP store used by users.js, admin.js, and otp.js
// so that an OTP generated during registration can be verified by the
// shared /api/verify-otp endpoint.
//
// Key: email → { otp, role, expiresAt }
//
// NOTE: This is in-memory and will NOT survive a server restart or work
// across multiple server instances. For production, replace with Redis
// or a database table with a TTL/expiry column.

const otpStore = {};

module.exports = otpStore;
