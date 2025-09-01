import express from 'express';
import { prisma, eventScheduler, io } from '../src/server.js';
import { authenticateToken, requireAdmin, requireStudentOrParentOrAdmin } from '../middleware/auth.js';
import { eventCreateSchema, eventUpdateSchema, eventQuerySchema, eventInstanceCreateSchema, eventInstanceUpdateSchema, sessionStatusUpdateSchema } from '../validation/schemas.js';
import { localToUTC, utcToLocal } from '../utils/dateUtils.js';
import { sendSessionCancellationEmail, sendSessionCompletionEmail } from '../services/emailService.js';

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
      user: { select: { id: true, name: true, role: true } },
      event: { select: { title: true } }
    }
  });

  const promotedUsers = [];
  
  for (const waitlistedUser of waitlistedUsers) {
    // Update to WAITLIST_PENDING with notification timestamp
    await tx.userEventSignup.update({
      where: { id: waitlistedUser.id },
      data: { 
        status: 'WAITLIST_PENDING',
        waitlistNotifiedAt: new Date()
      }
    });

    // Create notification
    await tx.notification.create({
      data: {
        userId: waitlistedUser.userId,
        title: 'Waitlist Spot Available!',
        description: `A spot has opened up for "${waitlistedUser.event.title}". You have 12 hours to accept or decline this spot. Go to the session details page to respond.`,
        type: 'SUCCESS'
      }
    });

    promotedUsers.push(waitlistedUser);
  }

  return promotedUsers;
}

// Get all events
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Validate query parameters
    const { error, value } = eventQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { page, limit, search, category, status, chapter, city, sortBy, sortOrder } = value;
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {};
    
    // Hide archived/draft events from non-admins
    if (req.user.role !== 'ADMIN') {
      where.status = 'PUBLISHED';
    } else if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (category && category !== 'undefined' && category !== 'all') where.category = category;
    if (chapter && chapter !== 'undefined') where.chapters = { has: chapter };
    if (city && city !== 'undefined') where.cities = { has: city };

    // Get events with pagination
    let events;
    let total;
    
                if (sortBy === 'startDate') {
              // For startDate sorting, order by the event's last updated date
              [events, total] = await Promise.all([
                prisma.event.findMany({
                  where,
                  include: {
                    creator: {
                      select: {
                        id: true,
                        name: true,
                        email: true
                      }
                    },
                    instances: {
                      orderBy: { startDate: 'asc' }
                    },
                    _count: {
                      select: {
                        signups: true
                      }
                    }
                  },
                  orderBy: { updatedAt: sortOrder },
                  skip,
                  take: limit
                }),
                prisma.event.count({ where })
              ]);
    } else {
      // For other sorting, use normal Prisma ordering
      [events, total] = await Promise.all([
        prisma.event.findMany({
          where,
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                email: true
              }
            },
            instances: {
              orderBy: { startDate: 'asc' },
              select: {
                id: true,
                startDate: true,
                endDate: true,
                location: true,
                hours: true,
                studentCapacity: true,
                parentCapacity: true,
                description: true,
                enabled: true,
                waitlistEnabled: true,
                status: true,
                cancelledAt: true,
                createdAt: true,
                updatedAt: true,
                signups: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        role: true
                      }
                    }
                  }
                }
              }
            },
            _count: {
              select: {
                signups: true
              }
            }
          },
          orderBy: { [sortBy]: sortOrder },
          skip,
          take: limit
        }),
        prisma.event.count({ where })
      ]);
    }

    res.json({
      events,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({
      error: 'Failed to fetch events',
      message: 'An error occurred while fetching events'
    });
  }
});

// Get event by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        instances: {
          include: {
            signups: {
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
            }
          },
          orderBy: { startDate: 'asc' }
        },
        _count: {
          select: {
            signups: true
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({
        error: 'Event not found',
        message: 'The requested event does not exist'
      });
    }

    // Check if user can view this event
    if (event.status === 'DRAFT' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'This event is not published yet'
      });
    }

    if (event.status === 'ARCHIVED' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'This event has been archived'
      });
    }

    res.json({ event });

  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({
      error: 'Failed to fetch event',
      message: 'An error occurred while fetching the event'
    });
  }
});

