import express from 'express';
import { prisma, eventScheduler, io } from '../src/server.js';
import { authenticateToken, requireAdmin, requireStudentOrParentOrAdmin, requireParentConfirmedForSession } from '../middleware/auth.js';
import { signupCreateSchema, signupUpdateSchema } from '../validation/schemas.js';
import { sendWaitlistOfferEmail, sendSignupConfirmationEmail } from '../services/emailService.js';

const router = express.Router();

// Helper function to promote waitlisted users with 12-hour notification system
async function promoteWaitlistedUsers(tx, instanceId, role, slotsAvailable) {
  const waitlistedUsers = await tx.userEventSignup.findMany({
    where: {
      instanceId,
      status: 'WAITLIST',
      user: { role }
    },
    orderBy: { signupDate: 'asc' },
    take: slotsAvailable,
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      event: { select: { id: true, title: true, category: true } },
      instance: { select: { id: true, startDate: true, endDate: true, location: true } }
    }
  });

  const promotedUsers = [];
  
  for (const waitlistedUser of waitlistedUsers) {
    // Update to WAITLIST_PENDING with notification timestamp
    const updatedSignup = await tx.userEventSignup.update({
      where: { id: waitlistedUser.id },
      data: { 
        status: 'WAITLIST_PENDING',
        waitlistNotifiedAt: new Date()
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        event: { select: { id: true, title: true, category: true } },
        instance: { select: { id: true, startDate: true, endDate: true, location: true } }
      }
    });

    // Create notification
    const notification = await tx.notification.create({
      data: {
        userId: waitlistedUser.userId,
        title: 'Waitlist Spot Available!',
        description: `A spot has opened up for "${waitlistedUser.event.title}". You have 12 hours to accept or decline this spot. Go to the session details page to respond.`,
        type: 'SUCCESS',
        sessionId: waitlistedUser.instanceId
      }
    });

    // Emit WebSocket event for the notification
    io.to(`user-${waitlistedUser.userId}`).emit('notification-created', {
      type: 'notification-created',
      notification
    });

    // Store email data for async sending (outside transaction)
    let emailData = null;
    try {
      const eventInstanceWithDetails = await tx.eventInstance.findUnique({
        where: { id: waitlistedUser.instanceId },
        include: {
          event: {
            select: {
              title: true,
              description: true
            }
          }
        }
      });

      if (eventInstanceWithDetails) {
        emailData = {
          user: waitlistedUser.user,
          eventInstance: eventInstanceWithDetails
        };
      }
    } catch (error) {
      console.error(`Failed to prepare waitlist email data for user ${waitlistedUser.userId}:`, error);
    }

    promotedUsers.push({ ...waitlistedUser, updatedSignup, emailData });
  }

  return promotedUsers;
}

// Get all signups (accessible to all authenticated users)
router.get('/', authenticateToken, requireStudentOrParentOrAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, eventId, instanceId, userId, status } = req.query;
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};
    if (eventId) where.eventId = eventId;
    if (instanceId) where.instanceId = instanceId;
    if (userId) where.userId = userId;
    if (status) where.status = status;

    // Get signups with pagination
    const [signups, total] = await Promise.all([
      prisma.userEventSignup.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          },
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
              location: true,
              status: true,
              cancelledAt: true
            }
          }
        },
        orderBy: { signupDate: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.userEventSignup.count({ where })
    ]);

    res.json({
      signups,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get signups error:', error);
    res.status(500).json({
      error: 'Failed to fetch signups',
      message: 'An error occurred while fetching signups'
    });
  }
});

// Get signup by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const signup = await prisma.userEventSignup.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
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
            location: true,
            status: true,
            cancelledAt: true
          }
        }
      }
    });

    if (!signup) {
      return res.status(404).json({
        error: 'Signup not found',
        message: 'The requested signup does not exist'
      });
    }

    // Users can only view their own signups unless they're admin
    if (req.user.role !== 'ADMIN' && signup.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only view your own signups'
      });
    }

    res.json({ signup });

  } catch (error) {
    console.error('Get signup error:', error);
    res.status(500).json({
      error: 'Failed to fetch signup',
      message: 'An error occurred while fetching the signup'
    });
  }
});

