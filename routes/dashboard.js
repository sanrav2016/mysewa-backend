import express from 'express';
import { prisma } from '../src/server.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';

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

// Get dashboard statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Calculate user's total hours from signups
    const totalHours = await calculateUserHours(userId);

    // Get upcoming events count
    const upcomingEventsCount = await prisma.userEventSignup.count({
      where: {
        userId,
        instance: {
          startDate: {
            gt: new Date()
          }
        }
      }
    });

    // Get past events count
    const pastEventsCount = await prisma.userEventSignup.count({
      where: {
        userId,
        instance: {
          startDate: {
            lte: new Date()
          }
        }
      }
    });

    // Get total events count
    const totalEventsCount = await prisma.userEventSignup.count({
      where: { userId }
    });

    // Get hours earned this month
    const currentMonth = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    const hoursThisMonth = await prisma.userEventSignup.aggregate({
      where: {
        userId,
        signupDate: {
          gte: startOfMonth,
          lte: endOfMonth
        },
        hoursEarned: {
          not: null
        }
      },
      _sum: {
        hoursEarned: true
      }
    });

    res.json({
      stats: {
        totalHours,
        upcomingEvents: upcomingEventsCount,
        pastEvents: pastEventsCount,
        totalEvents: totalEventsCount,
        hoursThisMonth: hoursThisMonth._sum.hoursEarned || 0
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard statistics',
      message: 'An error occurred while fetching dashboard statistics'
    });
  }
});

// Get upcoming events for dashboard
router.get('/upcoming-events', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 3 } = req.query;

    const upcomingEvents = await prisma.userEventSignup.findMany({
      where: {
        userId,
        instance: {
          startDate: {
            gt: new Date()
          }
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
            hours: true,
            status: true,
            cancelledAt: true
          }
        }
      },
      orderBy: {
        instance: {
          startDate: 'asc'
        }
      },
      take: parseInt(limit)
    });

    res.json({ upcomingEvents });

  } catch (error) {
    console.error('Get upcoming events error:', error);
    res.status(500).json({
      error: 'Failed to fetch upcoming events',
      message: 'An error occurred while fetching upcoming events'
    });
  }
});

// Get recent activity for dashboard
router.get('/recent-activity', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 5 } = req.query;

    const recentActivity = await prisma.userEventSignup.findMany({
      where: {
        userId,
        instance: {
          startDate: {
            lte: new Date()
          }
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
      },
      orderBy: {
        instance: {
          startDate: 'desc'
        }
      },
      take: parseInt(limit)
    });

    res.json({ recentActivity });

  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({
      error: 'Failed to fetch recent activity',
      message: 'An error occurred while fetching recent activity'
    });
  }
});

// Get admin dashboard statistics (admin only)
router.get('/admin-stats', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin access required'
      });
    }

    // Get total users count
    const totalUsers = await prisma.user.count();

    // Get total events count
    const totalEvents = await prisma.event.count();

    // Get total signups count
    const totalSignups = await prisma.userEventSignup.count();

    // Get events by status
    const eventsByStatus = await prisma.event.groupBy({
      by: ['status'],
      _count: {
        id: true
      }
    });

    // Get users by role
    const usersByRole = await prisma.user.groupBy({
      by: ['role'],
      _count: {
        id: true
      }
    });

    // Get upcoming events count
    const upcomingEvents = await prisma.eventInstance.count({
      where: {
        startDate: {
          gt: new Date()
        }
      }
    });

    // Get total hours volunteered from confirmed signups marked approved
    const totalHours = await prisma.userEventSignup.aggregate({
      where: {
        status: 'CONFIRMED',
        approval: 'APPROVED',
        hoursEarned: { not: null }
      },
      _sum: {
        hoursEarned: true
      }
    });

    res.json({
      stats: {
        totalUsers,
        totalEvents,
        totalSignups,
        upcomingEvents,
        totalHours: totalHours._sum.hoursEarned || 0,
        eventsByStatus,
        usersByRole
      }
    });

  } catch (error) {
    console.error('Get admin dashboard stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch admin dashboard statistics',
      message: 'An error occurred while fetching admin dashboard statistics'
    });
  }
});

