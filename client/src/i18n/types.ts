import type { fr } from './fr';

/** G6-05 — langues de l'interface (users.locale, mig 610). */
export type Locale = 'fr' | 'ar' | 'en';
export const LOCALES: readonly Locale[] = ['fr', 'ar', 'en'];
export const DEFAULT_LOCALE: Locale = 'fr';

/** Clés de traduction : celles du dictionnaire français, référence unique. */
export type TranslationKey = keyof typeof fr;
/** Dictionnaire d'une autre langue : sous-ensemble des clés françaises (repli sur le français). */
export type Dictionary = Partial<Record<TranslationKey, string>>;
export type TParams = Record<string, string | number>;
