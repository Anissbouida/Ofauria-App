import { useState, useMemo, useEffect } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, X, Download, Loader2, Notebook, Lock, FileText, Calendar, ChevronLeft, ChevronRight, ChevronDown, Eye, Wand2,
  CheckCircle2, AlertTriangle, Filter,
} from 'lucide-react';
import { journalEntriesApi, journalsApi, reconciliationApi, ledgerBackfillApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PeriodFilter, SelectFilter, Pager, PAGE_SIZE, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import type { JournalEntryStatus, JournalEntrySummary, JournalEntryDetail } from '@ofauria/shared';

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '﻿';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function n(v: string | number): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(num) || num === 0) return '';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(raw: string | null): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  if (s.length !== 10) return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

const STATUS_LABELS: Record<JournalEntryStatus, string> = {
  draft: 'Brouillon',
  posted: 'Comptabilise',
  reversed: 'Extournee',
};

const STATUS_COLORS: Record<JournalEntryStatus, { bg: string; color: string }> = {
  draft:    { bg: '#FAEEDA', color: '#633806' },
  posted:   { bg: '#E1F5EE', color: '#085041' },
  reversed: { bg: '#F1EFE8', color: '#444441' },
};

const JOURNAL_COLORS: Record<string, { bg: string; color: string }> = {
  AC: { bg: '#FAECE7', color: '#712B13' },
  VE: { bg: '#E1F5EE', color: '#085041' },
  BQ: { bg: '#E6F1FB', color: '#0C447C' },
  CA: { bg: '#EEEDFE', color: '#3C3489' },
  OD: { bg: '#F1EFE8', color: '#444441' },
};

