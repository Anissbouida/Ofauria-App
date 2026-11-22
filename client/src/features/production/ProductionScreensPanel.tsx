import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, MonitorCog } from 'lucide-react';
import { PRODUCTION_SCREEN_ELEMENTS } from '@ofauria/shared';
import { productionApi, useOrderTypes } from '../../api/production.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useAuth } from '../../context/AuthContext';

import { DataPanel, LoadingState, SectionHeader } from '../../components/ds';
/**
 * Production › Paramétrage › Écrans (mig 591).
 * Chaque panneau de l'ordre de fabrication et chaque étape de la fenêtre de lancement, avec la règle
 * qui l'affiche. Une case décochée masque l'élément pour toute la société ou pour un type d'ordre ;
 * masqué au niveau société, il l'est pour tous les types. Les éléments indispensables au parcours
 * ne se masquent pas (cadenas, avec la raison).
 */
export default function ProductionScreensPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = !!user && ['admin', 'manager'].includes(user.role);
  const { types } = useOrderTypes(true);
  const { data: hidden = [], isLoading } = useQuery({ queryKey: ['production-screen-settings'], queryFn: productionApi.screenSettings });
  const isHidden = (typeId: string | null, key: string) => hidden.some(h => h.orderTypeId === typeId && h.key === key);

  const toggle = useMutation({
    mutationFn: (v: { typeId: string | null; key: string; hidden: boolean }) => productionApi.setScreenSetting(v.typeId, v.key, v.hidden),
    onSuccess: (data) => { qc.setQueryData(['production-screen-settings'], data); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const columns: { id: string | null; label: string }[] = [{ id: null, label: 'Toute la société' }, ...types.map(t => ({ id: t.id, label: t.label }))];
  const groups = [
    { area: 'plan' as const, title: 'Ordre de fabrication' },
    { area: 'launch' as const, title: 'Fenêtre de lancement' },
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="info" icon={MonitorCog} title="Écrans de fabrication">
        Chaque élément s'affiche selon sa règle (état de l'ordre, type d'ordre, options, réglages). Décochez une case pour
        le masquer, pour toute la société ou pour un type d'ordre. Les éléments marqués d'un cadenas sont indispensables au parcours.
      </StatusBanner>
      {isLoading ? <LoadingState /> : groups.map(g => (
        <section key={g.area} style={{ display: 'grid', gap: 12 }}>
          <SectionHeader title={g.title} />
          <DataPanel label={g.title}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Élément</th><th>S'affiche quand</th>
                {columns.map(c => <th key={c.id ?? 'company'} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {PRODUCTION_SCREEN_ELEMENTS.filter(e => e.area === g.area).map(e => {
                const companyHidden = isHidden(null, e.key);
                return (
                  <tr key={e.key}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="ds-strong">{e.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)' }}>{e.place}</span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--ds-muted)' }}>{e.rule}</td>
                    {columns.map(c => {
                      if (e.locked) {
                        return <td key={c.id ?? 'company'} style={{ textAlign: 'center' }} title={e.locked}>
                          <Lock size={13} aria-label={`Toujours selon la règle : ${e.locked}`} style={{ color: 'var(--ds-muted)' }} />
                        </td>;
                      }
                      const inherited = c.id !== null && companyHidden;
                      const shown = !(inherited || isHidden(c.id, e.key));
                      return (
                        <td key={c.id ?? 'company'} style={{ textAlign: 'center' }}
                          title={inherited ? 'Masqué pour toute la société' : shown ? 'Affiché selon la règle' : 'Masqué'}>
                          <input type="checkbox" checked={shown} disabled={!canEdit || inherited || toggle.isPending}
                            aria-label={`${e.label} — ${c.label}`}
                            onChange={(ev) => toggle.mutate({ typeId: c.id, key: e.key, hidden: !ev.target.checked })} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </DataPanel>
        </section>
      ))}
    </div>
  );
}
