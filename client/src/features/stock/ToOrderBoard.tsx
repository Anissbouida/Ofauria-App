import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, AlertTriangle, ShoppingCart, CheckCircle2, Plus, ClipboardList, TrendingDown, Hourglass, Send,
} from 'lucide-react';
import { purchaseRequestsApi, type ToOrderRow } from '../../api/purchase-requests.api';
import { suppliersApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { Toolbar, SearchBar, DataPanel, BulkBar, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState } from '../../components/ds';
import SearchSelect from '../../components/ui/SearchSelect';
import { fmtQty } from './types';
import { FilterChips } from '../sales/ListTemplate';
import './stock.css';
import { money, currencySymbol } from '../../utils/money';

/**
 * Stock › « À commander » : l'unique écran des besoins d'achat (remplace la Liste
 * d'attente des Achats). Ruptures des bons de sortie, demandes en attente et stock
 * sous le seuil, fusionnés par ingrédient, déduction faite de ce qui est déjà en
 * commande.
 *
 * Flux procure-to-pay (mig 456) : l'action unique, pour TOUS les rôles, est
 * « Créer la demande d'achat ». Le chemin « BC direct » est supprimé. La DA créée
 * passe par l'approbation (selon les règles configurées) ; une fois approuvée,
 * elle devient un bon de commande depuis Achats › Demande d'achat.
 */

type Source = 'all' | 'rupture' | 'request' | 'low' | 'covered';
type LineState = { selected: boolean; qty: string; supplierId: string };
type ManualRow = ToOrderRow & { manual: true };

const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function reasonOf(r: ToOrderRow | ManualRow): 'production' | 'manual' | 'stock_bas' {
  if ('manual' in r) return 'manual';
  if (r.rupture_qty > 0) return 'production';
  if (r.request_qty > 0) return 'manual';
  return 'stock_bas';
}

export function ToOrderBoard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [source, setSource] = useState<Source>('all');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);
  const [addIngredient, setAddIngredient] = useState('');

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['to-order'], queryFn: purchaseRequestsApi.toOrder, refetchInterval: 60000 });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'active'], queryFn: suppliersApi.listActive });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });
  const [searchParams, setSearchParams] = useSearchParams();

  const rows: Array<ToOrderRow | ManualRow> = useMemo(() => [...manualRows, ...(data?.rows ?? [])], [data, manualRows]);
  const supplierOptions = useMemo(
    () => (suppliers as Record<string, any>[]).map(s => ({ id: s.id as string, label: s.name as string })).sort((a, b) => a.label.localeCompare(b.label)),
    [suppliers],
  );
  // État de saisie par ligne, initialisé une fois par ingrédient (on n'écrase pas la saisie au rafraîchissement).
  useEffect(() => {
    setLines(prev => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.ingredient_id]) continue;
        next[r.ingredient_id] = {
          selected: !r.covered && r.priority === 1,
          qty: r.suggested_qty > 0 ? String(r.suggested_qty) : '',
          supplierId: r.supplier_id ?? '',
        };
      }
      return next;
    });
  }, [rows]);

  const counts = useMemo(() => ({
    rupture: rows.filter(r => !r.covered && r.rupture_qty > 0).length,
    request: rows.filter(r => !r.covered && r.request_qty > 0).length,
    low: rows.filter(r => !r.covered && r.low_stock).length,
    covered: rows.filter(r => r.covered).length,
    open: rows.filter(r => !r.covered).length,
  }), [rows]);

  const visible = rows.filter(r => {
    if (source === 'covered') { if (!r.covered) return false; }
    else {
      if (r.covered) return false;
      if (source === 'rupture' && !(r.rupture_qty > 0)) return false;
      if (source === 'request' && !(r.request_qty > 0)) return false;
      if (source === 'low' && !r.low_stock) return false;
    }
    if (search && !r.ingredient_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const patch = (id: string, p: Partial<LineState>) => setLines(prev => ({ ...prev, [id]: { ...prev[id], ...p } }));
  const selectedRows = rows.filter(r => !r.covered && lines[r.ingredient_id]?.selected && (parseFloat(lines[r.ingredient_id].qty) || 0) > 0);
  let estimated = 0;
  for (const r of selectedRows) {
    const l = lines[r.ingredient_id];
    estimated += (parseFloat(l.qty) || 0) * (r.unit_price ?? 0);
  }
  const allVisibleSelected = visible.length > 0 && visible.filter(r => !r.covered).every(r => lines[r.ingredient_id]?.selected);
  const toggleAll = () => {
    const v = !allVisibleSelected;
    setLines(prev => {
      const next = { ...prev };
      for (const r of visible) if (!r.covered && next[r.ingredient_id]) next[r.ingredient_id] = { ...next[r.ingredient_id], selected: v };
      return next;
    });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['to-order'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-rupture-requests'] });
  };
  const resetSelection = (ids: string[]) => {
    setLines(prev => { const next = { ...prev }; for (const id of ids) delete next[id]; return next; });
    setManualRows(prev => prev.filter(m => !ids.includes(m.ingredient_id)));
  };

  // Flux procure-to-pay (mig 456) : l'action unique crée des DEMANDES D'ACHAT
  // (plus de BC direct). La demande porte le complément au-delà de ce qui est déjà
  // demandé, pour ne pas compter deux fois un besoin déjà exprimé. Chaque DA passe
  // ensuite par l'approbation ; au moins une peut requérir un accord selon les règles.
  const [createdRequests, setCreatedRequests] = useState<{ count: number; pending: number } | null>(null);
  const requestMutation = useMutation({
    mutationFn: async () => {
      let createdCount = 0;
      let pendingCount = 0;
      for (const r of selectedRows) {
        const l = lines[r.ingredient_id];
        const extra = (parseFloat(l.qty) || 0) - r.request_qty;
        if (extra <= 0) continue;
        const res = await purchaseRequestsApi.create({
          ingredientId: r.ingredient_id, quantity: Math.round(extra * 1000) / 1000, unit: r.unit || 'kg',
          reason: reasonOf(r), supplierId: l.supplierId || null,
          note: r.rupture_refs.length ? `Rupture ${r.rupture_refs.join(', ')}` : r.low_stock ? `Stock bas : ${fmtQty(r.low_stock.current)} ${r.unit} (seuil ${fmtQty(r.low_stock.threshold)})` : undefined,
        });
        createdCount++;
        if (res?.approval_status === 'pending') pendingCount++;
      }
      return { count: createdCount, pending: pendingCount };
    },
    onSuccess: ({ count, pending }) => {
      resetSelection(selectedRows.map(r => r.ingredient_id));
      refresh();
      if (!count) { notify.success('Déjà demandé'); return; }
      setCreatedRequests({ count, pending });
      notify.success(`${count} demande${count > 1 ? 's' : ''} d'achat créée${count > 1 ? 's' : ''}`);
    },
    onError: (e) => { refresh(); notify.error(apiErrorMessage(e, 'Demande impossible')); },
  });

  const addManual = (id: string) => {
    setAddIngredient('');
    if (!id || rows.some(r => r.ingredient_id === id)) return;
    const ing = (ingredients as Record<string, any>[]).find(i => i.id === id);
    if (!ing) return;
    setManualRows(prev => [{
      manual: true, ingredient_id: id, ingredient_name: ing.name, unit: ing.unit || 'kg',
      rupture_qty: 0, rupture_refs: [], request_qty: 0, request_ids: [], requesters: [], low_stock: null,
      on_order_qty: 0, on_order_refs: [], suggested_qty: 0, covered: false,
      supplier_id: null, last_supplier_id: null, last_supplier_name: null,
      unit_price: ing.unit_cost != null ? parseFloat(ing.unit_cost) : null, last_order_date: null, priority: 2,
    }, ...prev]);
    setLines(prev => ({ ...prev, [id]: { selected: true, qty: '', supplierId: '' } }));
  };

  // « Commander » depuis une ligne du stock (?add=<ingredient>) : l'article est ajouté et sélectionné.
  const addParam = searchParams.get('add');
  useEffect(() => {
    if (!addParam || !data || (ingredients as unknown[]).length === 0) return;
    if (rows.some(r => r.ingredient_id === addParam)) {
      patch(addParam, { selected: true });
      setSearch('');
      setSource('all');
    } else {
      addManual(addParam);
    }
    searchParams.delete('add');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addParam, data, ingredients]);

  const cards: Array<{ key: Source; label: string; hint: string; count: number; icon: typeof AlertTriangle }> = [
    { key: 'all', label: 'À commander', hint: 'besoins non couverts', count: counts.open, icon: ShoppingCart },
    { key: 'rupture', label: 'Ruptures', hint: 'la production attend', count: counts.rupture, icon: AlertTriangle },
    { key: 'request', label: 'Demandes', hint: 'saisies par l\'équipe', count: counts.request, icon: ClipboardList },
    { key: 'low', label: 'Stock bas', hint: 'sous le seuil minimum', count: counts.low, icon: TrendingDown },
    { key: 'covered', label: 'Déjà en commande', hint: 'couverts par un BC', count: counts.covered, icon: Hourglass },
  ];

  if (isLoading) return <LoadingState label="Chargement des besoins…" />;
  if (isError) return <ErrorState error={error} title="Les besoins n'ont pas pu être chargés" text={apiErrorMessage(error, 'Erreur inconnue')} />;

  const clearSelection = () => setLines(prev => Object.fromEntries(Object.entries(prev).map(([id, l]) => [id, { ...l, selected: false }])));
  const muted: React.CSSProperties = { color: 'var(--ds-muted)', fontSize: 12, fontWeight: 400 };
  // Barre de sélection : l'action unique « Créer la demande d'achat » porte sur les lignes cochées.
  const bulk = (
    <BulkBar count={selectedRows.length} noun="ligne" onClear={clearSelection}
      detail={<>{estimated > 0 ? <>estimé <strong>{money(estimated)}</strong> · </> : null}fournisseur facultatif, soumis à approbation selon les règles</>}>
      <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={requestMutation.isPending} onClick={() => requestMutation.mutate()}>
        {requestMutation.isPending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
        Créer la demande d'achat
      </button>
    </BulkBar>
  );

  return (
    <>
      {createdRequests && (
        <StatusBanner tone="success" icon={CheckCircle2}
          title={`${createdRequests.count} demande${createdRequests.count > 1 ? 's' : ''} d'achat créée${createdRequests.count > 1 ? 's' : ''}`}
          actions={
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/purchasing?tab=purchase_requests')}>Voir les demandes</button>
          }>
          {createdRequests.pending > 0
            ? `${createdRequests.pending} en attente d'approbation. Une fois approuvée, la demande devient un bon de commande depuis Achats › Demande d'achat.`
            : "Approuvées d'office. Transformez-les en bon de commande depuis Achats › Demande d'achat."}
        </StatusBanner>
      )}

      {/* Sources du besoin : clic = filtre */}
      <FilterChips label="Sources du besoin" value={source} onChange={k => setSource(k as Source)}
        chips={cards.map(c => ({
          key: c.key, label: c.label, count: c.count, icon: c.icon,
          tone: c.key === 'rupture' && c.count > 0 ? 'late' as const : undefined,
        }))} />

      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un article…" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
          <SearchSelect
            options={(ingredients as Record<string, any>[]).map(i => ({ id: i.id as string, label: i.name as string }))}
            value={addIngredient}
            onChange={addManual}
            placeholder="Ajouter un article à commander…"
            ariaLabel="Ajouter un article à commander"
            width={260}
          />
        </span>
      </Toolbar>

      {visible.length === 0 ? (
        <>
          {selectedRows.length > 0 && <DataPanel label="Sélection" bulk={bulk}>{null}</DataPanel>}
          {search
            ? <NoResultState onReset={() => setSearch('')} text="Aucun article ne correspond à la recherche." />
            : <EmptyState icon={CheckCircle2}
                title={source === 'covered' ? 'Aucun besoin déjà couvert par un bon de commande' : source === 'all' ? 'Rien à commander' : 'Aucun besoin de cette source'}
                text={source === 'covered' ? undefined
                  : `Pas de rupture, pas de demande en attente, aucun stock sous son seuil.${counts.low === 0 ? ' Renseignez un seuil minimum sur la fiche d\'un article pour qu\'il remonte ici quand il baisse.' : ''}`} />}
        </>
      ) : (
        <DataPanel label="Besoins à commander" bulk={bulk}
          footer={<TableFooter note={`${visible.length} article${visible.length > 1 ? 's' : ''}${source === 'covered' ? ' déjà en commande' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                {source !== 'covered' && (
                  <th style={{ width: 28 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Tout sélectionner" />
                  </th>
                )}
                <th>Article</th>
                <th>Motif</th>
                <th className="ds-num">Déjà en commande</th>
                <th className="ds-num" style={{ width: 150 }}>À commander</th>
                <th style={{ minWidth: 200 }}>Fournisseur</th>
                <th className="ds-num">Estimé ({currencySymbol()})</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const l = lines[r.ingredient_id] ?? { selected: false, qty: '', supplierId: '' };
                const qty = parseFloat(l.qty) || 0;
                const why: Array<{ text: string; color?: string }> = [];
                if ('manual' in r) why.push({ text: 'ajouté à la main' });
                if (r.rupture_qty > 0) why.push({ text: `rupture ${fmtQty(r.rupture_qty)} ${r.unit} · ${r.rupture_refs.join(', ')}`, color: 'var(--ds-danger)' });
                if (r.request_qty > 0) why.push({ text: `demandé ${fmtQty(r.request_qty)} ${r.unit}${r.requesters.length ? ` par ${r.requesters.join(', ')}` : ''}` });
                if (r.low_stock) why.push({ text: `stock ${fmtQty(r.low_stock.current)} / seuil ${fmtQty(r.low_stock.threshold)} ${r.unit}`, color: 'var(--ds-warning)' });
                // L6 : arrondi à la réalité d'achat (MOQ / conditionnement du fournisseur) et délai.
                if (!('manual' in r) && r.rounded_up) {
                  const bits = [r.moq ? `minimum ${fmtQty(r.moq)}` : '', r.order_multiple ? `cond. ${fmtQty(r.order_multiple)} ${r.unit}` : ''].filter(Boolean);
                  why.push({ text: `arrondi à la commande${bits.length ? ` (${bits.join(' · ')})` : ''}` });
                }
                if (!('manual' in r) && r.lead_time_days) why.push({ text: `délai fournisseur ${r.lead_time_days} j` });
                return (
                  <tr key={r.ingredient_id} className={!r.covered && l.selected ? 'ds-selected' : undefined}>
                    {source !== 'covered' && (
                      <td>
                        <input type="checkbox" checked={l.selected} onChange={() => patch(r.ingredient_id, { selected: !l.selected })}
                          aria-label={`Sélectionner ${r.ingredient_name}`} />
                      </td>
                    )}
                    <td>
                      <button type="button" className="ds-strong" onClick={() => navigate(`/stock/${r.ingredient_id}`)} title="Ouvrir la fiche de l'article"
                        style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                        {r.ingredient_name}
                      </button>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {why.map((w, i) => <div key={i} style={{ color: w.color ?? 'var(--ds-muted)' }}>{w.text}</div>)}
                    </td>
                    <td className="ds-num">
                      {r.on_order_qty > 0 ? (
                        <>
                          <div>{fmtQty(r.on_order_qty)} {r.unit}</div>
                          <div className="ds-ref" style={{ fontWeight: 400, fontSize: 12, color: 'var(--ds-muted)' }}>{r.on_order_refs.join(', ')}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="ds-num">
                      {r.covered ? <span style={muted}>couvert</span> : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" min={0} step="0.001" value={l.qty} aria-label={`Quantité à commander, ${r.ingredient_name}`}
                            onChange={e => patch(r.ingredient_id, { qty: e.target.value, selected: (parseFloat(e.target.value) || 0) > 0 ? true : l.selected })}
                            className="ds-input sm" style={{ width: 90, textAlign: 'right' }} />
                          <span style={muted}>{r.unit}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {r.covered ? <span style={muted}>{r.last_supplier_name ?? '—'}</span> : (
                        <>
                          <SearchSelect options={supplierOptions} value={l.supplierId} ariaLabel={`Fournisseur, ${r.ingredient_name}`}
                            onChange={v => patch(r.ingredient_id, { supplierId: v })} placeholder="Choisir…" />
                          {r.last_supplier_name && l.supplierId !== r.last_supplier_id && (
                            <button type="button" onClick={() => patch(r.ingredient_id, { supplierId: r.last_supplier_id ?? '' })}
                              style={{ ...muted, display: 'block', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline', marginTop: 2 }}>
                              dernier : {r.last_supplier_name}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    <td className="ds-num">
                      {r.unit_price != null && qty > 0 && !r.covered ? (
                        <>
                          <div className="ds-strong">{n2(qty * r.unit_price)}</div>
                          <div style={muted}>{n2(r.unit_price)} / {r.unit}</div>
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}
