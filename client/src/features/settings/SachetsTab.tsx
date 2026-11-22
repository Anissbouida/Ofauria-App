import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Package, Settings as SettingsIcon } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { sachetConfigApi, type SachetConfig } from '../../api/sachet-config.api';
import { SettingsSection, SettingItem, OdooToggle, PageNote } from './SettingsPrimitives';
import { DataPanel, EmptyState, FormFooter, KpiCard, KpiGrid, LoadingState, Segmented } from '../../components/ds';

const REASON_LABELS: Record<string, string> = {
  client_demande: 'Client a demandé',
  produit_fragile: 'Produit fragile',
  produit_chaud: 'Produit chaud / gras',
  double_sachet: 'Double sachet renforcé',
  autre: 'Autre',
};

type SubTab = 'config' | 'stats';

type Draft = {
  defaultArticlesPerSachet: string;
  categories: Array<{
    id: number;
    name: string;
    articlesPerSachet: string;
    needsSachet: boolean;
  }>;
};

function toDraft(config: SachetConfig): Draft {
  return {
    defaultArticlesPerSachet: String(config.defaultArticlesPerSachet),
    categories: config.categories.map((c) => ({
      id: c.id,
      name: c.name,
      articlesPerSachet: c.articlesPerSachet == null ? '' : String(c.articlesPerSachet),
      needsSachet: c.needsSachet,
    })),
  };
}

function isUnchanged(draft: Draft, config: SachetConfig): boolean {
  if (String(config.defaultArticlesPerSachet) !== draft.defaultArticlesPerSachet) return false;
  const byId = new Map(config.categories.map((c) => [c.id, c]));
  for (const row of draft.categories) {
    const ref = byId.get(row.id);
    if (!ref) return false;
    const refRatio = ref.articlesPerSachet == null ? '' : String(ref.articlesPerSachet);
    if (refRatio !== row.articlesPerSachet) return false;
    if (ref.needsSachet !== row.needsSachet) return false;
  }
  return true;
}

export default function SachetsTab() {
  const [sub, setSub] = useState<SubTab>('config');
  return (
    <div>
      <div style={{ display: 'inline-flex', marginBottom: 16 }}>
        <Segmented<SubTab> label="Sachets" value={sub} onChange={setSub} options={[
          { key: 'config', label: 'Configuration', icon: SettingsIcon },
          { key: 'stats', label: 'Statistiques', icon: BarChart3 },
        ]} />
      </div>
      {sub === 'config' ? <ConfigPanel /> : <StatsPanel />}
    </div>
  );
}

