import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Package, ShieldCheck, Recycle, Trash2, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Search, RefreshCw, Loader2, Info, Edit3, Filter, Store, TrendingDown,
} from 'lucide-react';
import { unsoldDecisionApi } from '../../api/unsold-decision.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import { useReferentiel } from '../../hooks/useReferentiel';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter, Pager, PAGE_SIZE, periodParams, periodLabel,
  type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { Dot, EmptyRow, Loading, inputStyle, muted, n0, n2, sectionTitle, tableWrap, toNum } from './shared';

/**
 * Invendus de fin de journée (ex-écran /unsold) : compter le reste, accepter ou
 * corriger la destination proposée, valider. 4 destinations alignées sur le POS
 * (audit P2.11). Un changement de suggestion exige un motif.
 */

type Product = Record<string, any>;
export type Destination = 'reexpose' | 'retour_stock' | 'recycle' | 'waste';
const DESTS: Destination[] = ['reexpose', 'retour_stock', 'recycle', 'waste'];

/** Un statut = une couleur (palette odoo-tag). */
export const DEST: Record<Destination, { label: string; tag: string; dot: string; icon: typeof Store }> = {
  reexpose: { label: 'Vitrine J+1', tag: 'odoo-tag-green', dot: '#28a745', icon: ShieldCheck },
  retour_stock: { label: 'Retour réserve', tag: 'odoo-tag-blue', dot: '#1f6391', icon: Package },
  recycle: { label: 'Valoriser', tag: 'odoo-tag-orange', dot: '#d9822b', icon: Recycle },
  waste: { label: 'Détruire', tag: 'odoo-tag-red', dot: '#dc3545', icon: Trash2 },
};

function DestTag({ dest, label }: { dest: string; label: string }) {
  const d = DEST[dest as Destination];
  return <span className={`odoo-tag ${d?.tag ?? 'odoo-tag-grey'}`}>{label}</span>;
}

type Msg = { type: 'success' | 'error'; text: string } | null;

export default function InvendusTab() {
  const [view, setView] = useState<'open' | 'history'>('open');
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <ViewSwitch ariaLabel="Invendus" view={view} onChange={setView}
          openLabel="À décider aujourd'hui" historyLabel="Décisions passées" />
      </div>
      {view === 'open' ? <DecisionPanel /> : <HistoryPanel />}
    </>
  );
}

/* ═══════════════════════ À DÉCIDER ═══════════════════════ */

