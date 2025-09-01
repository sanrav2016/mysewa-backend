import cron from 'node-cron';
import { prisma } from './server.js';
import { sendEventReminderEmail, sendWaitlistOfferEmail } from '../services/emailService.js';

class EventScheduler {
    constructor() {
        this.scheduledJobs = new Map();
        this.initializeScheduler();
    }

    initializeScheduler() {
        console.log('Initializing event scheduler...');
        
        // Run every minute to check for scheduled tasks
        cron.schedule('* * * * *', async () => {
            await this.processScheduledPublishes();
            await this.processEventReminders();
            await this.processSessionDisabling();
            await this.processWaitlistTimeouts();
        });

        // Load existing scheduled tasks on startup
        this.loadExistingScheduledTasks();
    }

    async loadExistingScheduledTasks() {
        try {
            // Load scheduled events that need to be published
            const scheduledEvents = await prisma.event.findMany({
                where: {
                    status: 'SCHEDULED',
                    scheduledPublishDate: {
                        not: null
                    }
                }
            });

            // Schedule each event for publishing
            scheduledEvents.forEach(event => {
                this.scheduleEventPublish(event);
            });

            console.log(`Loaded ${scheduledEvents.length} scheduled events`);
        } catch (error) {
            console.error('Error loading scheduled tasks:', error);
        }
    }

    scheduleEventPublish(event) {
        const jobId = `publish_${event.id}`;
        
        // Cancel existing job if it exists
        if (this.scheduledJobs.has(jobId)) {
            this.scheduledJobs.get(jobId).stop();
        }

        // Schedule the publish job
        const publishDate = new Date(event.scheduledPublishDate);
        const now = new Date();
        
        if (publishDate <= now) {
            // Event is already due, publish immediately
            this.publishScheduledEvent(event);
        } else {
            // Schedule for future
            const delay = publishDate.getTime() - now.getTime();
            const job = setTimeout(() => {
                this.publishScheduledEvent(event);
                this.scheduledJobs.delete(jobId);
            }, delay);
            
            this.scheduledJobs.set(jobId, { stop: () => clearTimeout(job) });
        }
    }

    async publishScheduledEvent(event) {
        try {
            await prisma.event.update({
                where: { id: event.id },
                data: { 
                    status: 'PUBLISHED',
                    scheduledPublishDate: null // Clear the scheduled date
                }
            });

            console.log(`Published scheduled event: ${event.title}`);
            
            // Remove from scheduled jobs
            const jobId = `publish_${event.id}`;
            this.scheduledJobs.delete(jobId);
        } catch (error) {
            console.error('Error publishing scheduled event:', error);
        }
    }

    async processScheduledPublishes() {
        try {
            const dueEvents = await prisma.event.findMany({
                where: {
                    status: 'SCHEDULED',
                    scheduledPublishDate: {
                        lte: new Date()
                    }
                }
            });

            for (const event of dueEvents) {
                await this.publishScheduledEvent(event);
            }
        } catch (error) {
            console.error('Error processing scheduled publishes:', error);
        }
    }

