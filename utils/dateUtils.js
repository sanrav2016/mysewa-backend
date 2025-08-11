/**
 * Date utility functions for consistent UTC handling
 */

/**
 * Convert a date to UTC ISO string
 * @param {Date|string} date - Date to convert
 * @returns {string} UTC ISO string
 */
export function toUTCISOString(date) {
  if (!date) return null;
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toISOString();
}

/**
 * Create a new Date object in UTC
 * @param {Date|string|number} date - Date input
 * @returns {Date} UTC Date object
 */
export function createUTCDate(date) {
  if (!date) return new Date();
  return new Date(date);
}

/**
 * Get current UTC time
 * @returns {Date} Current UTC time
 */
export function getCurrentUTCTime() {
  return new Date();
}

/**
 * Convert local time to UTC for storage
 * @param {string} localDateTime - Local datetime string (e.g., from datetime-local input)
 * @returns {string} UTC ISO string
 */
export function localToUTC(localDateTime) {
  if (!localDateTime) return null;
  
  // Create a date object from the local datetime string
  const localDate = new Date(localDateTime);
  
  // Convert to UTC ISO string
  return localDate.toISOString();
}

/**
 * Convert UTC time to local time for display
 * @param {string|Date} utcDateTime - UTC datetime
 * @returns {Date} Local date object
 */
export function utcToLocal(utcDateTime) {
  if (!utcDateTime) return null;
  
  const utcDate = typeof utcDateTime === 'string' ? new Date(utcDateTime) : utcDateTime;
  
  // Return the date object (JavaScript will automatically convert to local time when displayed)
  return utcDate;
}

/**
 * Format a date for datetime-local input (YYYY-MM-DDTHH:mm)
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatForDateTimeLocal(date) {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  // Get local time components
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
} 