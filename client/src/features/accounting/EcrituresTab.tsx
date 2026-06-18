import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, X, Download, Loader2, Notebook, Lock, FileText, Calendar, ChevronLeft, ChevronRight, Eye, Wand2,
} from 'lucide-react';
import { journalEntriesApi, journalsApi, reconciliationApi, ledgerBackfillApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
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

const PAGE_SIZE = 50;

export default function EcrituresTab() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [journalId, setJournalId] = useState<string>('all');
  const [status, setStatus] = useState<JournalEntryStatus | 'all'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

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
    offset: page * PAGE_SIZE,
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
      notify.success(`${r.created} écriture(s) générée(s)${r.skipped ? ` · ${r.skipped} déjà existante(s)` : ''}${r.errors ? ` · ${r.errors} erreur(s)` : ''}`);
    },
    onError: () => notify.error('Erreur lors de la génération des écritures'),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
          Le journal des ecritures est reserve a l'administrateur.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Bandeau de reconciliation legacy <-> ledger */}
      {reconciliation && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 6,
          marginBottom: 12,
          background: reconciliationOk ? '#E1F5EE' : '#FCEBEB',
          color: reconciliationOk ? '#085041' : '#791F1F',
          border: `1px solid ${reconciliationOk ? '#5DCAA5' : '#F09595'}`,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8125rem',
        }}>
          <span style={{ fontSize: '1rem' }}>{reconciliationOk ? '✓' : '⚠'}</span>
          <strong>Reconciliation legacy ↔ ledger :</strong>
          <span>
            {reconciliation.summary.aligned}/{reconciliation.summary.total_invoices} factures alignees
            {reconciliation.summary.divergent > 0 && ` · ${reconciliation.summary.divergent} divergentes`}
            {reconciliation.summary.missing_entries > 0 && ` · ${reconciliation.summary.missing_entries} sans ecriture`}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace' }}>
            delta total: {reconciliation.summary.total_delta} DH
          </span>
          {reconciliation.summary.missing_entries > 0 && (
            <button onClick={() => { if (window.confirm('Générer les écritures manquantes depuis l\'historique ? Opération idempotente.')) backfill.mutate(); }}
              disabled={backfill.isPending}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #791F1F', background: '#fff', color: '#791F1F', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500 }}>
              {backfill.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Générer
            </button>
          )}
        </div>
      )}

      {/* Filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder="Rechercher par n ou libelle..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
          {search && (
            <button onClick={() => { setSearch(''); setPage(0); }} title="Effacer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <select value={journalId} onChange={e => { setJournalId(e.target.value); setPage(0); }}
          className="odoo-search-input" style={{ minWidth: 150 }}>
          <option value="all">Tous les journaux</option>
          {journals.map(j => (
            <option key={j.id} value={j.id}>{j.code} - {j.label}</option>
          ))}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value as JournalEntryStatus | 'all'); setPage(0); }}
          className="odoo-search-input" style={{ minWidth: 130 }}>
          <option value="all">Tous statuts</option>
          <option value="draft">Brouillon</option>
          <option value="posted">Comptabilise</option>
          <option value="reversed">Extournee</option>
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(0); }}
            className="odoo-search-input" style={{ width: 130 }} title="Date debut" />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(0); }}
            className="odoo-search-input" style={{ width: 130 }} title="Date fin" />
        </div>
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
                const sc = STATUS_COLORS[e.status];
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(e.entry_date)}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: '#185fa5' }}>{e.entry_number}</td>
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
                    <td>
                      <span style={{
                        fontSize: '0.625rem', padding: '2px 8px',
                        background: sc.bg, color: sc.color,
                        borderRadius: 999, fontWeight: 500,
                      }}>{STATUS_LABELS[e.status]}</span>
                    </td>
                    <td>
                      <button onClick={() => setViewing(e.id)} className="odoo-btn-secondary"
                        title="Voir l'ecriture"
                        style={{ padding: '4px 6px', display: 'inline-flex', alignItems: 'center' }}>
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderTop: '1px solid var(--theme-bg-separator)',
              fontSize: '0.75rem', color: 'var(--theme-text-muted)',
            }}>
              <span>
                Page {page + 1} / {totalPages} ({total.toLocaleString('fr-FR')} ecriture{total > 1 ? 's' : ''})
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="odoo-btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: page === 0 ? 0.5 : 1 }}>
                  <ChevronLeft size={12} /> Precedent
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="odoo-btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
                  Suivant <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
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
    <ModalBackdrop onClose={onClose}>
      <div style={{
        background: 'var(--theme-bg-card)',
        borderRadius: 8,
        maxWidth: 800,
        width: '95vw',
        maxHeight: '90vh',
        overflow: 'auto',
        padding: 0,
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--theme-bg-separator)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <FileText size={16} />
          <strong style={{ fontSize: '0.9375rem' }}>
            {entry ? entry.entry_number : 'Chargement...'}
          </strong>
          {entry && (
            <span style={{
              fontSize: '0.625rem', padding: '2px 8px',
              background: STATUS_COLORS[entry.status].bg, color: STATUS_COLORS[entry.status].color,
              borderRadius: 999, fontWeight: 500,
            }}>{STATUS_LABELS[entry.status]}</span>
          )}
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            padding: 4, color: 'var(--theme-text-muted)',
          }}>
            <X size={16} />
          </button>
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
