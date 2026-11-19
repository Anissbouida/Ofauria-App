import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale, type TParams, type TranslationKey } from './types';
import { dirOf, isLocale, setCurrentLocale, translate } from './core';

/**
 * G6-05 — langue de l'interface.
 *  - Avant connexion : dernier choix de ce navigateur (localStorage, simple confort).
 *  - Après connexion : users.locale (serveur, suit l'utilisateur d'un poste à l'autre),
 *    adoptée par <LocaleUserSync> ; null = défaut de la société (français à ce jour) →
 *    on garde le choix local.
 * Le changement pose aussi `lang` / `dir` sur <html> (RTL pour l'arabe).
 */
const STORAGE_KEY = 'kalum_locale';

function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch { return null; }
}
function storeLocale(locale: Locale) {
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* navigation privée */ }
}

interface LocaleContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TParams) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  dir: 'ltr',
  setLocale: () => {},
  t: (key, params) => translate(DEFAULT_LOCALE, key, params),
});

export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = initialLocale ?? readStoredLocale() ?? DEFAULT_LOCALE;
    setCurrentLocale(initial); // avant le premier rendu : pas de clignotement LTR → RTL
    return initial;
  });

  const setLocale = useCallback((next: Locale) => {
    setCurrentLocale(next);
    storeLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    dir: dirOf(locale),
    setLocale,
    t: (key, params) => translate(locale, key, params),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
/** `const t = useT(); t('common.save')` — re-rend au changement de langue. */
export const useT = () => useContext(LocaleContext).t;
