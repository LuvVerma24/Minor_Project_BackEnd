const rateLimit = require("express-rate-limit");
const env = require("../config/env");

const isDev = env.NODE_ENV !== "production";

/**
 * Strict limiter: 50 requests in dev / 5 in prod per email on OTP-sending endpoints
 */
const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 50 : 5,
  keyGenerator: (req) => {
    const email = req.body?.email;
    if (email && typeof email === "string") {
      return "otp_" + email.trim().toLowerCase();
    }
    return "otp_ip_" + req.ip;
  },
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many OTP requests. Please wait before trying again.",
    });
  },
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General limiter: generous 10000 in dev / 1000 in prod
 */
const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 1000,
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many requests from this IP. Please try again after 15 minutes.",
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  otpRateLimiter,
  generalRateLimiter,
};