// Create signup with atomic transaction
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = signupCreateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { eventId, instanceId } = value;

    // Simple rate limiting - check for recent signup
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const recentSignup = await prisma.userEventSignup.findFirst({
      where: {
        userId: req.user.id,
        instanceId: instanceId,
        signupDate: {
          gt: fiveSecondsAgo
        }
      }
    });
    
    if (recentSignup) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Please wait 5 seconds before trying to sign up again'
      });
    }

    // Use atomic transaction with retry logic for race conditions
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // Check if event and instance exist
          const [event, instance] = await Promise.all([
            tx.event.findUnique({ where: { id: eventId } }),
            tx.eventInstance.findUnique({ where: { id: instanceId } })
          ]);

          if (!event) {
            throw new Error('Event not found');
          }

          if (!instance) {
            throw new Error('Event instance not found');
          }

          // Check if event is published
          if (event.status !== 'PUBLISHED' && req.user.role !== 'ADMIN') {
            throw new Error('Event not available for signups');
          }

          // Check if session is enabled
          if (!instance.enabled) {
            throw new Error('Session is not open for signups');
          }

          // Check if session is cancelled
          if (instance.status === 'CANCELLED') {
            throw new Error('Session has been cancelled');
          }

          // Check if user has any existing signup for this instance
          const existingSignup = await tx.userEventSignup.findFirst({
            where: {
              userId: req.user.id,
              instanceId
            }
          });

          if (existingSignup && existingSignup.status !== 'CANCELLED') {
            throw new Error('Already signed up for this event instance');
          }

          // Get current confirmed + waitlist_pending signups for this user's role (reserved spots)
          const reservedSignups = await tx.userEventSignup.findMany({
            where: {
              instanceId,
              status: { in: ['CONFIRMED', 'WAITLIST_PENDING'] },
              user: { role: req.user.role }
            },
            orderBy: { signupDate: 'asc' }
          });

          const reservedCount = reservedSignups.length;

          // Determine capacity and status
          const maxCapacity = req.user.role === 'STUDENT' ? instance.studentCapacity : instance.parentCapacity;
          let status = reservedCount >= maxCapacity ? 'WAITLIST' : 'CONFIRMED';

          // If session is full and waitlist is disabled, reject signup
          if (status === 'WAITLIST' && !instance.waitlistEnabled) {
            throw new Error('Session is full and waitlist is disabled');
          }

          console.log(`Signup - User: ${req.user.id}, Role: ${req.user.role}, Reserved: ${reservedCount}, Max: ${maxCapacity}, Status: ${status}`);

          // Create or update signup
          let signup;
          if (existingSignup && existingSignup.status === 'CANCELLED') {
            signup = await tx.userEventSignup.update({
              where: { id: existingSignup.id },
              data: { status },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true
                  }
                },
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
              }
            });
          } else {
            signup = await tx.userEventSignup.create({
              data: {
                userId: req.user.id,
                eventId,
                instanceId,
                status
              },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true
                  }
                },
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
              }
            });
          }

          // Double-check: if we created a CONFIRMED signup, verify we didn't exceed capacity
          if (status === 'CONFIRMED') {
            const finalCount = await tx.userEventSignup.count({
              where: {
                instanceId,
                status: 'CONFIRMED',
                user: { role: req.user.role }
              }
            });
            
            if (finalCount > maxCapacity) {
              // We exceeded capacity, need to fix this
              console.log(`ERROR: Capacity exceeded after signup - User: ${req.user.id}, FinalCount: ${finalCount}, Max: ${maxCapacity}`);
              
              // Check if waitlist is enabled before changing to waitlist
              if (instance.waitlistEnabled) {
                // Change this signup to waitlist
                signup = await tx.userEventSignup.update({
                  where: { id: signup.id },
                  data: { status: 'WAITLIST' },
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true
                      }
                    },
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
                  }
                });
                
                status = 'WAITLIST';
                console.log(`Fixed: Changed signup to WAITLIST for user ${req.user.id}`);
              } else {
                // Waitlist is disabled, delete the signup and throw error
                await tx.userEventSignup.delete({
                  where: { id: signup.id }
                });
                throw new Error('Session is full and waitlist is disabled');
              }
            }
          }

          // Store email data for async sending (outside transaction)
          let emailData = null;
          try {
            const eventInstanceWithDetails = await tx.eventInstance.findUnique({
              where: { id: instanceId },
              include: {
                event: {
                  select: {
                    title: true,
                    description: true
                  }
                }
              }
            });

            if (eventInstanceWithDetails) {
              emailData = {
                user: signup.user,
                eventInstance: eventInstanceWithDetails,
                status: status
              };
            }
          } catch (error) {
            console.error(`Failed to prepare email data for ${signup.user.email}:`, error);
          }

          // Emit WebSocket event
          io.to(`session-${instanceId}`).emit('signup-updated', {
            type: 'signup-created',
            signup: signup,
            sessionId: instanceId
          });

          return { signup, status, emailData };
        });

        // If we get here, the transaction succeeded
        
        // Send email asynchronously (don't wait for it)
        if (result.emailData) {
          sendSignupConfirmationEmail(result.emailData.user, result.emailData.eventInstance, result.emailData.status)
            .catch(error => {
              console.error(`Failed to send confirmation email to ${result.emailData.user.email}:`, error);
            });
        }
        
        res.status(201).json({
          message: result.status === 'WAITLIST' 
            ? 'Session is full. You have been added to the waitlist. You will be automatically registered if a spot opens up.'
            : 'Successfully signed up for event!',
          signup: result.signup,
          status: result.status
        });
        return; // Exit the retry loop

      } catch (error) {
        console.error(`Signup attempt ${retries + 1} failed:`, error);
        retries++;
        
        if (retries >= maxRetries) {
          throw error; // Re-throw the error if we've exhausted retries
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * retries));
      }
    }

  } catch (error) {
    console.error('Create signup error:', error);
    
    // Handle specific transaction errors
    if (error.message === 'Event not found') {
      return res.status(404).json({
        error: 'Event not found',
        message: 'The requested event does not exist'
      });
    }
    
    if (error.message === 'Event instance not found') {
      return res.status(404).json({
        error: 'Event instance not found',
        message: 'The requested event instance does not exist'
      });
    }
    
    if (error.message === 'Event not available for signups') {
      return res.status(403).json({
        error: 'Event not available',
        message: 'This event is not available for signups'
      });
    }
    
    if (error.message === 'Already signed up for this event instance') {
      return res.status(409).json({
        error: 'Already signed up',
        message: 'You are already signed up for this event instance'
      });
    }
    
    if (error.message === 'Session is full and waitlist is disabled') {
      return res.status(409).json({
        error: 'Session is full and waitlist is disabled',
        message: 'This session is full and waitlist is disabled. Please try another session.'
      });
    }

    res.status(500).json({
      error: 'Failed to create signup',
      message: 'An error occurred while creating the signup'
    });
  }
});

