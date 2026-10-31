const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Generates a cryptographically secure 6-digit numeric OTP
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hashes an OTP using bcrypt
 */
const hashOtp = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
};

/**
 * Compares plain OTP against stored hash
 */
const verifyOtpHash = async (plainOtp, hashedOtp) => {
  if (!plainOtp || !hashedOtp) return false;
  return bcrypt.compare(plainOtp.toString().trim(), hashedOtp);
};

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtpHash,
};
