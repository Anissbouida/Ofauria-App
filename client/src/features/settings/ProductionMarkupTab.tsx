import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { productionMarkupApi, type MarkupConfig } from '../../api/production-markup.api';
import { SettingsSection, SettingItem, PageNote } from './SettingsPrimitives';
import { DataPanel, EmptyState, FormFooter, LoadingState } from '../../components/ds';

type Draft = {
  globalPercent: string;
  categories: { categoryId: number; categoryName: string; percent: string }[];
};

function toDraft(c: MarkupConfig): Draft {
  return {
    globalPercent: String(c.globalPercent),
    categories: c.categories.map((cat) => ({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      percent: cat.markupPercent == null ? '' : String(cat.markupPercent),
    })),
  };
}

function isUnchanged(draft: Draft, config: MarkupConfig): boolean {
  if (String(config.globalPercent) !== draft.globalPercent) return false;
  const byId = new Map(config.categories.map((c) => [c.categoryId, c]));
  for (const row of draft.categories) {
    const ref = byId.get(row.categoryId);
    if (!ref) return false;
    const refP = ref.markupPercent == null ? '' : String(ref.markupPercent);
    if (refP !== row.percent) return false;
  }
  return true;
}

function fmtPct(v: string | null): string {
  return v == null ? '—' : `${parseFloat(v)} %`;
}

export default function ProductionMarkupTab() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ['production-markup'],
    queryFn: productionMarkupApi.get,
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (config) setDraft(toDraft(config));
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: productionMarkupApi.update,
    onSuccess: (updated) => {
      qc.setQueryData(['production-markup'], updated);
      notify.success('Majoration enregistrée');
    },
    onError: () => notify.error('Erreur lors de la sauvegarde'),
  });

  if (isLoading || !config || !draft) {
    return <LoadingState bare />;
  }

  const hasChanges = !isUnchanged(draft, config);
  const globalNum = parseFloat(draft.globalPercent.replace(',', '.'));

  const handleSave = () => {
    const g = parseFloat(draft.globalPercent.replace(',', '.'));
    if (!Number.isFinite(g) || g < 0 || g > 100) {
      notify.error('Majoration globale : nombre entre 0 et 100');
      return;
    }
    const categories: { categoryId: number; percent: number | null }[] = [];
    for (const row of draft.categories) {
      if (row.percent.trim() === '') {
        categories.push({ categoryId: row.categoryId, percent: null });
        continue;
      }
      const n = parseFloat(row.percent.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        notify.error(`Majoration invalide pour « ${row.categoryName} » (0 à 100)`);
        return;
      }
      categories.push({ categoryId: row.categoryId, percent: n });
    }
    saveMutation.mutate({ globalPercent: g, categories });
  };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <PageNote help="Les quantités suggérées partent des ventes du même jour la semaine précédente ; la majoration absorbe les aléas de demande.">
          Majoration des quantités suggérées. Catégorie vide = taux global.
        </PageNote>
      </div>

      <SettingsSection title="Majoration globale" columns={1}>
        <SettingItem
          title="Taux de majoration par défaut (%)"
          description="Appliqué aux catégories sans taux personnalisé"
        >
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={draft.globalPercent}
            onChange={(e) => setDraft({ ...draft, globalPercent: e.target.value })}
            className="ds-input"
            style={{ width: 128 }}
            aria-label="Taux de majoration par défaut (%)"
          />
        </SettingItem>
      </SettingsSection>

      <SettingsSection title="Majoration par catégorie" columns={1}>
        <DataPanel label="Majoration par catégorie">
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th className="ds-num">Majoration personnalisée (%)</th>
                <th className="ds-num">Taux effectif (%)</th>
              </tr>
            </thead>
            <tbody>
              {draft.categories.map((row) => {
                const custom = row.percent.trim() !== '' ? parseFloat(row.percent.replace(',', '.')) : null;
                const effective = custom != null && Number.isFinite(custom)
                  ? custom
                  : (Number.isFinite(globalNum) ? globalNum : 0);
                return (
                  <tr key={row.categoryId}>
                    <td className="ds-strong">{row.categoryName}</td>
                    <td className="ds-num">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={row.percent}
                        placeholder={`Global (${draft.globalPercent || '5'})`}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            categories: draft.categories.map((c) =>
                              c.categoryId === row.categoryId ? { ...c, percent: e.target.value } : c
                            ),
                          })
                        }
                        className="ds-input sm"
                        style={{ width: 160, textAlign: 'right' }}
                        aria-label={`Majoration personnalisée : ${row.categoryName}`}
                      />
                    </td>
                    <td className="ds-num">
                      {effective}{custom == null ? <span style={{ color: 'var(--ds-muted)' }}> (global)</span> : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      </SettingsSection>

      <div style={{ marginBottom: 32 }}>
        <FormFooter dirty={hasChanges} onCancel={() => setDraft(toDraft(config))} onSubmit={handleSave}
          busy={saveMutation.isPending} disabled={!hasChanges} />
      </div>

      <SettingsSection title="Historique des modifications" columns={1}>
        {config.history.length === 0 ? (
          <EmptyState icon={History} title="Aucune modification enregistrée" bare />
        ) : (
          <DataPanel label="Historique des modifications">
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Portée</th>
                  <th>Ancien → nouveau</th>
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {config.history.map((h, i) => (
                  <tr key={i}>
                    <td>
                      {new Date(h.changed_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td>
                      {h.scope === 'global' ? 'Global' : (h.category_name || 'Catégorie')}
                    </td>
                    <td>
                      <History size={11} aria-hidden="true" style={{ display: 'inline', marginRight: 4, color: 'var(--ds-muted)' }} />
                      {fmtPct(h.old_percent)} → <strong>{fmtPct(h.new_percent)}</strong>
                    </td>
                    <td style={{ color: 'var(--ds-muted)' }}>{h.changed_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </SettingsSection>
    </>
  );
}