// Update signup (admin only for approval/hours, user can cancel)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate input
    const { error, value } = signupUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    // Get existing signup
    const existingSignup = await prisma.userEventSignup.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        event: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    if (!existingSignup) {
      return res.status(404).json({
        error: 'Signup not found',
        message: 'The requested signup does not exist'
      });
    }

    // Check permissions
    const isOwner = existingSignup.userId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only update your own signups'
      });
    }

    // Non-admins can only cancel their signups
    if (!isAdmin && (value.status !== 'CANCELLED' || Object.keys(value).length > 1)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only cancel your signups'
      });
    }

    // Update signup with cancelledAt timestamp if cancelling
    const updateData = { ...value };
    if (value.status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
    }

    const updatedSignup = await prisma.userEventSignup.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
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
            location: true,
            status: true,
            cancelledAt: true
          }
        }
      }
    });

    // Emit WebSocket event
    io.to(`session-${existingSignup.instanceId}`).emit('signup-updated', {
      type: 'signup-updated',
      signup: updatedSignup,
      sessionId: existingSignup.instanceId
    });

    // If signup was cancelled, promote first person from waitlist using 12-hour system
    if (value.status === 'CANCELLED') {
      const promotedUsers = await prisma.$transaction(async (tx) => {
        const cancelledUser = await tx.user.findUnique({
          where: { id: existingSignup.userId },
          select: { role: true }
        });

        if (cancelledUser) {
          const promotedUsers = await promoteWaitlistedUsers(
            tx, 
            existingSignup.instanceId, 
            cancelledUser.role, 
            1
          );

          if (promotedUsers.length > 0) {
            console.log(`Promoted waitlisted user ${promotedUsers[0].user.name} to WAITLIST_PENDING for session ${existingSignup.instanceId}`);
          }

          return promotedUsers;
        }

        return [];
      });

      // Emit WebSocket events for promoted users after transaction
      if (promotedUsers && promotedUsers.length > 0) {
        for (const promotedUser of promotedUsers) {
          io.to(`session-${existingSignup.instanceId}`).emit('signup-updated', {
            type: 'waitlist-promoted',
            signup: promotedUser.updatedSignup,
            sessionId: existingSignup.instanceId
          });
          
          // Send email asynchronously (don't wait for it)
          if (promotedUser.emailData) {
            sendWaitlistOfferEmail(promotedUser.emailData.user, promotedUser.emailData.eventInstance)
              .catch(error => {
                console.error(`Failed to send waitlist offer email to user ${promotedUser.userId}:`, error);
              });
          }
        }
      }
    }

    // Note: totalHours are now calculated dynamically from signups

    res.json({
      message: 'Signup updated successfully',
      signup: updatedSignup
    });

  } catch (error) {
    console.error('Update signup error:', error);
    res.status(500).json({
      error: 'Failed to update signup',
      message: 'An error occurred while updating the signup'
    });
  }
});

// Delete signup (cancel)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get existing signup
    const existingSignup = await prisma.userEventSignup.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (!existingSignup) {
      return res.status(404).json({
        error: 'Signup not found',
        message: 'The requested signup does not exist'
      });
    }

    // Check permissions
    const isOwner = existingSignup.userId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only cancel your own signups'
      });
    }

    // Delete signup and handle waitlist promotion
    const promotedUsers = await prisma.$transaction(async (tx) => {
      // Delete the signup
      await tx.userEventSignup.delete({
        where: { id }
      });

      // If this was an admin removal, notify the user
      if (!isOwner && isAdmin) {
        const removalNotification = await tx.notification.create({
          data: {
            userId: existingSignup.userId,
            title: 'Removed from Event',
            description: `You have been removed from the event by an administrator.`,
            type: 'WARNING',
            sessionId: existingSignup.instanceId
          }
        });

        // Emit WebSocket event for the notification
        io.to(`user-${existingSignup.userId}`).emit('notification-created', {
          type: 'notification-created',
          notification: removalNotification
        });
      }

      // If the deleted signup was CONFIRMED, promote someone from waitlist
      if (existingSignup.status === 'CONFIRMED') {
        const promotedUsers = await promoteWaitlistedUsers(
          tx, 
          existingSignup.instanceId, 
          existingSignup.user.role, 
          1
        );

        if (promotedUsers.length > 0) {
          console.log(`Promoted waitlisted user ${promotedUsers[0].user.name} to WAITLIST_PENDING for session ${existingSignup.instanceId}`);
        }

        return promotedUsers;
      }

      return [];
    });

    // Emit WebSocket events for promoted users after transaction
    if (promotedUsers && promotedUsers.length > 0) {
      for (const promotedUser of promotedUsers) {
        io.to(`session-${existingSignup.instanceId}`).emit('signup-updated', {
          type: 'waitlist-promoted',
          signup: promotedUser.updatedSignup,
          sessionId: existingSignup.instanceId
        });
        
        // Send email asynchronously (don't wait for it)
        if (promotedUser.emailData) {
          sendWaitlistOfferEmail(promotedUser.emailData.user, promotedUser.emailData.eventInstance)
            .catch(error => {
              console.error(`Failed to send waitlist offer email to user ${promotedUser.userId}:`, error);
            });
        }
      }
    }

    res.json({
      message: 'Signup cancelled successfully'
    });

  } catch (error) {
    console.error('Delete signup error:', error);
    res.status(500).json({
      error: 'Failed to cancel signup',
      message: 'An error occurred while cancelling the signup'
    });
  }
});

