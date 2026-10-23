import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Loader2, Target, CheckCircle2, Info, Lock, Unlock, Trash2, Save } from 'lucide-react';
import { managementApi, type BudgetComparison, type BudgetRow } from '../../api/management.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Comptabilité › Budget (mig 317) : budget annuel par compte du CPC et par mois,
 * comparé au réel comptabilisé. Comparaison au cumul à date (mois écoulés)
 * pour ne pas confronter un budget annuel à un réel partiel.
 */

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const COLORS = { budget: '#2a78d6', actual: '#eb6834' };
const dh = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 };

export default function BudgetTab() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<'compare' | 'edit'>('compare');
  const { data, isLoading, error } = useQuery({ queryKey: ['budget', year], queryFn: () => managementApi.budget(year), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget', year] });
  const status = useMutation({
    mutationFn: (s: 'draft' | 'approved') => managementApi.setStatus(data!.budget!.id, s),
    onSuccess: (_r, s) => { refresh(); notify.success(s === 'approved' ? 'Budget approuvé' : 'Budget repassé en brouillon'); },
    onError: (e) => notify.error(e),
  });
  const remove = useMutation({
    mutationFn: () => managementApi.deleteBudget(data!.budget!.id),
    onSuccess: () => { refresh(); notify.success('Budget supprimé'); },
    onError: (e) => notify.error(e),
  });

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
  const b = data?.budget;

  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-search-input" aria-label="Exercice">
          {years.map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        {b && (
          <>
            <strong style={{ fontSize: '0.8125rem' }}>{b.name}</strong>
            <span className={`odoo-tag ${b.status === 'approved' ? 'odoo-tag-green' : 'odoo-tag-yellow'}`}>{b.status === 'approved' ? 'Approuvé' : 'Brouillon'}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={view === 'compare' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('compare')}>Budget vs réel</button>
              <button type="button" className={view === 'edit' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView('edit')}>Saisie</button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {b.status === 'draft' ? (
                <>
                  <button type="button" className="odoo-btn-primary" disabled={status.isPending} onClick={() => status.mutate('approved')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lock size={13} /> Approuver</button>
                  <button type="button" className="odoo-btn-danger" aria-label="Supprimer le budget" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Supprimer le budget ${year} ?`)) remove.mutate(); }}><Trash2 size={13} /></button>
                </>
              ) : (
                <button type="button" className="odoo-btn-secondary" disabled={status.isPending} onClick={() => status.mutate('draft')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Unlock size={13} /> Repasser en brouillon</button>
              )}
            </div>
          </>
        )}
      </div>

      {error ? <StatusBanner tone="danger" icon={Info} title="Budget indisponible">{String((error as any)?.response?.data?.error?.message ?? error)}</StatusBanner>
        : isLoading || !data ? <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Loader2 size={20} className="animate-spin" /></div>
        : !b ? <CreateBudget year={year} onCreated={refresh} />
          : view === 'edit' ? <EditGrid key={b.id} budgetId={b.id} rows={data.rows} locked={b.status === 'approved'} onSaved={refresh} />
            : <Comparison data={data} />}
      <StoreResults year={year} />
    </>
  );
}

/* ─── Création ─────────────────────────────────────────────────────── */

function CreateBudget({ year, onCreated }: { year: number; onCreated: () => void }) {
  const [init, setInit] = useState<'empty' | 'previous_actual'>('previous_actual');
  const [revenuePct, setRevenuePct] = useState(5);
  const [chargesPct, setChargesPct] = useState(3);
  const create = useMutation({
    mutationFn: () => managementApi.createBudget({ year, name: `Budget ${year}`, init, revenuePct, chargesPct }),
    onSuccess: () => { onCreated(); notify.success(`Budget ${year} créé`); },
    onError: (e) => notify.error(e),
  });
  return (
    <>
      <StatusBanner tone="info" icon={Target} title={`Pas encore de budget pour ${year}`}>
        Le budget se saisit par compte du CPC (charges et produits) et par mois. Le plus simple : partir du réel {year - 1} et appliquer une hausse attendue.
      </StatusBanner>
      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Point de départ
          <select value={init} onChange={e => setInit(e.target.value as typeof init)} className="odoo-search-input">
            <option value="previous_actual">Réel {year - 1}, mois par mois</option>
            <option value="empty">Budget vide</option>
          </select>
        </label>
        {init === 'previous_actual' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              Évolution des produits (%)
              <input type="number" value={revenuePct} onChange={e => setRevenuePct(Number(e.target.value))} className="odoo-search-input" style={{ width: 110 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              Évolution des charges (%)
              <input type="number" value={chargesPct} onChange={e => setChargesPct(Number(e.target.value))} className="odoo-search-input" style={{ width: 110 }} />
            </label>
          </>
        )}
        <button type="button" className="odoo-btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>Créer le budget {year}</button>
      </div>
    </>
  );
}

/* ─── Saisie ───────────────────────────────────────────────────────── */

function EditGrid({ budgetId, rows, locked, onSaved }: { budgetId: string; rows: BudgetRow[]; locked: boolean; onSaved: () => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const cellKey = (accountId: string, m: number) => `${accountId}|${m}`;
  const value = (r: BudgetRow, m: number) => edits[cellKey(r.id, m)] ?? (r.budget[m] ? String(Math.round(r.budget[m] * 100) / 100) : '');
  const num = (s: string) => { const n = Number(s.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const save = useMutation({
    mutationFn: () => managementApi.saveLines(budgetId, Object.entries(edits).map(([k, v]) => {
      const [account_id, m] = k.split('|');
      return { account_id, month: Number(m) + 1, amount: num(v) };
    })),
    onSuccess: () => { setEdits({}); onSaved(); notify.success('Budget enregistré'); },
    onError: (e) => notify.error(e),
  });
  const spread = (r: BudgetRow) => {
    const total = window.prompt(`Montant annuel pour ${r.code} ${r.label} (réparti sur 12 mois)`);
    if (total == null || total.trim() === '') return;
    const monthly = Math.round((num(total) / 12) * 100) / 100;
    setEdits(e => ({ ...e, ...Object.fromEntries(MONTHS.map((_, m) => [cellKey(r.id, m), String(monthly)])) }));
  };
  const dirty = Object.keys(edits).length;

  return (
    <>
      {locked ? (
        <StatusBanner tone="neutral" icon={Lock} title="Budget approuvé : saisie verrouillée">Repassez-le en brouillon pour le modifier.</StatusBanner>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Montants en DH HT. « ÷12 » répartit un montant annuel.</span>
          <button type="button" className="odoo-btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={13} /> Enregistrer{dirty ? ` (${dirty})` : ''}</button>
        </div>
      )}
      <div style={tableWrap}>
        <table className="odoo-table" style={{ margin: 0, minWidth: 1200 }}>
          <thead><tr><th style={{ minWidth: 220 }}>Compte</th>{MONTHS.map(m => <th key={m} style={{ textAlign: 'right' }}>{m}</th>)}<th style={{ textAlign: 'right' }}>Année</th><th /></tr></thead>
          <tbody>
            {[7, 6].map(cls => [
              <tr key={`h${cls}`}><td colSpan={15} style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem' }}>{cls === 7 ? 'Produits' : 'Charges'}</td></tr>,
              ...rows.filter(r => r.account_class === cls).map(r => {
                const year = MONTHS.reduce((s, _, m) => s + num(value(r, m)), 0);
                return (
                  <tr key={r.id}>
                    <td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{r.code}</span> {r.label}</td>
                    {MONTHS.map((mn, m) => (
                      <td key={m} style={{ padding: 2 }}>
                        <input value={value(r, m)} disabled={locked} inputMode="decimal" aria-label={`${r.label} ${mn}`}
                          onChange={e => setEdits(ed => ({ ...ed, [cellKey(r.id, m)]: e.target.value }))}
                          className="odoo-search-input" style={{ width: 72, textAlign: 'right', padding: '4px 6px', background: edits[cellKey(r.id, m)] != null ? '#fff8e8' : undefined }} />
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{dh(year)}</td>
                    <td>{!locked && <button type="button" className="odoo-btn-secondary" onClick={() => spread(r)} title="Répartir un montant annuel">÷12</button>}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ─── Budget vs réel ───────────────────────────────────────────────── */

function Variance({ budget, actual, cls }: { budget: number; actual: number; cls: 6 | 7 | 0 }) {
  const diff = actual - budget;
  // Favorable : plus de produits, moins de charges, meilleur résultat.
  const favorable = cls === 6 ? diff <= 0 : diff >= 0;
  const pct = budget !== 0 ? Math.round((diff / Math.abs(budget)) * 1000) / 10 : null;
  if (budget === 0 && actual === 0) return <span style={{ color: 'var(--theme-text-muted)' }}>—</span>;
  return (
    <span style={{ color: favorable ? '#155724' : '#dc3545', fontWeight: 600 }}>
      {diff >= 0 ? '+' : ''}{dh(diff)}{pct != null && <span style={{ fontWeight: 400, fontSize: '0.6875rem' }}> ({pct >= 0 ? '+' : ''}{pct} %)</span>}
    </span>
  );
}

function Comparison({ data }: { data: BudgetComparison }) {
  const n = data.elapsed_months;
  const sumTo = (arr: number[]) => arr.slice(0, n).reduce((s, v) => s + v, 0);
  const chart = useMemo(() => MONTHS.map((m, i) => ({
    mois: m,
    Budget: Math.round(data.totals.resultat.budget[i]),
    Réel: i < n ? Math.round(data.totals.resultat.actual[i]) : null,
  })), [data, n]);
  const rows = data.rows.filter(r => r.budget_year !== 0 || r.actual_year !== 0);
  const totalRow = (label: string, key: 'produits' | 'charges' | 'resultat', cls: 6 | 7 | 0) => {
    const t = data.totals[key];
    return (
      <tr key={key} style={{ fontWeight: 700, background: 'var(--odoo-bg-hover)' }}>
        <td>{label}</td>
        <td style={{ textAlign: 'right' }}>{dh(sumTo(t.budget))}</td>
        <td style={{ textAlign: 'right' }}>{dh(sumTo(t.actual))}</td>
        <td style={{ textAlign: 'right' }}><Variance budget={sumTo(t.budget)} actual={sumTo(t.actual)} cls={cls} /></td>
        <td style={{ textAlign: 'right' }}>{dh(t.budget.reduce((s, v) => s + v, 0))}</td>
      </tr>
    );
  };

  return (
    <>
      {n === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Exercice pas encore commencé">Le réel apparaîtra au fil des écritures comptabilisées.</StatusBanner>
      ) : (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Cumul à date : {n} mois ({MONTHS[0]} à {MONTHS[n - 1]}). Réel = écritures comptabilisées du magasin et écritures communes. Écart vert = favorable.
        </p>
      )}
      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '12px 12px 4px' }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 6 }}>Résultat mensuel (DH) — budget et réel</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chart} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e9ecef" />
            <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#6c757d' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6c757d' }} axisLine={false} tickLine={false} tickFormatter={v => dh(Number(v))} width={70} />
            <ReferenceLine y={0} stroke="#adb5bd" />
            <Tooltip formatter={(v: number) => `${dh(v)} DH`} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Budget" fill={COLORS.budget} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="Réel" fill={COLORS.actual} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={tableWrap}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr><th>Compte</th><th style={{ textAlign: 'right' }}>Budget à date</th><th style={{ textAlign: 'right' }}>Réel à date</th><th style={{ textAlign: 'right' }}>Écart</th><th style={{ textAlign: 'right' }}>Budget annuel</th></tr></thead>
          <tbody>
            {[7, 6].map(cls => [
              ...rows.filter(r => r.account_class === cls).map(r => (
                <tr key={r.id}>
                  <td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{r.code}</span> {r.label}</td>
                  <td style={{ textAlign: 'right' }}>{dh(r.budget_ytd)}</td>
                  <td style={{ textAlign: 'right' }}>{dh(r.actual_ytd)}</td>
                  <td style={{ textAlign: 'right' }}><Variance budget={r.budget_ytd} actual={r.actual_ytd} cls={r.account_class} /></td>
                  <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{dh(r.budget_year)}</td>
                </tr>
              )),
              totalRow(cls === 7 ? 'Total produits' : 'Total charges', cls === 7 ? 'produits' : 'charges', cls as 6 | 7),
            ])}
            {totalRow('Résultat', 'resultat', 0)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StoreResults({ year }: { year: number }) {
  const { data = [] } = useQuery({ queryKey: ['result-by-store', year], queryFn: () => managementApi.resultByStore(year) });
  if (data.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} /> Résultat {year} par magasin (réel)</h3>
      <div style={tableWrap}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr><th>Magasin</th><th style={{ textAlign: 'right' }}>Produits</th><th style={{ textAlign: 'right' }}>Charges</th><th style={{ textAlign: 'right' }}>Résultat</th></tr></thead>
          <tbody>{data.map(s => (
            <tr key={s.store_id ?? 'none'}>
              <td>{s.store_name ?? 'Écritures communes (sans magasin)'}</td>
              <td style={{ textAlign: 'right' }}>{dh(s.produits)}</td>
              <td style={{ textAlign: 'right' }}>{dh(s.charges)}</td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: s.resultat < 0 ? '#dc3545' : '#155724' }}>{dh(s.resultat)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
