import { currencySymbol } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge, Loader2, AlertTriangle, Info } from 'lucide-react';
import { ingredientsApi } from '../../api/inventory.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, FormField, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Fusion de deux fiches du même ingrédient (G2-03). On choisit la fiche en trop et la fiche
 * à garder ; l'aperçu montre ce qui sera repointé (recettes, lots, bons de commande), le
 * stock additionné et le nouveau coût moyen ; la fusion ne se fait qu'après confirmation.
 * Elle est définitive : la fiche en trop est archivée dans le journal des fusions.
 */

const TABLE_LABELS: Record<string, string> = {
  recipe_ingredients: 'lignes de recette', recipe_components: 'composants de fiche', recipe_format_components: 'composants de format',
  ingredient_lots: 'lots', inventory_transactions: 'mouvements de stock', inventory: 'lignes de stock',
  purchase_order_items: 'lignes de bon de commande', reception_voucher_items: 'lignes de réception', invoice_items: 'lignes de facture',
  purchase_requests: 'demandes d\'achat', rfq_items: 'lignes de demande de prix', production_ingredient_needs: 'besoins de production',
  production_lot_usage: 'consommations de lots', production_bons_sortie_lignes: 'lignes de bon de sortie',
  stock_count_lines: 'lignes d\'inventaire physique', stock_closing_lines: 'lignes de clôture de stock',
  stock_valuation_adjustments: 'ajustements de valeur', product_recycle_destinations: 'destinations de recyclage',
};
const fmt = (n: number, digits = 2) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits });

