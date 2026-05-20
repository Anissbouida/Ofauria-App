import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Info, History } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { productionMarkupApi, type MarkupConfig } from '../../api/production-markup.api';
import { SettingsSection, SettingItem } from './SettingsPrimitives';

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
    return <p className="text-sm text-gray-500">Chargement...</p>;
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
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2 text-sm text-blue-900 mb-6">
        <Info size={16} className="flex-shrink-0 mt-0.5" />
        <p>
          La majoration est appliquée aux quantités suggérées de l'approvisionnement (ventes
          du même jour la semaine précédente) pour absorber les aléas de demande. Laissez le
          champ d'une catégorie <strong>vide</strong> pour qu'elle utilise le taux global.
        </p>
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
            className="input w-32"
          />
        </SettingItem>
      </SettingsSection>

      <SettingsSection title="Majoration par catégorie" columns={1}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Catégorie</th>
                <th className="py-2 pr-4 font-medium">Majoration personnalisée (%)</th>
                <th className="py-2 pr-4 font-medium">Taux effectif</th>
              </tr>
            </thead>
            <tbody>
              {draft.categories.map((row) => {
                const custom = row.percent.trim() !== '' ? parseFloat(row.percent.replace(',', '.')) : null;
                const effective = custom != null && Number.isFinite(custom)
                  ? custom
                  : (Number.isFinite(globalNum) ? globalNum : 0);
                return (
                  <tr key={row.categoryId} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-800">{row.categoryName}</td>
                    <td className="py-2 pr-4">
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
                        className="input w-40"
                      />
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {effective} %{custom == null ? ' (global)' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <div className="flex justify-end mb-8">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
          className="btn-primary flex items-center gap-2 disabled:opacity-40"
        >
          <Save size={16} />
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      <SettingsSection title="Historique des modifications" columns={1}>
        {config.history.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune modification enregistrée.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Portée</th>
                  <th className="py-2 pr-4 font-medium">Ancien → Nouveau</th>
                  <th className="py-2 pr-4 font-medium">Par</th>
                </tr>
              </thead>
              <tbody>
                {config.history.map((h, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-500">
                      {new Date(h.changed_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {h.scope === 'global' ? 'Global' : (h.category_name || 'Catégorie')}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      <History size={11} className="inline -mt-0.5 mr-1 text-gray-400" />
                      {fmtPct(h.old_percent)} → <strong>{fmtPct(h.new_percent)}</strong>
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{h.changed_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