    async processEventReminders() {
        try {
            const now = new Date();
            // Ensure all dates are in UTC
            // const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
            const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            // const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            // Get events starting in the next hour - COMMENTED OUT
            // const oneHourEvents = await prisma.eventInstance.findMany({
            //     where: {
            //         startDate: {
            //             gte: now,
            //             lte: oneHourFromNow
            //         },
            //         enabled: true,
            //         status: 'ACTIVE'
            //     },
            //     include: {
            //         event: true,
            //         signups: {
            //             include: {
            //                 user: {
            //                     include: {
            //                         preferences: true
            //                     }
            //                 }
            //             }
            //         }
            //     }
            // });

            // Get events starting in the next 24 hours
            const oneDayEvents = await prisma.eventInstance.findMany({
                where: {
                    startDate: {
                        gte: now,
                        lte: oneDayFromNow,
                        not: null // Ensure startDate is not null
                    },
                    enabled: true,
                    status: 'ACTIVE'
                },
                include: {
                    event: true,
                    signups: {
                        include: {
                            user: {
                                include: {
                                    preferences: true
                                }
                            }
                        }
                    }
                }
            });

            // Get events starting in the next week - COMMENTED OUT
            // const oneWeekEvents = await prisma.eventInstance.findMany({
            //     where: {
            //         startDate: {
            //             gte: now,
            //             lte: oneWeekFromNow,
            //             not: null // Ensure startDate is not null
            //         },
            //         enabled: true,
            //         status: 'ACTIVE'
            //     },
            //     include: {
            //         event: true,
            //         signups: {
            //             include: {
            //                 user: {
            //                     include: {
            //                         preferences: true
            //                     }
            //                 }
            //             }
            //         }
            //     }
            // });

            // Send 1-hour reminders (in-app notifications + emails) - COMMENTED OUT
            // for (const instance of oneHourEvents) {
            //     await this.sendEventReminder(instance, '1 hour');
            // }

            // Send 1-day reminders (in-app notifications + emails)
            for (const instance of oneDayEvents) {
                // const oneHourInstance = oneHourEvents.find(i => i.id === instance.id);
                // if (!oneHourInstance) {
                    await this.sendEventReminder(instance, '24 hours');
                // }
            }

            // Send 1-week reminders (in-app notifications + emails) - COMMENTED OUT
            // for (const instance of oneWeekEvents) {
            //     const oneDayInstance = oneDayEvents.find(i => i.id === instance.id);
            //     const oneHourInstance = oneHourEvents.find(i => i.id === instance.id);
            //     if (!oneDayInstance && !oneHourInstance) {
            //         await this.sendEventReminder(instance, '7 days');
            //     }
            // }
        } catch (error) {
            console.error('Error processing event reminders:', error);
        }
    }

