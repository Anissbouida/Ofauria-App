import { AsyncLocalStorage } from 'async_hooks';
import { logger } from './logger.js';

const timezoneStorage = new AsyncLocalStorage<string>();

const DEFAULT_TIMEZONE = 'Africa/Casablanca';

// Strict whitelist of IANA timezones expected for this application.
// Extend as needed. Unknown timezones fall back to DEFAULT_TIMEZONE
// and are logged as a possible attack vector.
const ALLOWED_TIMEZONES = new Set<string>([
  'UTC',
  'Africa/Casablanca',
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Cairo',
  'Europe/Paris',
  'Europe/London',
  'Europe/Madrid',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
]);

function isValidTimezone(tz: string): boolean {
  return typeof tz === 'string' && ALLOWED_TIMEZONES.has(tz);
}

/**
 * Run a callback with a specific timezone stored in async context.
 * Invalid/malicious timezone values are rejected and fall back to default.
 */
export function runWithTimezone(timezone: string, fn: () => void) {
  if (!isValidTimezone(timezone)) {
    if (timezone && timezone !== DEFAULT_TIMEZONE) {
      // Log structure : utile pour detecter des tentatives d'injection
      // (OWASP A09 monitoring). La valeur est tronquee pour eviter tout abus.
      logger.warn({ rejectedTimezone: String(timezone).slice(0, 80) }, 'Rejet timezone non autorisee');
    }
    timezoneStorage.run(DEFAULT_TIMEZONE, fn);
    return;
  }
  timezoneStorage.run(timezone, fn);
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
