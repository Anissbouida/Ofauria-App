import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PencilLine, RotateCcw, Save, Type } from 'lucide-react';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { usePermissions } from '../../context/PermissionsContext';

/**
 * Paramètres › Secteur et modules › Vocabulaire (M8-03, mig 583).
 * Chaque terme métier affiché par l'application : valeur du secteur (préréglage) et
 * renommage propre à la société. Aperçu en direct ; « Rétablir » rend le terme du secteur.
 */
interface VocabItem {
  key: string; group: string; designates: string; fallback: string;
  sectorValue: string | null; override: string | null; effective: string; updatedBy: string | null;
}
interface VocabData { sector: { code: string; label: string }; items: VocabItem[] }

const vocabApi = {
  list: (): Promise<VocabData> => api.get('/settings/vocabulary').then(r => r.data.data),
  set: (key: string, value: string) => api.put(`/settings/vocabulary/${key}`, { value }).then(r => r.data.data),
  reset: (key: string) => api.delete(`/settings/vocabulary/${key}`).then(r => r.data.data),
};

export default function VocabularyPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { reload } = usePermissions();
  const { data, isLoading } = useQuery({ queryKey: ['settings-vocabulary'], queryFn: vocabApi.list });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['settings-vocabulary'] });
    reload(); // menus et écrans relisent les termes
    notify.success(msg);
  };
  const save = useMutation({
    mutationFn: async () => {
      for (const [k, v] of dirty) await vocabApi.set(k, v.trim());
    },
    onSuccess: () => { setDrafts({}); done('Vocabulaire enregistré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: (key: string) => vocabApi.reset(key),
    onSuccess: (_r, key) => { setDrafts(d => { const n = { ...d }; delete n[key]; return n; }); done('Terme du secteur rétabli'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const value = (it: VocabItem) => drafts[it.key] ?? it.effective;
  const term = (key: string) => { const it = data?.items.find(i => i.key === key); return it ? value(it) : key; };
  const groups = useMemo(() => {
    const m = new Map<string, VocabItem[]>();
    data?.items.forEach(i => m.set(i.group, [...(m.get(i.group) ?? []), i]));
    return [...m.entries()];
  }, [data]);
  const dirty = Object.entries(drafts).filter(([k, v]) => {
    const it = data?.items.find(i => i.key === k);
    return !!it && !!v.trim() && v.trim() !== it.effective;
  });

  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="info" icon={Type} title={`Vocabulaire — secteur « ${data.sector.label} »`}>
        Les termes viennent du secteur. Renommez ceux qui ne correspondent pas à votre métier : le changement vaut
        pour toute la société, menus et écrans compris. « Rétablir » rend le terme du secteur.
      </StatusBanner>

      <div className="prj-panel" style={{ padding: '14px 18px', fontSize: '0.875rem' }} aria-label="Aperçu">
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ds-muted)', marginBottom: 4 }}>Aperçu</div>
        Menu « {term('production')} » › « {term('production_plans')} » › bouton « {term('new_plan')} ».
        Chaque {term('production_plan').toLowerCase()} suit une {term('recipe').toLowerCase()} :
        {' '}{term('base_preps').toLowerCase()} puis {term('finished_product').toLowerCase()},
        produits par {term('batch').toLowerCase()} ({term('yield').toLowerCase()}).
      </div>

      {groups.map(([group, items]) => (
        <div key={group} className="prj-panel">
          <div className="prj-panel-head">{group}</div>
          <div className="prj-scroll">
          <table className="odoo-table">
            <thead>
              <tr><th>Désigne</th><th>Terme du secteur</th><th>Terme affiché</th><th /></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.key}>
                  <td>{it.designates}</td>
                  <td style={{ color: 'var(--ds-muted)' }}>{it.sectorValue ?? it.fallback}</td>
                  <td>
                    <input className="input" value={value(it)} maxLength={80} disabled={!canEdit} aria-label={`Terme pour ${it.designates}`}
                      onChange={e => setDrafts(d => ({ ...d, [it.key]: e.target.value }))} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {it.override && <StatusTag tone="progress" icon={PencilLine} title={it.updatedBy ? `Modifié par ${it.updatedBy}` : undefined} label="Modifié" />}
                    {canEdit && it.override && (
                      <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 6 }} disabled={reset.isPending}
                        onClick={() => reset.mutate(it.key)} aria-label={`Rétablir ${it.designates}`}>
                        <RotateCcw size={13} /> Rétablir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ))}

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {dirty.length > 0 && <button type="button" className="odoo-btn-secondary" onClick={() => setDrafts({})}>Annuler</button>}
          <button type="button" className="odoo-btn-primary" disabled={!dirty.length || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer{dirty.length ? ` (${dirty.length})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