function ConfigPanel() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ['sachet-config'],
    queryFn: sachetConfigApi.get,
  });

  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (config) setDraft(toDraft(config));
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: sachetConfigApi.update,
    onSuccess: (updated) => {
      qc.setQueryData(['sachet-config'], updated);
      notify.success('Configuration des sachets enregistrée');
    },
    onError: (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
              ?.message ?? 'Erreur lors de la sauvegarde')
          : 'Erreur lors de la sauvegarde';
      notify.error(message);
    },
  });

  if (isLoading || !config || !draft) {
    return <LoadingState bare />;
  }

  const hasChanges = !isUnchanged(draft, config);

  const handleDefaultChange = (v: string) => {
    setDraft({ ...draft, defaultArticlesPerSachet: v });
  };

  const handleRowChange = (
    id: number,
    patch: { articlesPerSachet?: string; needsSachet?: boolean }
  ) => {
    setDraft({
      ...draft,
      categories: draft.categories.map((row) =>
        row.id === id
          ? {
              ...row,
              articlesPerSachet:
                patch.articlesPerSachet !== undefined ? patch.articlesPerSachet : row.articlesPerSachet,
              needsSachet: patch.needsSachet !== undefined ? patch.needsSachet : row.needsSachet,
            }
          : row
      ),
    });
  };

  const handleSave = () => {
    const defaultParsed = parseInt(draft.defaultArticlesPerSachet, 10);
    if (!Number.isFinite(defaultParsed) || defaultParsed <= 0) {
      notify.error('Le défaut global doit être un entier > 0');
      return;
    }

    const categories: Array<{ id: number; articlesPerSachet: number | null; needsSachet: boolean }> = [];
    for (const row of draft.categories) {
      let aps: number | null = null;
      if (row.articlesPerSachet.trim() !== '') {
        const n = parseInt(row.articlesPerSachet, 10);
        if (!Number.isFinite(n) || n <= 0) {
          notify.error(`Ratio invalide pour "${row.name}" (entier > 0 ou vide)`);
          return;
        }
        aps = n;
      }
      categories.push({ id: row.id, articlesPerSachet: aps, needsSachet: row.needsSachet });
    }

    saveMutation.mutate({
      defaultArticlesPerSachet: defaultParsed,
      categories,
    });
  };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <PageNote help="Avec un ratio de 15 : 1 à 14 articles → 0 sachet, 15 à 29 → 1, etc. Désactivez « Nécessite un sachet » pour les produits déjà emballés (bouteilles, madeleines conditionnées…).">
          1 sachet suggéré par tranche complète d'articles (le ratio est un seuil).
        </PageNote>
      </div>

      <SettingsSection title="Réglage global" columns={1}>
        <SettingItem
          title="Défaut global (articles par sachet)"
          description="Utilisé pour les catégories sans ratio personnalisé"
        >
          <input
            type="number"
            min={1}
            step={1}
            value={draft.defaultArticlesPerSachet}
            onChange={(e) => handleDefaultChange(e.target.value)}
            className="ds-input"
            style={{ width: 128 }}
            aria-label="Défaut global (articles par sachet)"
          />
        </SettingItem>
      </SettingsSection>

      <SettingsSection title="Ratio par catégorie" columns={1}>
        <DataPanel label="Ratio par catégorie">
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th className="ds-num">Articles / sachet</th>
                <th>Nécessite un sachet</th>
              </tr>
            </thead>
            <tbody>
              {draft.categories.map((row) => (
                <tr key={row.id}>
                  <td className="ds-strong">{row.name}</td>
                  <td className="ds-num">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder={`défaut (${draft.defaultArticlesPerSachet})`}
                      value={row.articlesPerSachet}
                      onChange={(e) => handleRowChange(row.id, { articlesPerSachet: e.target.value })}
                      disabled={!row.needsSachet}
                      className="ds-input sm"
                      style={{ width: 144, textAlign: 'right' }}
                      aria-label={`Articles par sachet : ${row.name}`}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <OdooToggle
                        checked={row.needsSachet}
                        onChange={(v) => handleRowChange(row.id, { needsSachet: v })}
                      />
                      <span style={{ color: 'var(--ds-muted)' }}>{row.needsSachet ? 'Oui' : 'Non'}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {draft.categories.length === 0 && (
                <tr>
                  <td colSpan={3}><EmptyState icon={Package} title="Aucune catégorie" bare /></td>
                </tr>
              )}
            </tbody>
          </table>
        </DataPanel>
      </SettingsSection>

      <FormFooter dirty={hasChanges} onCancel={() => setDraft(toDraft(config))} onSubmit={handleSave}
        busy={saveMutation.isPending} disabled={!hasChanges} />
    </>
  );
}

type PeriodKey = '7' | '30' | '90' | 'all';

function StatsPanel() {
  const [period, setPeriod] = useState<PeriodKey>('30');

  const { dateFrom, dateTo } = useMemo(() => {
    if (period === 'all') return { dateFrom: undefined, dateTo: undefined };
    const now = new Date();
    const to = new Date(now);
    to.setDate(to.getDate() + 1); // exclusif
    const from = new Date(now);
    from.setDate(from.getDate() - parseInt(period, 10));
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }, [period]);

  const { data: report, isLoading } = useQuery({
    queryKey: ['sachet-report', period],
    queryFn: () => sachetConfigApi.report({ dateFrom, dateTo }),
  });

  const periodOptions: Array<{ key: PeriodKey; label: string }> = [
    { key: '7', label: '7 jours' },
    { key: '30', label: '30 jours' },
    { key: '90', label: '90 jours' },
    { key: 'all', label: 'Tout' },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Segmented<PeriodKey> label="Période" value={period} onChange={setPeriod} options={periodOptions} />
      </div>

      {isLoading || !report ? (
        <LoadingState bare />
      ) : (
        <>
          <SettingsSection title="Vue d'ensemble" columns={1}>
            <KpiGrid>
              <KpiCard label="Ventes" value={report.totals.salesCount} />
              <KpiCard label="Sachets remis" value={report.totals.sachetsGiven} />
              <KpiCard label="Sachets suggérés" value={report.totals.sachetsSuggested} />
              <KpiCard
                label="Sur-distribution"
                value={report.totals.overshoot}
                sub={report.totals.overshoot > 0 ? 'Plus de sachets que suggéré' : 'Conforme'}
                tone={report.totals.overshoot > 0 ? 'orange' : 'green'}
              />
            </KpiGrid>
          </SettingsSection>

          <SettingsSection title="Par vendeuse" columns={1}>
            <DataPanel label="Sachets par vendeuse">
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Vendeuse</th>
                    <th>Magasin</th>
                    <th className="ds-num">Ventes</th>
                    <th className="ds-num">Remis</th>
                    <th className="ds-num">Suggérés</th>
                    <th className="ds-num">Sur-distrib.</th>
                    <th className="ds-num">Ratio (%)</th>
                    <th>Motif principal</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perSaleswoman.length === 0 && (
                    <tr>
                      <td colSpan={8}><EmptyState icon={BarChart3} title="Aucune donnée sur cette période" bare /></td>
                    </tr>
                  )}
                  {report.perSaleswoman.map((row) => {
                    const ratioPct = row.overshootRatio > 0 ? row.overshootRatio * 100 : 0;
                    const tone: CSSProperties | undefined =
                      row.overshoot === 0 ? undefined :
                      ratioPct > 130 ? { color: 'var(--ds-danger)', fontWeight: 600 } :
                      { color: 'var(--ds-warning)', fontWeight: 600 };
                    return (
                      <tr key={row.userId}>
                        <td className="ds-strong">{row.userName}</td>
                        <td style={{ color: 'var(--ds-muted)' }}>{row.storeName ?? '—'}</td>
                        <td className="ds-num">{row.salesCount}</td>
                        <td className="ds-num">{row.sachetsGiven}</td>
                        <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{row.sachetsSuggested}</td>
                        <td className="ds-num" style={tone}>{row.overshoot}</td>
                        <td className="ds-num" style={tone}>
                          {row.sachetsSuggested > 0 ? ratioPct.toFixed(0) : '—'}
                        </td>
                        <td>
                          {row.topReason ? REASON_LABELS[row.topReason] ?? row.topReason : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataPanel>
          </SettingsSection>

          {report.reasons.length > 0 && (
            <SettingsSection title="Motifs invoqués" columns={1}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {report.reasons.map((r) => (
                  <span
                    key={r.reason}
                    className="prj-chip" style={{ cursor: 'default' }}
                  >
                    {REASON_LABELS[r.reason] ?? r.reason}
                    <small>{r.count}</small>
                  </span>
                ))}
              </div>
            </SettingsSection>
          )}
        </>
      )}
    </>
  );
}
