const env = require('../config/env');

/**
 * Send email via Resend API
 */
const sendViaResend = async (to, subject, html, text) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Resend API Error (${response.status}): ${errorData.message || response.statusText}`);
  }

  return response.json();
};

/**
 * Send email via Brevo API
 */
const sendViaBrevo = async (to, subject, html, text) => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.EMAIL_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: env.EMAIL_FROM.split('<')[0].trim() || 'College Portal',
        email: (env.EMAIL_FROM.match(/<([^>]+)>/) || [null, 'noreply@college.edu'])[1],
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Brevo API Error (${response.status}): ${errorData.message || response.statusText}`);
  }

  return response.json();
};

/**
 * Main transactional email sender
 * Uses Resend or Brevo, with a development fallback when API key is not configured.
 */
const sendEmail = async ({ to, subject, html, text, otp = null, purpose = 'Verification' }) => {
  // If no API key configured or explicitly in test/dev mode without key, log OTP to console
  if (!env.EMAIL_API_KEY || env.EMAIL_API_KEY === 'mock' || env.EMAIL_API_KEY.includes('your_') || env.EMAIL_API_KEY.startsWith('re_123456')) {
    console.log('\n==================================================');
    console.log(`[EMAIL SERVICE - DEV/TEST MODE]`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    if (otp) {
      console.log(`🔑 OTP CODE: >>> ${otp} <<< (Valid for 10 minutes)`);
      console.log(`Purpose: ${purpose}`);
    }
    console.log('==================================================\n');
    return { success: true, simulated: true, messageId: 'simulated-dev-id' };
  }

  if (env.EMAIL_PROVIDER === 'brevo') {
    return sendViaBrevo(to, subject, html, text);
  } else {
    // Default to Resend
    return sendViaResend(to, subject, html, text);
  }
};

/**
 * Send OTP for Signup or Password Reset
 */
const sendOtpEmail = async (email, otp, purpose = 'signup') => {
  const isSignup = purpose === 'signup';
  const actionTitle = isSignup ? 'Verify Your Account' : 'Reset Your Password';
  const actionDescription = isSignup
    ? 'Thank you for registering on the Faculty-Student Portal. Use the one-time verification code below to complete your registration.'
    : 'We received a request to reset your password for the Faculty-Student Portal. Use the one-time code below to proceed.';

  const subject = isSignup
    ? 'Verification Code - College Portal Registration'
    : 'Password Reset Code - College Portal';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .header { text-align: center; border-bottom: 1px solid #edf2f7; padding-bottom: 20px; }
        .title { color: #1a365d; font-size: 22px; font-weight: 700; margin: 0; }
        .content { padding: 24px 0; font-size: 15px; line-height: 1.6; }
        .otp-box { background: #ebf8ff; border: 1px solid #bee3f8; border-radius: 8px; text-align: center; padding: 18px; margin: 24px 0; }
        .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #2b6cb0; font-family: monospace; }
        .expiry { font-size: 13px; color: #718096; margin-top: 6px; }
        .footer { font-size: 12px; color: #a0aec0; text-align: center; border-top: 1px solid #edf2f7; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="title">College Faculty-Student Portal</h1>
        </div>
        <div class="content">
          <p>Hello,</p>
          <p>${actionDescription}</p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
            <div class="expiry">This code will expire in 10 minutes.</div>
          </div>
          <p>If you did not request this email, please disregard it. Do not share this code with anyone.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} College Faculty-Student Portal. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `College Faculty-Student Portal\n\n${actionTitle}\n\nYour OTP verification code is: ${otp}\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.`;

  return sendEmail({
    to: email,
    subject,
    html,
    text,
    otp,
    purpose,
  });
};

module.exports = {
  sendEmail,
  sendOtpEmail,
};