/** Statut d'une écriture : point de couleur + texte (même convention que les autres listes). */
const STATUS_DOT: Record<JournalEntryStatus, string> = { draft: '#d9822b', posted: '#28a745', reversed: '#adb5bd' };
function StatusDot({ status }: { status: JournalEntryStatus }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_DOT[status] }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function EcrituresTab() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [journalId, setJournalId] = useState<string>('all');
  const [status, setStatus] = useState<JournalEntryStatus | 'all'>('all');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = periodParams(period, customFrom, customTo);
  const startDate = range.dateFrom ?? '';
  const endDate = range.dateTo ?? '';
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [period, customFrom, customTo]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [showDivergent, setShowDivergent] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  // Tous les hooks DOIVENT etre appeles avant tout return conditionnel
  // (regle des hooks React : meme ordre a chaque render).
  const { data: journals = [] } = useQuery({
    queryKey: ['ledger-journals'],
    queryFn: () => journalsApi.list(),
    enabled: isAdmin,
  });

  const { data: reconciliation } = useQuery({
    queryKey: ['ledger-reconciliation'],
    queryFn: () => reconciliationApi.check(),
    enabled: isAdmin,
  });

  const filters = useMemo(() => ({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    journalId: journalId !== 'all' ? journalId : undefined,
    status: status !== 'all' ? status : undefined,
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }), [startDate, endDate, journalId, status, search, page]);

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-entries', filters],
    queryFn: () => journalEntriesApi.list(filters),
    enabled: isAdmin,
  });

  const queryClient = useQueryClient();
  const backfill = useMutation({
    mutationFn: () => ledgerBackfillApi.run(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-reconciliation'] });
      notify.success(`${r.created} écriture(s) générée(s)${r.resynced ? ` · ${r.resynced} resynchronisée(s)` : ''}${r.skipped ? ` · ${r.skipped} déjà existante(s)` : ''}${r.errors ? ` · ${r.errors} erreur(s)` : ''}`);
    },
    onError: () => notify.error('Erreur lors de la génération des écritures'),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const r of rows) { d += parseFloat(r.total_debit) || 0; c += parseFloat(r.total_credit) || 0; }
    return { debit: d, credit: c };
  }, [rows]);

  const handleExport = () => {
    const csvRows: string[][] = rows.map((r: JournalEntrySummary) => [
      r.entry_number,
      fmtDate(r.entry_date),
      r.journal_code,
      r.description || '',
      r.total_debit,
      r.total_credit,
      STATUS_LABELS[r.status],
    ]);
    exportCSV(
      `ecritures_${new Date().toISOString().slice(0, 10)}.csv`,
      ['N ECRITURE', 'DATE', 'JOURNAL', 'LIBELLE', 'DEBIT', 'CREDIT', 'STATUT'],
      csvRows
    );
  };

  const reconciliationOk = reconciliation
    && reconciliation.summary.divergent === 0
    && reconciliation.summary.missing_entries === 0;

  // Garde non-admin — apres tous les hooks (regle des hooks React)
  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>
          Le journal des ecritures est reserve a l'administrateur ou au gerant.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Réconciliation registre des factures ↔ comptabilité */}
      {reconciliation && (
        <StatusBanner
          tone={reconciliationOk ? 'success' : 'danger'}
          icon={reconciliationOk ? CheckCircle2 : AlertTriangle}
          title={`Réconciliation factures ↔ comptabilité : ${reconciliation.summary.aligned}/${reconciliation.summary.total_invoices} factures alignées`}
          actions={!reconciliationOk ? (
            <>
              {reconciliation.divergent.length > 0 && (
                <button type="button" className="odoo-btn-secondary" onClick={() => setShowDivergent(v => !v)}>
                  {showDivergent ? 'Masquer le détail' : 'Voir le détail'}
                </button>
              )}
              {reconciliation.summary.missing_entries > 0 && (
                <button type="button" className="odoo-btn-primary" disabled={backfill.isPending}
                  onClick={() => { if (window.confirm('Générer les écritures manquantes depuis l\'historique ? Opération idempotente.')) backfill.mutate(); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {backfill.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Générer les écritures
                </button>
              )}
            </>
          ) : undefined}>
          {reconciliationOk ? 'Chaque facture a son écriture et les restes dus concordent.' : (
            <>
              {reconciliation.summary.divergent > 0 && `${reconciliation.summary.divergent} divergente${reconciliation.summary.divergent > 1 ? 's' : ''} · `}
              {reconciliation.summary.missing_entries > 0 && `${reconciliation.summary.missing_entries} sans écriture · `}
              écart total {reconciliation.summary.total_delta} DH
            </>
          )}
        </StatusBanner>
      )}

      {/* Detail des factures divergentes / sans ecriture */}
      {reconciliation && !reconciliationOk && showDivergent && reconciliation.divergent.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid #F09595', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ background: '#FCEBEB', color: '#791F1F', textAlign: 'left' }}>
                <th style={{ padding: '6px 10px' }}>Facture</th>
                <th style={{ padding: '6px 10px' }}>Type</th>
                <th style={{ padding: '6px 10px' }}>Date</th>
                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Reste legacy</th>
                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Reste ledger</th>
                <th style={{ padding: '6px 10px', textAlign: 'right' }}>Delta</th>
                <th style={{ padding: '6px 10px' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.divergent.map(d => (
                <tr key={d.invoice_id} style={{ borderTop: '1px solid #F3D6D6' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{d.invoice_number}</td>
                  <td style={{ padding: '6px 10px' }}>{d.invoice_type === 'emitted' ? 'Émise' : 'Reçue'}</td>
                  <td style={{ padding: '6px 10px' }}>{fmtDate(d.invoice_date)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(d.total_amount)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(d.legacy_remaining)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(d.ledger_remaining)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#791F1F' }}>{n(d.delta)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    {!d.has_ledger_entries
                      ? <span style={{ color: '#633806', background: '#FAEEDA', padding: '1px 6px', borderRadius: 4 }}>Sans écriture</span>
                      : <span style={{ color: '#791F1F', background: '#FCEBEB', padding: '1px 6px', borderRadius: 4 }}>Divergente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder="Rechercher par n ou libelle..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1); }} title="Effacer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <SearchSelect
          options={journals.map(j => ({ id: j.id, label: `${j.code} - ${j.label}` }))}
          value={journalId === 'all' ? '' : journalId}
          onChange={id => { setJournalId(id || 'all'); setPage(1); }}
          placeholder="Tous les journaux"
          width={190}
        />
        <SelectFilter label="Statut" icon={Filter} value={status === 'all' ? '' : status}
          onChange={v => { setStatus((v || 'all') as JournalEntryStatus | 'all'); setPage(1); }}
          options={[{ key: 'draft', label: 'Brouillon' }, { key: 'posted', label: 'Comptabilisée' }, { key: 'reversed', label: 'Extournée' }]} />
        <PeriodFilter label="Date" title="Date de l'écriture"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary" disabled={rows.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: rows.length === 0 ? 0.5 : 1 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {/* Stats du page courant */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Total ecritures</div>
          <div className="odoo-stat-card-value">{total.toLocaleString('fr-FR')}</div>
          <div className="odoo-stat-card-sub">filtre applique</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Debit (page)</div>
          <div className="odoo-stat-card-value" style={{ color: '#1565c0' }}>{n(totals.debit)}</div>
          <div className="odoo-stat-card-sub">DH</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Credit (page)</div>
          <div className="odoo-stat-card-value" style={{ color: '#c62828' }}>{n(totals.credit)}</div>
          <div className="odoo-stat-card-sub">DH</div>
        </div>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Notebook size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.875rem', marginBottom: 4 }}>Aucune écriture comptable</p>
          <p style={{ fontSize: '0.75rem', opacity: 0.8, maxWidth: 520, margin: '0 auto 1rem' }}>
            Les nouvelles opérations (factures, paiements, ventes) génèrent leur écriture automatiquement.
            Pour comptabiliser l'<strong>historique déjà saisi</strong>, lancez la génération ci-dessous —
            l'opération est idempotente (relançable sans risque de doublon).
          </p>
          <button onClick={() => { if (window.confirm('Générer les écritures comptables pour tout l\'historique (factures, paiements, ventes) ? Opération idempotente.')) backfill.mutate(); }}
            disabled={backfill.isPending} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {backfill.isPending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {backfill.isPending ? 'Génération en cours...' : 'Générer les écritures depuis l\'historique'}
          </button>
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Date</th>
                <th style={{ width: 130 }}>N ecriture</th>
                <th style={{ width: 50 }}>Jr</th>
                <th>Libelle</th>
                <th style={{ width: 100, textAlign: 'right' }}>Debit</th>
                <th style={{ width: 100, textAlign: 'right' }}>Credit</th>
                <th style={{ width: 110 }}>Statut</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e: JournalEntrySummary) => {
                const jc = JOURNAL_COLORS[e.journal_code] || JOURNAL_COLORS.OD;
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(e.entry_date)}</td>
                    <td>
                      <button type="button" onClick={() => setViewing(e.id)} title="Ouvrir l'écriture"
                        style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', fontWeight: 600, color: 'var(--odoo-purple)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                        {e.entry_number}
                      </button>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.625rem', padding: '2px 6px',
                        background: jc.bg, color: jc.color,
                        borderRadius: 4, fontWeight: 500, fontFamily: 'ui-monospace, monospace',
                      }}>{e.journal_code}</span>
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>{e.description || <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>
                      {n(e.total_debit)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>
                      {n(e.total_credit)}
                    </td>
                    <td><StatusDot status={e.status} /></td>
                    <td>
                      <button type="button" onClick={() => setViewing(e.id)} className="odoo-pager-btn" title="Voir l'écriture" aria-label="Voir l'écriture">
                        <Eye size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Pager page={page} total={total} onPage={setPage}
            note={`${total.toLocaleString('fr-FR')} écriture${total > 1 ? 's' : ''} · ${periodLabel(period, customFrom, customTo)}`} />
        </div>
      )}

      {/* Viewer modal en lecture seule */}
      {viewing && <JournalEntryViewer id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function JournalEntryViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: entry, isLoading } = useQuery({
    queryKey: ['ledger-entry', id],
    queryFn: () => journalEntriesApi.getById(id),
  });

  const totalD = useMemo(() => {
    if (!entry) return 0;
    return entry.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  }, [entry]);
  const totalC = useMemo(() => {
    if (!entry) return 0;
    return entry.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  }, [entry]);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" aria-label="Écriture comptable" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <FileText size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Écriture</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>{entry ? entry.entry_number : 'Chargement...'}</span>
          </div>
          {entry && <StatusDot status={entry.status} />}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        {isLoading || !entry ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* Meta */}
            <div style={{ padding: '12px 16px', fontSize: '0.8125rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Date :</span> {fmtDate(entry.entry_date)}</div>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Journal :</span> {entry.journal_code} - {entry.journal_label}</div>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Periode :</span> {String(entry.fiscal_month).padStart(2, '0')}/{entry.fiscal_year}</div>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Source :</span> {entry.source_kind}</div>
              {entry.description && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--theme-text-muted)' }}>Libelle :</span> {entry.description}
                </div>
              )}
            </div>

            {/* Lignes */}
            <table className="odoo-table" style={{ margin: 0, borderTop: '1px solid var(--theme-bg-separator)' }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Compte</th>
                  <th>Libelle / Tiers</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Debit</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{l.account_code}</td>
                    <td>
                      <div>{l.account_label}</div>
                      {l.auxiliary_label && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                          {l.auxiliary_code} — {l.auxiliary_label}
                        </div>
                      )}
                      {l.label && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>
                          {l.label}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: '#1565c0' }}>
                      {n(l.debit)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: '#c62828' }}>
                      {n(l.credit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--theme-bg-secondary)', fontWeight: 600 }}>
                  <td colSpan={2} style={{ textAlign: 'right' }}>Totaux :</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>
                    {n(totalD)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>
                    {n(totalC)}
                  </td>
                </tr>
                {Math.abs(totalD - totalC) > 0.01 && (
                  <tr style={{ background: '#FCEBEB' }}>
                    <td colSpan={4} style={{ padding: '8px 14px', fontSize: '0.75rem', color: '#A32D2D' }}>
                      ⚠ Ecriture desequilibree : delta = {n(Math.abs(totalD - totalC))} DH
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