// Bulk update approval (admin only)
router.patch('/bulk-approval', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { signups } = req.body;

    if (!Array.isArray(signups) || signups.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide an array of signup updates'
      });
    }

    // Use atomic transaction for all operations
    await prisma.$transaction(async (tx) => {
      for (const signupUpdate of signups) {
        const { id, approval, hoursEarned } = signupUpdate;

        // Validate signup exists
        const existingSignup = await tx.userEventSignup.findUnique({
          where: { id },
          include: { 
            user: true,
            event: {
              select: {
                title: true
              }
            }
          }
        });

        if (!existingSignup) {
          continue; // Skip invalid signups
        }

        // Check if approval is being changed and create notification
        const approvalChanged = approval && approval !== existingSignup.approval;
        
        // Prepare update data
        const updateData = {};
        if (approval) updateData.approval = approval;
        if (hoursEarned !== undefined) updateData.hoursEarned = hoursEarned;

        await tx.userEventSignup.update({
          where: { id },
          data: updateData
        });

        // Create notification for approval changes
        if (approvalChanged) {
          let notificationTitle = '';
          let notificationDescription = '';
          let notificationType = 'INFO';

          if (approval === 'APPROVED') {
            notificationTitle = 'Hours Approved!';
            notificationDescription = hoursEarned && hoursEarned > 0 
              ? `Your hours for "${existingSignup.event.title}" have been approved and you've been awarded ${hoursEarned} volunteer hours!`
              : `Your hours for "${existingSignup.event.title}" have been approved.`;
            notificationType = 'SUCCESS';
          } else if (approval === 'DENIED') {
            notificationTitle = 'Hours Denied';
            notificationDescription = `Your hours for "${existingSignup.event.title}" have been denied.`;
            notificationType = 'WARNING';
          }

          const notification = await tx.notification.create({
            data: {
              userId: existingSignup.userId,
              title: notificationTitle,
              description: notificationDescription,
              type: notificationType,
              sessionId: existingSignup.instanceId
            }
          });

          // Emit WebSocket event for the notification
          io.to(`user-${existingSignup.userId}`).emit('notification-created', {
            type: 'notification-created',
            notification
          });
        }
      }
    });

    res.json({
      message: 'Approval status updated successfully',
      updatedCount: signups.length
    });

  } catch (error) {
    console.error('Bulk approval update error:', error);
    res.status(500).json({
      error: 'Failed to update approval status',
      message: 'An error occurred while updating approval status'
    });
  }
});

