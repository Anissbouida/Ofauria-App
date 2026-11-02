import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Download, Calendar, Search, X, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle, BellRing, Hourglass, Info } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { agedBalanceApi } from '../../api/ledger.api';
import type { AgedBucket, AgedItem, AgedSide } from '../../api/ledger.api';

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

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'hidden' }}>
          {(['suppliers', 'customers'] as AgedSide[]).map(s => (
            <button key={s} type="button" onClick={() => { setSide(s); setExpanded(new Set()); }}
              className={side === s ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ borderRadius: 0, border: 'none', fontSize: '0.75rem' }}>
              {s === 'suppliers' ? 'Fournisseurs' : 'Clients'}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>au</span>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="odoo-search-input" style={{ width: 140 }} aria-label="Date de la balance" />
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 180px', minWidth: 160 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder={isCustomers ? 'Filtrer un client…' : 'Filtrer un fournisseur…'} value={search} onChange={e => setSearch(e.target.value)} className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
          {search && <button type="button" onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)' }} aria-label="Effacer"><X size={12} /></button>}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
          <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> Échus seulement
        </label>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={!tiers.length}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: tiers.length ? 1 : 0.5 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : data && t && (
        <>
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">{isCustomers ? 'Total à recevoir' : 'Total dû'}</div>
              <div className="odoo-stat-card-value">{n(t.total) || '0,00'}</div>
              <div className="odoo-stat-card-sub">{t.tiers} tiers · DH</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Échu</div>
              <div className="odoo-stat-card-value" style={{ color: t.overdue > 0 ? '#c62828' : undefined }}>{n(t.overdue) || '0,00'}</div>
              <div className="odoo-stat-card-sub">{t.total > 0 ? `${Math.round((t.overdue / t.total) * 100)} % du total` : 'DH'}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Plus de 90 jours</div>
              <div className="odoo-stat-card-value" style={{ color: t.buckets.over90 > 0 ? '#c62828' : undefined }}>{n(t.buckets.over90) || '0,00'}</div>
              <div className="odoo-stat-card-sub">DH</div>
            </div>
          </div>

          {concord ? (
            <StatusBanner tone="success" icon={CheckCircle2} title={`Concorde avec la comptabilité au ${fmtDate(data.as_of)}`}>
              Le total égale le solde des comptes {isCustomers ? 'clients' : 'fournisseurs'} du grand livre. Seules les lignes non lettrées y figurent : lettrez factures et règlements dans l'onglet Lettrage pour un classement juste.
            </StatusBanner>
          ) : (
            <StatusBanner tone="danger" icon={AlertTriangle} title="Écart avec la comptabilité">
              Total {n(t.total)} DH, solde comptable {n(data.ledger_balance)} DH.
            </StatusBanner>
          )}
          {isCustomers && (
            <StatusBanner tone="neutral" icon={Info} title="Tickets de caisse impayés"
              actions={<Link to="/dunning" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><BellRing size={13} /> Relances</Link>}>
              Un ticket « à plus tard » n'entre au grand livre qu'à son encaissement : il figure dans Ventes › Créances, pas ici. Les relances partent de là.
            </StatusBanner>
          )}

          <div className="odoo-section" style={{ padding: 0, overflowX: 'auto' }}>
            {tiers.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                <Hourglass size={24} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
                Aucun solde ouvert.
              </div>
            ) : (
              <table className="odoo-table" style={{ margin: 0, minWidth: 820 }}>
                <thead>
                  <tr>
                    <th>{isCustomers ? 'Client' : 'Fournisseur'}</th>
                    {BUCKETS.map(b => <th key={b.key} style={{ width: 105, textAlign: 'right' }}>{b.label}</th>)}
                    <th style={{ width: 115, textAlign: 'right' }}>Total</th>
                    {isCustomers && <th style={{ width: 90 }} />}
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
                              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              <span style={{ fontWeight: 500 }}>{tr.label}</span>
                              <span style={{ ...mono, fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{tr.code}</span>
                              {tr.max_days_late > 90 && <span className="odoo-tag odoo-tag-red">{tr.max_days_late} j</span>}
                            </span>
                          </td>
                          {BUCKETS.map(b => (
                            <td key={b.key} style={{ ...mono, textAlign: 'right', color: b.key !== 'current' && tr.buckets[b.key] > 0 ? '#c62828' : undefined }}>{n(tr.buckets[b.key])}</td>
                          ))}
                          <td style={{ ...mono, textAlign: 'right', fontWeight: 600 }}>{n(tr.total) || '0,00'}</td>
                          {isCustomers && (
                            <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right' }}>
                              {tr.overdue > 0 && <Link to="/dunning" className="odoo-btn-secondary" style={{ fontSize: '0.6875rem', padding: '2px 8px' }}>Relancer</Link>}
                            </td>
                          )}
                        </tr>
                        {open && tr.items.map(i => (
                          <tr key={i.key} style={{ background: 'var(--theme-bg-tertiary)', fontSize: '0.75rem' }}>
                            <td style={{ paddingLeft: 32 }}>
                              <span style={{ color: 'var(--theme-text-muted)' }}>{KIND_LABELS[i.kind]}</span>{' '}
                              <span style={{ ...mono, color: '#185fa5' }}>{i.reference}</span>
                              <span style={{ color: 'var(--theme-text-muted)' }}> · du {fmtDate(i.doc_date)} · échéance {fmtDate(i.due_date)}{i.days_late > 0 ? ` · ${i.days_late} j de retard` : ''}</span>
                            </td>
                            {BUCKETS.map(b => <td key={b.key} style={{ ...mono, textAlign: 'right' }}>{b.key === i.bucket ? n(i.amount) : ''}</td>)}
                            <td style={{ ...mono, textAlign: 'right' }}>{n(i.amount)}</td>
                            {isCustomers && <td />}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--theme-bg-secondary)', fontWeight: 600 }}>
                    <td style={{ textAlign: 'right' }}>Total{tiers.length !== data.tiers.length ? ' (filtré)' : ''}</td>
                    {BUCKETS.map(b => <td key={b.key} style={{ ...mono, textAlign: 'right' }}>{n(tiers.reduce((s, x) => s + x.buckets[b.key], 0))}</td>)}
                    <td style={{ ...mono, textAlign: 'right' }}>{n(tiers.reduce((s, x) => s + x.total, 0)) || '0,00'}</td>
                    {isCustomers && <td />}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
