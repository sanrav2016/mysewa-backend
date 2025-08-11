import express from 'express';
import { prisma } from '../src/server.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get user preferences
router.get('/', authenticateToken, async (req, res) => {
  try {
    let preferences = await prisma.userPreferences.findUnique({
      where: { userId: req.user.id }
    });

    // If no preferences exist, create default ones
    if (!preferences) {
      preferences = await prisma.userPreferences.create({
        data: {
          userId: req.user.id
        }
      });
    }

    res.json({ preferences });

  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      error: 'Failed to fetch preferences',
      message: 'An error occurred while fetching preferences'
    });
  }
});

// Update user preferences
router.put('/', authenticateToken, async (req, res) => {
  try {
    const {
      eventReminders,
      newEvents,
      weeklyDigest,
      emailNotifications,
      textNotifications
    } = req.body;

    // Check if preferences exist
    const existingPreferences = await prisma.userPreferences.findUnique({
      where: { userId: req.user.id }
    });

    let preferences;
    if (existingPreferences) {
      // Update existing preferences
      preferences = await prisma.userPreferences.update({
        where: { userId: req.user.id },
        data: {
          eventReminders: eventReminders !== undefined ? eventReminders : existingPreferences.eventReminders,
          newEvents: newEvents !== undefined ? newEvents : existingPreferences.newEvents,
          weeklyDigest: weeklyDigest !== undefined ? weeklyDigest : existingPreferences.weeklyDigest,
          emailNotifications: emailNotifications !== undefined ? emailNotifications : existingPreferences.emailNotifications,
          textNotifications: textNotifications !== undefined ? textNotifications : existingPreferences.textNotifications
        }
      });
    } else {
      // Create new preferences
      preferences = await prisma.userPreferences.create({
        data: {
          userId: req.user.id,
          eventReminders: eventReminders !== undefined ? eventReminders : true,
          newEvents: newEvents !== undefined ? newEvents : true,
          weeklyDigest: weeklyDigest !== undefined ? weeklyDigest : false,
          emailNotifications: emailNotifications !== undefined ? emailNotifications : true,
          textNotifications: textNotifications !== undefined ? textNotifications : true
        }
      });
    }

    res.json({
      message: 'Preferences updated successfully',
      preferences
    });

  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      error: 'Failed to update preferences',
      message: 'An error occurred while updating preferences'
    });
  }
});

export default router; 