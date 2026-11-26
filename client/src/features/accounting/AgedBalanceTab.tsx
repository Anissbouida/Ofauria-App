import { usePermissions } from '../../context/PermissionsContext';
import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle, BellRing, Hourglass, Info } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { agedBalanceApi } from '../../api/ledger.api';
import type { AgedBucket, AgedItem, AgedSide } from '../../api/ledger.api';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { KpiCard, KpiGrid, LoadingState, SearchBar, DataPanel, EmptyState, NoResultState, TableFooter, Toolbar, Segmented, HeaderActions } from '../../components/ds';

/**
 * Balance âgée comptable : par tiers, les lignes non lettrées des comptes
 * fournisseurs (4411) ou clients (3421), classées par ancienneté d'échéance.
 * Son total égale le solde comptable des comptes de tiers à la même date.
 */

const BUCKETS: { key: AgedBucket; label: string }[] = [
  { key: 'current', label: 'Non échu' },
  { key: 'd30', label: '1-30 j' },
  { key: 'd60', label: '31-60 j' },
  { key: 'd90', label: '61-90 j' },
  { key: 'over90', label: '+ 90 j' },
];
const KIND_LABELS: Record<AgedItem['kind'], string> = {
  invoice: 'Facture', payment: 'Règlement non imputé', opening: 'À-nouveau', other: 'Écriture',
};
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as const;

