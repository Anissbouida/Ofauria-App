import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, Loader2, RefreshCw, Check } from 'lucide-react';
import { inventoryApi, type ReorderPointRow } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { ListToolbar, FilterChips, ListPanel, ListEmpty } from '../sales/ListTemplate';
import './stock.css';

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
      className="input" style={{ width: 90, textAlign: 'right', padding: '2px 6px' }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = raw === '' ? null : Number(raw.replace(',', '.'));
        if (field !== 'maxStock' && v == null) return;
        if (v === value) return;
        update.mutate({ id: r.id, patch: { [field]: v } });
      }} />
  );

  if (isLoading || !data) return <ListEmpty icon={Loader2} title="Chargement…" />;

  return (
    <div className="stk-stack">
      <StatusBanner tone="info" icon={Gauge} title="Points de commande">
        Point de commande = consommation moyenne des {data.params.usage_days} derniers jours × délai du fournisseur + stock de sécurité.
        Sous ce point, l'article apparaît dans « À commander », qui propose de remonter jusqu'au maximum (à défaut, deux fois le point de commande).
        Mode « calculé » : mis à jour chaque semaine. Mode « manuel » : le recalcul propose, vous validez.
      </StatusBanner>

      <ListToolbar search={query} onSearch={setQuery} placeholder="Rechercher un article">
        <span className="stk-grow" />
        <button type="button" className="odoo-btn-secondary" disabled={recalc.isPending} onClick={() => recalc.mutate()}>
          {recalc.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Recalculer
        </button>
        <button type="button" className="odoo-btn-primary" disabled={!selected.size || apply.isPending} onClick={() => apply.mutate([...selected])}>
          <Check size={14} /> Valider les propositions ({selected.size})
        </button>
      </ListToolbar>

      <FilterChips label="Filtrer les points de commande" value={onlyProposals ? 'proposals' : ''} onChange={k => setOnlyProposals(k === 'proposals')} chips={[
        { key: '', label: 'Tous les articles', count: data.rows.length },
        { key: 'proposals', label: 'Propositions à valider', count: proposals.length },
      ]} />

      <ListPanel>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Choisir toutes les propositions"
                  checked={proposals.length > 0 && proposals.every(p => selected.has(p.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(proposals.map(p => p.id)) : new Set())} />
              </th>
              <th>Article</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th style={{ textAlign: 'right' }}>Conso. / jour</th>
              <th style={{ textAlign: 'right' }}>Délai (j)</th>
              <th style={{ textAlign: 'right' }}>Sécurité</th>
              <th style={{ textAlign: 'right' }}>Point de commande</th>
              <th style={{ textAlign: 'right' }}>Proposé</th>
              <th style={{ textAlign: 'right' }}>Maximum</th>
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
                  <span style={{ fontWeight: 500 }}>{r.ingredient_name}</span>
                  {r.below && <span style={{ marginLeft: 6 }}><StatusTag tone="todo" label="Sous le point" /></span>}
                </td>
                <td style={{ textAlign: 'right' }}>{n(r.current_quantity)} {r.unit}</td>
                <td style={{ textAlign: 'right' }}>{n(r.avg_daily_usage)}</td>
                <td style={{ textAlign: 'right' }} title={r.lead_from_supplier ? 'Délai du fournisseur' : 'Délai par défaut (aucun délai fournisseur renseigné)'}>
                  {r.lead_days}{r.lead_from_supplier ? '' : ' *'}
                </td>
                <td style={{ textAlign: 'right' }}>{numberCell(r, 'safetyStock', r.safety_stock, r.replenish_mode === 'calcule')}</td>
                <td style={{ textAlign: 'right' }}>{numberCell(r, 'reorderPoint', r.reorder_point, r.replenish_mode === 'calcule')}</td>
                <td style={{ textAlign: 'right', color: hasProposal(r) ? 'var(--odoo-text)' : 'var(--odoo-text-muted)' }}>{n(r.proposed_reorder_point ?? r.live_reorder_point)}</td>
                <td style={{ textAlign: 'right' }}>{numberCell(r, 'maxStock', r.max_stock)}</td>
                <td>
                  <select className="input" value={r.replenish_mode} aria-label={`Mode de ${r.ingredient_name}`} style={{ padding: '2px 6px', width: 'auto' }}
                    onChange={e => update.mutate({ id: r.id, patch: { mode: e.target.value as 'manuel' | 'calcule' } })}>
                    <option value="manuel">Manuel</option>
                    <option value="calcule">Calculé</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListPanel>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
        * Délai par défaut ({data.params.default_lead_days} j) : renseignez le délai sur la fiche article × fournisseur pour un calcul juste.
      </p>
    </div>
  );
}
