const crypto = require('crypto');
const ClassRoom = require('../models/ClassRoom');

/**
 * Generate a random 6-character alphanumeric uppercase join code (excluding ambiguous 0/O, 1/I)
 */
const generateRandomCode = (length = 6) => {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
};

/**
 * Generate a unique join code that is not currently in use by any ClassRoom
 */
const generateUniqueJoinCode = async () => {
  let isUnique = false;
  let code = '';
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    code = generateRandomCode(6);
    const existing = await ClassRoom.findOne({ joinCode: code });
    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    // Fallback to timestamp-based unique code
    code = ('C' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex')).toUpperCase().slice(-8);
  }

  return code;
};

/**
 * Normalizes input date to YYYY-MM-DD format.
 * Defaults to current date if omitted.
 */
const normalizeDate = (dateInput) => {
  if (!dateInput) {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  // Validate format YYYY-MM-DD
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (regex.test(dateInput)) {
    const d = new Date(dateInput);
    if (!isNaN(d.getTime())) {
      return dateInput;
    }
  }

  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }

  return parsed.toISOString().split('T')[0];
};

module.exports = {
  generateRandomCode,
  generateUniqueJoinCode,
  normalizeDate,
};
