const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const OtpToken = require('../models/OtpToken');
const { generateOtp, hashOtp, verifyOtpHash } = require('../services/otpService');
const { sendOtpEmail } = require('../services/emailService');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate college domain if ALLOWED_EMAIL_DOMAIN is configured
 */
const isDomainAllowed = (email) => {
  if (!env.ALLOWED_EMAIL_DOMAIN) return true;
  const domain = email.split('@')[1];
  return domain && domain.toLowerCase() === env.ALLOWED_EMAIL_DOMAIN.toLowerCase();
};

/**
 * Generate 7-day JWT Token
 */
const generateAuthToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
};

/**
 * SIGNUP STEP 1: Initiate signup, validate fields, hash password, send OTP
 */
const initiateSignup = async (req, res, next) => {
  try {
    const {
      role,
      fullName,
      email,
      password,
      confirmPassword,
      // Teacher specific
      post,
      department,
      phone,
      // Student specific
      year,
      section,
    } = req.body;

    // Validate role
    if (!role || !['teacher', 'student'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role is required and must be either "teacher" or "student".',
      });
    }

    // Validate fullName
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required.',
      });
    }

    // Validate email
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check college domain restriction if enabled
    if (!isDomainAllowed(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: `Email domain must be restricted to @${env.ALLOWED_EMAIL_DOMAIN}`,
      });
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 8 characters long.',
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match.',
      });
    }

    // Validate phone
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required.',
      });
    }

    // Validate department
    if (!department || typeof department !== 'string' || !department.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Department is required.',
      });
    }

    // Role-specific field validation
    if (role === 'teacher') {
      if (!post || typeof post !== 'string' || !post.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Post (designation) is required for teacher accounts.',
        });
      }
    } else if (role === 'student') {
      if (!year || typeof year !== 'string' || !year.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Year is required for student accounts.',
        });
      }
      if (!section || typeof section !== 'string' || !section.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Section is required for student accounts.',
        });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists. Please log in.',
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Prepare pending registration metadata
    const metadata = {
      role,
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
      department: department.trim(),
      phone: phone.trim(),
      post: role === 'teacher' ? post.trim() : null,
      year: role === 'student' ? year.trim() : null,
      section: role === 'student' ? section.trim() : null,
    };

    // Generate 6-digit OTP
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Delete any existing signup OTPs for this email
    await OtpToken.deleteMany({ email: normalizedEmail, purpose: 'signup' });

    // Store in OtpToken
    await OtpToken.create({
      email: normalizedEmail,
      otpHash,
      purpose: 'signup',
      metadata,
      expiresAt,
    });

    // Send transactional email
    await sendOtpEmail(normalizedEmail, otp, 'signup');

    return res.status(200).json({
      success: true,
      message: 'Signup initiated. A 6-digit OTP has been sent to your email. Please verify to complete registration.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * SIGNUP STEP 2: Verify OTP and create user account
 */
const verifySignup = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP code are required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find latest valid unexpired OTP token
    const otpRecord = await OtpToken.findOne({
      email: normalizedEmail,
      purpose: 'signup',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired or is invalid. Please initiate signup again.',
      });
    }

    // Verify OTP
    const isMatch = await verifyOtpHash(otp, otpRecord.otpHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code. Please enter the correct code sent to your email.',
      });
    }

    // Double check if account was created in the meantime
    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
      await OtpToken.deleteMany({ email: normalizedEmail, purpose: 'signup' });
      return res.status(400).json({
        success: false,
        message: 'Account has already been created. Please log in.',
      });
    }

    // Create user from stored metadata
    const metadata = otpRecord.metadata;
    user = await User.create({
      fullName: metadata.fullName,
      email: metadata.email,
      passwordHash: metadata.passwordHash,
      role: metadata.role,
      department: metadata.department,
      phone: metadata.phone,
      post: metadata.post,
      year: metadata.year,
      section: metadata.section,
    });

    // Clean up OTP token
    await OtpToken.deleteMany({ email: normalizedEmail, purpose: 'signup' });

    // Generate JWT
    const token = generateAuthToken(user);

    return res.status(201).json({
      success: true,
      message: 'Account created and verified successfully.',
      token,
      user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * LOGIN: Email + Password
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const token = generateAuthToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * FORGOT PASSWORD - STEP 1: Request OTP
 */
const forgotPasswordStep1 = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No registered account found with this email address.',
      });
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Remove prior login-reset OTPs for this email
    await OtpToken.deleteMany({ email: normalizedEmail, purpose: 'login-reset' });

    await OtpToken.create({
      email: normalizedEmail,
      otpHash,
      purpose: 'login-reset',
      expiresAt,
    });

    await sendOtpEmail(normalizedEmail, otp, 'login-reset');

    return res.status(200).json({
      success: true,
      message: 'Password reset OTP has been sent to your email.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * FORGOT PASSWORD - STEP 2: Verify OTP
 */
const forgotPasswordStep2 = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const otpRecord = await OtpToken.findOne({
      email: normalizedEmail,
      purpose: 'login-reset',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired or is invalid. Please request a new code.',
      });
    }

    const isMatch = await verifyOtpHash(otp, otpRecord.otpHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You may now proceed to reset your password.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * FORGOT PASSWORD - STEP 3: Reset password with OTP + newPassword + confirmNewPassword
 */
const forgotPasswordStep3 = async (req, res, next) => {
  try {
    const { email, otp, newPassword, confirmNewPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, newPassword, and confirmNewPassword are all required.',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.',
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify OTP again
    const otpRecord = await OtpToken.findOne({
      email: normalizedEmail,
      purpose: 'login-reset',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired or is invalid. Please restart the forgot-password process.',
      });
    }

    const isMatch = await verifyOtpHash(otp, otpRecord.otpHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code.',
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    // Hash and update password
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await user.save();

    // Delete used OTP
    await OtpToken.deleteMany({ email: normalizedEmail, purpose: 'login-reset' });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user profile
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }
    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initiateSignup,
  verifySignup,
  login,
  forgotPasswordStep1,
  forgotPasswordStep2,
  forgotPasswordStep3,
  getMe,
};