// Create new event (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Validate input
    const { error, value } = eventCreateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    const { instances, ...eventData } = value;

    // Convert dates to UTC for storage
    const utcEventData = {
      ...eventData,
      scheduledPublishDate: eventData.scheduledPublishDate ? localToUTC(eventData.scheduledPublishDate) : null
    };

    // Convert instance dates to UTC
    const utcInstances = instances ? instances.map(instance => ({
      ...instance,
      startDate: instance.startDate ? localToUTC(instance.startDate) : null,
      endDate: instance.endDate ? localToUTC(instance.endDate) : null
    })) : undefined;

    // Create event
    const event = await prisma.event.create({
      data: {
        ...utcEventData,
        createdBy: req.user.id,
        instances: utcInstances ? {
          create: utcInstances
        } : undefined
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        instances: true
      }
    });

    // Create admin notification for event creation
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Event Created Successfully',
        description: `Event "${event.title}" has been created successfully.`,
        type: 'SUCCESS',
        eventId: event.id
      }
    });

    res.status(201).json({
      message: 'Event created successfully',
      event
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({
      error: 'Failed to create event',
      message: 'An error occurred while creating the event'
    });
  }
});

// Update event (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate input
    const { error, value } = eventUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    // Check if event exists with current instances and signups
    const existingEvent = await prisma.event.findUnique({
      where: { id },
      include: {
        instances: {
          include: {
            signups: {
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
            }
          }
        }
      }
    });

    if (!existingEvent) {
      return res.status(404).json({
        error: 'Event not found',
        message: 'The requested event does not exist'
      });
    }

    // Extract instances from the update data
    const { instances, ...eventData } = value;

    // Convert dates to UTC for storage
    const utcEventData = {
      ...eventData,
      scheduledPublishDate: eventData.scheduledPublishDate ? localToUTC(eventData.scheduledPublishDate) : null
    };

    // Validate capacity changes if instances are being updated
    if (instances) {
      for (let i = 0; i < instances.length; i++) {
        const newInstance = instances[i];
        
        // If this is an update to an existing instance (has an ID)
        if (newInstance.id) {
          const existingInstance = existingEvent.instances.find(inst => inst.id === newInstance.id);
          if (existingInstance) {
            const confirmedStudentSignups = existingInstance.signups.filter(s => s.status === 'CONFIRMED' && s.user.role === 'STUDENT').length;
            const confirmedParentSignups = existingInstance.signups.filter(s => s.status === 'CONFIRMED' && s.user.role === 'PARENT').length;
            
            // Check student capacity
            if (newInstance.studentCapacity !== undefined && newInstance.studentCapacity < confirmedStudentSignups) {
              return res.status(400).json({
                error: 'Capacity Validation Error',
                details: `${confirmedStudentSignups} students are currently confirmed for this session. You must remove ${confirmedStudentSignups - newInstance.studentCapacity} students before reducing capacity to ${newInstance.studentCapacity}.`
              });
            }
            
            // Check parent capacity
            if (newInstance.parentCapacity !== undefined && newInstance.parentCapacity < confirmedParentSignups) {
              return res.status(400).json({
                error: 'Capacity Validation Error',
                details: `${confirmedParentSignups} parents are currently confirmed for this session. You must remove ${confirmedParentSignups - newInstance.parentCapacity} parents before reducing capacity to ${newInstance.parentCapacity}.`
              });
            }
          }
        }
      }
    }

    // Cancel scheduled jobs if event status is changing from SCHEDULED
    if (existingEvent.status === 'SCHEDULED' && eventData.status && eventData.status !== 'SCHEDULED') {
      eventScheduler.cancelScheduledJob(id, 'publish');
    }

    // Use a transaction to handle the update properly
    const updatedEvent = await prisma.$transaction(async (tx) => {
      // First, update the event itself
      const updatedEvent = await tx.event.update({
        where: { id },
        data: utcEventData,
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      // Handle instances if provided
      if (instances) {
        // Get existing instance IDs
        const existingInstanceIds = existingEvent.instances.map(inst => inst.id);
        const newInstanceIds = instances.filter(inst => inst.id).map(inst => inst.id);
        
        // Delete instances that are no longer in the list
        const instancesToDelete = existingInstanceIds.filter(id => !newInstanceIds.includes(id));
        if (instancesToDelete.length > 0) {
          await tx.eventInstance.deleteMany({
            where: {
              id: { in: instancesToDelete }
            }
          });
        }

        // Convert instance dates to UTC
        const utcInstances = instances.map(instance => ({
          ...instance,
          startDate: instance.startDate ? localToUTC(instance.startDate) : null,
          endDate: instance.endDate ? localToUTC(instance.endDate) : null
        }));

        // Update existing instances and create new ones
        for (const instance of utcInstances) {
          if (instance.id) {
            // Update existing instance
            await tx.eventInstance.update({
              where: { id: instance.id },
              data: {
                startDate: instance.startDate,
                endDate: instance.endDate,
                location: instance.location,
                hours: instance.hours,
                studentCapacity: instance.studentCapacity,
                parentCapacity: instance.parentCapacity,
                description: instance.description,
                enabled: instance.enabled !== undefined ? instance.enabled : true
              }
            });
          } else {
            // Create new instance
            await tx.eventInstance.create({
              data: {
                eventId: id,
                startDate: instance.startDate,
                endDate: instance.endDate,
                location: instance.location,
                hours: instance.hours,
                studentCapacity: instance.studentCapacity,
                parentCapacity: instance.parentCapacity,
                description: instance.description,
                enabled: instance.enabled !== undefined ? instance.enabled : true
              }
            });
          }
        }
      }

      // Return the updated event with instances
      return await tx.event.findUnique({
        where: { id },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          instances: {
            include: {
              signups: {
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
              }
            }
          }
        }
      });
    });

    // Schedule new publish job if status is being set to SCHEDULED
    if (utcEventData.status === 'SCHEDULED' && utcEventData.scheduledPublishDate) {
      eventScheduler.scheduleEventPublish(updatedEvent);
    }

    // Create admin notification for event update or publish
    const isPublish = existingEvent.status !== 'PUBLISHED' && utcEventData.status === 'PUBLISHED';
    const isScheduledPublish = existingEvent.status !== 'SCHEDULED' && utcEventData.status === 'SCHEDULED';
    
    if (isPublish) {
      // Event is being published for the first time
      await prisma.notification.create({
        data: {
          userId: req.user.id,
          title: 'Event Published Successfully',
          description: `"${updatedEvent.title}" has been published successfully! Category: ${updatedEvent.category}, Chapters: ${updatedEvent.chapters.join(', ')}, Cities: ${updatedEvent.cities.join(', ')}`,
          type: 'SUCCESS',
          eventId: updatedEvent.id
        }
      });
    } else if (isScheduledPublish) {
      // Event is being scheduled for publication
      await prisma.notification.create({
        data: {
          userId: req.user.id,
          title: 'Event Scheduled Successfully',
          description: `"${updatedEvent.title}" has been scheduled for publication. Category: ${updatedEvent.category}, Chapters: ${updatedEvent.chapters.join(', ')}, Cities: ${updatedEvent.cities.join(', ')}`,
          type: 'SUCCESS',
          eventId: updatedEvent.id
        }
      });
    } else {
      // Regular update
      await prisma.notification.create({
        data: {
          userId: req.user.id,
          title: 'Event Updated Successfully',
          description: `"${updatedEvent.title}" has been updated successfully.`,
          type: 'SUCCESS',
          eventId: updatedEvent.id
        }
      });
    }

    res.json({
      message: 'Event updated successfully',
      event: updatedEvent
    });

  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({
      error: 'Failed to update event',
      message: 'An error occurred while updating the event'
    });
  }
});