// Get available events for signup
router.get('/available-events', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;

    // Get events that the user hasn't signed up for
    const availableEvents = await prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        instances: {
          some: {
            startDate: {
              gt: new Date()
            }
          }
        },
        signups: {
          none: {
            userId
          }
        }
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        instances: {
          where: {
            startDate: {
              gt: new Date()
            }
          },
          orderBy: {
            startDate: 'asc'
          }
        },
        _count: {
          select: {
            signups: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });

    res.json({ availableEvents });

  } catch (error) {
    console.error('Get available events error:', error);
    res.status(500).json({
      error: 'Failed to fetch available events',
      message: 'An error occurred while fetching available events'
    });
  }
});

// Export chapter data to Excel (admin only)
router.get('/export-chapter-data', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get all users with calculated hours
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        chapter: true,
        city: true,
        phone: true,
        joinedDate: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    // Calculate hours for all users
    const userIds = users.map(user => user.id);
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

    // Format users data for Excel
    const usersData = users.map(user => ({
      'Name': user.name,
      'Email': user.email,
      'Role': user.role,
      'Chapter': user.chapter || '',
      'City': user.city || '',
      'Phone': user.phone || '',
      'Total Hours': hoursMap.get(user.id) || 0,
      'Join Date': user.joinedDate ? new Date(user.joinedDate).toLocaleDateString() : '',
      'Created': new Date(user.createdAt).toLocaleDateString()
    }));

    // Get all events with instances
    const events = await prisma.event.findMany({
      include: {
        instances: {
          include: {
            signups: {
              where: {
                status: 'CONFIRMED'
              },
              include: {
                user: {
                  select: {
                    name: true,
                    role: true
                  }
                }
              }
            }
          }
        },
        creator: {
          select: {
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Format events data for Excel
    const eventsData = events.flatMap(event => 
      event.instances.map(instance => ({
        'Event Title': event.title,
        'Event Category': event.category,
        'Session Date': instance.startDate ? new Date(instance.startDate).toLocaleDateString() : 'TBD',
        'Session Time': instance.startDate ? new Date(instance.startDate).toLocaleTimeString() : 'TBD',
        'Location': instance.location || 'TBD',
        'Hours': instance.hours || 0,
        'Student Capacity': instance.studentCapacity,
        'Parent Capacity': instance.parentCapacity,
        'Total Signups': instance.signups.length,
        'Student Signups': instance.signups.filter(s => s.user.role === 'STUDENT').length,
        'Parent Signups': instance.signups.filter(s => s.user.role === 'PARENT').length,
        'Status': event.status,
        'Created By': event.creator.name,
        'Created Date': new Date(event.createdAt).toLocaleDateString(),
        'Chapters': event.chapters.join(', '),
        'Cities': event.cities.join(', ')
      }))
    );

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Add users sheet
    const usersSheet = XLSX.utils.json_to_sheet(usersData);
    XLSX.utils.book_append_sheet(workbook, usersSheet, 'Users');

    // Add events sheet
    const eventsSheet = XLSX.utils.json_to_sheet(eventsData);
    XLSX.utils.book_append_sheet(workbook, eventsSheet, 'Events');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="chapter-data-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);

    // Send file
    res.send(buffer);

  } catch (error) {
    console.error('Export chapter data error:', error);
    res.status(500).json({
      error: 'Failed to export data',
      message: 'An error occurred while exporting chapter data'
    });
  }
});

// Generate volunteer certificate PDF
router.get('/generate-certificate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        chapter: true,
        city: true,
        joinedDate: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User data could not be found'
      });
    }

    // Calculate total hours
    const totalHours = await calculateUserHours(userId);

    if (totalHours === 0) {
      return res.status(400).json({
        error: 'No volunteer hours',
        message: 'You must have completed volunteer hours to generate a certificate'
      });
    }

    // Get completed events for details
    const completedSignups = await prisma.userEventSignup.findMany({
      where: {
        userId: userId,
        status: 'CONFIRMED',
        approval: 'APPROVED',
        hoursEarned: { not: null }
      },
      include: {
        event: {
          select: {
            title: true,
            category: true
          }
        },
        instance: {
          select: {
            startDate: true,
            hours: true
          }
        }
      },
      orderBy: {
        instance: {
          startDate: 'asc'
        }
      }
    });

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 50
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="volunteer-certificate-${user.name.replace(/\s+/g, '-')}.pdf"`);

    // Pipe the PDF to the response
    doc.pipe(res);

    // Certificate design
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const centerX = pageWidth / 2;

    // Add border
    doc.rect(30, 30, pageWidth - 60, pageHeight - 60)
       .lineWidth(3)
       .stroke('#D97706');

    doc.rect(40, 40, pageWidth - 80, pageHeight - 80)
       .lineWidth(1)
       .stroke('#D97706');

    // Title
    doc.fontSize(36)
       .font('Helvetica-Bold')
       .fillColor('#D97706')
       .text('CERTIFICATE OF APPRECIATION', centerX - 250, 100, {
         width: 500,
         align: 'center'
       });

    // Subtitle
    doc.fontSize(18)
       .font('Helvetica')
       .fillColor('#374151')
       .text('Volunteer Service Recognition', centerX - 150, 160, {
         width: 300,
         align: 'center'
       });

    // Main text
    doc.fontSize(16)
       .text('This is to certify that', centerX - 100, 220, {
         width: 200,
         align: 'center'
       });

    // User name (highlighted)
    doc.fontSize(28)
       .font('Helvetica-Bold')
       .fillColor('#D97706')
       .text(user.name, centerX - 200, 260, {
         width: 400,
         align: 'center'
       });

    // Achievement text
    doc.fontSize(16)
       .font('Helvetica')
       .fillColor('#374151')
       .text('has successfully completed', centerX - 120, 320, {
         width: 240,
         align: 'center'
       });

    // Hours (highlighted)
    doc.fontSize(24)
       .font('Helvetica-Bold')
       .fillColor('#059669')
       .text(`${totalHours} Volunteer Hours`, centerX - 120, 360, {
         width: 240,
         align: 'center'
       });

    // Service period
    const firstEventDate = completedSignups[0]?.instance?.startDate;
    const lastEventDate = completedSignups[completedSignups.length - 1]?.instance?.startDate;
    
    if (firstEventDate && lastEventDate) {
      const startDate = new Date(firstEventDate).toLocaleDateString();
      const endDate = new Date(lastEventDate).toLocaleDateString();
      
      doc.fontSize(14)
         .font('Helvetica')
         .text(`Service Period: ${startDate} - ${endDate}`, centerX - 150, 410, {
           width: 300,
           align: 'center'
         });
    }

    // Organization info
    doc.fontSize(14)
       .text('through volunteer service with', centerX - 120, 440, {
         width: 240,
         align: 'center'
       });

    doc.fontSize(20)
       .font('Helvetica-Bold')
       .fillColor('#D97706')
       .text('Sewa International', centerX - 100, 470, {
         width: 200,
         align: 'center'
       });

    // Chapter info
    if (user.chapter) {
      doc.fontSize(14)
         .font('Helvetica')
         .fillColor('#374151')
         .text(`${user.chapter} Chapter`, centerX - 100, 500, {
           width: 200,
           align: 'center'
         });
    }

    // Date and signature area
    const currentDate = new Date().toLocaleDateString();
    
    doc.fontSize(12)
       .text(`Certificate Generated: ${currentDate}`, 80, pageHeight - 120);

    doc.text('Authorized Signature', pageWidth - 200, pageHeight - 120);

    // Add a signature line
    doc.moveTo(pageWidth - 200, pageHeight - 90)
       .lineTo(pageWidth - 80, pageHeight - 90)
       .stroke('#374151');

    // Footer
    doc.fontSize(10)
       .fillColor('#6B7280')
       .text('This certificate is digitally generated and verified by Sewa International Volunteer Management System', 
             centerX - 250, pageHeight - 60, {
         width: 500,
         align: 'center'
       });

    // Finalize the PDF
    doc.end();

  } catch (error) {
    console.error('Generate certificate error:', error);
    res.status(500).json({
      error: 'Failed to generate certificate',
      message: 'An error occurred while generating the certificate'
    });
  }
});

export default router; 