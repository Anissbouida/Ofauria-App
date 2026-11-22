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
  // Canada — utilisateurs a Montreal / Toronto / Vancouver
  'America/Montreal',
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Halifax',
  'America/Winnipeg',
  'America/St_Johns',
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
 * Fuseau de la boutique (constat 139, scénario 2) : une vente a lieu à l'heure locale du magasin,
 * quel que soit l'endroit d'où l'on consulte l'application. Les journées de caisse, les filtres
 * « du jour », la numérotation et le reçu suivent ce fuseau ; seul l'affichage des écrans prend
 * l'heure du poste (formatage côté navigateur). Réglable par BUSINESS_TIMEZONE.
 */
export const BUSINESS_TIMEZONE: string =
  isValidTimezone(process.env.BUSINESS_TIMEZONE ?? '') ? (process.env.BUSINESS_TIMEZONE as string) : DEFAULT_TIMEZONE;

/** « jj/mm/aaaa hh:mm » à l'heure de la boutique (reçus et rapports imprimés). */
export function formatBusinessDateTime(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: BUSINESS_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
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