// Delete event (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists
    const existingEvent = await prisma.event.findUnique({
      where: { id }
    });

    if (!existingEvent) {
      return res.status(404).json({
        error: 'Event not found',
        message: 'The requested event does not exist'
      });
    }

    // Cancel any scheduled jobs for this event
    if (existingEvent.status === 'SCHEDULED') {
      eventScheduler.cancelScheduledJob(id, 'publish');
    }

    // Delete event (cascade will handle related records)
    await prisma.event.delete({
      where: { id }
    });

    res.json({
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      error: 'Failed to delete event',
      message: 'An error occurred while deleting the event'
    });
  }
});

// Create event instance (admin only)
router.post('/:id/instances', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id: eventId } = req.params;

    // Validate input
    const { error, value } = eventInstanceCreateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    // Check if event exists
    const existingEvent = await prisma.event.findUnique({
      where: { id: eventId }
    });

    if (!existingEvent) {
      return res.status(404).json({
        error: 'Event not found',
        message: 'The requested event does not exist'
      });
    }

    // Convert dates to UTC for storage
    const utcInstanceData = {
      ...value,
      startDate: value.startDate ? localToUTC(value.startDate) : null,
      endDate: value.endDate ? localToUTC(value.endDate) : null,
      scheduledPublishDate: value.scheduledPublishDate ? localToUTC(value.scheduledPublishDate) : null,
      eventId
    };

    // Create event instance
    const instance = await prisma.eventInstance.create({
      data: utcInstanceData,
      include: {
        event: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Event instance created successfully',
      instance
    });

  } catch (error) {
    console.error('Create event instance error:', error);
    res.status(500).json({
      error: 'Failed to create event instance',
      message: 'An error occurred while creating the event instance'
    });
  }
});

