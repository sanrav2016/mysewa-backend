import jwt from 'jsonwebtoken';
import { prisma } from '../src/server.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid authentication token' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
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
      return res.status(401).json({ 
        error: 'User not found',
        message: 'User account no longer exists' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.' 
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Invalid authentication token' 
      });
    }
    
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication error',
      message: 'An error occurred during authentication' 
    });
  }
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please log in to access this resource' 
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}` 
      });
    }

    next();
  };
};

export const requireAdmin = requireRole('ADMIN');
export const requireParentOrAdmin = requireRole(['PARENT', 'ADMIN']);
export const requireStudentOrParentOrAdmin = requireRole(['STUDENT', 'PARENT', 'ADMIN']);

// New middleware to check if parent is confirmed for a session
export const requireParentConfirmedForSession = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please log in to access this resource' 
      });
    }

    // Admins can always access
    if (req.user.role === 'ADMIN') {
      return next();
    }

    // Only parents need this check
    if (req.user.role !== 'PARENT') {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: 'Only parents can access this resource' 
      });
    }

    const sessionId = req.params.sessionId || req.body.sessionId || req.query.sessionId;
    
    if (!sessionId) {
      return res.status(400).json({ 
        error: 'Session ID required',
        message: 'Session ID is required for this operation' 
      });
    }

    // Check if parent is confirmed for this session
    const signup = await prisma.userEventSignup.findFirst({
      where: {
        userId: req.user.id,
        instanceId: sessionId,
        status: 'CONFIRMED'
      }
    });

    if (!signup) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You must be confirmed for this session to manage participants' 
      });
    }

    next();
  } catch (error) {
    console.error('Parent session access check error:', error);
    return res.status(500).json({ 
      error: 'Access check error',
      message: 'An error occurred while checking session access' 
    });
  }
}; 