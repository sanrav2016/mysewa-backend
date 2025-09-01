import express from 'express';
import { prisma, io } from '../src/server.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get user's notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      userId: req.user.id
    };

    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    // Add search functionality
    if (search && search.trim() !== '') {
      where.OR = [
        {
          title: {
            contains: search.trim(),
            mode: 'insensitive'
          }
        },
        {
          description: {
            contains: search.trim(),
            mode: 'insensitive'
          }
        }
      ];
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          session: {
            include: {
              event: true
            }
          },
          event: true
        }
      }),
      prisma.notification.count({ where })
    ]);

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      error: 'Failed to fetch notifications',
      message: 'An error occurred while fetching notifications'
    });
  }
});

// Create notification
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, type, userId, isRead, sessionId } = req.body;

    // Validate required fields
    if (!title || !description || !type || !userId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Title, description, type, and userId are required'
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The specified user does not exist'
      });
    }

    const notification = await prisma.notification.create({
      data: {
        title,
        description,
        type,
        userId,
        sessionId,
        isRead: isRead || false,
        date: new Date()
      },
      include: {
        session: {
          include: {
            event: true
          }
        }
      }
    });

    // Emit WebSocket event for real-time notification
    io.to(`user-${userId}`).emit('notification-created', {
      type: 'notification-created',
      notification
    });

    res.status(201).json({
      message: 'Notification created successfully',
      notification
    });

  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      error: 'Failed to create notification',
      message: 'An error occurred while creating the notification'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification) {
      return res.status(404).json({
        error: 'Notification not found',
        message: 'The requested notification does not exist'
      });
    }

    // Check if user owns this notification
    if (notification.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only mark your own notifications as read'
      });
    }

    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: { isRead: true }
    });

    res.json({
      message: 'Notification marked as read',
      notification: updatedNotification
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      error: 'Failed to mark notification as read',
      message: 'An error occurred while updating the notification'
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false
      },
      data: { isRead: true }
    });

    res.json({
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      error: 'Failed to mark notifications as read',
      message: 'An error occurred while updating notifications'
    });
  }
});

// Delete notification
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification) {
      return res.status(404).json({
        error: 'Notification not found',
        message: 'The requested notification does not exist'
      });
    }

    // Check if user owns this notification
    if (notification.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only delete your own notifications'
      });
    }

    await prisma.notification.delete({
      where: { id }
    });

    res.json({
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      error: 'Failed to delete notification',
      message: 'An error occurred while deleting the notification'
    });
  }
});

export default router; 