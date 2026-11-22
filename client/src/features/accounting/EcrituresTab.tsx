import { useState, useMemo, useEffect } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Download, Loader2, Notebook, Lock, FileText, Eye, Wand2, CheckCircle2, AlertTriangle, Filter, Plus, PenLine, Trash2, RotateCcw,
} from 'lucide-react';
import { journalEntriesApi, journalsApi, reconciliationApi, ledgerBackfillApi, manualEntriesApi, type JournalEntryDetailEx } from '../../api/ledger.api';
import ManualEntryEditor from './ManualEntryEditor';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PeriodFilter, SelectFilter, PAGE_SIZE, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import type { JournalEntryStatus, JournalEntrySummary } from '@ofauria/shared';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { EmptyState, KpiCard, KpiGrid, LoadingState, DataPanel, TableFooter, NoResultState, SearchBar, Toolbar } from '../../components/ds';
import { AccHeaderActions } from './AccHeaderActions';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';

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



/** Statut d'une écriture : étiquette commune (couleur + libellé), comme dans les autres listes. */
const STATUS_TONE: Record<JournalEntryStatus, StatusTone> = { draft: 'draft', posted: 'done', reversed: 'cancelled' };
function StatusDot({ status }: { status: JournalEntryStatus }) {
  return <StatusTag tone={STATUS_TONE[status]} label={STATUS_LABELS[status]} />;
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
  const confirm = useConfirm();
  useEffect(() => { setPage(1); }, [period, customFrom, customTo]);
  const [viewing, setViewing] = useState<string | null>(null);
  // Saisie libre (mig 418) : null = fermé ; draft = brouillon à reprendre.
  const [editor, setEditor] = useState<{ draft: JournalEntryDetailEx | null } | null>(null);
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
      notify.success(`${r.created} écriture(s) générée(s)${r.resynced ? ` · ${r.resynced} resynchronisée(s)` : ''}${r.lettered ? ` · ${r.lettered} facture(s) lettrée(s)` : ''}${r.skipped ? ` · ${r.skipped} déjà existante(s)` : ''}${r.errors ? ` · ${r.errors} erreur(s)` : ''}`);
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
      <EmptyState icon={Lock} title="Le journal des écritures est réservé à l'administrateur ou au gérant." />
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
                  onClick={async () => { if (await confirm('Générer les écritures manquantes depuis l\'historique ? L\'opération peut être relancée sans risque de doublon.', { title: 'Générer les écritures', confirmLabel: 'Générer' })) backfill.mutate(); }}>
                  {backfill.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Générer les écritures
                </button>
              )}
            </>
          ) : undefined}>
          {reconciliationOk ? 'Chaque facture a son écriture et les restes dus concordent.' : (
            <>
              {reconciliation.summary.divergent > 0 && `${reconciliation.summary.divergent} divergente${reconciliation.summary.divergent > 1 ? 's' : ''} · `}
              {reconciliation.summary.missing_entries > 0 && `${reconciliation.summary.missing_entries} sans écriture · `}
              écart total {reconciliation.summary.total_delta} {currencySymbol()}
            </>
          )}
        </StatusBanner>
      )}

      {/* Detail des factures divergentes / sans ecriture */}
      {reconciliation && !reconciliationOk && showDivergent && reconciliation.divergent.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid #F09595', borderRadius: 6, overflow: 'hidden' }}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr style={{ background: 'var(--ds-danger-bg)', color: 'var(--ds-danger)', textAlign: 'left' }}>
                <th style={{ padding: '6px 10px' }}>Facture</th>
                <th style={{ padding: '6px 10px' }}>Type</th>
                <th style={{ padding: '6px 10px' }}>Date</th>
                <th className="ds-num" style={{ padding: '6px 10px' }}>Total</th>
                <th className="ds-num" style={{ padding: '6px 10px' }}>Reste legacy</th>
                <th className="ds-num" style={{ padding: '6px 10px' }}>Reste ledger</th>
                <th className="ds-num" style={{ padding: '6px 10px' }}>Delta</th>
                <th style={{ padding: '6px 10px' }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.divergent.map(d => (
                <tr key={d.invoice_id} style={{ borderTop: '1px solid var(--ds-danger-bg)' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{d.invoice_number}</td>
                  <td style={{ padding: '6px 10px' }}>{d.invoice_type === 'emitted' ? 'Émise' : 'Reçue'}</td>
                  <td style={{ padding: '6px 10px' }}>{fmtDate(d.invoice_date)}</td>
                  <td className="ds-num" style={{ padding: '6px 10px' }}>{n(d.total_amount)}</td>
                  <td className="ds-num" style={{ padding: '6px 10px' }}>{n(d.legacy_remaining)}</td>
                  <td className="ds-num" style={{ padding: '6px 10px' }}>{n(d.ledger_remaining)}</td>
                  <td className="ds-num" style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--ds-danger)' }}>{n(d.delta)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    {!d.has_ledger_entries
                      ? <span style={{ color: 'var(--ds-warning)', background: 'var(--ds-warning-bg)', padding: '1px 6px', borderRadius: 4 }}>Sans écriture</span>
                      : <span style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', padding: '1px 6px', borderRadius: 4 }}>Divergente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filtres */}
      <AccHeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={rows.length === 0}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <EditionButtons kind="journal" params={{ startDate: startDate || undefined, endDate: endDate || undefined, journal: journals.find(j => j.id === journalId)?.code }} />
        <button type="button" onClick={() => setEditor({ draft: null })} className="odoo-btn-primary">
          <Plus size={13} aria-hidden="true" /> Nouvelle écriture
        </button>
      </AccHeaderActions>

      {/* Indicateurs de la page courante */}
      <KpiGrid>
        <KpiCard label="Écritures" value={total.toLocaleString('fr-FR')} sub="filtres appliqués" />
        <KpiCard label="Débit (page)" value={n(totals.debit)} sub={currencySymbol()} />
        <KpiCard label="Crédit (page)" value={n(totals.credit)} sub={currencySymbol()} />
      </KpiGrid>

      <Toolbar>
        <SearchBar value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Rechercher par numéro ou libellé…" />
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
      </Toolbar>

      {/* Liste */}
      {isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        (search || journalId !== 'all' || status !== 'all') ? (
          <NoResultState text="Aucune écriture ne correspond aux filtres." onReset={() => { setSearch(''); setJournalId('all'); setStatus('all'); setPage(1); }} />
        ) : (
          <EmptyState icon={Notebook} title="Aucune écriture comptable"
            text="Les nouvelles opérations (factures, paiements, ventes) génèrent leur écriture automatiquement. Pour comptabiliser l'historique déjà saisi, lancez la génération : elle peut être relancée sans risque de doublon."
            action={
              <button type="button" disabled={backfill.isPending} aria-busy={backfill.isPending || undefined} className="odoo-btn-primary"
                onClick={async () => { if (await confirm('Générer les écritures comptables pour tout l\'historique (factures, paiements, ventes) ? L\'opération peut être relancée sans risque de doublon.', { title: 'Générer les écritures', confirmLabel: 'Générer' })) backfill.mutate(); }}>
                {backfill.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}
                {backfill.isPending ? 'Génération en cours…' : 'Générer les écritures depuis l\'historique'}
              </button>
            } />
        )
      ) : (
        <DataPanel label="Journal des écritures" footer={
          <TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage}
            note={`débit ${n(totals.debit) || '0,00'} · crédit ${n(totals.credit) || '0,00'} ${currencySymbol()} sur la page · ${periodLabel(period, customFrom, customTo)}`} />
        }>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Date</th>
                <th style={{ width: 140 }}>N° d'écriture</th>
                <th style={{ width: 70 }}>Journal</th>
                <th>Libellé</th>
                <th className="ds-num" style={{ width: 120 }}>Débit ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 120 }}>Crédit ({currencySymbol()})</th>
                <th style={{ width: 140 }}>Statut</th>
                <th className="ds-actions" style={{ width: 60 }}><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e: JournalEntrySummary) => {
                return (
                  <tr key={e.id}>
                    <td>{fmtDate(e.entry_date)}</td>
                    <td>
                      <button type="button" onClick={() => setViewing(e.id)} title="Ouvrir l'écriture" className="ds-ref"
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ds-accent-ink)' }}>
                        {e.entry_number}
                      </button>
                    </td>
                    <td>{e.journal_code}</td>
                    <td className="ds-strong">{e.description || <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                    <td className="ds-num">
                      {n(e.total_debit)}
                    </td>
                    <td className="ds-num">
                      {n(e.total_credit)}
                    </td>
                    <td><StatusDot status={e.status} /></td>
                    <td className="ds-actions">
                      <button type="button" onClick={() => setViewing(e.id)} className="ds-icon-btn" title="Voir l'écriture" aria-label={`Voir l'écriture ${e.entry_number}`}>
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* Viewer modal en lecture seule */}
      {viewing && <JournalEntryViewer id={viewing} onClose={() => setViewing(null)}
        onEdit={(draft) => { setViewing(null); setEditor({ draft }); }} />}
      {editor && <ManualEntryEditor draft={editor.draft} onClose={() => setEditor(null)} />}
    </>
  );
}

function JournalEntryViewer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (draft: JournalEntryDetailEx) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: rawEntry, isLoading } = useQuery({
    queryKey: ['ledger-entry', id],
    queryFn: () => journalEntriesApi.getById(id),
  });
  const entry = rawEntry as JournalEntryDetailEx | undefined;
  // Actions de la saisie libre (mig 418) : brouillon de saisie, écriture manuelle comptabilisée.
  const isDraft = entry?.status === 'draft' && entry.source_kind === 'manual' && entry.source_detail === 'saisie';
  const canReverse = entry?.status === 'posted' && entry.source_kind === 'manual';
  const [reversing, setReversing] = useState<{ date: string; reason: string } | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-entry', id] });
  };
  const postM = useMutation({
    mutationFn: () => manualEntriesApi.post(id),
    onSuccess: (r) => { refresh(); notify.success(`Écriture ${r.entry_number} comptabilisée`); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Comptabilisation impossible')),
  });
  const deleteM = useMutation({
    mutationFn: () => manualEntriesApi.deleteDraft(id),
    onSuccess: () => { refresh(); notify.success('Brouillon supprimé'); onClose(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Suppression impossible')),
  });
  const reverseM = useMutation({
    mutationFn: (p: { date: string; reason: string }) => manualEntriesApi.reverse(id, { date: p.date || null, reason: p.reason }),
    onSuccess: (r) => { refresh(); setReversing(null); notify.success(`Extournée par ${r.reversal_number ?? 'une contre-passation'}`); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Extourne impossible')),
  });
  const busy = postM.isPending || deleteM.isPending || reverseM.isPending;

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
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>{entry ? entry.entry_number : 'Chargement...'}</span>
          </div>
          {entry && <StatusDot status={entry.status} />}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        {isLoading || !entry ? (
          <LoadingState />
        ) : (
          <>
            {/* Meta */}
            <div style={{ padding: '12px 16px', fontSize: '0.8125rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Date :</span> {fmtDate(entry.entry_date)}</div>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Journal :</span> {entry.journal_code} - {entry.journal_label}</div>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Periode :</span> {String(entry.fiscal_month).padStart(2, '0')}/{entry.fiscal_year}</div>
              <div><span style={{ color: 'var(--theme-text-muted)' }}>Source :</span> {entry.source_kind === 'manual' && entry.source_detail === 'saisie' ? 'saisie libre' : entry.source_kind}</div>
              {(entry.piece_ref || entry.piece_date) && (
                <div><span style={{ color: 'var(--theme-text-muted)' }}>Pièce :</span> {entry.piece_ref || '—'}{entry.piece_date ? ` du ${fmtDate(entry.piece_date)}` : ''}</div>
              )}
              {entry.reversed_by_number && (
                <div><span style={{ color: 'var(--theme-text-muted)' }}>Extournée par :</span> <span style={{ fontFamily: 'ui-monospace, monospace' }}>{entry.reversed_by_number}</span></div>
              )}
              {entry.reversal_of_number && (
                <div><span style={{ color: 'var(--theme-text-muted)' }}>Extourne de :</span> <span style={{ fontFamily: 'ui-monospace, monospace' }}>{entry.reversal_of_number}</span></div>
              )}
              {entry.description && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--theme-text-muted)' }}>Libelle :</span> {entry.description}
                </div>
              )}
            </div>

            {/* Lignes */}
            <table className="odoo-table ds-dense" style={{ borderTop: '1px solid var(--theme-bg-separator)' }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Compte</th>
                  <th>Libelle / Tiers</th>
                  <th className="ds-num" style={{ width: 110 }}>Debit</th>
                  <th className="ds-num" style={{ width: 110 }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map(l => (
                  <tr key={l.id}>
                    <td className="ds-ref">{l.account_code}</td>
                    <td>
                      <div>{l.account_label}</div>
                      {l.auxiliary_label && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                          {l.auxiliary_code} — {l.auxiliary_label}
                        </div>
                      )}
                      {l.label && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                          {l.label}
                        </div>
                      )}
                    </td>
                    <td className="ds-num" style={{ color: 'var(--ds-info)' }}>
                      {n(l.debit)}
                    </td>
                    <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>
                      {n(l.credit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ds-num" colSpan={2}>Totaux :</td>
                  <td className="ds-num">
                    {n(totalD)}
                  </td>
                  <td className="ds-num">
                    {n(totalC)}
                  </td>
                </tr>
                {Math.abs(totalD - totalC) > 0.01 && (
                  <tr style={{ background: 'var(--ds-danger-bg)' }}>
                    <td colSpan={4} style={{ padding: '8px 14px', fontSize: '0.75rem', color: 'var(--ds-danger)' }}>
                      ⚠ Ecriture desequilibree : delta = {n(Math.abs(totalD - totalC))} {currencySymbol()}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>

            {(isDraft || canReverse) && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--theme-bg-separator)' }}>
                {reversing ? (
                  <form onSubmit={(e) => { e.preventDefault(); reverseM.mutate(reversing); }}
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Date de l'extourne
                      <input type="date" value={reversing.date} onChange={e => setReversing({ ...reversing, date: e.target.value })}
                        className="ds-input sm" style={{ width: 150, display: 'block' }} />
                    </label>
                    <label style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', flex: 1, minWidth: 240 }}>Motif <span className="ds-req" aria-hidden="true">*</span>
                      <input value={reversing.reason} onChange={e => setReversing({ ...reversing, reason: e.target.value })} autoFocus required
                        className="ds-input sm" style={{ width: '100%', display: 'block' }} placeholder="Ex. Erreur d'imputation" maxLength={500} />
                    </label>
                    <button type="button" className="odoo-btn-secondary" onClick={() => setReversing(null)} disabled={busy}>Retour</button>
                    <button type="submit" className="ds-btn-danger solid" disabled={busy || reversing.reason.trim().length < 3} aria-busy={reverseM.isPending || undefined}>
                      {reverseM.isPending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />} Extourner
                    </button>
                  </form>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    {isDraft && (
                      <>
                        <button type="button" className="ds-btn-danger" disabled={busy}
                          onClick={async () => { if (await confirm('Supprimer ce brouillon ? Il n\'a pas encore de numéro : aucun trou ne restera dans la numérotation.', { title: 'Supprimer le brouillon', danger: true, confirmLabel: 'Supprimer' })) deleteM.mutate(); }}>
                          <Trash2 size={12} aria-hidden="true" /> Supprimer
                        </button>
                        <button type="button" className="odoo-btn-secondary" disabled={busy} onClick={() => onEdit(entry)}>
                          <PenLine size={12} /> Modifier
                        </button>
                        <button type="button" className="odoo-btn-primary" disabled={busy || Math.abs(totalD - totalC) > 0.005}
                          onClick={async () => { if (await confirm('Comptabiliser ce brouillon ? Il recevra son numéro de journal et ne pourra plus être modifié (correction par extourne).', { title: 'Comptabiliser l\'écriture', confirmLabel: 'Comptabiliser' })) postM.mutate(); }}>
                          {postM.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Comptabiliser
                        </button>
                      </>
                    )}
                    {canReverse && (
                      <button type="button" className="ds-btn-danger" disabled={busy}
                        onClick={() => setReversing({ date: new Date().toISOString().slice(0, 10), reason: '' })}>
                        <RotateCcw size={12} aria-hidden="true" /> Extourner
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
