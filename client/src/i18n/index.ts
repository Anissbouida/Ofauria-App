/** G6-05 — point d'entrée de la traduction (voir core.ts et fr.ts). */
export * from './types';
export {
  t, translate, interpolate, dirOf, isLocale, getLocale, getIntlLocale, intlLocaleOf,
  setCurrentLocale, applyDocumentLocale, formatNumber, formatDate, DICTIONARIES,
} from './core';
export { LocaleProvider, useLocale, useT } from './LocaleContext';