// Get event instance by ID
router.get('/instances/:instanceId', authenticateToken, async (req, res) => {
  try {
    const { instanceId } = req.params;

    const instance = await prisma.eventInstance.findUnique({
      where: { id: instanceId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            tags: true,
            createdBy: true
          }
        },
        signups: {
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
        }
      }
    });

    if (!instance) {
      return res.status(404).json({
        error: 'Event instance not found',
        message: 'The requested event instance does not exist'
      });
    }

    res.json({
      instance
    });

  } catch (error) {
    console.error('Get event instance error:', error);
    res.status(500).json({
      error: 'Failed to fetch event instance',
      message: 'An error occurred while fetching the event instance'
    });
  }
});

// Update event instance (admin only)
router.put('/instances/:instanceId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { instanceId } = req.params;

    // Validate input
    const { error, value } = eventInstanceUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    // Check if instance exists
    const existingInstance = await prisma.eventInstance.findUnique({
      where: { id: instanceId }
    });

    if (!existingInstance) {
      return res.status(404).json({
        error: 'Event instance not found',
        message: 'The requested event instance does not exist'
      });
    }

    // Validate capacity reduction - prevent reducing below confirmed + waitlist_pending signups
    if (value.studentCapacity && value.studentCapacity < existingInstance.studentCapacity) {
      const reservedStudents = await prisma.userEventSignup.count({
        where: {
          instanceId,
          status: { in: ['CONFIRMED', 'WAITLIST_PENDING'] },
          user: { role: 'STUDENT' }
        }
      });

      if (value.studentCapacity < reservedStudents) {
        return res.status(400).json({
          error: 'Capacity too low',
          message: `Cannot reduce student capacity to ${value.studentCapacity}. There are ${reservedStudents} students with confirmed or pending waitlist spots. Please remove some signups first.`
        });
      }
    }

    if (value.parentCapacity && value.parentCapacity < existingInstance.parentCapacity) {
      const reservedParents = await prisma.userEventSignup.count({
        where: {
          instanceId,
          status: { in: ['CONFIRMED', 'WAITLIST_PENDING'] },
          user: { role: 'PARENT' }
        }
      });

      if (value.parentCapacity < reservedParents) {
        return res.status(400).json({
          error: 'Capacity too low',
          message: `Cannot reduce parent capacity to ${value.parentCapacity}. There are ${reservedParents} parents with confirmed or pending waitlist spots. Please remove some signups first.`
        });
      }
    }

    // Check if trying to disable waitlist when there are waitlisted/pending users
    if (value.waitlistEnabled === false) {
      const waitlistCount = await prisma.userEventSignup.count({
        where: {
          instanceId,
          status: { in: ['WAITLIST', 'WAITLIST_PENDING'] }
        }
      });

      if (waitlistCount > 0) {
        return res.status(400).json({
          error: 'Cannot disable waitlist',
          message: `Cannot disable waitlist while there are ${waitlistCount} users on the waitlist or with pending waitlist spots. Please handle these users first.`
        });
      }
    }

    // Convert dates to UTC for storage
    const utcInstanceData = {
      ...value,
      startDate: value.startDate ? localToUTC(value.startDate) : null,
      endDate: value.endDate ? localToUTC(value.endDate) : null,
      scheduledPublishDate: value.scheduledPublishDate ? localToUTC(value.scheduledPublishDate) : null
    };

    // Use atomic transaction for the update
    const updatedInstance = await prisma.$transaction(async (tx) => {
      // Update event instance
      const updatedInstance = await tx.eventInstance.update({
        where: { id: instanceId },
        data: utcInstanceData,
        include: {
          event: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      // If capacity was increased, promote users from waitlist using 12-hour system
      if (value.studentCapacity || value.parentCapacity) {
        const allPromotedUsers = [];

        // Check for waitlisted students if student capacity increased
        if (value.studentCapacity && value.studentCapacity > existingInstance.studentCapacity) {
          const spotsAvailable = value.studentCapacity - existingInstance.studentCapacity;
          const studentPromotedUsers = await promoteWaitlistedUsers(tx, instanceId, 'STUDENT', spotsAvailable);
          
          if (studentPromotedUsers.length > 0) {
            console.log(`Promoted ${studentPromotedUsers.length} student(s) to WAITLIST_PENDING for session ${instanceId}`);
            allPromotedUsers.push(...studentPromotedUsers);
          }
        }

        // Check for waitlisted parents if parent capacity increased
        if (value.parentCapacity && value.parentCapacity > existingInstance.parentCapacity) {
          const spotsAvailable = value.parentCapacity - existingInstance.parentCapacity;
          const parentPromotedUsers = await promoteWaitlistedUsers(tx, instanceId, 'PARENT', spotsAvailable);
          
          if (parentPromotedUsers.length > 0) {
            console.log(`Promoted ${parentPromotedUsers.length} parent(s) to WAITLIST_PENDING for session ${instanceId}`);
            allPromotedUsers.push(...parentPromotedUsers);
          }
        }

        // Emit WebSocket events for promoted users within the transaction
        if (allPromotedUsers && allPromotedUsers.length > 0) {
          for (const promotedUser of allPromotedUsers) {
            io.to(`session-${instanceId}`).emit('signup-updated', {
              type: 'waitlist-promoted',
              signup: promotedUser.updatedSignup,
              sessionId: instanceId
            });
          }
        }
      }

      // If session is being closed (enabled: false), move WAITLIST_PENDING users back to WAITLIST
      if (value.enabled === false && existingInstance.enabled === true) {
        const waitlistPendingSignups = await tx.userEventSignup.findMany({
          where: {
            instanceId,
            status: 'WAITLIST_PENDING'
          }
        });

        for (const signup of waitlistPendingSignups) {
          await tx.userEventSignup.update({
            where: { id: signup.id },
            data: { 
              status: 'WAITLIST',
              waitlistNotifiedAt: null // Clear the notification timestamp
            }
          });
        }

        if (waitlistPendingSignups.length > 0) {
          console.log(`Moved ${waitlistPendingSignups.length} WAITLIST_PENDING user(s) back to WAITLIST for closed session ${instanceId}`);
        }
      }

      return updatedInstance;
    });

    // Emit WebSocket event for the instance update
    io.to(`session-${instanceId}`).emit('signup-updated', {
      type: 'instance-updated',
      instance: updatedInstance,
      sessionId: instanceId
    });

    // Create admin notification for session update
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Session Updated Successfully',
        description: `Session "${updatedInstance.event.title}" has been updated successfully.`,
        type: 'SUCCESS',
        sessionId: updatedInstance.id,
        eventId: updatedInstance.eventId
      }
    });

    res.json({
      message: 'Event instance updated successfully',
      instance: updatedInstance
    });

  } catch (error) {
    console.error('Update event instance error:', error);
    res.status(500).json({
      error: 'Failed to update event instance',
      message: 'An error occurred while updating the event instance'
    });
  }
});

