import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Store } from 'lucide-react';
import { authApi } from '../../api/auth.api';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n';
import { notify } from '../ui/InlineNotification';

const IS_MOBILE_BUILD = !!import.meta.env.VITE_API_URL;

/**
 * Établissement actif (refonte Utilisateurs, lot 7, mig 707) : affiché seulement quand le compte a
 * plusieurs établissements. Basculer réémet le jeton de connexion avec l'établissement choisi, puis
 * recharge la page pour que tous les écrans lisent le nouveau périmètre « Son établissement ».
 */
export default function StoreSwitcher() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ['my-stores', user?.id], queryFn: authApi.myStores, enabled: !!user, staleTime: 60_000 });

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!data || data.stores.length < 2) return null;
  const active = data.stores.find(s => s.id === data.activeStoreId) ?? data.stores.find(s => s.isDefault) ?? data.stores[0];

  const pick = async (id: string) => {
    setOpen(false);
    if (id === active.id || busy) return;
    setBusy(true);
    try {
      const out = await authApi.setActiveStore(id);
      if (IS_MOBILE_BUILD && out.token) localStorage.setItem('ofauria_token', out.token);
      window.location.reload();
    } catch {
      setBusy(false);
      notify.error(t('header.storeSwitchFailed'));
    }
  };

  return (
    <div className="relative me-1" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} disabled={busy}
        aria-haspopup="menu" aria-expanded={open} aria-label={`${t('header.storeSwitch')} : ${active.name}`}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-white/15 transition-colors text-sm font-medium">
        <Store size={15} aria-hidden="true" />
        <span className="hidden md:block max-w-[180px] truncate">{active.name}</span>
        <ChevronDown size={14} className="text-white/60" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={t('header.storeSwitch')}
          className="absolute end-0 top-full mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-1 text-gray-800 z-50">
          <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('header.store')}</p>
          {data.stores.map(s => (
            <button key={s.id} type="button" role="menuitemradio" aria-checked={s.id === active.id} aria-label={s.isDefault ? `${s.name} (${t('header.storeDefault')})` : s.name} onClick={() => void pick(s.id)}
              className="w-full text-start px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
              <span className="w-4 shrink-0">{s.id === active.id && <Check size={14} className="text-emerald-600" />}</span>
              <span className="flex-1 truncate">{s.name}</span>
              {s.isDefault && <span className="text-[11px] text-gray-400">{t('header.storeDefault')}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
