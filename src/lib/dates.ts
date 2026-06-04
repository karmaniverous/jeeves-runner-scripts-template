/**
 * @module dates
 *
 * Date formatting utilities — thin wrappers around date-fns.
 *
 * LLMs cannot do day-of-week arithmetic reliably; always call these
 * helpers instead of computing dates inline. Used by meeting extractors,
 * email classification, and any script that formats dates for human output.
 *
 * No config dependencies — this module is purely functional.
 */

import {
  differenceInCalendarDays,
  format,
  formatDistance,
  parseISO,
} from 'date-fns';

export { format, parseISO };

/**
 * Return the full weekday name for a date string (e.g. "Monday").
 *
 * @param dateStr - ISO 8601 date string (YYYY-MM-DD or full ISO)
 */
export function dayOfWeek(dateStr: string): string {
  return format(parseISO(dateStr), 'EEEE');
}

/**
 * Format a date string using a date-fns format pattern.
 *
 * @param dateStr - ISO 8601 date string
 * @param fmt     - date-fns format string (e.g. "yyyy-MM-dd", "EEEE d MMMM yyyy")
 */
export function formatDate(dateStr: string, fmt: string): string {
  return format(parseISO(dateStr), fmt);
}

/**
 * Human-friendly relative description of a date (e.g. "3 days ago",
 * "in 2 days", "today").
 *
 * @param dateStr      - ISO 8601 date string
 * @param referenceStr - Optional ISO 8601 reference date (defaults to now)
 */
export function relativeDays(dateStr: string, referenceStr?: string): string {
  const target = parseISO(dateStr);
  const reference = referenceStr ? parseISO(referenceStr) : new Date();
  const diff = differenceInCalendarDays(target, reference);

  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';

  return formatDistance(target, reference, { addSuffix: true });
}