// Bulk update with removals (admin only) - atomic transaction
router.patch('/bulk-update-with-removals', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { removals, updates } = req.body;

    if (!Array.isArray(removals) || !Array.isArray(updates)) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide arrays for removals and updates'
      });
    }

    // Use atomic transaction for all operations
    const result = await prisma.$transaction(async (tx) => {
      const sessionIds = new Set();
      const removedSignups = [];
      const updatedSignups = [];

      // Process removals first
      for (const signupId of removals) {
        const existingSignup = await tx.userEventSignup.findUnique({
          where: { id: signupId },
          include: {
            user: { select: { id: true, name: true, role: true } },
            event: { select: { title: true } },
            instance: { select: { id: true } }
          }
        });

        if (existingSignup) {
          sessionIds.add(existingSignup.instance.id);
          
          // Delete the signup
          await tx.userEventSignup.delete({
            where: { id: signupId }
          });

          // Create notification for removal
          const removalNotification = await tx.notification.create({
            data: {
              userId: existingSignup.userId,
              title: 'Removed from Event',
              description: `You have been removed from "${existingSignup.event.title}" by an administrator.`,
              type: 'WARNING',
              sessionId: existingSignup.instance.id
            }
          });

          // Emit WebSocket event for the notification
          io.to(`user-${existingSignup.userId}`).emit('notification-created', {
            type: 'notification-created',
            notification: removalNotification
          });

          removedSignups.push(existingSignup);

          // If the removed signup was CONFIRMED, promote someone from waitlist
          if (existingSignup.status === 'CONFIRMED') {
            const promotedUsers = await promoteWaitlistedUsers(
              tx, 
              existingSignup.instance.id, 
              existingSignup.user.role, 
              1
            );

            if (promotedUsers.length > 0) {
              console.log(`Promoted waitlisted user ${promotedUsers[0].user.name} to WAITLIST_PENDING for session ${existingSignup.instance.id}`);
              updatedSignups.push(...promotedUsers);
            }
          }
        }
      }

      // Process updates
      for (const signupUpdate of updates) {
        const { id, approval, hoursEarned, comment } = signupUpdate;

        const existingSignup = await tx.userEventSignup.findUnique({
          where: { id },
          include: { 
            user: true,
            event: { select: { title: true } },
            instance: { select: { id: true } }
          }
        });

        if (existingSignup) {
          sessionIds.add(existingSignup.instance.id);
          
          // Check if approval is being changed
          const approvalChanged = approval && approval !== existingSignup.approval;
          
          // Prepare update data
          const updateData = {};
          if (approval) updateData.approval = approval;
          if (hoursEarned !== undefined) updateData.hoursEarned = hoursEarned;
          if (comment !== undefined) updateData.comment = comment;

          const updatedSignup = await tx.userEventSignup.update({
            where: { id },
            data: updateData,
            include: {
              user: { select: { id: true, name: true, email: true, role: true } },
              event: { select: { id: true, title: true } },
              instance: { select: { id: true, startDate: true, endDate: true, location: true } }
            }
          });

          updatedSignups.push(updatedSignup);

          // Create notification for approval changes
          if (approvalChanged) {
            let notificationTitle = '';
            let notificationDescription = '';
            let notificationType = 'INFO';

            if (approval === 'APPROVED') {
              notificationTitle = 'Hours Approved!';
              notificationDescription = hoursEarned && hoursEarned > 0 
                ? `Your hours for "${existingSignup.event.title}" have been approved and you've been awarded ${hoursEarned} volunteer hours!`
                : `Your hours for "${existingSignup.event.title}" have been approved.`;
              notificationType = 'SUCCESS';
            } else if (approval === 'DENIED') {
              notificationTitle = 'Hours Denied';
              notificationDescription = `Your hours for "${existingSignup.event.title}" have been denied.`;
              notificationType = 'WARNING';
            }

            const approvalNotification = await tx.notification.create({
              data: {
                userId: existingSignup.userId,
                title: notificationTitle,
                description: notificationDescription,
                type: notificationType,
                sessionId: existingSignup.instanceId
              }
            });

            // Emit WebSocket event for the notification
            io.to(`user-${existingSignup.userId}`).emit('notification-created', {
              type: 'notification-created',
              notification: approvalNotification
            });
          }
        }
      }

      return {
        removedSignups,
        updatedSignups,
        sessionIds: Array.from(sessionIds)
      };
    });

    // Emit WebSocket events for all affected sessions
    for (const sessionId of result.sessionIds) {
      io.to(`session-${sessionId}`).emit('signup-updated', {
        type: 'bulk-update',
        sessionId: sessionId,
        removedCount: result.removedSignups.length,
        updatedCount: result.updatedSignups.length
      });
    }

    // Emit individual events for promoted users
    for (const promotedUser of result.updatedSignups) {
      if (promotedUser.updatedSignup) {
        io.to(`session-${promotedUser.updatedSignup.instanceId}`).emit('signup-updated', {
          type: 'waitlist-promoted',
          signup: promotedUser.updatedSignup,
          sessionId: promotedUser.updatedSignup.instanceId
        });
        
        // Send email asynchronously (don't wait for it)
        if (promotedUser.emailData) {
          sendWaitlistOfferEmail(promotedUser.emailData.user, promotedUser.emailData.eventInstance)
            .catch(error => {
              console.error(`Failed to send waitlist offer email to user ${promotedUser.userId}:`, error);
            });
        }
      }
    }

    res.json({
      message: 'Bulk update completed successfully',
      removedCount: result.removedSignups.length,
      updatedCount: result.updatedSignups.length
    });

  } catch (error) {
    console.error('Bulk update with removals error:', error);
    res.status(500).json({
      error: 'Failed to perform bulk update',
      message: 'An error occurred while performing the bulk update'
    });
  }
});

