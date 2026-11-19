import { fr } from './fr';
import { ar } from './ar';
import { en } from './en';
import { DEFAULT_LOCALE, LOCALES, type Dictionary, type Locale, type TParams, type TranslationKey } from './types';

/**
 * G6-05 — moteur de traduction sans dépendance.
 *   translate('ar', 'common.save')                       → « حفظ »
 *   translate('en', 'common.error.server', { status: 500 }) → « Server error (500) »
 * Repli : clé absente de la langue → français ; absente du français → la clé elle-même
 * (visible à l'écran, donc repérable).
 *
 * `t()` (hors React : utilitaires, notifications) lit la langue courante du module ; dans
 * un composant, préférer `useT()` qui re-rend au changement de langue.
 */
export const DICTIONARIES: Record<Locale, Dictionary> = { fr, ar, en };

/** Langues écrites de droite à gauche. */
const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

/** Locale Intl (nombres, dates) — ar-MA garde les chiffres latins, usuels au Maroc. */
const INTL_LOCALES: Record<Locale, string> = { fr: 'fr-FR', ar: 'ar-MA', en: 'en-GB' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (RTL_LOCALES.has(locale) ? 'rtl' : 'ltr');
export const intlLocaleOf = (locale: Locale): string => INTL_LOCALES[locale];

/** Remplace « {nom} » par params.nom ; un paramètre absent laisse le jeton tel quel. */
export function interpolate(text: string, params?: TParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

export function translate(locale: Locale, key: TranslationKey, params?: TParams): string {
  const text = DICTIONARIES[locale]?.[key] ?? (fr as Dictionary)[key] ?? key;
  return interpolate(text, params);
}

let current: Locale = DEFAULT_LOCALE;

export const getLocale = (): Locale => current;
export const getIntlLocale = (): string => INTL_LOCALES[current];

/** Traduction dans la langue courante (hors composants React). */
export function t(key: TranslationKey, params?: TParams): string {
  return translate(current, key, params);
}

/** Pose `lang` et `dir` sur <html> : le navigateur bascule la mise en page en RTL pour l'arabe. */
export function applyDocumentLocale(locale: Locale, doc: { documentElement: { lang: string; dir: string } } | undefined =
  typeof document !== 'undefined' ? document : undefined): void {
  if (!doc) return;
  doc.documentElement.lang = locale;
  doc.documentElement.dir = dirOf(locale);
}

/** Change la langue courante du module et du document. */
export function setCurrentLocale(locale: Locale): void {
  current = locale;
  applyDocumentLocale(locale);
}

/* ── Formats (Intl) dans la langue courante ── */

export function formatNumber(value: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(getIntlLocale(), opts).format(value);
}

export function formatDate(value: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(getIntlLocale(), opts).format(d);
}
