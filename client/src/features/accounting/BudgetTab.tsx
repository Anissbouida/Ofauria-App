import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Target, Info, Lock, Unlock, Trash2, Save } from 'lucide-react';
import { managementApi, type BudgetComparison, type BudgetRow } from '../../api/management.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { money, currencySymbol } from '../../utils/money';
import { LoadingState, DataPanel, Segmented, SectionHeader, HeaderActions, ErrorState, FormSection, FormField } from '../../components/ds';
import { useConfirm, usePrompt } from '../../components/ui/ConfirmDialog';

/**
 * Comptabilité › Budget (mig 317) : budget annuel par compte du CPC et par mois,
 * comparé au réel comptabilisé. Comparaison au cumul à date (mois écoulés)
 * pour ne pas confronter un budget annuel à un réel partiel.
 * Contrôle budgétaire (mig 435) : engagé = BC envoyés ni reçus ni facturés ;
 * à l'envoi d'un BC, dépassement du disponible → alerte ou blocage.
 */

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const COLORS = { budget: 'var(--ds-info)', actual: 'var(--ds-warning)' };
const dh = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });

export default function BudgetTab() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<'compare' | 'edit'>('compare');
  const confirm = useConfirm();
  const { data, isLoading, error } = useQuery({ queryKey: ['budget', year], queryFn: () => managementApi.budget(year), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget', year] });
  const status = useMutation({
    mutationFn: (s: 'draft' | 'approved') => managementApi.setStatus(data!.budget!.id, s),
    onSuccess: (_r, s) => { refresh(); notify.success(s === 'approved' ? 'Budget approuvé' : 'Budget repassé en brouillon'); },
    onError: (e) => notify.error(e),
  });
  const control = useMutation({
    mutationFn: (c: { action: 'none' | 'warn' | 'block'; period: 'annual' | 'cumulative' }) => managementApi.setControl(data!.budget!.id, c),
    onSuccess: () => { refresh(); notify.success('Contrôle budgétaire mis à jour'); },
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
      <div className="prj-toolbar">
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ds-input sm" style={{ width: 'auto' }} aria-label="Exercice">
          {years.map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        {b && (
          <>
            <strong className="ds-strong">{b.name}</strong>
            <StatusTag tone={b.status === 'approved' ? 'done' : 'draft'} label={b.status === 'approved' ? 'Approuvé' : 'Brouillon'} />
            <Segmented label="Affichage" value={view} onChange={setView}
              options={[{ key: 'compare', label: 'Budget vs réel' }, { key: 'edit', label: 'Saisie' }]} />
            <span role="group" aria-label="Contrôle des BC" className="ds-period"
              title="Appliqué à l'envoi des bons de commande, budget approuvé seulement">
              Contrôle des BC
              <select value={b.control_action} disabled={control.isPending} onChange={e => control.mutate({ action: e.target.value as 'none' | 'warn' | 'block', period: b.control_period })}
                className="ds-input sm" style={{ width: 'auto' }} aria-label="Action sur dépassement">
                <option value="none">Aucun</option><option value="warn">Alerte</option><option value="block">Blocage</option>
              </select>
              <select value={b.control_period} disabled={control.isPending || b.control_action === 'none'} onChange={e => control.mutate({ action: b.control_action, period: e.target.value as 'annual' | 'cumulative' })}
                className="ds-input sm" style={{ width: 'auto' }} aria-label="Période de contrôle">
                <option value="annual">sur l'année</option><option value="cumulative">au cumul du mois</option>
              </select>
            </span>
            <HeaderActions>
              {b.status === 'draft' ? (
                <>
                  <button type="button" className="ds-btn-danger" disabled={remove.isPending}
                    onClick={async () => { if (await confirm(`Supprimer le budget ${year} ? Les montants saisis seront perdus.`, { title: 'Supprimer le budget', danger: true, confirmLabel: 'Supprimer' })) remove.mutate(); }}><Trash2 size={13} aria-hidden="true" /> Supprimer</button>
                  <button type="button" className="odoo-btn-primary" disabled={status.isPending} onClick={() => status.mutate('approved')}><Lock size={13} aria-hidden="true" /> Approuver</button>
                </>
              ) : (
                <button type="button" className="odoo-btn-secondary" disabled={status.isPending} onClick={() => status.mutate('draft')}><Unlock size={13} aria-hidden="true" /> Repasser en brouillon</button>
              )}
            </HeaderActions>
          </>
        )}
      </div>

      {error ? <ErrorState error={error} title="Budget indisponible" text={String((error as any)?.response?.data?.error?.message ?? error)} onRetry={refresh} />
        : isLoading || !data ? <LoadingState />
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
      <div className="ds-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FormSection title={`Nouveau budget ${year}`}>
          <div className="ds-form-grid cols-4">
            <FormField label="Point de départ" htmlFor="bud-init" required>
              <select id="bud-init" value={init} onChange={e => setInit(e.target.value as typeof init)} className="ds-input">
                <option value="previous_actual">Réel {year - 1}, mois par mois</option>
                <option value="empty">Budget vide</option>
              </select>
            </FormField>
            {init === 'previous_actual' && (
              <>
                <FormField label="Évolution des produits (%)" htmlFor="bud-rev">
                  <input id="bud-rev" type="number" value={revenuePct} onChange={e => setRevenuePct(Number(e.target.value))} className="ds-input" />
                </FormField>
                <FormField label="Évolution des charges (%)" htmlFor="bud-chg">
                  <input id="bud-chg" type="number" value={chargesPct} onChange={e => setChargesPct(Number(e.target.value))} className="ds-input" />
                </FormField>
              </>
            )}
          </div>
        </FormSection>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>Créer le budget {year}</button>
        </div>
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
  const askAmount = usePrompt();
  const spread = async (r: BudgetRow) => {
    const total = await askAmount(`${r.code} ${r.label} : le montant annuel est réparti à parts égales sur les 12 mois.`, {
      title: 'Répartir un montant annuel', label: 'Montant annuel', inputType: 'number', required: true, confirmLabel: 'Répartir',
    });
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
          <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Montants en {currencySymbol()} HT. « ÷12 » répartit un montant annuel.</span>
          <button type="button" className="odoo-btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()} style={{ marginLeft: 'auto' }}><Save size={13} /> Enregistrer{dirty ? ` (${dirty})` : ''}</button>
        </div>
      )}
      <DataPanel>
        <table className="odoo-table ds-dense" style={{ minWidth: 1200 }}>
          <thead><tr><th style={{ minWidth: 220 }}>Compte</th>{MONTHS.map(m => <th className="ds-num" key={m}>{m}</th>)}<th className="ds-num">Année ({currencySymbol()})</th><th className="ds-actions" /></tr></thead>
          <tbody>
            {[7, 6].map(cls => [
              <tr key={`h${cls}`} className="ds-group"><td colSpan={15}>{cls === 7 ? 'Produits' : 'Charges'}</td></tr>,
              ...rows.filter(r => r.account_class === cls).map(r => {
                const year = MONTHS.reduce((s, _, m) => s + num(value(r, m)), 0);
                return (
                  <tr key={r.id}>
                    <td><span className="ds-ref">{r.code}</span> {r.label}</td>
                    {MONTHS.map((mn, m) => (
                      <td key={m} style={{ padding: 2 }}>
                        <input value={value(r, m)} disabled={locked} inputMode="decimal" aria-label={`${r.label} ${mn}`}
                          onChange={e => setEdits(ed => ({ ...ed, [cellKey(r.id, m)]: e.target.value }))}
                          className="ds-input sm" style={{ width: 72, textAlign: 'right', background: edits[cellKey(r.id, m)] != null ? 'var(--ds-warning-bg)' : undefined }} />
                      </td>
                    ))}
                    <td className="ds-num ds-strong">{dh(year)}</td>
                    <td className="ds-actions">{!locked && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => spread(r)} title="Répartir un montant annuel">÷12</button>}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </DataPanel>
    </>
  );
}

/* ─── Budget vs réel ───────────────────────────────────────────────── */

function Variance({ budget, actual, cls }: { budget: number; actual: number; cls: 6 | 7 | 0 }) {
  const diff = actual - budget;
  // Favorable : plus de produits, moins de charges, meilleur résultat.
  const favorable = cls === 6 ? diff <= 0 : diff >= 0;
  const pct = budget !== 0 ? Math.round((diff / Math.abs(budget)) * 1000) / 10 : null;
  if (budget === 0 && actual === 0) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  return (
    <span style={{ color: favorable ? 'var(--ds-success)' : 'var(--ds-danger)', fontWeight: 600 }}>
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
  const rows = data.rows.filter(r => r.budget_year !== 0 || r.actual_year !== 0 || r.committed !== 0);
  const totalRow = (label: string, key: 'produits' | 'charges' | 'resultat', cls: 6 | 7 | 0) => {
    const t = data.totals[key];
    return (
      <tr key={key} className="ds-group">
        <td>{label}</td>
        <td className="ds-num">{dh(sumTo(t.budget))}</td>
        <td className="ds-num">{dh(sumTo(t.actual))}</td>
        <td className="ds-num"><Variance budget={sumTo(t.budget)} actual={sumTo(t.actual)} cls={cls} /></td>
        <td className="ds-num">{dh(t.budget.reduce((s, v) => s + v, 0))}</td>
        <td className="ds-num">{key === 'charges' ? dh(data.totals.charges.committed ?? 0) : ''}</td>
        <td />
      </tr>
    );
  };

  return (
    <>
      {n === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Exercice pas encore commencé">Le réel apparaîtra au fil des écritures comptabilisées.</StatusBanner>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
          Cumul à date : {n} mois ({MONTHS[0]} à {MONTHS[n - 1]}). Réel = écritures comptabilisées du magasin et écritures communes. Écart vert = favorable.
        </p>
      )}
      <div className="ds-panel" style={{ padding: '16px 16px 8px' }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 6 }}>Résultat mensuel ({currencySymbol()}) — budget et réel</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chart} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--ds-hair)" />
            <XAxis dataKey="mois" tick={{ fontSize: 11, fill: 'var(--ds-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--ds-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => dh(Number(v))} width={70} />
            <ReferenceLine y={0} stroke="var(--ds-muted)" />
            <Tooltip formatter={(v: number) => money(v, { decimals: 0 })} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Budget" fill={COLORS.budget} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="Réel" fill={COLORS.actual} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataPanel>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Compte</th><th className="ds-num">Budget à date ({currencySymbol()})</th><th className="ds-num">Réel à date ({currencySymbol()})</th><th className="ds-num">Écart ({currencySymbol()})</th><th className="ds-num">Budget annuel ({currencySymbol()})</th>
            <th className="ds-num" title="Bons de commande envoyés, ni reçus ni facturés">Engagé ({currencySymbol()})</th>
            <th className="ds-num" title="Budget annuel − réel − engagé">Disponible ({currencySymbol()})</th></tr></thead>
          <tbody>
            {[7, 6].map(cls => [
              ...rows.filter(r => r.account_class === cls).map(r => (
                <tr key={r.id}>
                  <td><span className="ds-ref">{r.code}</span> {r.label}</td>
                  <td className="ds-num">{dh(r.budget_ytd)}</td>
                  <td className="ds-num">{dh(r.actual_ytd)}</td>
                  <td className="ds-num"><Variance budget={r.budget_ytd} actual={r.actual_ytd} cls={r.account_class} /></td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{dh(r.budget_year)}</td>
                  <td className="ds-num">{cls === 6 && r.committed ? dh(r.committed) : ''}</td>
                  <td className="ds-num" style={{ fontWeight: 600, color: r.available < 0 ? 'var(--ds-danger)' : undefined }}>{cls === 6 && r.budget_year ? dh(r.available) : ''}</td>
                </tr>
              )),
              totalRow(cls === 7 ? 'Total produits' : 'Total charges', cls === 7 ? 'produits' : 'charges', cls as 6 | 7),
            ])}
          </tbody>
          <tfoot>{totalRow('Résultat', 'resultat', 0)}</tfoot>
        </table>
      </DataPanel>
    </>
  );
}

function StoreResults({ year }: { year: number }) {
  const { data = [] } = useQuery({ queryKey: ['result-by-store', year], queryFn: () => managementApi.resultByStore(year) });
  if (data.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionHeader title={`Résultat ${year} par magasin`} note="réel" />
      <DataPanel>
        <table className="odoo-table ds-dense">
          <thead><tr><th>Magasin</th><th className="ds-num">Produits ({currencySymbol()})</th><th className="ds-num">Charges ({currencySymbol()})</th><th className="ds-num">Résultat ({currencySymbol()})</th></tr></thead>
          <tbody>{data.map(s => (
            <tr key={s.store_id ?? 'none'}>
              <td>{s.store_name ?? 'Écritures communes (sans magasin)'}</td>
              <td className="ds-num">{dh(s.produits)}</td>
              <td className="ds-num">{dh(s.charges)}</td>
              <td className="ds-num" style={{ fontWeight: 600, color: s.resultat < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{dh(s.resultat)}</td>
            </tr>
          ))}</tbody>
        </table>
      </DataPanel>
    </div>
  );
}
