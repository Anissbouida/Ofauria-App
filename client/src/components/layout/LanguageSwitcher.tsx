import { useEffect, useRef } from 'react';
import { Check, Languages } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usersApi } from '../../api/users.api';
import { LOCALES, isLocale, useLocale, type Locale } from '../../i18n';

/**
 * G6-05 — choix de la langue. Connecté : enregistré sur le compte (PUT /users/me/locale),
 * il suit l'utilisateur sur tous les postes ; sur l'écran de connexion : ce navigateur seul.
 */
export function useChangeLocale() {
  const { user } = useAuth();
  const { setLocale } = useLocale();
  return (next: Locale) => {
    setLocale(next);
    if (user) usersApi.setMyLocale(next).catch(() => { /* reste appliquée localement */ });
  };
}

/** Liste des langues du menu utilisateur (barre du haut). */
export function LanguageMenu({ onDone }: { onDone?: () => void }) {
  const { locale, t } = useLocale();
  const change = useChangeLocale();
  return (
    <div className="py-1" role="group" aria-label={t('header.language')}>
      <p className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
        <Languages size={12} /> {t('header.language')}
      </p>
      {LOCALES.map(l => (
        <button key={l} type="button" lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}
          onClick={() => { change(l); onDone?.(); }}
          aria-pressed={locale === l}
          className="w-full text-start px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
          <span className="w-4 shrink-0">{locale === l && <Check size={14} className="text-emerald-600" />}</span>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}

/** Sélecteur compact (écran de connexion). */
export function LanguageSelect({ className = '' }: { className?: string }) {
  const { locale, t } = useLocale();
  const change = useChangeLocale();
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm text-gray-500 ${className}`}>
      <Languages size={14} aria-hidden />
      <span className="sr-only">{t('header.language')}</span>
      <select value={locale} onChange={e => { if (isLocale(e.target.value)) change(e.target.value); }}
        className="bg-transparent border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-700">
        {LOCALES.map(l => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
      </select>
    </label>
  );
}

/**
 * Adopte la langue du compte à la connexion (users.locale) ; null = défaut de la société
 * (français à ce jour) : on garde alors le choix de ce navigateur.
 */
export function LocaleUserSync() {
  const { user } = useAuth();
  const { setLocale } = useLocale();
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    const userLocale = user?.locale;
    if (!user) { adopted.current = null; return; }
    if (adopted.current === user.id) return;
    adopted.current = user.id;
    if (isLocale(userLocale)) setLocale(userLocale);
  }, [user, setLocale]);
  return null;
}