// Parent-managed bulk update (approval and hours only, no removals)
router.patch('/parent-bulk-update/:sessionId', authenticateToken, requireParentConfirmedForSession, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide an array of signup updates'
      });
    }

    // Use atomic transaction for all operations
    const result = await prisma.$transaction(async (tx) => {
      const updatedSignups = [];

      // Process updates only (no removals allowed for parents)
      for (const signupUpdate of updates) {
        const { id, approval, hoursEarned, comment } = signupUpdate;

        const existingSignup = await tx.userEventSignup.findUnique({
          where: { id },
          include: { 
            user: true,
            event: { select: { title: true } },
            instance: { select: { id: true } }
          }
        });

        if (existingSignup && existingSignup.instance.id === sessionId) {
                  // Check if approval is being changed (only admins can change approval)
        const approvalChanged = req.user.role === 'ADMIN' && approval && approval !== existingSignup.approval;
        
        // Prepare update data (only hours for parents, both approval and hours for admins)
        const updateData = {};
        if (req.user.role === 'ADMIN' && approval) updateData.approval = approval;
        if (hoursEarned !== undefined) updateData.hoursEarned = hoursEarned;
        if (comment !== undefined) updateData.comment = comment;

          const updatedSignup = await tx.userEventSignup.update({
            where: { id },
            data: updateData,
            include: {
              user: { select: { id: true, name: true, email: true, role: true } },
              event: { select: { id: true, title: true } },
              instance: { select: { id: true, startDate: true, endDate: true, location: true } }
            }
          });

          updatedSignups.push(updatedSignup);

          // Create notification for approval changes
          if (approvalChanged) {
            let notificationTitle = '';
            let notificationDescription = '';
            let notificationType = 'INFO';

            if (approval === 'APPROVED') {
              notificationTitle = 'Hours Approved!';
              notificationDescription = hoursEarned && hoursEarned > 0 
                ? `Your hours for "${existingSignup.event.title}" have been approved and you've been awarded ${hoursEarned} volunteer hours!`
                : `Your hours for "${existingSignup.event.title}" have been approved.`;
              notificationType = 'SUCCESS';
            } else if (approval === 'DENIED') {
              notificationTitle = 'Hours Denied';
              notificationDescription = `Your hours for "${existingSignup.event.title}" have been denied.`;
              notificationType = 'WARNING';
            }

            const approvalNotification = await tx.notification.create({
              data: {
                userId: existingSignup.userId,
                title: notificationTitle,
                description: notificationDescription,
                type: notificationType,
                sessionId: existingSignup.instanceId
              }
            });

            // Emit WebSocket event for the notification
            io.to(`user-${existingSignup.userId}`).emit('notification-created', {
              type: 'notification-created',
              notification: approvalNotification
            });
          }
        }
      }

      return {
        updatedSignups
      };
    });

    // Emit WebSocket event for the session
    io.to(`session-${sessionId}`).emit('signup-updated', {
      type: 'parent-bulk-update',
      sessionId: sessionId,
      updatedCount: result.updatedSignups.length
    });

    res.json({
      message: req.user.role === 'ADMIN' 
        ? 'Approval status and hours updated successfully'
        : 'Hours updated successfully',
      updatedCount: result.updatedSignups.length
    });

  } catch (error) {
    console.error('Parent bulk update error:', error);
    res.status(500).json({
      error: req.user.role === 'ADMIN' 
        ? 'Failed to update approval status and hours'
        : 'Failed to update hours',
      message: req.user.role === 'ADMIN'
        ? 'An error occurred while updating approval status and hours'
        : 'An error occurred while updating hours'
    });
  }
});

// Check for scheduling conflicts before signup
router.get('/check-conflicts/:instanceId', authenticateToken, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const userId = req.user.id;

    // Get the target instance details
    const targetInstance = await prisma.eventInstance.findUnique({
      where: { id: instanceId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            category: true
          }
        }
      }
    });

    if (!targetInstance) {
      return res.status(404).json({
        error: 'Instance not found',
        message: 'The requested event instance does not exist'
      });
    }

    if (!targetInstance.startDate || !targetInstance.endDate) {
      return res.json({
        hasConflicts: false,
        conflicts: []
      });
    }

    const targetStart = new Date(targetInstance.startDate);
    const targetEnd = new Date(targetInstance.endDate);

    // Get all user's confirmed signups for other events that overlap with the target time
    const conflictingSignups = await prisma.userEventSignup.findMany({
      where: {
        userId,
        instanceId: { not: instanceId }, // Exclude the target instance
        status: { in: ['CONFIRMED', 'WAITLIST_PENDING'] }, // Only check confirmed and pending waitlist
        instance: {
          startDate: { not: null },
          endDate: { not: null }
        }
      },
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
            location: true,
            status: true,
            cancelledAt: true
          }
        }
      }
    });

    // Check for time overlaps
    const conflicts = conflictingSignups.filter(signup => {
      const signupStart = new Date(signup.instance.startDate);
      const signupEnd = new Date(signup.instance.endDate);

      // Check if the time ranges overlap
      // Two time ranges overlap if: start1 < end2 AND start2 < end1
      return targetStart < signupEnd && signupStart < targetEnd;
    });

    res.json({
      hasConflicts: conflicts.length > 0,
      conflicts: conflicts.map(conflict => ({
        id: conflict.id,
        eventTitle: conflict.event.title,
        eventCategory: conflict.event.category,
        startDate: conflict.instance.startDate,
        endDate: conflict.instance.endDate,
        location: conflict.instance.location,
        status: conflict.status
      })),
      targetEvent: {
        title: targetInstance.event.title,
        category: targetInstance.event.category,
        startDate: targetInstance.startDate,
        endDate: targetInstance.endDate,
        location: targetInstance.location
      }
    });

  } catch (error) {
    console.error('Check conflicts error:', error);
    res.status(500).json({
      error: 'Failed to check conflicts',
      message: 'An error occurred while checking for scheduling conflicts'
    });
  }
});

