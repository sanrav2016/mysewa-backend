import Joi from 'joi';

// User validation schemas
export const userRegistrationSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('STUDENT', 'PARENT', 'ADMIN').default('STUDENT'),
  phone: Joi.string().optional(),
  chapter: Joi.string().optional(),
  city: Joi.string().optional()
});

export const userLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

export const userUpdateSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  chapter: Joi.string().optional(),
  city: Joi.string().optional(),
  avatar: Joi.string().optional()
});

// Event validation schemas
export const eventCreateSchema = Joi.object({
  title: Joi.string().min(3).max(200).required(),
  description: Joi.string().min(10).required(),
  category: Joi.string().required(),
  isRecurring: Joi.boolean().default(false),
  status: Joi.string().valid('DRAFT', 'PUBLISHED', 'ARCHIVED', 'SCHEDULED').default('DRAFT'),
  chapters: Joi.array().items(Joi.string()).min(1).required(),
  cities: Joi.array().items(Joi.string()).min(1).required(),
  tags: Joi.array().items(Joi.string()).optional(),
  scheduledPublishDate: Joi.date().iso().allow(null).optional(),
  instances: Joi.array().items(Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
    location: Joi.string().optional(),
    hours: Joi.number().integer().min(0).default(0),
    studentCapacity: Joi.number().integer().min(0).default(0),
    parentCapacity: Joi.number().integer().min(0).default(0),
    description: Joi.string().optional(),
    enabled: Joi.boolean().default(true)
  })).optional()
});

export const eventUpdateSchema = Joi.object({
  title: Joi.string().min(3).max(200).optional(),
  description: Joi.string().max(1000).optional(),
  category: Joi.string().optional(),
  isRecurring: Joi.boolean().optional(),
  status: Joi.string().valid('DRAFT', 'PUBLISHED', 'ARCHIVED', 'SCHEDULED').optional(),
  chapters: Joi.array().items(Joi.string()).min(1).optional(),
  cities: Joi.array().items(Joi.string()).min(1).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  scheduledPublishDate: Joi.date().iso().allow(null).optional(),
  instances: Joi.array().items(Joi.object({
    id: Joi.string().optional(), // Allow ID for existing instances
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
    location: Joi.string().optional(),
    hours: Joi.number().integer().min(0).default(0),
    studentCapacity: Joi.number().integer().min(0).default(0),
    parentCapacity: Joi.number().integer().min(0).default(0),
    description: Joi.string().optional(),
    enabled: Joi.boolean().default(true)
  })).optional()
});

// Event instance validation schemas
export const eventInstanceCreateSchema = Joi.object({
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional(),
  location: Joi.string().optional(),
  hours: Joi.number().integer().min(0).default(0),
  studentCapacity: Joi.number().integer().min(0).default(0),
  parentCapacity: Joi.number().integer().min(0).default(0),
  description: Joi.string().optional(),
  enabled: Joi.boolean().default(true),
  waitlistEnabled: Joi.boolean().default(true)
});

export const eventInstanceUpdateSchema = Joi.object({
  startDate: Joi.date().allow(null).optional(),
  endDate: Joi.date().allow(null).optional(),
  location: Joi.string().allow(null, '').optional(),
  hours: Joi.number().integer().min(0).optional(),
  studentCapacity: Joi.number().integer().min(0).optional(),
  parentCapacity: Joi.number().integer().min(0).optional(),
  description: Joi.string().allow(null, '').optional(),
  enabled: Joi.boolean().optional(),
  waitlistEnabled: Joi.boolean().optional()
});

// Signup validation schemas
export const signupCreateSchema = Joi.object({
  eventId: Joi.string().required(),
  instanceId: Joi.string().required()
});

export const signupUpdateSchema = Joi.object({
  status: Joi.string().valid('CONFIRMED', 'WAITLIST', 'WAITLIST_PENDING', 'CANCELLED').optional(),
  hoursEarned: Joi.number().min(0).optional(),
  attendance: Joi.string().valid('PRESENT', 'ABSENT', 'NOT_MARKED').optional()
});

// Query validation schemas
export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().optional(),
  sortBy: Joi.string().optional(),
  sortOrder: Joi.string().valid('asc', 'desc').default('asc')
});

export const eventQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().allow('', null).optional(),
  category: Joi.string().allow('undefined', '').optional(),
  status: Joi.string().valid('DRAFT', 'PUBLISHED', 'ARCHIVED').optional(),
  chapter: Joi.string().allow('undefined', '').optional(),
  city: Joi.string().allow('undefined', '').optional(),
  sortBy: Joi.string().valid('title', 'category', 'createdAt', 'startDate').default('startDate'),
  sortOrder: Joi.string().valid('asc', 'desc').default('asc')
});

export const userQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().optional(),
  role: Joi.string().valid('STUDENT', 'PARENT', 'ADMIN').optional(),
  chapter: Joi.string().allow('undefined', '').optional(),
  city: Joi.string().allow('undefined', '').optional(),
  sortBy: Joi.string().valid('name', 'email', 'role', 'totalHours', 'joinedDate').default('name'), // totalHours kept for backward compatibility, handled in backend
  sortOrder: Joi.string().valid('asc', 'desc').default('asc')
}); 