// Update session status (admin only)
router.patch('/instances/:instanceId/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { instanceId } = req.params;

    // Validate input
    const { error, value } = sessionStatusUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        details: error.details[0].message
      });
    }

    // Check if instance exists
    const existingInstance = await prisma.eventInstance.findUnique({
      where: { id: instanceId },
      include: {
        event: {
          select: {
            id: true,
            title: true
          }
        },
        signups: {
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
        }
      }
    });

    if (!existingInstance) {
      return res.status(404).json({
        error: 'Event instance not found',
        message: 'The requested event instance does not exist'
      });
    }

    // Update session status
    const updateData = {
      status: value.status
    };

    // If cancelling, add cancellation details
    if (value.status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      updateData.cancelledBy = req.user.id;
    }

    const updatedInstance = await prisma.$transaction(async (tx) => {
      // Update the session status
      const updatedInstance = await tx.eventInstance.update({
        where: { id: instanceId },
        data: updateData,
        include: {
          event: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      // If cancelling or closing, handle waitlist pending users and notify confirmed signups
      if (value.status === 'CANCELLED' || value.status === 'COMPLETED') {
        // Move all WAITLIST_PENDING users back to WAITLIST to prevent 12-hour expiry
        const waitlistPendingSignups = existingInstance.signups.filter(signup => signup.status === 'WAITLIST_PENDING');
        
        for (const signup of waitlistPendingSignups) {
          await tx.userEventSignup.update({
            where: { id: signup.id },
            data: { 
              status: 'WAITLIST',
              waitlistNotifiedAt: null // Clear the notification timestamp
            }
          });
        }

        // Notify all confirmed signups (except the admin who cancelled the session)
        const confirmedSignups = existingInstance.signups.filter(signup => 
          signup.status === 'CONFIRMED' && signup.userId !== req.user.id
        );
        
        for (const signup of confirmedSignups) {
          // Create notification for each confirmed user
          await tx.notification.create({
            data: {
              userId: signup.userId,
              title: value.status === 'CANCELLED' ? 'Session Cancelled' : 'Session Completed',
              description: value.status === 'CANCELLED' 
                ? `The session "${existingInstance.event.title}" has been cancelled by an administrator.${value.reason ? ` Reason: ${value.reason}` : ''}`
                : `The session "${existingInstance.event.title}" has been marked as completed.`,
              type: 'WARNING',
              sessionId: instanceId
            }
          });

          // Send email notification
          if (value.status === 'CANCELLED') {
            sendSessionCancellationEmail(signup.user, existingInstance, value.reason);
          } else if (value.status === 'COMPLETED') {
            sendSessionCompletionEmail(signup.user, existingInstance);
          }

          // Emit WebSocket event for the notification
          io.to(`user-${signup.userId}`).emit('notification-created', {
            type: 'notification-created',
            notification: {
              title: value.status === 'CANCELLED' ? 'Session Cancelled' : 'Session Completed',
              description: value.status === 'CANCELLED' 
                ? `The session "${existingInstance.event.title}" has been cancelled by an administrator.${value.reason ? ` Reason: ${value.reason}` : ''}`
                : `The session "${existingInstance.event.title}" has been marked as completed.`,
              type: 'WARNING'
            }
          });
        }

        // Emit WebSocket event for session status change
        if (value.status === 'CANCELLED') {
          io.to(`session-${instanceId}`).emit('session-cancelled', {
            type: 'session-cancelled',
            sessionId: instanceId,
            reason: value.reason
          });
        } else {
          io.to(`session-${instanceId}`).emit('session-completed', {
            type: 'session-completed',
            sessionId: instanceId
          });
        }
      }

      return updatedInstance;
    });

    res.json({
      message: `Session ${value.status.toLowerCase()} successfully`,
      instance: updatedInstance
    });

  } catch (error) {
    console.error('Update session status error:', error);
    res.status(500).json({
      error: 'Failed to update session status',
      message: 'An error occurred while updating the session status'
    });
  }
});

// Delete event instance (admin only)
router.delete('/instances/:instanceId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { instanceId } = req.params;

    // Check if instance exists
    const existingInstance = await prisma.eventInstance.findUnique({
      where: { id: instanceId }
    });

    if (!existingInstance) {
      return res.status(404).json({
        error: 'Event instance not found',
        message: 'The requested event instance does not exist'
      });
    }

    // Delete event instance (cascade will handle related records)
    await prisma.eventInstance.delete({
      where: { id: instanceId }
    });

    res.json({
      message: 'Event instance deleted successfully'
    });

  } catch (error) {
    console.error('Delete event instance error:', error);
    res.status(500).json({
      error: 'Failed to delete event instance',
      message: 'An error occurred while deleting the event instance'
    });
  }
});

export default router; 