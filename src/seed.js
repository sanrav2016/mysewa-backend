import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Reset database - delete all data in reverse order of dependencies
  console.log('🗑️  Clearing existing data...');
  
  await prisma.notification.deleteMany({});
  await prisma.userPreferences.deleteMany({});
  await prisma.userEventSignup.deleteMany({});
  await prisma.eventInstance.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('✅ Database cleared successfully!');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@volunteer.org',
      password: adminPassword,
      role: 'ADMIN',
      phone: '(555) 123-4567',
      chapter: 'Central New Jersey',
      city: 'Edison'
    }
  });

  // Create test users
  const studentPassword = await bcrypt.hash('student123', 12);
  const parentPassword = await bcrypt.hash('parent123', 12);

  const student2 = await prisma.user.create({
    data: {
      name: 'Sample Student',
      email: 'student2@test.com',
      password: studentPassword,
      role: 'STUDENT',
      phone: '(555) 234-5678',
      chapter: 'Central New Jersey',
      city: 'Monroe'
    }
  });

  const student = await prisma.user.create({
    data: {
      name: 'Test Student',
      email: 'student@test.com',
      password: studentPassword,
      role: 'STUDENT',
      phone: '(555) 234-5678',
      chapter: 'Central New Jersey',
      city: 'Monroe'
    }
  });

  const parent = await prisma.user.create({
    data: {
      name: 'Test Parent',
      email: 'parent@test.com',
      password: parentPassword,
      role: 'PARENT',
      phone: '(555) 345-6789',
      chapter: 'Central New Jersey',
      city: 'Edison'
    }
  });

  const parent2 = await prisma.user.create({
    data: {
      name: 'Sample Parent',
      email: 'parent2@test.com',
      password: parentPassword,
      role: 'PARENT',
      phone: '(555) 456-7890',
      chapter: 'Central New Jersey',
      city: 'Monroe'
    }
  });

  // Create user preferences for all users
  await prisma.userPreferences.create({
    data: {
      userId: admin.id,
      emailNotifications: true,
      textNotifications: true,
      eventReminders: true,
      newEvents: true,
      weeklyDigest: false
    }
  });

  await prisma.userPreferences.create({
    data: {
      userId: student.id,
      emailNotifications: true,
      textNotifications: true,
      eventReminders: true,
      newEvents: true,
      weeklyDigest: false
    }
  });

  await prisma.userPreferences.create({
    data: {
      userId: parent.id,
      emailNotifications: true,
      textNotifications: false,
      eventReminders: true,
      newEvents: true,
      weeklyDigest: true
    }
  });

  await prisma.userPreferences.create({
    data: {
      userId: student2.id,
      emailNotifications: true,
      textNotifications: true,
      eventReminders: true,
      newEvents: false,
      weeklyDigest: false
    }
  });

  await prisma.userPreferences.create({
    data: {
      userId: parent2.id,
      emailNotifications: true,
      textNotifications: true,
      eventReminders: false,
      newEvents: true,
      weeklyDigest: true
    }
  });

  // Create test events
  const event1 = await prisma.event.create({
    data: {
      id: 'event-1',
      title: 'Community Garden Cleanup',
      description: 'Help maintain our local community garden by weeding, planting, and general maintenance.',
      category: 'Environment',
      createdBy: admin.id,
      isRecurring: true,
      status: 'PUBLISHED',
      chapters: ['Central New Jersey'],
      cities: ['Edison', 'Monroe'],
      tags: ['outdoor', 'environment', 'physical']
    }
  });

  const event2 = await prisma.event.create({
    data: {
      id: 'event-2',
      title: 'Food Bank Sorting',
      description: 'Help sort and organize food donations at the local food bank.',
      category: 'Community Service',
      createdBy: admin.id,
      isRecurring: false,
      status: 'PUBLISHED',
      chapters: ['Central New Jersey'],
      cities: ['Edison'],
      tags: ['indoor', 'community', 'sorting']
    }
  });

  const event3 = await prisma.event.create({
    data: {
      id: 'event-3',
      title: 'Senior Center Bingo Night',
      description: 'Assist with bingo night activities at the senior center.',
      category: 'Senior Care',
      createdBy: admin.id,
      isRecurring: true,
      status: 'PUBLISHED',
      chapters: ['Central New Jersey'],
      cities: ['Edison'],
      tags: ['indoor', 'seniors', 'social']
    }
  });

  // Create event instances
  const instance1 = await prisma.eventInstance.create({
    data: {
      id: 'instance-1',
      eventId: event1.id,
      startDate: new Date('2025-08-15T09:00:00Z'),
      endDate: new Date('2025-08-15T12:00:00Z'),
      location: 'Riverside Community Garden',
      hours: 3,
      studentCapacity: 1,
      parentCapacity: 4,
      description: 'Spring cleanup and preparation',
      waitlistEnabled: true
    }
  });

  const instance2 = await prisma.eventInstance.create({
    data: {
      id: 'instance-2',
      eventId: event2.id,
      startDate: new Date('2025-08-20T14:00:00Z'),
      endDate: new Date('2025-08-20T17:00:00Z'),
      location: 'Central Food Bank',
      hours: 3,
      studentCapacity: 5,
      parentCapacity: 3,
      description: 'Monthly food sorting and inventory',
      waitlistEnabled: true
    }
  });

  const instance3 = await prisma.eventInstance.create({
    data: {
      id: 'instance-3',
      eventId: event3.id,
      startDate: new Date('2025-08-25T18:00:00Z'),
      endDate: new Date('2025-08-25T20:00:00Z'),
      location: 'Sunset Senior Center',
      hours: 2,
      studentCapacity: 6,
      parentCapacity: 3,
      description: 'Help with setup, calling numbers, and cleanup',
      waitlistEnabled: false
    }
  });

  // Create additional event instances for more variety
  const instance4 = await prisma.eventInstance.create({
    data: {
      id: 'instance-4',
      eventId: event1.id,
      startDate: new Date('2025-08-30T10:00:00Z'),
      endDate: new Date('2025-08-30T14:00:00Z'),
      location: 'Riverside Community Garden',
      hours: 4,
      studentCapacity: 10,
      parentCapacity: 5,
      description: 'Summer maintenance and new plant installation',
      waitlistEnabled: true
    }
  });

  const instance5 = await prisma.eventInstance.create({
    data: {
      id: 'instance-5',
      eventId: event2.id,
      startDate: new Date('2025-09-05T13:00:00Z'),
      endDate: new Date('2025-09-05T16:00:00Z'),
      location: 'Central Food Bank',
      hours: 3,
      studentCapacity: 6,
      parentCapacity: 4,
      description: 'Weekly food sorting and distribution preparation',
      waitlistEnabled: true
    }
  });

  const instance6 = await prisma.eventInstance.create({
    data: {
      id: 'instance-6',
      eventId: event3.id,
      startDate: new Date('2025-09-10T19:00:00Z'),
      endDate: new Date('2025-09-10T21:30:00Z'),
      location: 'Sunset Senior Center',
      hours: 2,
      studentCapacity: 8,
      parentCapacity: 4,
      description: 'Evening bingo and social activities',
      waitlistEnabled: true
    }
  });

  // Create some signups
  await prisma.userEventSignup.create({
    data: {
      id: 'signup-1',
      userId: student.id,
      eventId: event1.id,
      instanceId: instance1.id,
      status: 'CONFIRMED',
      hoursEarned: 3,
      attendance: 'PRESENT'
    }
  });

  await prisma.userEventSignup.create({
    data: {
      id: 'signup-2',
      userId: parent.id,
      eventId: event2.id,
      instanceId: instance2.id,
      status: 'CONFIRMED',
      hoursEarned: 3,
      attendance: 'PRESENT'
    }
  });

  await prisma.userEventSignup.create({
    data: {
      id: 'signup-3',
      userId: student.id,
      eventId: event3.id,
      instanceId: instance3.id,
      status: 'CONFIRMED'
    }
  });

  // Create a cancelled signup to demonstrate the cancelledAt field
  await prisma.userEventSignup.create({
    data: {
      id: 'signup-6',
      userId: student2.id,
      eventId: event1.id,
      instanceId: instance4.id,
      status: 'CANCELLED',
      cancelledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
    }
  });

  // Create waitlist signups to demonstrate new functionality
  await prisma.userEventSignup.create({
    data: {
      id: 'signup-4',
      userId: student2.id,
      eventId: event1.id,
      instanceId: instance1.id,
      status: 'WAITLIST'
    }
  });

  await prisma.userEventSignup.create({
    data: {
      id: 'signup-5',
      userId: parent2.id,
      eventId: event2.id,
      instanceId: instance2.id,
      status: 'WAITLIST_PENDING',
      waitlistNotifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    }
  });

  // Create sample notifications
  await prisma.notification.create({
    data: {
      userId: student.id,
      title: 'Event Confirmation',
      description: 'Your signup for Community Garden Cleanup has been confirmed!',
      type: 'SUCCESS',
      isRead: true,
      date: new Date('2025-02-10T10:00:00Z')
    }
  });

  await prisma.notification.create({
    data: {
      userId: student.id,
      title: 'Hours Updated',
      description: 'You earned 3 hours for Community Garden Cleanup. Total hours: 25',
      type: 'INFO',
      isRead: false,
      date: new Date('2025-02-15T13:00:00Z')
    }
  });

  await prisma.notification.create({
    data: {
      userId: parent.id,
      title: 'Event Reminder',
      description: 'Food Bank Sorting starts in 2 hours. Don\'t forget!',
      type: 'WARNING',
      isRead: false,
      date: new Date('2025-02-20T12:00:00Z')
    }
  });

  await prisma.notification.create({
    data: {
      userId: admin.id,
      title: 'New Event Created',
      description: 'Senior Center Bingo Night has been successfully published.',
      type: 'SUCCESS',
      isRead: true,
      date: new Date('2025-02-05T15:00:00Z')
    }
  });

  await prisma.notification.create({
    data: {
      userId: admin.id,
      title: 'System Update',
      description: 'New notification system has been implemented.',
      type: 'INFO',
      isRead: false,
      date: new Date('2025-02-18T09:00:00Z')
    }
  });

  // Create waitlist-related notifications
  await prisma.notification.create({
    data: {
      userId: student2.id,
      title: 'Added to Waitlist',
      description: 'You have been added to the waitlist for Community Garden Cleanup.',
      type: 'INFO',
      isRead: false,
      date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
    }
  });

  await prisma.notification.create({
    data: {
      userId: parent2.id,
      title: 'Waitlist Spot Available!',
      description: 'A spot has opened up for "Food Bank Sorting". You have 12 hours to accept or decline this spot. Go to the session details page to respond.',
      type: 'SUCCESS',
      isRead: false,
      date: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    }
  });

  console.log('✅ Database seeded successfully!');
  console.log('📧 Test accounts:');
  console.log('   Admin: admin@volunteer.org / admin123');
  console.log('   Student: student@test.com / student123');
  console.log('   Student2: student2@test.com / student123');
  console.log('   Parent: parent@test.com / parent123');
  console.log('   Parent2: parent2@test.com / parent123');
  console.log('📊 Created:');
  console.log('   - 5 users with preferences');
  console.log('   - 3 events with 6 instances (waitlist features enabled/disabled)');
  console.log('   - 5 event signups (including WAITLIST and WAITLIST_PENDING statuses)');
  console.log('   - 7 sample notifications (including waitlist notifications)');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 