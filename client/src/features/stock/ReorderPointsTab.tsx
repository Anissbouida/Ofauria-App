import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, Loader2, RefreshCw, Check } from 'lucide-react';
import { inventoryApi, type ReorderPointRow } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { ListToolbar, FilterChips } from '../sales/ListTemplate';
import './stock.css';
import { HeaderActions } from './StockUi';
import { DataPanel, EmptyState, LoadingState, NoResultState, TableFooter } from '../../components/ds';

/**
 * Stock › Paramétrage › Points de commande (G5-02, mig 550).
 *
 * Par article : consommation moyenne, délai du fournisseur, stock de sécurité, point de
 * commande (le seuil d'alerte) et maximum. En mode « calculé », le recalcul hebdomadaire
 * met le point de commande à jour ; en mode « manuel », il pose une proposition que l'on
 * valide ici — jamais appliquée d'office.
 */
const n = (v: number | null | undefined, d = 3) => v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: d });

export default function ReorderPointsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['reorder-points'], queryFn: inventoryApi.reorderPoints });
  const [query, setQuery] = useState('');
  const [onlyProposals, setOnlyProposals] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reorder-points'] });
  const recalc = useMutation({
    mutationFn: inventoryApi.reorderRecalculate,
    onSuccess: (r) => { invalidate(); notify.success(`${r.applied} point(s) mis à jour (mode calculé) · ${r.proposed} proposition(s) à valider`); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: (ids: string[]) => inventoryApi.reorderApply(ids),
    onSuccess: (r) => { invalidate(); setSelected(new Set()); notify.success(`${r.applied} proposition(s) appliquée(s)`); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof inventoryApi.reorderUpdate>[1] }) => inventoryApi.reorderUpdate(id, patch),
    onSuccess: () => invalidate(),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const hasProposal = (r: ReorderPointRow) => r.replenish_mode === 'manuel' && r.proposed_reorder_point != null
    && Math.abs(r.proposed_reorder_point - r.reorder_point) > 0.0005;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter(r => (!q || r.ingredient_name.toLowerCase().includes(q)) && (!onlyProposals || hasProposal(r)));
  }, [data, query, onlyProposals]);
  const proposals = (data?.rows ?? []).filter(hasProposal);

  const numberCell = (r: ReorderPointRow, field: 'reorderPoint' | 'safetyStock' | 'maxStock', value: number | null, disabled = false) => (
    <input type="number" min={0} step="any" defaultValue={value ?? ''} disabled={disabled || update.isPending}
      aria-label={`${field === 'reorderPoint' ? 'Point de commande' : field === 'safetyStock' ? 'Stock de sécurité' : 'Maximum'} de ${r.ingredient_name}`}
      className="ds-input sm ds-num" style={{ width: 90 }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = raw === '' ? null : Number(raw.replace(',', '.'));
        if (field !== 'maxStock' && v == null) return;
        if (v === value) return;
        update.mutate({ id: r.id, patch: { [field]: v } });
      }} />
  );

  if (isLoading || !data) return <LoadingState label="Chargement des points de commande…" />;

  return (
    <div className="stk-stack">
      <StatusBanner tone="info" icon={Gauge} title="Points de commande">
        Point de commande = consommation moyenne des {data.params.usage_days} derniers jours × délai du fournisseur + stock de sécurité.
        Sous ce point, l'article apparaît dans « À commander », qui propose de remonter jusqu'au maximum (à défaut, deux fois le point de commande).
        Mode « calculé » : mis à jour chaque semaine. Mode « manuel » : le recalcul propose, vous validez.
      </StatusBanner>

      <HeaderActions>
        <button type="button" className="odoo-btn-secondary" disabled={recalc.isPending} aria-busy={recalc.isPending || undefined} onClick={() => recalc.mutate()}>
          {recalc.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Recalculer
        </button>
        <button type="button" className="odoo-btn-primary" disabled={!selected.size || apply.isPending} onClick={() => apply.mutate([...selected])}>
          <Check size={14} aria-hidden="true" /> Valider les propositions ({selected.size})
        </button>
      </HeaderActions>

      <FilterChips label="Filtrer les points de commande" value={onlyProposals ? 'proposals' : ''} onChange={k => setOnlyProposals(k === 'proposals')} chips={[
        { key: '', label: 'Tous les articles', count: data.rows.length },
        { key: 'proposals', label: 'Propositions à valider', count: proposals.length },
      ]} />

      <ListToolbar search={query} onSearch={setQuery} placeholder="Rechercher un article" />

      {rows.length === 0 ? (
        (query || onlyProposals)
          ? <NoResultState text="Aucun article ne correspond aux filtres." onReset={() => { setQuery(''); setOnlyProposals(false); }} />
          : <EmptyState icon={Gauge} title="Aucun article suivi" text="Les articles stockés apparaîtront ici avec leur point de commande." />
      ) : (
      <DataPanel label="Points de commande" footer={<TableFooter note={`${rows.length} article${rows.length > 1 ? 's' : ''} · ${proposals.length} proposition${proposals.length > 1 ? 's' : ''} à valider`} />}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Choisir toutes les propositions"
                  checked={proposals.length > 0 && proposals.every(p => selected.has(p.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(proposals.map(p => p.id)) : new Set())} />
              </th>
              <th>Article</th>
              <th className="ds-num">Stock</th>
              <th className="ds-num">Conso. / jour</th>
              <th className="ds-num">Délai (j)</th>
              <th className="ds-num">Sécurité</th>
              <th className="ds-num">Point de commande</th>
              <th className="ds-num">Proposé</th>
              <th className="ds-num">Maximum</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{hasProposal(r) && (
                  <input type="checkbox" aria-label={`Valider la proposition pour ${r.ingredient_name}`} checked={selected.has(r.id)}
                    onChange={e => setSelected(s => { const x = new Set(s); if (e.target.checked) x.add(r.id); else x.delete(r.id); return x; })} />
                )}</td>
                <td>
                  <span className="ds-strong">{r.ingredient_name}</span>
                  {r.below && <span style={{ marginLeft: 6 }}><StatusTag tone="todo" label="Sous le point" /></span>}
                </td>
                <td className="ds-num">{n(r.current_quantity)} {r.unit}</td>
                <td className="ds-num">{n(r.avg_daily_usage)}</td>
                <td className="ds-num" title={r.lead_from_supplier ? 'Délai du fournisseur' : 'Délai par défaut (aucun délai fournisseur renseigné)'}>
                  {r.lead_days}{r.lead_from_supplier ? '' : ' *'}
                </td>
                <td className="ds-num">{numberCell(r, 'safetyStock', r.safety_stock, r.replenish_mode === 'calcule')}</td>
                <td className="ds-num">{numberCell(r, 'reorderPoint', r.reorder_point, r.replenish_mode === 'calcule')}</td>
                <td className="ds-num" style={{ color: hasProposal(r) ? 'var(--ds-ink)' : 'var(--ds-muted)' }}>{n(r.proposed_reorder_point ?? r.live_reorder_point)}</td>
                <td className="ds-num">{numberCell(r, 'maxStock', r.max_stock)}</td>
                <td>
                  <select className="ds-input sm" value={r.replenish_mode} aria-label={`Mode de ${r.ingredient_name}`} style={{ width: 'auto' }}
                    onChange={e => update.mutate({ id: r.id, patch: { mode: e.target.value as 'manuel' | 'calcule' } })}>
                    <option value="manuel">Manuel</option>
                    <option value="calcule">Calculé</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
      )}
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-muted)' }}>
        * Délai par défaut ({data.params.default_lead_days} j) : renseignez le délai sur la fiche article × fournisseur pour un calcul juste.
      </p>
    </div>
  );
}
