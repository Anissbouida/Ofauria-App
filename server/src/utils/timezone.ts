import { AsyncLocalStorage } from 'async_hooks';

const timezoneStorage = new AsyncLocalStorage<string>();

const DEFAULT_TIMEZONE = 'Africa/Casablanca';

/**
 * Run a callback with a specific timezone stored in async context
 */
export function runWithTimezone(timezone: string, fn: () => void) {
  timezoneStorage.run(timezone || DEFAULT_TIMEZONE, fn);
}

/**
 * Get the current user's timezone from async context
 * Falls back to 'Africa/Casablanca' if not set
 */
export function getUserTimezone(): string {
  return timezoneStorage.getStore() || DEFAULT_TIMEZONE;
}

/**
 * SQL helper: returns the timezone-aware "today" expression
 * Usage in SQL template: `WHERE ${sqlToday('created_at')} = ${sqlToday()}`
 */
export function sqlToday(column?: string): string {
  const tz = getUserTimezone();
  if (column) {
    return `(${column} AT TIME ZONE '${tz}')::date`;
  }
  return `(NOW() AT TIME ZONE '${tz}')::date`;
}

/**
 * SQL helper: returns timezone-aware EXTRACT expression
 */
export function sqlExtract(field: string, column: string): string {
  const tz = getUserTimezone();
  return `EXTRACT(${field} FROM ${column} AT TIME ZONE '${tz}')`;
}

/**
 * JS helper: get current date string (YYYYMMDD) in user's timezone
 */
export function getLocalDateString(): string {
  const tz = getUserTimezone();
  const now = new Date();
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return localDate.getFullYear().toString() +
    String(localDate.getMonth() + 1).padStart(2, '0') +
    String(localDate.getDate()).padStart(2, '0');
}

/**
 * JS helper: get current date as ISO string (YYYY-MM-DD) in user's timezone
 */
export function getLocalISODate(): string {
  const tz = getUserTimezone();
  const now = new Date();
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return localDate.getFullYear().toString() +
    '-' + String(localDate.getMonth() + 1).padStart(2, '0') +
    '-' + String(localDate.getDate()).padStart(2, '0');
}

/**
 * JS helper: get current year in user's timezone
 */
export function getLocalYear(): number {
  const tz = getUserTimezone();
  const now = new Date();
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return localDate.getFullYear();
}

/**
 * JS helper: get current Date object adjusted to user's timezone
 */
export function getLocalNow(): Date {
  const tz = getUserTimezone();
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: tz }));
}
