import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, Printer, Plus, Search, CheckCircle2, RotateCcw, Ban, AlertTriangle, Send, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  stockCountsApi, parseCountExpression, STOCK_COUNT_STATUS_LABELS, STOCK_COUNT_STATUS_TAG, type StockCount, type StockCountLine,
} from '../../api/stock-counts.api';
import { ingredientsApi } from '../../api/inventory.api';
import { packagingApi } from '../../api/packaging.api';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import SearchSelect from '../../components/ui/SearchSelect';
import { useStockCategories } from './useStockCategories';

/**
 * Inventaire physique (mig 367) : ouvrir une campagne, compter (à l'écran ou sur la
 * feuille imprimée), terminer le comptage, puis la direction vérifie les écarts et valide.
 * Remplace le script SQL ad hoc des inventaires mensuels.
 */
const qty = (v: number | string | null | undefined) => (v == null ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };

async function openSheet(id: string) {
  try { window.open(URL.createObjectURL(await stockCountsApi.sheet(id)), '_blank'); } catch (e) { notify.error(apiErrorMessage(e)); }
}

export default function StockCountsTab() {
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['stock-counts'], queryFn: () => stockCountsApi.list({ limit: '50' }) });
  const current = data?.data.find(c => c.status === 'counting' || c.status === 'review');
  const [creating, setCreating] = useState(false);
  if (isLoading) return <div style={{ padding: 16 }}><Loader2 className="animate-spin" size={18} /></div>;
  if (openId) return <CountSheet id={openId} isDirection={isDirection} onBack={() => setOpenId(null)} />;
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: '1rem' }}>
      {current ? (
        <StatusBanner tone={current.status === 'review' ? 'warning' : 'info'} icon={ClipboardCheck}
          title={`${current.number} · ${STOCK_COUNT_STATUS_LABELS[current.status]} (${current.lines_counted}/${current.lines_total} compté(s))`}
          actions={<button className="odoo-btn-primary" onClick={() => setOpenId(current.id)}>{current.status === 'review' && isDirection ? 'Vérifier et valider' : 'Continuer le comptage'}</button>}>
          {current.title ?? 'Inventaire en cours'} — ouvert le {format(new Date(current.created_at), 'dd/MM/yyyy')}{current.created_by_name ? ` par ${current.created_by_name}` : ''}.
          Un seul inventaire peut être ouvert à la fois.
        </StatusBanner>
      ) : !creating && (
        <StatusBanner tone="neutral" icon={ClipboardCheck} title="Aucun inventaire en cours"
          actions={<button className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={13} /> Nouvel inventaire</button>}>
          Comptez tout le stock (inventaire complet) ou quelques catégories (inventaire tournant). Les écarts validés ajustent le stock et sont valorisés au coût moyen.
        </StatusBanner>
      )}
      {creating && !current && <NewCount onCancel={() => setCreating(false)} onCreated={c => { setCreating(false); setOpenId(c.id); }} />}

      <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Historique des inventaires</div>
      {!data?.data.length ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>Aucun inventaire enregistré dans l'application.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Inventaire</th><th>Date</th><th>Articles</th><th>Statut</th>{isDirection && <th style={{ textAlign: 'right' }}>Écart valorisé</th>}<th>Validé par</th></tr></thead>
            <tbody>{data.data.map(c => (
              <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: 'pointer' }}>
                <td className="font-mono">{c.number}</td>
                <td>{c.title ?? (c.scope === 'full' ? 'Inventaire complet' : 'Inventaire tournant')}<div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{{ ingredient: 'Matières', packaging: 'Consommables', both: 'Matières et consommables' }[c.item_kinds]}{c.blind ? ' · à l\'aveugle' : ''}</div></td>
                <td>{format(new Date(`${String(c.count_date).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy')}</td>
                <td>{c.lines_counted}/{c.lines_total}</td>
                <td><span className={`odoo-tag ${STOCK_COUNT_STATUS_TAG[c.status]}`}>{STOCK_COUNT_STATUS_LABELS[c.status]}</span></td>
                {isDirection && <td style={{ textAlign: 'right', color: Number(c.gap_value) < 0 ? '#dc3545' : undefined }}>{c.gap_value != null ? `${n2(c.gap_value)} DH` : '—'}</td>}
                <td>{c.validated_by_name ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewCount({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: StockCount) => void }) {
  const { branches } = useStockCategories();
  const [f, setF] = useState({ title: '', itemKinds: 'both' as 'ingredient' | 'packaging' | 'both', blind: true, includeInactive: false, partial: false });
  const [cats, setCats] = useState<Set<string>>(new Set());
  const create = useMutation({
    mutationFn: () => stockCountsApi.create({ title: f.title || null, itemKinds: f.itemKinds, blind: f.blind, includeInactive: f.includeInactive, categoryIds: f.partial ? [...cats] : [] }),
    onSuccess: c => { notify.success(`Inventaire ${c.number} ouvert : ${c.lines_total} article(s) à compter`); onCreated(c); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
      <div style={{ fontWeight: 600 }}>Nouvel inventaire</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label style={lab}>Intitulé<input style={field} maxLength={200} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Ex. : inventaire de fin octobre" /></label>
        <label style={lab}>Articles à compter<select style={field} value={f.itemKinds} onChange={e => setF({ ...f, itemKinds: e.target.value as typeof f.itemKinds })}>
          <option value="both">Matières et consommables</option><option value="ingredient">Matières premières</option><option value="packaging">Consommables (emballages…)</option>
        </select></label>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.blind} onChange={e => setF({ ...f, blind: e.target.checked })} /> Comptage à l'aveugle (le compteur ne voit pas le stock théorique)</label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.includeInactive} onChange={e => setF({ ...f, includeInactive: e.target.checked })} /> Inclure les articles sans stock ni mouvement depuis 6 mois</label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.partial} onChange={e => setF({ ...f, partial: e.target.checked })} /> Seulement certaines catégories (inventaire tournant)</label>
      </div>
      {f.partial && (
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 8, background: 'var(--odoo-bg)' }}>
          {branches.map(b => (
            <label key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem', paddingLeft: b.depth * 16 }}>
              <input type="checkbox" checked={cats.has(b.id)} onChange={e => { const s = new Set(cats); if (e.target.checked) s.add(b.id); else s.delete(b.id); setCats(s); }} />
              {b.name}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="odoo-btn-secondary" onClick={onCancel}>Annuler</button>
        <button className="odoo-btn-primary" disabled={create.isPending || (f.partial && !cats.size)} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <ClipboardCheck size={13} />} Ouvrir l'inventaire
        </button>
      </div>
    </div>
  );
}

function CountSheet({ id, isDirection, onBack }: { id: string; isDirection: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: c, isLoading } = useQuery({ queryKey: ['stock-count', id], queryFn: () => stockCountsApi.get(id) });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'gaps'>('all');
  const [zeroUncounted, setZeroUncounted] = useState(false);
  const [adding, setAdding] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['stock-count', id] }); qc.invalidateQueries({ queryKey: ['stock-counts'] }); };

  const save = useMutation({
    mutationFn: ({ line, value }: { line: StockCountLine; value: number | null }) => stockCountsApi.count(id, line.id, value),
    onSuccess: (l, v) => {
      qc.setQueryData<StockCount>(['stock-count', id], old => old ? {
        ...old, lines: old.lines?.map(x => x.id === l.id ? { ...x, ...l, theoretical_at_start: l.theoretical_at_start ?? x.theoretical_at_start } : x),
        lines_counted: (old.lines ?? []).filter(x => (x.id === l.id ? l.counted_qty : x.counted_qty) != null).length,
      } : old);
      setDrafts(d => { const n = { ...d }; delete n[v.line.id]; return n; });
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const act = useMutation({
    mutationFn: (a: 'submit' | 'reopen' | 'cancel') => stockCountsApi.action(id, a),
    onSuccess: (_d, a) => { refresh(); notify.success(a === 'submit' ? 'Comptage terminé : la direction est prévenue' : a === 'cancel' ? 'Inventaire annulé' : 'Comptage rouvert'); if (a === 'cancel') onBack(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const validate = useMutation({
    mutationFn: () => stockCountsApi.validate(id, zeroUncounted),
    onSuccess: r => { refresh(); notify.success(`Inventaire validé : écart net ${n2(r.gap_value)} DH`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const lines = c?.lines ?? [];
  const showTh = !!c && !c.theoretical_hidden;
  const gapOf = (l: StockCountLine) => (l.counted_qty != null && l.theoretical_at_count != null ? Number(l.counted_qty) - Number(l.theoretical_at_count) : null);
  const visible = useMemo(() => lines.filter(l => {
    if (search && !l.item_name.toLowerCase().includes(search.toLowerCase()) && !(l.category_name ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'todo') return l.counted_qty == null;
    if (filter === 'gaps') { const g = gapOf(l); return g != null && Math.abs(g) > 0.0005; }
    return true;
  }), [lines, search, filter]);
  const totals = useMemo(() => {
    let gain = 0; let loss = 0; let gaps = 0;
    for (const l of lines) {
      const g = gapOf(l); if (g == null || Math.abs(g) < 0.0005) continue;
      gaps++; const v = g * Number(l.cost ?? 0); if (v > 0) gain += v; else loss += v;
    }
    return { gain, loss, gaps, uncounted: lines.filter(l => l.counted_qty == null).length };
  }, [lines]);

  if (isLoading || !c) return <div style={{ padding: 16 }}><Loader2 className="animate-spin" size={18} /></div>;
  const editable = c.status === 'counting';
  const commit = (l: StockCountLine) => {
    const raw = drafts[l.id];
    if (raw === undefined) return;
    if (raw.trim() === '') { if (l.counted_qty != null) save.mutate({ line: l, value: null }); else setDrafts(d => { const n = { ...d }; delete n[l.id]; return n; }); return; }
    const v = parseCountExpression(raw);
    if (v == null) { notify.error(`Quantité illisible pour ${l.item_name} : « ${raw} »`); return; }
    if (l.counted_qty != null && Math.abs(Number(l.counted_qty) - v) < 0.0005) { setDrafts(d => { const n = { ...d }; delete n[l.id]; return n; }); return; }
    save.mutate({ line: l, value: v });
  };

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="odoo-btn-secondary" onClick={onBack}>← Inventaires</button>
        <h2 style={{ margin: 0, fontSize: '1.125rem', flex: 1 }}>{c.number} · {c.title ?? (c.scope === 'full' ? 'Inventaire complet' : 'Inventaire tournant')}</h2>
        <span className={`odoo-tag ${STOCK_COUNT_STATUS_TAG[c.status]}`}>{STOCK_COUNT_STATUS_LABELS[c.status]}</span>
        <button className="odoo-btn-secondary" onClick={() => openSheet(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Feuille de comptage</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--odoo-border)' }}>
          <div style={{ width: `${c.lines_total ? Math.round(c.lines_counted / c.lines_total * 100) : 0}%`, height: '100%', borderRadius: 4, background: c.lines_counted === c.lines_total ? '#28a745' : 'var(--odoo-purple, #714B67)' }} />
        </div>
        <span style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{c.lines_counted}/{c.lines_total} compté(s)</span>
      </div>

      {c.status === 'counting' && (
        <StatusBanner tone="info" icon={ClipboardCheck} title="Comptage en cours"
          actions={<button className="odoo-btn-primary" disabled={!c.lines_counted || act.isPending}
            onClick={async () => { if (await confirm(`Terminer le comptage ? ${totals.uncounted} article(s) non compté(s) ne seront pas ajustés, sauf décision contraire à la validation.`)) act.mutate('submit'); }}>
            <Send size={13} /> Terminer le comptage</button>}>
          Saisissez la quantité réellement présente, réserve et poste de pesée confondus, dans l'unité de l'article. Formule acceptée pour les contenants : « 3x25 + 4,5 ».
          {c.theoretical_hidden && ' Comptage à l\'aveugle : le stock théorique n\'est pas affiché.'}
        </StatusBanner>
      )}
      {isDirection && (c.status === 'review' || c.status === 'counting') && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10, background: 'var(--odoo-bg-alt)' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '0.875rem' }}>
            <span>Écarts : <strong>{totals.gaps}</strong></span>
            <span>Excédents : <strong style={{ color: '#198754' }}>+{n2(totals.gain)} DH</strong></span>
            <span>Manquants : <strong style={{ color: '#dc3545' }}>{n2(totals.loss)} DH</strong></span>
            <span>Net : <strong style={{ color: totals.gain + totals.loss < 0 ? '#dc3545' : undefined }}>{n2(totals.gain + totals.loss)} DH</strong></span>
            <span>Non comptés : <strong>{totals.uncounted}</strong></span>
          </div>
          {totals.uncounted > 0 && (
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem' }}>
              <input type="checkbox" checked={zeroUncounted} onChange={e => setZeroUncounted(e.target.checked)} />
              Mettre à zéro les {totals.uncounted} article(s) non compté(s) (inventaire complet : ce qui n'a pas été trouvé n'existe plus)
            </label>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="odoo-btn-secondary" disabled={act.isPending} onClick={async () => { if (await confirm(`Annuler l'inventaire ${c.number} ? Aucun stock ne sera modifié.`)) act.mutate('cancel'); }}><Ban size={13} /> Annuler</button>
            {c.status === 'review' && <button className="odoo-btn-secondary" disabled={act.isPending} onClick={() => act.mutate('reopen')}><RotateCcw size={13} /> Rouvrir le comptage</button>}
            <button className="odoo-btn-primary" disabled={validate.isPending || !c.lines_counted}
              onClick={async () => { if (await confirm(`Valider l'inventaire ? Le stock de ${totals.gaps + (zeroUncounted ? totals.uncounted : 0)} article(s) sera ajusté (net ${n2(totals.gain + totals.loss)} DH). Cette opération ne s'annule pas.`)) validate.mutate(); }}>
              {validate.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Valider l'inventaire
            </button>
          </div>
        </div>
      )}
      {c.status === 'validated' && (
        <StatusBanner tone="success" icon={CheckCircle2} title={`Validé le ${c.validated_at ? format(new Date(c.validated_at), 'dd/MM/yyyy HH:mm') : ''}${c.validated_by_name ? ` par ${c.validated_by_name}` : ''}`}>
          {isDirection ? <>Excédents +{n2(c.gain_value)} DH · manquants {n2(c.loss_value)} DH · net {n2(c.gap_value)} DH (au coût moyen du jour).</> : 'Le stock a été ajusté.'}
          {c.zero_uncounted && ' Les articles non comptés ont été mis à zéro.'}
        </StatusBanner>
      )}

      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Article ou catégorie…" />
        <select className="odoo-filter-dropdown" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          <option value="all">Tous les articles</option><option value="todo">Non comptés</option>{showTh && <option value="gaps">Avec écart</option>}
        </select>
        {editable && <button className="odoo-btn-secondary" onClick={() => setAdding(!adding)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Article hors liste</button>}
      </div>
      {adding && editable && <AddLine countId={c.id} kinds={c.item_kinds} onDone={() => { setAdding(false); refresh(); }} />}

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr>
            <th>Article</th><th>Unité</th>{showTh && <th style={{ textAlign: 'right' }}>Théorique</th>}<th style={{ width: 160 }}>Compté</th>
            {showTh && <th style={{ textAlign: 'right' }}>Écart</th>}{showTh && isDirection && <th style={{ textAlign: 'right' }}>Valeur</th>}
            {c.status === 'validated' && <th style={{ textAlign: 'right' }}>Ajusté</th>}<th>Compté par</th>
          </tr></thead>
          <tbody>{visible.map(l => {
            const g = gapOf(l);
            const th = l.theoretical_at_count ?? l.theoretical_at_start;
            return (
              <tr key={l.id}>
                <td>{l.item_name}<div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{l.category_name ?? (l.item_kind === 'packaging' ? 'Consommable' : '')}{l.container_size ? ` · contenant ${qty(l.container_size)} ${l.unit ?? ''}` : ''}</div></td>
                <td>{l.unit}</td>
                {showTh && <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{qty(th)}</td>}
                <td>
                  {editable ? (
                    <input style={{ ...field, textAlign: 'right', borderColor: l.counted_qty != null ? '#28a745' : undefined }} inputMode="decimal"
                      value={drafts[l.id] ?? (l.counted_qty != null ? qty(l.counted_qty).replace(/\s/g, '') : '')}
                      onChange={e => setDrafts({ ...drafts, [l.id]: e.target.value })}
                      onBlur={() => commit(l)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      aria-label={`Quantité comptée ${l.item_name}`} placeholder="—" />
                  ) : <span style={{ fontWeight: 600 }}>{l.counted_qty != null ? qty(l.counted_qty) : <span style={{ color: 'var(--theme-text-muted)' }}>non compté</span>}</span>}
                </td>
                {showTh && <td style={{ textAlign: 'right', fontWeight: g && Math.abs(g) > 0.0005 ? 600 : 400, color: g == null ? undefined : g < -0.0005 ? '#dc3545' : g > 0.0005 ? '#198754' : 'var(--theme-text-muted)' }}>
                  {g == null ? '' : `${g > 0 ? '+' : ''}${qty(g)}`}{g != null && Number(th) > 0 && Math.abs(g) / Number(th) > 0.2 && <AlertTriangle size={11} style={{ marginLeft: 4, color: '#b85d1a' }} aria-label="Écart supérieur à 20 %" />}
                </td>}
                {showTh && isDirection && <td style={{ textAlign: 'right' }}>{g == null || Math.abs(g) < 0.0005 ? '' : n2(g * Number(l.cost ?? 0))}</td>}
                {c.status === 'validated' && <td style={{ textAlign: 'right' }}>{l.applied_qty != null && Math.abs(Number(l.applied_qty)) > 0.0005 ? `${Number(l.applied_qty) > 0 ? '+' : ''}${qty(l.applied_qty)}` : '—'}</td>}
                <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{l.counted_by_name ?? ''}{l.counted_at ? ` · ${format(new Date(l.counted_at), 'dd/MM HH:mm')}` : ''}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {visible.length === 0 && <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucun article pour ce filtre.</p>}
      </div>
    </div>
  );
}

function AddLine({ countId, kinds, onDone }: { countId: string; kinds: StockCount['item_kinds']; onDone: () => void }) {
  const [value, setValue] = useState('');
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list, enabled: kinds !== 'packaging' });
  const { data: consumables = [] } = useQuery({ queryKey: ['packaging-items'], queryFn: () => packagingApi.list({ activeOnly: true }), enabled: kinds !== 'ingredient' });
  const options = [
    ...(kinds !== 'packaging' ? (ingredients as Record<string, any>[]).map(i => ({ id: `i:${i.id}`, label: String(i.name), sublabel: 'Matière' })) : []),
    ...(kinds !== 'ingredient' ? (consumables as Record<string, any>[]).map(p => ({ id: `p:${p.id}`, label: String(p.name), sublabel: 'Consommable' })) : []),
  ];
  const add = useMutation({
    mutationFn: () => stockCountsApi.addLine(countId, value.startsWith('i:') ? { ingredientId: value.slice(2) } : { packagingId: value.slice(2) }),
    onSuccess: () => { notify.success('Article ajouté à l\'inventaire'); onDone(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <SearchSelect options={options} value={value} onChange={setValue} placeholder="Article trouvé hors liste…" width={360} size="md" />
      <button className="odoo-btn-primary" disabled={!value || add.isPending} onClick={() => add.mutate()}>Ajouter</button>
      <button className="odoo-pager-btn" aria-label="Fermer" onClick={onDone}><X size={13} /></button>
    </div>
  );
}