function n(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return '';
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(raw: string): string {
  const [y, m, d] = raw.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = '﻿' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
const csvNum = (v: number) => v.toFixed(2).replace('.', ',');

export default function AgedBalanceTab() {
  const [side, setSide] = useState<AgedSide>('suppliers');
  const [asOf, setAsOf] = useState(today());
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['aged-balance', side, asOf],
    queryFn: () => agedBalanceApi.get(side, asOf),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(asOf),
  });

  const tiers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.tiers ?? []).filter(t =>
      (!q || t.label.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
      && (!onlyOverdue || t.overdue > 0.005));
  }, [data, search, onlyOverdue]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleExport = () => {
    if (!data) return;
    const rows: string[][] = [];
    for (const t of tiers) {
      rows.push([t.code, t.label, '', '', '', '', ...BUCKETS.map(b => csvNum(t.buckets[b.key])), csvNum(t.total)]);
      for (const i of t.items) {
        rows.push([t.code, '', KIND_LABELS[i.kind], i.reference, i.doc_date, i.due_date,
          ...BUCKETS.map(b => (b.key === i.bucket ? csvNum(i.amount) : '')), csvNum(i.amount)]);
      }
    }
    exportCSV(`balance_agee_${side === 'suppliers' ? 'fournisseurs' : 'clients'}_${asOf}.csv`,
      ['CODE', 'TIERS', 'PIECE', 'REFERENCE', 'DATE', 'ECHEANCE', ...BUCKETS.map(b => b.label.toUpperCase()), 'TOTAL'], rows);
  };

  const t = data?.totals;
  const concord = data ? Math.abs(data.totals.total - data.ledger_balance) < 0.005 : true;
  const isCustomers = side === 'customers';
  // Audit des profils (R1) : les tickets « à plus tard » n'existent qu'avec la caisse.
  const posOn = usePermissions().moduleActive('pos');

  return (
    <>
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={!tiers.length}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <EditionButtons kind="balance-agee" params={{ side, endDate: asOf }} />
      </HeaderActions>

      {data && t && (
        <>
        {concord ? (
          <StatusBanner tone="success" icon={CheckCircle2} title={`Concorde avec la comptabilité au ${fmtDate(data.as_of)}`}>
            Le total égale le solde des comptes {isCustomers ? 'clients' : 'fournisseurs'} du grand livre. Seules les lignes non lettrées y figurent : lettrez factures et règlements dans l'onglet Lettrage pour un classement juste.
          </StatusBanner>
        ) : (
          <StatusBanner tone="danger" icon={AlertTriangle} title="Écart avec la comptabilité">
            Total {n(t.total)} {currencySymbol()}, solde comptable {n(data.ledger_balance)} {currencySymbol()}.
          </StatusBanner>
        )}
        {isCustomers && posOn && (
          <StatusBanner tone="neutral" icon={Info} title="Tickets de caisse impayés"
            actions={<Link to="/dunning" className="odoo-btn-secondary"><BellRing size={13} /> Relances</Link>}>
            Un ticket « à plus tard » n'entre au grand livre qu'à son encaissement : il figure dans Ventes › Créances, pas ici. Les relances partent de là.
          </StatusBanner>
        )}
        <KpiGrid>
          <KpiCard label={isCustomers ? 'Total à recevoir' : 'Total dû'} value={n(t.total) || '0,00'} sub={<>{t.tiers} tiers · {currencySymbol()}</>} />
          <KpiCard label="Échu" value={n(t.overdue) || '0,00'} sub={<>{t.total > 0 ? `${Math.round((t.overdue / t.total) * 100)} % du total` : currencySymbol()}</>} tone={t.overdue > 0 ? 'red' : undefined} />
          <KpiCard label="Plus de 90 jours" value={n(t.buckets.over90) || '0,00'} sub={currencySymbol()} tone={t.buckets.over90 > 0 ? 'red' : undefined} />
        </KpiGrid>
        </>
      )}

      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder={isCustomers ? 'Filtrer un client…' : 'Filtrer un fournisseur…'} />
        <label className="ds-period">
          Arrêtée au
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="ds-input sm" style={{ width: 150 }} aria-label="Date de la balance" />
        </label>
        <label className="ds-period">
          <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> Échus seulement
        </label>
        <Segmented label="Tiers" value={side} onChange={s => { setSide(s); setExpanded(new Set()); }}
          options={[{ key: 'suppliers', label: 'Fournisseurs' }, { key: 'customers', label: 'Clients' }]} />
      </Toolbar>

      {isLoading ? (
        <LoadingState />
      ) : data && t && (
        <>
          {tiers.length === 0 ? (
            data.tiers.length === 0
              ? <EmptyState icon={Hourglass} title="Aucun solde ouvert" text="Toutes les pièces de ces tiers sont lettrées à cette date." />
              : <NoResultState text="Aucun tiers ne correspond aux filtres." onReset={() => { setSearch(''); setOnlyOverdue(false); }} />
          ) : (
            <DataPanel label="Balance âgée" footer={<TableFooter note={`${tiers.length} tiers${tiers.length !== data.tiers.length ? ' (filtré)' : ''} · montants en ${currencySymbol()}`} />}>
              <table className="odoo-table ds-dense" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th>{isCustomers ? 'Client' : 'Fournisseur'}</th>
                    {BUCKETS.map(b => <th className="ds-num" key={b.key} style={{ width: 105 }}>{b.label}</th>)}
                    <th className="ds-num" style={{ width: 115 }}>Total</th>
                    {isCustomers && <th className="ds-actions" style={{ width: 90 }}><span className="ds-sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {tiers.map(tr => {
                    const open = expanded.has(tr.auxiliary_id);
                    return (
                      <Fragment key={tr.auxiliary_id}>
                        <tr onClick={() => toggle(tr.auxiliary_id)} style={{ cursor: 'pointer' }}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                              <span className="ds-strong">{tr.label}</span>
                              <span className="ds-ref" style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>{tr.code}</span>
                              {tr.max_days_late > 90 && <StatusTag tone="late" label={`${tr.max_days_late} j`} title="Retard le plus ancien" />}
                            </span>
                          </td>
                          {BUCKETS.map(b => (
                            <td className="ds-num" key={b.key} style={{ color: b.key !== 'current' && tr.buckets[b.key] > 0 ? 'var(--ds-danger)' : undefined }}>{n(tr.buckets[b.key])}</td>
                          ))}
                          <td className="ds-num ds-strong">{n(tr.total) || '0,00'}</td>
                          {isCustomers && (
                            <td className="ds-actions" onClick={e => e.stopPropagation()}>
                              {tr.overdue > 0 && <Link to="/dunning" className="odoo-btn-secondary ds-btn-sm">Relancer</Link>}
                            </td>
                          )}
                        </tr>
                        {open && tr.items.map(i => (
                          <tr key={i.key} style={{ background: 'var(--ds-hair)', fontSize: '12px' }}>
                            <td style={{ paddingLeft: 32 }}>
                              <span style={{ color: 'var(--ds-muted)' }}>{KIND_LABELS[i.kind]}</span>{' '}
                              <span style={{ ...mono, color: 'var(--ds-info)' }}>{i.reference}</span>
                              {i.partial && <span style={{ marginLeft: 4 }}><StatusTag tone="progress" label="pré-lettré" title="Pièce et acomptes pré-lettrés : le montant est le reste dû" /></span>}
                              <span style={{ color: 'var(--ds-muted)' }}> · du {fmtDate(i.doc_date)} · échéance {fmtDate(i.due_date)}{i.days_late > 0 ? ` · ${i.days_late} j de retard` : ''}</span>
                            </td>
                            {BUCKETS.map(b => <td className="ds-num" key={b.key}>{b.key === i.bucket ? n(i.amount) : ''}</td>)}
                            <td className="ds-num">{n(i.amount)}</td>
                            {isCustomers && <td />}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total{tiers.length !== data.tiers.length ? ' (filtré)' : ''}</td>
                    {BUCKETS.map(b => <td className="ds-num" key={b.key}>{n(tiers.reduce((s, x) => s + x.buckets[b.key], 0))}</td>)}
                    <td className="ds-num">{n(tiers.reduce((s, x) => s + x.total, 0)) || '0,00'}</td>
                    {isCustomers && <td />}
                  </tr>
                </tfoot>
              </table>
            </DataPanel>
          )}
        </>
      )}
    </>
  );
}
