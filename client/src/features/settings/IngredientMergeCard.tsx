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
    const ok = await confirm(
      `Fusionner « ${preview.source.name} » dans « ${preview.target.name} » ? La fiche « ${preview.source.name} » disparaîtra ; l'opération ne peut pas être annulée.`,
      { title: 'Fusionner deux fiches', confirmLabel: 'Fusionner', danger: true });
    if (ok) merge.mutate();
  };

  const rows = preview ? Object.entries(preview.impact.tables).sort((a, b) => b[1] - a[1]) : [];

  return (
    <section className="prj-panel" style={{ padding: '16px 18px', display: 'grid', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
        <GitMerge size={16} /> Fusionner deux fiches du même ingrédient
      </h3>
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>
        Les recettes, les lots, les bons de commande et le stock de la fiche en trop passent sur la fiche gardée ; son coût devient la moyenne
        des deux, pondérée par les stocks. Les deux fiches doivent avoir la même unité.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.82rem' }}>
          <span style={{ fontWeight: 500 }}>Fiche en trop (elle disparaîtra)</span>
          <SearchSelect options={options.filter(o => o.id !== targetId)} value={sourceId} onChange={setSourceId}
            placeholder="Choisir la fiche en trop" size="md" width="100%" ariaLabel="Fiche en trop" />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.82rem' }}>
          <span style={{ fontWeight: 500 }}>Fiche à garder</span>
          <SearchSelect options={options.filter(o => o.id !== sourceId)} value={targetId} onChange={setTargetId}
            placeholder="Choisir la fiche à garder" size="md" width="100%" ariaLabel="Fiche à garder" />
        </label>
      </div>

      {ready && isFetching && <div><Loader2 size={16} className="animate-spin" /></div>}
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
              <table className="odoo-table" style={{ width: '100%' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Établissement</th><th style={{ textAlign: 'right' }}>Fiche en trop</th><th style={{ textAlign: 'right' }}>Fiche gardée</th><th style={{ textAlign: 'right' }}>Après</th></tr></thead>
                <tbody>
                  {preview.impact.stock.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--theme-text-muted)' }}>Aucun stock sur ces deux fiches.</td></tr>}
                  {preview.impact.stock.map(s => (
                    <tr key={s.storeId}>
                      <td>{s.storeName}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.source, 3)} {preview.source.unit}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.target, 3)} {preview.target.unit}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(s.source + s.target, 3)} {preview.target.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="odoo-table" style={{ width: '100%' }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Références repointées</th><th style={{ textAlign: 'right' }}>Lignes</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--theme-text-muted)' }}>La fiche en trop n'est utilisée nulle part.</td></tr>}
                  {rows.map(([table, n]) => (
                    <tr key={table}><td>{TABLE_LABELS[table] ?? table}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('fr-FR')}</td></tr>
                  ))}
                </tbody>
              </table>
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
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--theme-text-strong)', margin: '4px 0' }}>Dernières fusions</h4>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Date</th><th style={{ textAlign: 'left' }}>Fiche retirée</th><th style={{ textAlign: 'left' }}>Fiche gardée</th><th style={{ textAlign: 'right' }}>Coût</th><th style={{ textAlign: 'left' }}>Par</th></tr></thead>
            <tbody>
              {history.slice(0, 10).map(h => (
                <tr key={h.id}>
                  <td>{new Date(h.merged_at).toLocaleDateString('fr-FR')}</td>
                  <td>{h.source_name}</td>
                  <td>{h.target_name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(h.unit_cost_before) || 0, 4)} → {fmt(Number(h.unit_cost_after) || 0, 4)}</td>
                  <td>{h.merged_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
