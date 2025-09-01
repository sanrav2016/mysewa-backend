import express from 'express';
import { prisma } from '../src/server.js';
import { authenticateToken, requireAdmin, requireStudentOrParentOrAdmin } from '../middleware/auth.js';
import { userUpdateSchema, userQuerySchema } from '../validation/schemas.js';

const router = express.Router();

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

// Helper function to calculate hours for multiple users
const calculateUsersHours = async (userIds) => {
  const results = await prisma.userEventSignup.groupBy({
    by: ['userId'],
    where: {
      userId: { in: userIds },
      status: 'CONFIRMED',
      approval: 'APPROVED',
      hoursEarned: { not: null }
    },
    _sum: {
      hoursEarned: true
    }
  });
  
  const hoursMap = new Map();
  results.forEach(result => {
    hoursMap.set(result.userId, result._sum.hoursEarned || 0);
  });
  
  return hoursMap;
};

// Get all users (accessible to all authenticated users)
router.get('/', authenticateToken, requireStudentOrParentOrAdmin, async (req, res) => {
  try {
    // Validate query parameters
    const { error, value } = userQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { page, limit, search, role, chapter, city, sortBy, sortOrder } = value;
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (role) where.role = role;
    if (chapter) where.chapter = chapter;
    if (city) where.city = city;

    // Get users with pagination
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
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
        },
        orderBy: sortBy === 'totalHours' ? { name: sortOrder } : { [sortBy]: sortOrder }, // Handle totalHours sorting separately
        skip,
        take: limit
      }),
      prisma.user.count({ where })
    ]);

    // Calculate hours for all users
    const userIds = users.map(user => user.id);
    const hoursMap = await calculateUsersHours(userIds);

    // Add calculated hours to users
    const usersWithHours = users.map(user => ({
      ...user,
      totalHours: hoursMap.get(user.id) || 0
    }));

    // Sort by totalHours if requested
    if (sortBy === 'totalHours') {
      usersWithHours.sort((a, b) => {
        return sortOrder === 'asc' ? a.totalHours - b.totalHours : b.totalHours - a.totalHours;
      });
    }

    res.json({
      users: usersWithHours,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      error: 'Failed to fetch users',
      message: 'An error occurred while fetching users'
    });
  }
});

// Get chapters and cities (public endpoint)
router.get('/chapters-cities', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        chapter: true,
        city: true
      },
      where: {
        OR: [
          { chapter: { not: null } },
          { city: { not: null } }
        ]
      }
    });

    const chapters = Array.from(new Set(users.map(u => u.chapter).filter(Boolean)));
    const cities = Array.from(new Set(users.map(u => u.city).filter(Boolean)));

    res.json({ chapters, cities });
  } catch (error) {
    console.error('Get chapters and cities error:', error);
    res.status(500).json({
      error: 'Failed to fetch chapters and cities',
      message: 'An error occurred while fetching chapters and cities'
    });
  }
});

// Get chapter members (public endpoint)
router.get('/chapter-members', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        chapter: true,
        city: true,
        avatar: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    // Calculate hours for all users
    const userIds = users.map(user => user.id);
    const hoursMap = await calculateUsersHours(userIds);

    // Add calculated hours to users
    const usersWithHours = users.map(user => ({
      ...user,
      totalHours: hoursMap.get(user.id) || 0
    }));

    res.json({ users: usersWithHours });
  } catch (error) {
    console.error('Get chapter members error:', error);
    res.status(500).json({
      error: 'Failed to fetch chapter members',
      message: 'An error occurred while fetching chapter members'
    });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // All authenticated users can view any profile
    // The frontend will handle showing edit buttons only for own profile

    const user = await prisma.user.findUnique({
      where: { id },
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

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The requested user does not exist'
      });
    }

    // Calculate hours for this user
    const totalHours = await calculateUserHours(id);

    res.json({ 
      user: {
        ...user,
        totalHours
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      error: 'Failed to fetch user',
      message: 'An error occurred while fetching the user'
    });
  }
});

// Update user profile
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Users can only update their own profile unless they're admin
    if (req.user.role !== 'ADMIN' && req.user.id !== id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only update your own profile'
      });
    }

    // Validate input
    const { error, value } = userUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The requested user does not exist'
      });
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: value,
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

    // Calculate hours for updated user
    const totalHours = await calculateUserHours(id);

    res.json({
      message: 'User updated successfully',
      user: {
        ...updatedUser,
        totalHours
      }
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: 'An error occurred while updating the user'
    });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (req.user.id === id) {
      return res.status(400).json({
        error: 'Cannot delete own account',
        message: 'You cannot delete your own account'
      });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The requested user does not exist'
      });
    }

    // Delete user (cascade will handle related records)
    await prisma.user.delete({
      where: { id }
    });

    res.json({
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      error: 'Failed to delete user',
      message: 'An error occurred while deleting the user'
    });
  }
});

// Get user's signups
router.get('/:id/signups', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Users can only view their own signups unless they're admin
    if (req.user.role !== 'ADMIN' && req.user.id !== id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only view your own signups'
      });
    }

    const signups = await prisma.userEventSignup.findMany({
      where: { userId: id },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            category: true
          }
        },
        instance: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            location: true
          }
        }
      },
      orderBy: { signupDate: 'desc' }
    });

    res.json({ signups });

  } catch (error) {
    console.error('Get user signups error:', error);
    res.status(500).json({
      error: 'Failed to fetch user signups',
      message: 'An error occurred while fetching user signups'
    });
  }
});

export default router; 