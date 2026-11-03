/**
 * Formats a date string for file display
 * - If modified today: shows time like "8:23 am"
 * - If modified on previous day: shows date
 */
export function formatFileDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  
  // Check if the date is today
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    // Format as time (e.g., "8:23 am")
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).toLowerCase();
  } else {
    // Format as date (e.g., "12/25/23" or "Dec 25")
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }
}