export default function IngredientMergeCard() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');

  const { data: ingredients = [] } = useQuery<{ id: string; name: string; unit: string; unit_cost: string | number | null }[]>({
    queryKey: ['ingredients'], queryFn: ingredientsApi.list,
  });
  const options = useMemo(() => ingredients.map(i => ({
    id: i.id, label: i.name, detail: `${fmt(Number(i.unit_cost) || 0, 4)} ${currencySymbol()} / ${i.unit}`,
  })), [ingredients]);

  const ready = Boolean(sourceId && targetId && sourceId !== targetId);
  const { data: preview, isFetching, error } = useQuery({
    queryKey: ['ingredient-merge-preview', sourceId, targetId],
    queryFn: () => ingredientsApi.mergePreview(sourceId, targetId),
    enabled: ready, retry: false,
  });
  const { data: history = [] } = useQuery({ queryKey: ['ingredient-merges'], queryFn: ingredientsApi.mergeHistory });

  const merge = useMutation({
    mutationFn: () => ingredientsApi.merge(sourceId, targetId),
    onSuccess: () => {
      notify.success('Fiches fusionnées');
      setSourceId('');
      for (const key of ['ingredients', 'ingredient-merges', 'data-quality', 'inventory']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const run = async () => {
    if (!preview || preview.blocker) return;
    const ok = await confirm(`Fusionner « ${preview.source.name} » dans « ${preview.target.name} » ? La fiche « ${preview.source.name} » disparaîtra ; l'opération ne peut pas être annulée.`,
      { title: 'Fusionner deux fiches', confirmLabel: 'Fusionner', danger: true });
    if (ok) merge.mutate();
  };

  const rows = preview ? Object.entries(preview.impact.tables).sort((a, b) => b[1] - a[1]) : [];

  return (
    <section className="ds-panel" style={{ padding: '16px 18px', display: 'grid', gap: 14 }} aria-label="Fusionner deux fiches du même ingrédient">
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><GitMerge size={16} aria-hidden="true" /> Fusionner deux fiches du même ingrédient</span>} />
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ds-muted)' }}>
        Les recettes, les lots, les bons de commande et le stock de la fiche en trop passent sur la fiche gardée ; son coût devient la moyenne
        des deux, pondérée par les stocks. Les deux fiches doivent avoir la même unité.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <FormField label="Fiche en trop" required hint="Elle disparaîtra après la fusion.">
          <SearchSelect options={options.filter(o => o.id !== targetId)} value={sourceId} onChange={setSourceId}
            placeholder="Choisir la fiche en trop" size="md" width="100%" ariaLabel="Fiche en trop" />
        </FormField>
        <FormField label="Fiche à garder" required>
          <SearchSelect options={options.filter(o => o.id !== sourceId)} value={targetId} onChange={setTargetId}
            placeholder="Choisir la fiche à garder" size="md" width="100%" ariaLabel="Fiche à garder" />
        </FormField>
      </div>

      {ready && isFetching && <LoadingState bare label="Calcul de l'aperçu…" />}
      {ready && error != null && <StatusBanner tone="danger" icon={AlertTriangle} title="Aperçu impossible">{apiErrorMessage(error)}</StatusBanner>}

      {ready && preview && !isFetching && (
        preview.blocker ? (
          <StatusBanner tone="warning" icon={AlertTriangle} title="Fusion impossible en l'état">{preview.blocker}</StatusBanner>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <StatusBanner tone="info" icon={Info} title="Ce que fera la fusion">
              {preview.impact.recipes} fiche{preview.impact.recipes > 1 ? 's' : ''} technique{preview.impact.recipes > 1 ? 's' : ''},{' '}
              {preview.impact.lots} lot{preview.impact.lots > 1 ? 's' : ''} et {preview.impact.purchaseOrders} bon{preview.impact.purchaseOrders > 1 ? 's' : ''} de commande
              {' '}passeront sur « {preview.target.name} ». Coût unitaire : {fmt(preview.impact.unitCostBefore, 4)} → <strong>{fmt(preview.impact.unitCostAfter, 4)} {currencySymbol()} / {preview.target.unit}</strong>.
            </StatusBanner>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12, alignItems: 'start' }}>
              <DataPanel label="Stock par établissement">
              <table className="odoo-table" style={{ width: '100%' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Établissement</th><th className="ds-num">Fiche en trop ({preview.source.unit})</th><th className="ds-num">Fiche gardée ({preview.target.unit})</th><th className="ds-num">Après ({preview.target.unit})</th></tr></thead>
                <tbody>
                  {preview.impact.stock.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ds-muted)' }}>Aucun stock sur ces deux fiches.</td></tr>}
                  {preview.impact.stock.map(s => (
                    <tr key={s.storeId}>
                      <td className="ds-strong">{s.storeName}</td>
                      <td className="ds-num">{fmt(s.source, 3)}</td>
                      <td className="ds-num">{fmt(s.target, 3)}</td>
                      <td className="ds-num ds-strong">{fmt(s.source + s.target, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </DataPanel>
              <DataPanel label="Références repointées">
              <table className="odoo-table" style={{ width: '100%' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Références repointées</th><th className="ds-num">Lignes</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--ds-muted)' }}>La fiche en trop n'est utilisée nulle part.</td></tr>}
                  {rows.map(([table, n]) => (
                    <tr key={table}><td>{TABLE_LABELS[table] ?? table}</td><td className="ds-num">{n.toLocaleString('fr-FR')}</td></tr>
                  ))}
                </tbody>
              </table>
              </DataPanel>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="odoo-btn-primary" disabled={merge.isPending} onClick={() => void run()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {merge.isPending ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />} Fusionner
              </button>
            </div>
          </div>
        )
      )}

      {history.length > 0 && (
        <div>
          <SectionHeader title="Dernières fusions" />
          <DataPanel label="Dernières fusions">
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Date</th><th style={{ textAlign: 'left' }}>Fiche retirée</th><th style={{ textAlign: 'left' }}>Fiche gardée</th><th className="ds-num">Coût unitaire ({currencySymbol()})</th><th style={{ textAlign: 'left' }}>Par</th></tr></thead>
            <tbody>
              {history.slice(0, 10).map(h => (
                <tr key={h.id}>
                  <td>{new Date(h.merged_at).toLocaleDateString('fr-FR')}</td>
                  <td>{h.source_name}</td>
                  <td className="ds-strong">{h.target_name}</td>
                  <td className="ds-num">{fmt(Number(h.unit_cost_before) || 0, 4)} → {fmt(Number(h.unit_cost_after) || 0, 4)}</td>
                  <td>{h.merged_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </DataPanel>
        </div>
      )}
    </section>
  );
}