function DecisionPanel() {
  const queryClient = useQueryClient();
  const { getLabel } = useReferentiel('unsold_destinations');
  const destLabel = (d: string) => getLabel(d) || DEST[d as Destination]?.label || d;
  const [search, setSearch] = useState('');
  const [filterDest, setFilterDest] = useState<'all' | Destination>('all');
  const [choices, setChoices] = useState<Record<string, Destination>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<Msg>(null);

  const { data: products = [], isLoading, isFetching, refetch } = useQuery<Product[]>({
    queryKey: ['unsold-suggestions'],
    queryFn: () => unsoldDecisionApi.suggestions(),
  });

  // Les décisions doivent être rattachées à la session de caisse ouverte
  // (le serveur refuse les décisions orphelines).
  const { data: activeSession } = useQuery({ queryKey: ['cash-register-session'], queryFn: cashRegisterApi.currentSession });
  const sessionId = (activeSession as { id?: string } | null)?.id;

  // Reste compté : pré-rempli avec le stock théorique, sans écraser une saisie.
  useEffect(() => {
    setCounts(prev => {
      const next = { ...prev };
      for (const p of products) if (next[p.product_id] === undefined) next[p.product_id] = parseInt(String(p.current_stock)) || 0;
      return next;
    });
  }, [products]);

  const remainingOf = (p: Product) => counts[p.product_id] ?? (parseInt(String(p.current_stock)) || 0);
  const destOf = (p: Product): Destination => choices[p.product_id] ?? (p.suggested_destination as Destination);
  const isOverride = (p: Product) => destOf(p) !== p.suggested_destination;

  const summary = useMemo(() => {
    const s = { all: { qty: 0, cost: 0, n: 0 } } as Record<'all' | Destination, { qty: number; cost: number; n: number }>;
    DESTS.forEach(d => { s[d] = { qty: 0, cost: 0, n: 0 }; });
    for (const p of products) {
      const r = remainingOf(p);
      if (r <= 0) continue;
      const cost = toNum(p.cost_price) * r;
      const d = destOf(p);
      for (const k of ['all', d] as const) if (s[k]) { s[k].qty += r; s[k].cost += cost; s[k].n += 1; }
    }
    return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, choices, counts]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      (!q || String(p.product_name).toLowerCase().includes(q) || String(p.category_name || '').toLowerCase().includes(q))
      && (filterDest === 'all' || destOf(p) === filterDest));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, search, filterDest, choices]);

  const missingReason = products.find(p => remainingOf(p) > 0 && isOverride(p) && !reasons[p.product_id]?.trim());

  const save = useMutation({
    mutationFn: () => unsoldDecisionApi.save({
      sessionId,
      closeType: 'fin_journee',
      decisions: products.filter(p => remainingOf(p) > 0).map(p => {
        const pid = p.product_id as string;
        const finalDest = destOf(p);
        // N8 — initial = report (carryover) + appros de la fenêtre, même formule
        // que le POS : l'écart d'inventaire réel = initial − vendu − reste.
        const initial = (parseInt(String(p.initial_stock)) || 0) + (parseInt(String(p.replenished_today_qty)) || 0);
        return {
          productId: pid,
          productName: p.product_name,
          categoryName: p.category_name || undefined,
          initialQty: initial,
          soldQty: parseInt(String(p.sold_qty)) || 0,
          remainingQty: remainingOf(p),
          suggestedDestination: p.suggested_destination,
          suggestedReason: p.suggested_reason,
          finalDestination: finalDest,
          overrideReason: finalDest !== p.suggested_destination ? (reasons[pid] || 'Decision operateur') : undefined,
          shelfLifeDays: p.shelf_life_days ?? undefined,
          displayLifeHours: p.display_life_hours ?? undefined,
          isReexposable: p.is_reexposable ?? undefined,
          maxReexpositions: p.max_reexpositions ?? undefined,
          currentReexpositionCount: p.reexposition_count ?? undefined,
          isRecyclable: p.is_recyclable ?? undefined,
          recycleIngredientId: p.recycle_ingredient_id || undefined,
          saleType: p.sale_type || undefined,
          displayExpiresAt: p.display_expires_at || undefined,
          expiresAt: p.expires_at || undefined,
          producedAt: p.produced_at || undefined,
          unitCost: toNum(p.cost_price),
        };
      }),
    }),
    onSuccess: () => {
      setMsg({ type: 'success', text: 'Décisions enregistrées. Les mouvements de stock ont été appliqués.' });
      setChoices({}); setReasons({}); setCounts({});
      ['unsold-suggestions', 'unsold-history', 'unsold-stats', 'boutique-unsold-today'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
    },
    onError: () => setMsg({ type: 'error', text: "Erreur lors de l'enregistrement des décisions." }),
  });

  const submit = () => {
    setMsg(null);
    if (!sessionId) { setMsg({ type: 'error', text: 'Aucune caisse ouverte : ouvrez une session depuis la caisse.' }); return; }
    if (missingReason) {
      setMsg({ type: 'error', text: `Motif obligatoire pour « ${missingReason.product_name} » : la destination proposée a été changée.` });
      setExpanded(missingReason.product_id);
      return;
    }
    save.mutate();
  };

  if (isLoading) return <Loading />;

  const stages: Array<StageDef & { key: 'all' | Destination }> = [
    { key: 'all', label: 'Tous', hint: 'reste compté', icon: Store },
    ...DESTS.map(d => ({ key: d, label: destLabel(d), hint: d === 'waste' ? 'perte au coût de revient' : 'unités', icon: DEST[d].icon })),
  ];

  return (
    <>
      {!sessionId ? (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Aucune caisse ouverte">
          Les décisions sont rattachées à une session de caisse. Ouvrez une session depuis la caisse pour pouvoir les valider.
        </StatusBanner>
      ) : (
        <StatusBanner tone="neutral" icon={Info} title="Fin de journée">
          Comptez le reste, vérifiez la destination proposée, puis validez. La fermeture complète (montants, écarts de caisse) se fait depuis la caisse.
        </StatusBanner>
      )}
      {msg && (
        <StatusBanner tone={msg.type === 'error' ? 'danger' : 'success'} icon={msg.type === 'error' ? AlertTriangle : CheckCircle2}
          title={msg.type === 'error' ? 'Action impossible' : 'Enregistré'}>{msg.text}</StatusBanner>
      )}

      {products.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucun invendu">Tous les produits en vitrine ont été vendus.</StatusBanner>
      ) : (
        <>
          <StagePipeline
            title="Destination des invendus"
            summary={`${n0(summary.all.qty)} unités · ${n2(summary.all.cost)} DH au coût de revient`}
            stages={stages}
            stats={Object.fromEntries(stages.map(s => [s.key, { count: summary[s.key].qty, sub: `${summary[s.key].n} produit${summary[s.key].n > 1 ? 's' : ''}` }]))}
            isActive={k => filterDest === k}
            onPick={k => setFilterDest(filterDest === k ? 'all' : (k as 'all' | Destination))}
          />

          <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
            <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher un produit"
              placeholder="Rechercher un produit ou une catégorie..." className="odoo-search-input" style={{ flex: '1 1 220px', minWidth: 0 }} />
            <button type="button" onClick={() => refetch()} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Actualiser
            </button>
          </div>

          <div style={tableWrap}>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Produit</th>
                  <th style={{ textAlign: 'right' }}>Disponible</th>
                  <th style={{ textAlign: 'right' }}>Vendu</th>
                  <th style={{ textAlign: 'center' }}>Reste compté</th>
                  <th>Proposition</th>
                  <th>Décision</th>
                  <th style={{ textAlign: 'right' }}>Coût</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <EmptyRow colSpan={7}>Aucun produit pour ce filtre.</EmptyRow>}
                {rows.map(p => {
                  const pid = p.product_id as string;
                  const stock = parseInt(String(p.current_stock)) || 0;
                  const sold = parseInt(String(p.sold_qty)) || 0;
                  const remaining = remainingOf(p);
                  const sug = p.suggested_destination as Destination;
                  const dest = destOf(p);
                  const over = isOverride(p);
                  const open = expanded === pid;
                  const unitCost = toNum(p.cost_price);
                  // Règles d'éligibilité alignées sur le POS (audit P2.11).
                  const allowed: Record<Destination, string | null> = {
                    reexpose: p.is_reexposable ? null : 'Remise en vente non autorisée',
                    retour_stock: p.sale_type === 'dlv' || (p.shelf_life_days ?? 0) > 1 ? null : 'DLC trop courte pour un retour réserve',
                    recycle: p.is_recyclable && p.recycle_ingredient_id ? null : 'Produit non valorisable',
                    waste: null,
                  };
                  return (
                    <Fragment key={pid}>
                      <tr style={over ? { background: 'color-mix(in srgb, #fff3cd 45%, transparent)' } : undefined}>
                        <td>
                          <button type="button" onClick={() => setExpanded(open ? null : pid)} aria-expanded={open}
                            style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                            {open ? <ChevronDown size={14} style={{ marginTop: 2 }} /> : <ChevronRight size={14} style={{ marginTop: 2 }} />}
                            <span>
                              <span style={{ fontWeight: 600, color: 'var(--odoo-text)' }}>{p.product_name}</span>
                              <div style={muted}>{p.category_name || 'Sans catégorie'}</div>
                            </span>
                          </button>
                        </td>
                        <td style={{ textAlign: 'right' }}>{stock + sold}</td>
                        <td style={{ textAlign: 'right' }}>{sold}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="number" min={0} max={stock} value={remaining} aria-label={`Reste compté ${p.product_name}`}
                            onChange={e => setCounts(prev => ({ ...prev, [pid]: Math.max(0, parseInt(e.target.value) || 0) }))}
                            style={{ ...inputStyle, width: 64, textAlign: 'center', fontWeight: 600 }} />
                        </td>
                        <td><DestTag dest={sug} label={destLabel(sug)} /></td>
                        <td>
                          {remaining > 0 ? (
                            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }} role="radiogroup" aria-label={`Destination ${p.product_name}`}>
                              {DESTS.map(d => {
                                const active = dest === d;
                                const blocked = allowed[d];
                                return (
                                  <button key={d} type="button" role="radio" aria-checked={active} disabled={!!blocked}
                                    title={blocked ?? destLabel(d)}
                                    onClick={() => setChoices(prev => ({ ...prev, [pid]: d }))}
                                    className={active ? `odoo-tag ${DEST[d].tag}` : undefined}
                                    style={{
                                      padding: '2px 8px', fontSize: '0.75rem', borderRadius: 3, cursor: blocked ? 'not-allowed' : 'pointer',
                                      border: `1px solid ${active ? 'transparent' : 'var(--odoo-border)'}`,
                                      background: active ? undefined : 'var(--odoo-bg)',
                                      color: active ? undefined : blocked ? 'var(--odoo-text-light)' : 'var(--odoo-text-muted)',
                                      fontWeight: active ? 600 : 400, opacity: blocked ? 0.5 : 1,
                                    }}>
                                    {destLabel(d)}
                                  </button>
                                );
                              })}
                              {over && <Edit3 size={12} style={{ color: '#d9822b' }} aria-label="Proposition modifiée" />}
                            </span>
                          ) : <span style={muted}>Tout vendu</span>}
                        </td>
                        <td style={{ textAlign: 'right', color: dest === 'waste' && remaining > 0 ? '#dc3545' : 'var(--odoo-text)' }}>
                          {remaining > 0 ? n2(unitCost * remaining) : '—'}
                        </td>
                      </tr>
                      {remaining > 0 && over && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--odoo-bg-alt)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Motif du changement *</span>
                              <input type="text" value={reasons[pid] || ''} autoFocus={open}
                                onChange={e => setReasons(prev => ({ ...prev, [pid]: e.target.value }))}
                                placeholder="Ex. aspect encore correct, commande client demain..."
                                style={{ ...inputStyle, flex: 1, borderColor: reasons[pid]?.trim() ? 'var(--odoo-border)' : '#d9822b' }} />
                            </label>
                          </td>
                        </tr>
                      )}
                      {open && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--odoo-bg-alt)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 16px', fontSize: '0.8125rem' }}>
                              <Detail label="Type de vente" value={p.sale_type === 'jour' ? 'Vente du jour' : p.sale_type === 'dlv' ? 'Multi-jours (DLC)' : 'Sur commande'} />
                              <Detail label="DLC" value={`${p.shelf_life_days || '—'} jour(s)`} />
                              <Detail label="Exposition max" value={`${p.display_life_hours || '—'} h`} />
                              <Detail label="Remises en vitrine" value={`${p.reexposition_count || 0} / ${p.max_reexpositions || 0}`} />
                              <Detail label="Valorisable" value={p.is_recyclable ? `Oui → ${p.recycle_ingredient_name || 'ingrédient'}` : 'Non'} />
                              <Detail label="Coût unitaire" value={`${n2(unitCost)} DH`} />
                              {p.expires_at && <Detail label="Expiration" value={format(new Date(p.expires_at), 'dd MMM yyyy HH:mm', { locale: fr })}
                                danger={new Date(p.expires_at) <= new Date()} />}
                            </div>
                            <div style={{ ...muted, marginTop: 8, fontSize: '0.75rem' }}>
                              <strong>Pourquoi cette proposition :</strong> {p.suggested_reason || '—'}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
              {summary.all.n} produit{summary.all.n > 1 ? 's' : ''} à traiter
              {missingReason && <> · <span style={{ color: '#d9822b' }}>motif manquant</span></>}
            </span>
            <button type="button" onClick={submit} disabled={save.isPending || summary.all.qty === 0 || !sessionId}
              className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Valider les décisions
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Detail({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div style={muted}>{label}</div>
      <div style={{ fontWeight: 600, color: danger ? '#dc3545' : 'var(--odoo-text)' }}>{value}</div>
    </div>
  );
}

/* ═══════════════════════ DÉCISIONS PASSÉES ═══════════════════════ */

function HistoryPanel() {
  const { getLabel } = useReferentiel('unsold_destinations');
  const destLabel = (d: string) => getLabel(d) || DEST[d as Destination]?.label || d;
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dest, setDest] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [period, from, to, dest]);

  const params = { ...periodParams(period, from, to), ...(dest ? { destination: dest } : {}), page: String(page), limit: String(PAGE_SIZE) };
  const { data, isLoading } = useQuery({ queryKey: ['unsold-history', params], queryFn: () => unsoldDecisionApi.list(params) });
  const rows: Product[] = data?.data || [];
  const total: number = data?.total || 0;

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <PeriodFilter label="Période" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        <SelectFilter label="Destination" icon={Filter} value={dest} onChange={setDest} allLabel="Toutes"
          options={DESTS.map(d => ({ key: d, label: destLabel(d) }))} />
      </div>
      <div style={tableWrap}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Produit</th>
              <th style={{ textAlign: 'right' }}>Reste</th>
              <th>Proposition</th>
              <th>Décision</th>
              <th style={{ textAlign: 'right' }}>Coût</th>
              <th>Par</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow colSpan={7}><Loader2 size={16} className="animate-spin" /></EmptyRow>}
            {!isLoading && rows.length === 0 && <EmptyRow colSpan={7}>Aucune décision sur {periodLabel(period, from, to)}.</EmptyRow>}
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(r.created_at), 'dd/MM/yy HH:mm')}</td>
                <td>
                  <span style={{ fontWeight: 600 }}>{r.product_name}</span>
                  <div style={muted}>{r.category_name || ''}</div>
                </td>
                <td style={{ textAlign: 'right' }}>{r.remaining_qty}</td>
                <td><DestTag dest={r.suggested_destination} label={destLabel(r.suggested_destination)} /></td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <DestTag dest={r.final_destination} label={destLabel(r.final_destination)} />
                    {r.is_override && <span title={r.override_reason || 'Proposition modifiée'}><Edit3 size={12} style={{ color: '#d9822b' }} /></span>}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>{n2(toNum(r.total_cost))}</td>
                <td style={muted}>{r.decided_by_first_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager page={page} total={total} onPage={setPage} note="Coût = reste × coût de revient unitaire" />
      </div>
    </>
  );
}

