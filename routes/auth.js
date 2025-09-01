import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { prisma } from '../src/server.js';
import { userLoginSchema, userRegistrationSchema, passwordChangeSchema } from '../validation/schemas.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Email transporter configuration
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

// Helper function to calculate user hours from signups
const calculateUserHours = async (userId) => {
  const result = await prisma.userEventSignup.aggregate({
    where: {
      userId: userId,
      status: 'CONFIRMED',
      approval: 'APPROVED',
      hoursEarned: { not: null }
    },
    _sum: {
      hoursEarned: true
    }
  });
  return result._sum.hoursEarned || 0;
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    // Validate input
    const { error, value } = userRegistrationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { email, password, ...userData } = value;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'A user with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await prisma.user.create({
      data: {
        ...userData,
        email,
        password: hashedPassword
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        joinedDate: true,
        phone: true,
        chapter: true,
        city: true,
        avatar: true
      }
    });

    // Calculate hours for new user (will be 0)
    const totalHours = await calculateUserHours(user.id);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        ...user,
        totalHours
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: 'An error occurred during registration'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    // Validate input
    const { error, value } = userLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { email, password } = value;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        role: true,
        joinedDate: true,
        phone: true,
        chapter: true,
        city: true,
        avatar: true
      }
    });

    if (!user) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Remove password from response and calculate hours
    const { password: _, ...userWithoutPassword } = user;
    const totalHours = await calculateUserHours(user.id);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Login successful',
      user: {
        ...userWithoutPassword,
        totalHours
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: 'An error occurred during login'
    });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: req.user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to get profile',
      message: 'An error occurred while fetching your profile'
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({
    message: 'Logout successful'
  });
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = passwordChangeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { currentPassword, newPassword } = value;

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        password: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        error: 'Invalid current password',
        message: 'Current password is incorrect'
      });
    }

    // Check if new password is different from current password
    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'Same password',
        message: 'New password must be different from your current password'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedNewPassword }
    });

    res.json({
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Password change failed',
      message: 'An error occurred while changing the password'
    });
  }
});

// Refresh token (optional - for longer sessions)
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true
      }
    });

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        message: 'User account no longer exists'
      });
    }

    // Generate new token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Token refreshed successfully',
      token
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Token refresh failed',
      message: 'An error occurred while refreshing the token'
    });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email required',
        message: 'Please provide an email address'
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true }
    });

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours

    // Save reset token to database
    await prisma.passwordReset.create({
      data: {
        email,
        token: resetToken,
        expiresAt
      }
    });

    // Create notification for password reset request
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Password Reset Requested',
        description: 'A password reset has been requested for your account. Check your email for the reset link. If you did not request this, please contact support immediately.',
        type: 'WARNING'
      }
    });

    // Create email transporter
    const transporter = createTransporter();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request - MySewa',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; color: white;">
            <h1 style="margin: 0;">MySewa</h1>
            <p style="margin: 5px 0 0 0;">Password Reset Request</p>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              We received a request to reset your password for your MySewa account. 
              If you didn't make this request, you can safely ignore this email.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        padding: 12px 30px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        display: inline-block; 
                        font-weight: bold;">
                Reset Password
              </a>
            </div>
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              This link will expire in 3 hours for security reasons.
            </p>
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              If the button doesn't work, you can copy and paste this link into your browser:
            </p>
            <p style="color: #667eea; word-break: break-all; font-size: 14px;">
              ${resetUrl}
            </p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              This is an automated message from MySewa. Please do not reply to this email.
            </p>
          </div>
        </div>
      `
    };

    // Send email
    await transporter.sendMail(mailOptions);

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent'
    });

  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      error: 'Password reset request failed',
      message: 'An error occurred while processing your request'
    });
  }
});

// Verify reset token
router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token }
    });

    if (!resetRecord) {
      return res.status(400).json({
        error: 'Invalid token',
        message: 'The reset token is invalid or has expired'
      });
    }

    if (resetRecord.used) {
      return res.status(400).json({
        error: 'Token already used',
        message: 'This reset token has already been used'
      });
    }

    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({
        error: 'Token expired',
        message: 'The reset token has expired'
      });
    }

    res.json({
      message: 'Token is valid',
      email: resetRecord.email
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: 'Token verification failed',
      message: 'An error occurred while verifying the token'
    });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Token and new password are required'
      });
    }

    // Find reset record
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token }
    });

    if (!resetRecord) {
      return res.status(400).json({
        error: 'Invalid token',
        message: 'The reset token is invalid or has expired'
      });
    }

    if (resetRecord.used) {
      return res.status(400).json({
        error: 'Token already used',
        message: 'This reset token has already been used'
      });
    }

    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({
        error: 'Token expired',
        message: 'The reset token has expired'
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: resetRecord.email }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // Mark reset token as used
    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true }
    });

    // Create notification for successful password reset
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Password Reset Successful',
        description: 'Your password has been successfully reset. If you did not perform this action, please contact support immediately.',
        type: 'SUCCESS'
      }
    });

    // Get updated user data with total hours
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        joinedDate: true,
        phone: true,
        chapter: true,
        city: true,
        avatar: true
      }
    });

    const totalHours = await calculateUserHours(user.id);

    // Generate JWT token for automatic login
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Password reset successfully',
      user: {
        ...updatedUser,
        totalHours
      },
      token: jwtToken
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      error: 'Password reset failed',
      message: 'An error occurred while resetting the password'
    });
  }
});

export default router; 