// Get waitlist position for a user in a specific instance
router.get('/waitlist-position/:instanceId', authenticateToken, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const userId = req.user.id;

    // Get user's signup for this instance
    const userSignup = await prisma.userEventSignup.findFirst({
      where: {
        userId,
        instanceId,
        status: { in: ['WAITLIST', 'WAITLIST_PENDING'] }
      },
      include: {
        user: { select: { role: true } }
      }
    });

    if (!userSignup) {
      return res.status(404).json({
        error: 'Not on waitlist',
        message: 'User is not on the waitlist for this session'
      });
    }

    // Get all waitlisted users for the same role, ordered by signup date
    const waitlistedUsers = await prisma.userEventSignup.findMany({
      where: {
        instanceId,
        status: { in: ['WAITLIST', 'WAITLIST_PENDING'] },
        user: { role: userSignup.user.role }
      },
      orderBy: { signupDate: 'asc' },
      include: {
        user: { select: { role: true } }
      }
    });

    // Find user's position (1-indexed)
    const position = waitlistedUsers.findIndex(signup => signup.userId === userId) + 1;

    res.json({
      position,
      totalWaitlisted: waitlistedUsers.length,
      role: userSignup.user.role,
      status: userSignup.status,
      waitlistNotifiedAt: userSignup.waitlistNotifiedAt
    });

  } catch (error) {
    console.error('Get waitlist position error:', error);
    res.status(500).json({
      error: 'Failed to get waitlist position',
      message: 'An error occurred while getting waitlist position'
    });
  }
});

// Accept waitlist spot (promote from WAITLIST_PENDING to CONFIRMED)
router.post('/accept-waitlist/:instanceId', authenticateToken, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const userId = req.user.id;

    const result = await prisma.$transaction(async (tx) => {
      // Find user's waitlist pending signup
      const pendingSignup = await tx.userEventSignup.findFirst({
        where: {
          userId,
          instanceId,
          status: 'WAITLIST_PENDING'
        },
        include: {
          user: { select: { role: true } },
          instance: true,
          event: { select: { title: true } }
        }
      });

      if (!pendingSignup) {
        throw new Error('No pending waitlist spot found');
      }

      // Check if the 12-hour window has expired
      if (pendingSignup.waitlistNotifiedAt) {
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        if (pendingSignup.waitlistNotifiedAt < twelveHoursAgo) {
          throw new Error('Waitlist acceptance period has expired');
        }
      }

      // Check current capacity
      const confirmedCount = await tx.userEventSignup.count({
        where: {
          instanceId,
          status: 'CONFIRMED',
          user: { role: pendingSignup.user.role }
        }
      });

      const maxCapacity = pendingSignup.user.role === 'STUDENT' 
        ? pendingSignup.instance.studentCapacity 
        : pendingSignup.instance.parentCapacity;

      if (confirmedCount >= maxCapacity) {
        throw new Error('Session is now full - capacity was changed');
      }

      // Update signup to confirmed and set signupDate to when they actually confirmed
      const updatedSignup = await tx.userEventSignup.update({
        where: { id: pendingSignup.id },
        data: { 
          status: 'CONFIRMED',
          waitlistNotifiedAt: null,
          signupDate: new Date() // Update to when they actually confirmed their spot
        },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          event: { select: { id: true, title: true } },
          instance: { select: { id: true, startDate: true, endDate: true, location: true } }
        }
      });

      // Create success notification
      const notification = await tx.notification.create({
        data: {
          userId,
          title: 'Waitlist Spot Accepted',
          description: `You have successfully accepted your spot for "${pendingSignup.event.title}". You are now confirmed for this session.`,
          type: 'SUCCESS',
          sessionId: instanceId
        }
      });

      // Store email data for async sending (outside transaction)
      let emailData = null;
      try {
        const eventInstanceWithDetails = await tx.eventInstance.findUnique({
          where: { id: instanceId },
          include: {
            event: {
              select: {
                title: true,
                description: true
              }
            }
          }
        });

        if (eventInstanceWithDetails) {
          emailData = {
            user: updatedSignup.user,
            eventInstance: eventInstanceWithDetails,
            status: 'CONFIRMED'
          };
        }
      } catch (error) {
        console.error(`Failed to prepare email data for ${updatedSignup.user.email}:`, error);
      }

      // Emit WebSocket event for the notification
      io.to(`user-${userId}`).emit('notification-created', {
        type: 'notification-created',
        notification
      });

      return { updatedSignup, emailData };
    });

    // Send email asynchronously (don't wait for it)
    if (result.emailData) {
      sendSignupConfirmationEmail(result.emailData.user, result.emailData.eventInstance, result.emailData.status)
        .catch(error => {
          console.error(`Failed to send confirmation email to ${result.emailData.user.email}:`, error);
        });
    }
    
    // Emit WebSocket event for live updates
    io.to(`session-${instanceId}`).emit('signup-updated', {
      type: 'waitlist-accepted',
      signup: result.updatedSignup,
      sessionId: instanceId
    });

    res.json({
      message: 'Successfully accepted waitlist spot',
      signup: result.updatedSignup
    });

  } catch (error) {
    console.error('Accept waitlist error:', error);
    
    if (error.message === 'No pending waitlist spot found') {
      return res.status(404).json({
        error: 'No pending spot',
        message: 'No pending waitlist spot found for this session'
      });
    }
    
    if (error.message === 'Waitlist acceptance period has expired') {
      return res.status(410).json({
        error: 'Period expired',
        message: 'The 12-hour acceptance period has expired'
      });
    }
    
    if (error.message === 'Session is now full - capacity was changed') {
      return res.status(409).json({
        error: 'Session full',
        message: 'The session capacity was changed and there is no longer room available'
      });
    }

    res.status(500).json({
      error: 'Failed to accept waitlist spot',
      message: 'An error occurred while accepting the waitlist spot'
    });
  }
});