/* ═══════════════════════ TABLEAU DE BORD (onglet Rapports) ═══════════════════════ */

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function InvendusDashboard() {
  const { getLabel } = useReferentiel('unsold_destinations');
  const destLabel = (d: string) => getLabel(d) || DEST[d as Destination]?.label || d;
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { data: stats, isLoading } = useQuery({ queryKey: ['unsold-stats', { month, year }], queryFn: () => unsoldDecisionApi.stats({ month, year }) });

  const totals = useMemo(() => {
    const t: Record<string, { qty: number; cost: number }> = {};
    DESTS.forEach(d => { t[d] = { qty: 0, cost: 0 }; });
    for (const d of stats?.byDestination || []) t[d.final_destination] = { qty: toNum(d.total_qty), cost: toNum(d.total_cost) };
    return t;
  }, [stats]);
  const grand = DESTS.reduce((s, d) => s + totals[d].qty, 0);
  const pct = (d: Destination) => (grand > 0 ? (totals[d].qty / grand) * 100 : 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

  const byCategory = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const c of stats?.byCategory || []) {
      const cat = c.category_name || 'Sans catégorie';
      m[cat] ??= {};
      m[cat][c.final_destination] = toNum(c.total_qty);
    }
    return Object.entries(m);
  }, [stats]);

  const overrides = stats?.overrideRate || { override_count: 0, total_count: 0 };
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 3 + i);

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          Mois
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="odoo-filter-dropdown">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-filter-dropdown">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {isLoading ? <Loading /> : !stats ? (
        <StatusBanner tone="neutral" icon={Info} title="Aucune donnée">Aucune décision d'invendus ce mois-ci.</StatusBanner>
      ) : (
        <>
          <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
            <div className="odoo-stat-card" style={{ cursor: 'default' }}>
              <div className="odoo-stat-card-label">Invendus du mois</div>
              <div className="odoo-stat-card-value">{n0(grand)}</div>
              <div className="odoo-stat-card-sub">unités décidées</div>
            </div>
            {DESTS.map(d => (
              <div key={d} className="odoo-stat-card" style={{ cursor: 'default' }}>
                <div className="odoo-stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Dot color={DEST[d].dot} /> {destLabel(d)}</div>
                <div className="odoo-stat-card-value">{pct(d)} %</div>
                <div className="odoo-stat-card-sub">{n0(totals[d].qty)} unités{d === 'waste' ? ` · ${n2(totals[d].cost)} DH perdus` : ''}</div>
              </div>
            ))}
          </div>

          {toNum(overrides.total_count) > 0 && (
            <StatusBanner tone="info" icon={Edit3} title={`${toNum(overrides.override_count)} proposition(s) modifiée(s) par l'équipe`}>
              Sur {toNum(overrides.total_count)} décisions ce mois ({((toNum(overrides.override_count) / toNum(overrides.total_count)) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %).
            </StatusBanner>
          )}

          {(stats.recurringWaste || []).length > 0 && (
            <>
              <h3 style={sectionTitle}>Surproduction : destructions répétées</h3>
              <div style={tableWrap}>
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead><tr><th>Produit</th><th style={{ textAlign: 'right' }}>Jours détruits</th><th style={{ textAlign: 'right' }}>Unités</th><th style={{ textAlign: 'right' }}>Perte (DH)</th></tr></thead>
                  <tbody>
                    {stats.recurringWaste.map((p: Product) => (
                      <tr key={p.product_id}>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Dot color="#dc3545" /><strong>{p.product_name}</strong></span></td>
                        <td style={{ textAlign: 'right' }}>{p.waste_days}</td>
                        <td style={{ textAlign: 'right' }}>{n0(toNum(p.total_qty))}</td>
                        <td style={{ textAlign: 'right', color: '#dc3545', fontWeight: 600 }}>{n2(toNum(p.total_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <div>
              <h3 style={sectionTitle}>Par catégorie (unités)</h3>
              <div style={{ ...tableWrap, marginTop: 6 }}>
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead><tr><th>Catégorie</th>{DESTS.map(d => <th key={d} style={{ textAlign: 'right' }}>{destLabel(d)}</th>)}</tr></thead>
                  <tbody>
                    {byCategory.length === 0 && <EmptyRow colSpan={5}>Aucune donnée.</EmptyRow>}
                    {byCategory.map(([cat, v]) => (
                      <tr key={cat}>
                        <td>{cat}</td>
                        {DESTS.map(d => <td key={d} style={{ textAlign: 'right', color: v[d] ? 'var(--odoo-text)' : 'var(--theme-text-muted)' }}>{v[d] ? n0(v[d]) : '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingDown size={12} /> Produits les plus détruits (coût)</h3>
              <div style={{ ...tableWrap, marginTop: 6 }}>
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead><tr><th>Produit</th><th style={{ textAlign: 'right' }}>Fois</th><th style={{ textAlign: 'right' }}>Unités</th><th style={{ textAlign: 'right' }}>Perte (DH)</th></tr></thead>
                  <tbody>
                    {(stats.topWasteProducts || []).length === 0 && <EmptyRow colSpan={4}>Aucune destruction.</EmptyRow>}
                    {(stats.topWasteProducts || []).map((p: Product) => (
                      <tr key={p.product_id}>
                        <td><strong>{p.product_name}</strong><div style={muted}>{p.category_name || ''}</div></td>
                        <td style={{ textAlign: 'right' }}>{p.waste_count}</td>
                        <td style={{ textAlign: 'right' }}>{n0(toNum(p.total_qty))}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{n2(toNum(p.total_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {(stats.daily || []).length > 0 && (
            <>
              <h3 style={sectionTitle}>Jour par jour</h3>
              <div style={{ ...tableWrap, maxHeight: 320, overflowY: 'auto' }}>
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead><tr><th>Date</th><th>Destination</th><th style={{ textAlign: 'right' }}>Unités</th><th style={{ textAlign: 'right' }}>Coût (DH)</th><th style={{ textAlign: 'right' }}>Décisions</th></tr></thead>
                  <tbody>
                    {stats.daily.map((d: Product, i: number) => (
                      <tr key={i}>
                        <td>{format(new Date(d.date), 'EEE dd/MM', { locale: fr })}</td>
                        <td><DestTag dest={d.final_destination} label={destLabel(d.final_destination)} /></td>
                        <td style={{ textAlign: 'right' }}>{n0(toNum(d.total_qty))}</td>
                        <td style={{ textAlign: 'right' }}>{n2(toNum(d.total_cost))}</td>
                        <td style={{ textAlign: 'right' }}>{toNum(d.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
