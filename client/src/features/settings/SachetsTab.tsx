import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Info, BarChart3, Settings as SettingsIcon } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { sachetConfigApi, type SachetConfig } from '../../api/sachet-config.api';
import { SettingsSection, SettingItem, OdooToggle } from './SettingsPrimitives';

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
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 max-w-xs mb-6">
        <button
          onClick={() => setSub('config')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            sub === 'config' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <SettingsIcon size={15} /> Configuration
        </button>
        <button
          onClick={() => setSub('stats')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            sub === 'stats' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <BarChart3 size={15} /> Statistiques
        </button>
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
    return <p className="text-sm text-gray-500">Chargement...</p>;
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
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2 text-sm text-blue-900 mb-6">
        <Info size={16} className="flex-shrink-0 mt-0.5" />
        <p>
          Le ratio est un <strong>seuil</strong> : 1 sachet est suggéré par tranche complète
          d'articles. Avec un ratio de 15, il faut 15 viennoiseries pour 1 sachet (1 à 14 → 0,
          15 à 29 → 1, etc.). Désactivez "Nécessite un sachet" pour les produits déjà emballés
          (bouteilles, sachets madeleine conditionnés...).
        </p>
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
            className="input w-32"
          />
        </SettingItem>
      </SettingsSection>

      <SettingsSection title="Ratio par catégorie" columns={1}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Catégorie</th>
                <th className="py-2 pr-4 font-medium">Articles / sachet</th>
                <th className="py-2 pr-4 font-medium">Nécessite un sachet</th>
              </tr>
            </thead>
            <tbody>
              {draft.categories.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2.5 pr-4 text-gray-800 font-medium">{row.name}</td>
                  <td className="py-2.5 pr-4">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder={`défaut (${draft.defaultArticlesPerSachet})`}
                      value={row.articlesPerSachet}
                      onChange={(e) => handleRowChange(row.id, { articlesPerSachet: e.target.value })}
                      disabled={!row.needsSachet}
                      className="input w-36 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <OdooToggle
                        checked={row.needsSachet}
                        onChange={(v) => handleRowChange(row.id, { needsSachet: v })}
                      />
                      <span className="text-sm text-gray-500">{row.needsSachet ? 'Oui' : 'Non'}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {draft.categories.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-gray-400 text-sm">
                    Aucune catégorie.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
          className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60"
        >
          <Save size={16} />
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
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
      <div className="flex items-center justify-end mb-4">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {periodOptions.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                period === p.key ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !report ? (
        <p className="text-sm text-gray-500">Chargement...</p>
      ) : (
        <>
          <SettingsSection title="Vue d'ensemble" columns={1}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPI label="Ventes" value={report.totals.salesCount} />
              <KPI label="Sachets remis" value={report.totals.sachetsGiven} />
              <KPI label="Sachets suggérés" value={report.totals.sachetsSuggested} />
              <KPI
                label="Sur-distribution"
                value={report.totals.overshoot}
                tone={report.totals.overshoot > 0 ? 'warning' : 'ok'}
              />
            </div>
          </SettingsSection>

          <SettingsSection title="Par vendeuse" columns={1}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-4 font-medium">Vendeuse</th>
                    <th className="py-2 pr-4 font-medium">Magasin</th>
                    <th className="py-2 pr-4 font-medium text-right">Ventes</th>
                    <th className="py-2 pr-4 font-medium text-right">Remis</th>
                    <th className="py-2 pr-4 font-medium text-right">Suggérés</th>
                    <th className="py-2 pr-4 font-medium text-right">Sur-distrib.</th>
                    <th className="py-2 pr-4 font-medium text-right">Ratio</th>
                    <th className="py-2 pr-4 font-medium">Motif principal</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perSaleswoman.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-gray-400 text-sm">
                        Aucune donnée sur cette période.
                      </td>
                    </tr>
                  )}
                  {report.perSaleswoman.map((row) => {
                    const ratioPct = row.overshootRatio > 0 ? row.overshootRatio * 100 : 0;
                    const tone =
                      row.overshoot === 0 ? 'text-gray-700' :
                      ratioPct > 130 ? 'text-red-600 font-semibold' :
                      'text-amber-600 font-semibold';
                    return (
                      <tr key={row.userId} className="border-b border-gray-100 last:border-0">
                        <td className="py-2.5 pr-4 text-gray-800 font-medium">{row.userName}</td>
                        <td className="py-2.5 pr-4 text-gray-500">{row.storeName ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-right">{row.salesCount}</td>
                        <td className="py-2.5 pr-4 text-right">{row.sachetsGiven}</td>
                        <td className="py-2.5 pr-4 text-right text-gray-500">{row.sachetsSuggested}</td>
                        <td className={`py-2.5 pr-4 text-right ${tone}`}>{row.overshoot}</td>
                        <td className={`py-2.5 pr-4 text-right ${tone}`}>
                          {row.sachetsSuggested > 0 ? `${ratioPct.toFixed(0)}%` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600">
                          {row.topReason ? REASON_LABELS[row.topReason] ?? row.topReason : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SettingsSection>

          {report.reasons.length > 0 && (
            <SettingsSection title="Motifs invoqués" columns={1}>
              <div className="flex flex-wrap gap-2">
                {report.reasons.map((r) => (
                  <span
                    key={r.reason}
                    className="inline-flex items-center gap-2 bg-amber-50 text-amber-800 text-xs font-medium px-3 py-1.5 rounded-full"
                  >
                    {REASON_LABELS[r.reason] ?? r.reason}
                    <span className="bg-white px-1.5 py-0.5 rounded-full font-semibold">{r.count}</span>
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

function KPI({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warning' }) {
  const color =
    tone === 'warning' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : 'text-gray-800';
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