// Decline waitlist spot (remove from WAITLIST_PENDING)
router.post('/decline-waitlist/:instanceId', authenticateToken, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const userId = req.user.id;

    const result = await prisma.$transaction(async (tx) => {
      // Find user's waitlist pending signup
      const pendingSignup = await tx.userEventSignup.findFirst({
        where: {
          userId,
          instanceId,
          status: 'WAITLIST_PENDING'
        },
        include: {
          user: { select: { role: true } },
          event: { select: { title: true } }
        }
      });

      if (!pendingSignup) {
        throw new Error('No pending waitlist spot found');
      }

      // Delete the pending signup
      await tx.userEventSignup.delete({
        where: { id: pendingSignup.id }
      });

      // Create notification
      const notification = await tx.notification.create({
        data: {
          userId,
          title: 'Waitlist Spot Declined',
          description: `You have declined your waitlist spot for "${pendingSignup.event.title}".`,
          type: 'INFO',
          sessionId: instanceId
        }
      });

      // Emit WebSocket event for the notification
      io.to(`user-${userId}`).emit('notification-created', {
        type: 'notification-created',
        notification
      });

      // Find next person on waitlist for the same role
      const nextWaitlisted = await tx.userEventSignup.findFirst({
        where: {
          instanceId,
          status: 'WAITLIST',
          user: { role: pendingSignup.user.role }
        },
        orderBy: { signupDate: 'asc' },
        include: {
          user: { select: { id: true, name: true, role: true } },
          event: { select: { title: true } }
        }
      });

      if (nextWaitlisted) {
        // Promote next person to WAITLIST_PENDING
        await tx.userEventSignup.update({
          where: { id: nextWaitlisted.id },
          data: { 
            status: 'WAITLIST_PENDING',
            waitlistNotifiedAt: new Date()
          }
        });

        // Notify next person (in-app notification + email)
        const nextNotification = await tx.notification.create({
          data: {
            userId: nextWaitlisted.userId,
            title: 'Waitlist Spot Available!',
            description: `A spot has opened up for "${nextWaitlisted.event.title}". You have 12 hours to accept or decline this spot. Go to the session details page to respond.`,
            type: 'SUCCESS',
            sessionId: instanceId
          }
        });

        // Emit WebSocket event for the notification
        io.to(`user-${nextWaitlisted.userId}`).emit('notification-created', {
          type: 'notification-created',
          notification: nextNotification
        });

        // Store email data for async sending (outside transaction)
        let emailData = null;
        try {
          const eventInstanceWithDetails = await tx.eventInstance.findUnique({
            where: { id: nextWaitlisted.instanceId },
            include: {
              event: {
                select: {
                  title: true,
                  description: true
                }
              }
            }
          });

          if (eventInstanceWithDetails) {
            emailData = {
              user: nextWaitlisted.user,
              eventInstance: eventInstanceWithDetails
            };
          }
        } catch (error) {
          console.error(`Failed to prepare waitlist email data for user ${nextWaitlisted.userId}:`, error);
        }

        return { nextPromoted: nextWaitlisted, emailData };
      }

      return { nextPromoted: null };
    });

    // Send email asynchronously (don't wait for it)
    if (result.emailData) {
      sendWaitlistOfferEmail(result.emailData.user, result.emailData.eventInstance)
        .catch(error => {
          console.error(`Failed to send waitlist offer email to user ${result.emailData.user.id}:`, error);
        });
    }
    
    // Emit WebSocket events for live updates
    io.to(`session-${instanceId}`).emit('signup-updated', {
      type: 'waitlist-declined',
      sessionId: instanceId,
      nextPromoted: result.nextPromoted
    });

    // If someone was promoted, emit another event for them
    if (result.nextPromoted) {
      io.to(`session-${instanceId}`).emit('signup-updated', {
        type: 'waitlist-promoted',
        signup: {
          ...result.nextPromoted,
          status: 'WAITLIST_PENDING',
          waitlistNotifiedAt: new Date()
        },
        sessionId: instanceId
      });
    }

    res.json({
      message: 'Successfully declined waitlist spot',
      nextPromoted: result.nextPromoted
    });

  } catch (error) {
    console.error('Decline waitlist error:', error);
    
    if (error.message === 'No pending waitlist spot found') {
      return res.status(404).json({
        error: 'No pending spot',
        message: 'No pending waitlist spot found for this session'
      });
    }

    res.status(500).json({
      error: 'Failed to decline waitlist spot',
      message: 'An error occurred while declining the waitlist spot'
    });
  }
});

export default router; 