    async sendEventReminder(instance, timeFrame) {
        try {
            // Additional safety check: ensure session is still active, enabled, and has a datetime
            if (!instance.enabled || instance.status !== 'ACTIVE' || !instance.startDate) {
                console.log(`Skipping reminder for session ${instance.id}: not active, enabled, or missing datetime`);
                return;
            }

            // Check if we've already sent this reminder for this specific session
            const existingReminder = await prisma.notification.findFirst({
                where: {
                    userId: { in: instance.signups.map(s => s.userId) },
                    title: `Event Reminder - ${timeFrame}`,
                    sessionId: instance.id
                }
            });

            if (existingReminder) {
                return; // Already sent this reminder
            }

            // Calculate the cutoff time for when users should have signed up to receive this reminder
            const reminderTime = new Date(instance.startDate);
            let cutoffTime;
            
            if (timeFrame === '1 hour') {
                cutoffTime = new Date(reminderTime.getTime() - 60 * 60 * 1000);
            } else if (timeFrame === '24 hours') {
                cutoffTime = new Date(reminderTime.getTime() - 24 * 60 * 60 * 1000);
            } else if (timeFrame === '7 days') {
                cutoffTime = new Date(reminderTime.getTime() - 7 * 24 * 60 * 60 * 1000);
            }

            // Send notifications and emails to users who signed up before the cutoff time
            for (const signup of instance.signups) {
                if (signup.status === 'CONFIRMED' && signup.signupDate < cutoffTime) {
                    console.log(`Sending ${timeFrame} reminder for event: ${instance.event.title} to user: ${signup.user.name}`);
                    // Create in-app notification
                    await prisma.notification.create({
                        data: {
                            userId: signup.userId,
                            title: `Event Reminder - ${timeFrame}`,
                            description: `Your event "${instance.event.title}" starts in ${timeFrame}. Location: ${instance.location}`,
                            type: 'INFO',
                            sessionId: instance.id,
                            date: new Date()
                        }
                    });

                    // Send email if user has email reminders enabled
                    if (signup.user.preferences?.eventReminders) {
                        try {  
                            console.log(`Sending email reminder for event: ${instance.event.title} to user: ${signup.user.name}`);
                            await sendEventReminderEmail(signup.user, instance, timeFrame);
                        } catch (error) {
                            console.error(`Failed to send email reminder to ${signup.user.email}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error sending event reminder:', error);
        }
    }



    async processSessionDisabling() {
        try {
            const now = new Date(); // UTC time
            
            // Find all enabled sessions with start dates that have passed
            const sessionsToDisable = await prisma.eventInstance.findMany({
                where: {
                    enabled: true,
                    status: 'ACTIVE',
                    startDate: {
                        not: null,
                        lte: now
                    }
                },
                include: {
                    event: true
                }
            });

            // Disable each session and mark as completed
            for (const session of sessionsToDisable) {
                await prisma.eventInstance.update({
                    where: { id: session.id },
                    data: { 
                        enabled: false,
                        status: 'COMPLETED'
                    }
                });

                console.log(`Completed session: ${session.event.title} (${session.id}) - start time passed`);
            }

            if (sessionsToDisable.length > 0) {
                console.log(`Completed ${sessionsToDisable.length} sessions that have passed their start time`);
            }
        } catch (error) {
            console.error('Error processing session disabling:', error);
        }
    }

    // Method to cancel scheduled jobs when events are cancelled/unpublished
    cancelScheduledJob(eventId, jobType = 'publish') {
        const jobId = `${jobType}_${eventId}`;
        if (this.scheduledJobs.has(jobId)) {
            this.scheduledJobs.get(jobId).stop();
            this.scheduledJobs.delete(jobId);
            console.log(`Cancelled scheduled job: ${jobId}`);
        }
    }

    // Method to cancel reminder jobs for a specific event instance
    cancelReminderJobs(instanceId) {
        const jobId = `reminder_${instanceId}`;
        if (this.scheduledJobs.has(jobId)) {
            this.scheduledJobs.get(jobId).stop();
            this.scheduledJobs.delete(jobId);
            console.log(`Cancelled reminder job: ${jobId}`);
        }
    }

    async processWaitlistTimeouts() {
        try {
            const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000); // UTC time
            
            // Find all WAITLIST_PENDING signups that have timed out
            const timedOutSignups = await prisma.userEventSignup.findMany({
                where: {
                    status: 'WAITLIST_PENDING',
                    waitlistNotifiedAt: {
                        not: null,
                        lte: twelveHoursAgo
                    }
                },
                include: {
                    user: { 
                        select: { 
                            id: true, 
                            name: true, 
                            role: true 
                        } 
                    },
                    event: { 
                        select: { 
                            title: true 
                        } 
                    },
                    instance: {
                        select: {
                            id: true
                        }
                    }
                }
            });

            for (const timedOutSignup of timedOutSignups) {
                await prisma.$transaction(async (tx) => {
                    // Delete the timed-out signup
                    await tx.userEventSignup.delete({
                        where: { id: timedOutSignup.id }
                    });

                    // Notify user about timeout
                    await tx.notification.create({
                        data: {
                            userId: timedOutSignup.userId,
                            title: 'Waitlist Period Expired',
                            description: `Your 12-hour period to accept the waitlist spot for "${timedOutSignup.event.title}" has expired.`,
                            type: 'WARNING',
                            sessionId: timedOutSignup.instanceId
                        }
                    });

                    // Find next person on waitlist for the same role
                    const nextWaitlisted = await tx.userEventSignup.findFirst({
                        where: {
                            instanceId: timedOutSignup.instanceId,
                            status: 'WAITLIST',
                            user: { role: timedOutSignup.user.role }
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
                        await tx.notification.create({
                            data: {
                                userId: nextWaitlisted.userId,
                                title: 'Waitlist Spot Available!',
                                description: `A spot has opened up for "${nextWaitlisted.event.title}". You have 12 hours to accept or decline this spot. Go to the session details page to respond.`,
                                type: 'SUCCESS',
                                sessionId: nextWaitlisted.instanceId
                            }
                        });

                        // Send email notification for waitlist spot offer
                        try {
                            const userWithDetails = await tx.user.findUnique({
                                where: { id: nextWaitlisted.userId },
                                select: {
                                    id: true,
                                    name: true,
                                    email: true
                                }
                            });

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

                            if (userWithDetails && eventInstanceWithDetails) {
                                await sendWaitlistOfferEmail(userWithDetails, eventInstanceWithDetails);
                            }
                        } catch (error) {
                            console.error(`Failed to send waitlist offer email to user ${nextWaitlisted.userId}:`, error);
                        }

                        console.log(`Promoted next waitlisted user ${nextWaitlisted.user.name} for session ${timedOutSignup.instanceId}`);
                    }
                });

                console.log(`Processed timeout for user ${timedOutSignup.user.name} on session ${timedOutSignup.instanceId}`);
            }

            if (timedOutSignups.length > 0) {
                console.log(`Processed ${timedOutSignups.length} waitlist timeouts`);
            }
        } catch (error) {
            console.error('Error processing waitlist timeouts:', error);
        }
    }
}

export default EventScheduler; 