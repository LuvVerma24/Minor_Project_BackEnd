const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { otpRateLimiter } = require('../middleware/rateLimiter');

// Signup flow
// Step 1: Submits details, strict rate limiter sends OTP
router.post('/signup/initiate', otpRateLimiter, authController.initiateSignup);
// Step 2: Submits email + OTP, completes account creation
router.post('/signup/verify', authController.verifySignup);

// Login
router.post('/login', authController.login);

// Forgot password flow (Three steps)
// Step 1: Send OTP (strict rate limited)
router.post('/forgot-password/step1', otpRateLimiter, authController.forgotPasswordStep1);
// Step 2: Verify OTP
router.post('/forgot-password/step2', authController.forgotPasswordStep2);
// Step 3: Reset password with OTP + newPassword + confirmNewPassword
router.post('/forgot-password/step3', authController.forgotPasswordStep3);

// Current user profile
router.get('/me', authenticate, authController.getMe);

module.exports = router;
