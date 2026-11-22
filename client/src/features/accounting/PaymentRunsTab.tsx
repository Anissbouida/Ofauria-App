import { cashForecastApi } from '../../api/ledger.api';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, CheckCircle2, Download, FileText, Loader2, Play, Plus, Send, Settings2, X, AlertTriangle } from 'lucide-react';
import { paymentRunsApi, paymentsApi, type PaymentRunCandidate, type PaymentRunStatus } from '../../api/accounting.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import ReasonCodeDialog from '../../components/purchasing/ReasonCodeDialog';
import { money as fmtMoney, currencySymbol } from '../../utils/money';
import TransferFormatDialog from './TransferFormatDialog';
import { LoadingState, ErrorState, DataPanel, EmptyState, TableFooter, HeaderActions, FormField, SectionHeader } from '../../components/ds';

/**
 * Paiements fournisseurs en lot (G4-01).
 *
 * Liste des campagnes, préparation (factures payables jusqu'à une date, regroupées par
 * fournisseur, montant modifiable pour un règlement partiel) et fiche d'une campagne avec
 * son circuit : soumettre → (approbation) → éditer le fichier → exécuter. Après
 * exécution, une ligne rejetée par la banque s'annule depuis la fiche.
 */

const STATUS: Record<PaymentRunStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Brouillon', tone: 'draft' },
  pending_approval: { label: 'En approbation', tone: 'progress' },
  approved: { label: 'Approuvée', tone: 'todo' },
  file_generated: { label: 'Fichier édité', tone: 'progress' },
  executed: { label: 'Exécutée', tone: 'done' },
  cancelled: { label: 'Annulée', tone: 'cancelled' },
};
const money = (n: number) => fmtMoney(n);
/** Montant sans devise (cellules de tableau : la devise est dans l'en-tête). */
const amt = (n: number) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
/** Date du jour en heure locale (toISOString donnerait la date UTC, le lendemain en soirée). */
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

export default function PaymentRunsTab() {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'run'; id: string }>({ kind: 'list' });
  if (view.kind === 'new') return <PrepareRun onBack={() => setView({ kind: 'list' })} onCreated={id => setView({ kind: 'run', id })} />;
  if (view.kind === 'run') return <RunDetail id={view.id} onBack={() => setView({ kind: 'list' })} />;
  return <RunList onNew={() => setView({ kind: 'new' })} onOpen={id => setView({ kind: 'run', id })} />;
}

function RunList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const { data: runs = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['payment-runs'], queryFn: paymentRunsApi.list });
  const { data: modes } = useQuery({ queryKey: ['payment-modes'], queryFn: paymentsApi.modes });
  const banks = (modes?.treasuryAccounts ?? []).filter(t => t.kind === 'bank');
  const [formatOpen, setFormatOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <HeaderActions>
        <button type="button" className="odoo-btn-secondary" disabled={!banks.length} onClick={() => setFormatOpen(true)} title="Format du fichier attendu par le portail de la banque"><Settings2 size={14} aria-hidden="true" /> Format banque</button>
        <button type="button" className="odoo-btn-primary" onClick={onNew}><Plus size={14} aria-hidden="true" /> Nouvelle campagne</button>
      </HeaderActions>
      <StatusBanner tone="info" icon={Banknote} title="Paiements fournisseurs en lot">
        Regroupez les factures fournisseurs échues dans une campagne de virement : approbation, fichier pour la banque, puis exécution en un geste
        (règlements, écritures et lettrage créés pour chaque facture).
      </StatusBanner>
      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : runs.length === 0 ? (
        <EmptyState icon={Banknote} title="Aucune campagne de paiement" text="Regroupez les factures échues dans une première campagne de virement."
          action={<button type="button" className="odoo-btn-primary" onClick={onNew}><Plus size={14} aria-hidden="true" /> Nouvelle campagne</button>} />
      ) : (
        <DataPanel label="Campagnes de paiement" footer={<TableFooter note={`${runs.length} campagne${runs.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table ds-dense">
            <thead><tr>
              <th>Campagne</th><th>Date de paiement</th><th>Compte</th>
              <th className="ds-num">Factures</th><th className="ds-num">Total ({currencySymbol()})</th><th>Statut</th><th>Préparée par</th>
            </tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                  <td className="ds-ref">{r.run_number}</td>
                  <td>{dmy(r.payment_date)}</td>
                  <td>{r.treasury_label}</td>
                  <td className="ds-num">{r.lines}{r.rejected ? ` (${r.rejected} rejetée${r.rejected > 1 ? 's' : ''})` : ''}</td>
                  <td className="ds-num ds-strong">{amt(r.total_amount)}</td>
                  <td><StatusTag tone={STATUS[r.status].tone} label={STATUS[r.status].label} /></td>
                  <td>{r.created_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
      {formatOpen && banks.length > 0 && (
        <TransferFormatDialog banks={banks} initialId={banks.find(b => b.is_default)?.id ?? banks[0].id} onClose={() => setFormatOpen(false)} />
      )}
    </div>
  );
}

function PrepareRun({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [dueBefore, setDueBefore] = useState(today());
  const [paymentDate, setPaymentDate] = useState(today());
  const [treasuryId, setTreasuryId] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});   // invoice_id → montant saisi
  const { data: candidates = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['payment-run-candidates', dueBefore], queryFn: () => paymentRunsApi.candidates(dueBefore) });
  const { data: modes } = useQuery({ queryKey: ['payment-modes'], queryFn: paymentsApi.modes });
  const banks = (modes?.treasuryAccounts ?? []).filter(t => t.kind === 'bank');
  const bankId = treasuryId || banks.find(b => b.is_default)?.id || banks[0]?.id || '';

  const bySupplier = useMemo(() => {
    const m = new Map<string, { name: string; ribValid: boolean; rows: PaymentRunCandidate[] }>();
    for (const c of candidates) {
      const g = m.get(c.supplier_id) ?? { name: c.supplier_name, ribValid: c.ribValid, rows: [] };
      g.rows.push(c); m.set(c.supplier_id, g);
    }
    return [...m.entries()];
  }, [candidates]);
  const selected = candidates.filter(c => picked[c.invoice_id] !== undefined);
  const total = selected.reduce((t, c) => t + (Number(picked[c.invoice_id].replace(',', '.')) || 0), 0);
  const toggle = (c: PaymentRunCandidate) => setPicked(p => {
    const { [c.invoice_id]: had, ...rest } = p;
    return had !== undefined ? rest : { ...p, [c.invoice_id]: String(c.remaining) };
  });

  // G4-03 : effet de la sélection sur le solde prévu (factures choisies payées à la date du virement).
  const selectedIds = selected.map(c => c.invoice_id).sort();
  const { data: forecast } = useQuery({
    queryKey: ['cash-forecast-sim', paymentDate, selectedIds.join(',')],
    queryFn: () => cashForecastApi.simulate({ planned: { date: paymentDate, invoiceIds: selectedIds } }),
    enabled: selectedIds.length > 0,
  });
  const atDate = forecast?.days.find(d => d.date === paymentDate) ?? null;

  const create = useMutation({
    mutationFn: () => paymentRunsApi.create({
      paymentDate, treasuryAccountId: bankId,
      lines: selected.map(c => ({ invoiceId: c.invoice_id, amount: Number(picked[c.invoice_id].replace(',', '.')) })),
    }),
    onSuccess: run => { qc.invalidateQueries({ queryKey: ['payment-runs'] }); notify.success(`Campagne ${run.run_number} créée`); onCreated(run.id); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Campagnes</button>
        <h2 className="ds-subhead" style={{ fontSize: 17 }}>Nouvelle campagne de paiement</h2>
      </div>
      <div className="prj-toolbar" style={{ alignItems: 'flex-end', gap: 16 }}>
        <FormField label="Factures échues au plus tard le" htmlFor="pr-due" required>
          <input id="pr-due" type="date" className="ds-input sm" style={{ width: 'auto' }} value={dueBefore} onChange={e => { setDueBefore(e.target.value); setPicked({}); }} />
        </FormField>
        <FormField label="Date du virement" htmlFor="pr-date" required>
          <input id="pr-date" type="date" className="ds-input sm" style={{ width: 'auto' }} value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
        </FormField>
        <FormField label="Compte débité" htmlFor="pr-bank" required>
          <select id="pr-bank" className="ds-input sm" style={{ width: 'auto' }} value={bankId} onChange={e => setTreasuryId(e.target.value)}>
            {banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </FormField>
      </div>

      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : bySupplier.length === 0 ? (
        <EmptyState icon={Banknote} title="Aucune facture payable à cette date" text="Seules les factures validées, non soldées, sans blocage et en dirhams entrent dans une campagne." />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {bySupplier.map(([supplierId, g]) => {
            const supplierTotal = g.rows.filter(c => picked[c.invoice_id] !== undefined).reduce((t, c) => t + (Number(picked[c.invoice_id].replace(',', '.')) || 0), 0);
            return (
              <div key={supplierId}>
                <SectionHeader title={<>{g.name}{!g.ribValid && <> <StatusTag tone="late" label="RIB manquant ou invalide" icon={AlertTriangle} title="À compléter sur la fiche fournisseur avant la soumission" /></>}</>}
                  note={<>Sélection : <strong className="ds-num" style={{ color: 'var(--ds-ink)' }}>{money(supplierTotal)}</strong></>} />
                <DataPanel label={`Factures de ${g.name}`}>
                <table className="odoo-table ds-dense">
                  <thead><tr><th style={{ width: 36 }} /><th>Facture</th><th>Échéance</th>
                    <th className="ds-num">Reste à payer ({currencySymbol()})</th><th className="ds-num">À régler ({currencySymbol()})</th></tr></thead>
                  <tbody>
                    {g.rows.map(c => {
                      const on = picked[c.invoice_id] !== undefined;
                      return (
                        <tr key={c.invoice_id} style={{ opacity: c.open_run ? 0.55 : 1 }}>
                          <td><input type="checkbox" checked={on} disabled={!!c.open_run} onChange={() => toggle(c)} aria-label={`Sélectionner ${c.invoice_number}`} /></td>
                          <td className="ds-ref">{c.supplier_invoice_number || c.invoice_number}{c.open_run && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}> — déjà dans {c.open_run}</span>}</td>
                          <td>{dmy(c.due_date)}</td>
                          <td className="ds-num">{amt(c.remaining)}</td>
                          <td className="ds-num">
                            {on ? <input className="ds-input sm" type="text" inputMode="decimal" style={{ width: 120, textAlign: 'right' }} aria-label={`Montant pour ${c.invoice_number}`}
                              value={picked[c.invoice_id]} onChange={e => setPicked(p => ({ ...p, [c.invoice_id]: e.target.value }))} /> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </DataPanel>
              </div>
            );
          })}
        </div>
      )}

      <div className="ds-panel" style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', overflow: 'visible' }}>
        <span>{selected.length} facture{selected.length > 1 ? 's' : ''} · <strong>{money(total)}</strong></span>
        {forecast && (
          <span style={{ fontSize: 13, color: forecast.firstBelowThreshold ? 'var(--ds-danger)' : 'var(--ds-muted)' }}
            title="Prévision de trésorerie avec ces factures payées à la date du virement (les autres à leur échéance)">
            {atDate ? `Solde prévu le ${dmy(paymentDate)} : ${money(atDate.balance)} · ` : ''}point bas sur 13 semaines : {money(forecast.minimum.balance)} le {dmy(forecast.minimum.date)}
            {forecast.firstBelowThreshold ? ' — sous le seuil d\'alerte' : ''}
          </span>
        )}
        <button type="button" className="odoo-btn-primary" style={{ marginLeft: 'auto' }}
          disabled={!selected.length || !bankId || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Créer la campagne
        </button>
      </div>
    </div>
  );
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const { data: run, isLoading, isError, error, refetch } = useQuery({ queryKey: ['payment-run', id], queryFn: () => paymentRunsApi.get(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payment-run', id] }); qc.invalidateQueries({ queryKey: ['payment-runs'] }); };
  const act = useMutation({
    mutationFn: async (kind: 'submit' | 'file' | 'letter' | 'execute' | 'cancel') => {
      if (kind === 'submit') return paymentRunsApi.submit(id);
      if (kind === 'file') return paymentRunsApi.transferFile(id);
      if (kind === 'letter') return paymentRunsApi.orderLetter(id);
      if (kind === 'execute') return paymentRunsApi.execute(id);
      return paymentRunsApi.cancel(id);
    },
    onSuccess: (out, kind) => {
      refresh();
      if (kind === 'submit') notify.success((out as { status: string }).status === 'approved' ? 'Campagne approuvée' : 'Campagne soumise à approbation');
      if (kind === 'execute') {
        const r = out as { executed: number; advices: number };
        notify.success(`${r.executed} règlement${r.executed > 1 ? 's' : ''} créé${r.executed > 1 ? 's' : ''}${r.advices ? `, ${r.advices} avis de paiement en file` : ''}`);
        qc.invalidateQueries({ queryKey: ['invoices'] });
      }
      if (kind === 'cancel') notify.success('Campagne annulée');
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: (v: { lineId: string; reasonCodeId: string; note: string }) => paymentRunsApi.rejectLine(v.lineId, v.reasonCodeId, v.note),
    onSuccess: () => { setRejecting(null); refresh(); notify.success('Ligne rejetée : règlement annulé, facture de nouveau à payer'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !run) return <LoadingState />;
  const st = STATUS[run.status];
  const badRib = run.lines.some(l => !l.ribValid);
  const busy = act.isPending;
  const btn = (kind: 'submit' | 'file' | 'letter' | 'execute' | 'cancel', label: string, Icon: typeof Send, primary = false) => (
    <button type="button" className={kind === 'cancel' ? 'ds-btn-danger' : primary ? 'odoo-btn-primary' : 'odoo-btn-secondary'} disabled={busy}
      onClick={async () => {
        if (kind === 'execute' && !(await confirm(`Exécuter la campagne ${run.run_number} ? ${run.lines.filter(l => l.status === 'pending').length} règlement(s) seront créés, avec leurs écritures. À faire une fois le virement remis à la banque.`, { title: 'Exécuter la campagne', confirmLabel: 'Exécuter' }))) return;
        if (kind === 'cancel' && !(await confirm(`Annuler la campagne ${run.run_number} ? Les factures redeviennent disponibles pour une autre campagne.`, { title: 'Annuler la campagne', confirmLabel: 'Annuler la campagne', danger: true }))) return;
        act.mutate(kind);
      }}>
      <Icon size={14} aria-hidden="true" /> {label}
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Campagnes</button>
        <h2 className="ds-subhead ds-ref" style={{ fontSize: 17 }}>{run.run_number}</h2>
        <StatusTag tone={st.tone} label={st.label} />
        <span style={{ color: 'var(--ds-muted)', fontSize: 13 }}>Virement du {dmy(run.payment_date)} · {run.treasury_label} · {money(run.total_amount)}</span>
        <HeaderActions>
          {['draft', 'pending_approval', 'approved', 'file_generated'].includes(run.status) && btn('cancel', 'Annuler', X)}
          {run.status === 'draft' && btn('submit', 'Soumettre', Send, true)}
          {['approved', 'file_generated', 'executed'].includes(run.status) && btn('file', 'Fichier de virement', Download, run.status === 'approved')}
          {['approved', 'file_generated', 'executed'].includes(run.status) && btn('letter', 'Lettre d\'ordre', FileText)}
          {run.status === 'file_generated' && btn('execute', 'Exécuter', Play, true)}
        </HeaderActions>
      </div>

      {run.status === 'draft' && badRib && (
        <StatusBanner tone="warning" icon={AlertTriangle} title="RIB à compléter">
          Un fournisseur de la campagne n'a pas de RIB valide : complétez sa fiche, puis recréez la campagne (le RIB est figé à la préparation).
        </StatusBanner>
      )}
      {run.status === 'pending_approval' && (
        <StatusBanner tone="info" icon={Send} title="En attente d'approbation">La campagne suit le circuit d'approbation des paiements (par défaut : un administrateur) ; le fichier s'édite une fois approuvée.</StatusBanner>
      )}
      {run.status === 'executed' && (
        <StatusBanner tone="success" icon={CheckCircle2} title="Campagne exécutée">
          Les règlements sont passés. Si la banque rejette un virement, annulez la ligne : le règlement est extourné et la facture redevient à payer.
        </StatusBanner>
      )}

      <DataPanel label="Lignes de la campagne">
        <table className="odoo-table ds-dense">
          <thead><tr>
            <th>Fournisseur</th><th>Facture</th><th>RIB</th>
            <th className="ds-num">Montant ({currencySymbol()})</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {run.lines.map(l => (
              <tr key={l.id}>
                <td className="ds-strong">{l.supplier_name}</td>
                <td className="ds-ref">{l.supplier_invoice_number || l.invoice_number}</td>
                <td className="ds-ref" style={{ color: l.ribValid ? undefined : 'var(--ds-danger)' }}>{l.rib ?? 'absent'}</td>
                <td className="ds-num">{amt(l.amount)}</td>
                <td>
                  <StatusTag tone={l.status === 'paid' ? 'done' : l.status === 'rejected' ? 'late' : 'draft'} label={l.status === 'paid' ? 'Réglée' : l.status === 'rejected' ? 'Rejetée' : 'À régler'} />
                  {l.reject_reason && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}> — {l.reject_reason}</span>}
                </td>
                <td className="ds-actions">
                  {run.status === 'executed' && l.status === 'paid' && (
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setRejecting(l.id)}>Rejet bancaire</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="ds-strong">Total</td><td className="ds-num ds-strong">{amt(run.total_amount)}</td><td colSpan={2} /></tr></tfoot>
        </table>
      </DataPanel>

      {rejecting && (
        <ReasonCodeDialog title="Rejet bancaire d'un virement" scope="void_payment"
          description="Le règlement est annulé par une contre-pièce, son écriture extournée ; la facture redevient à payer."
          confirmLabel="Annuler le règlement" danger pending={reject.isPending}
          onClose={() => setRejecting(null)}
          onSubmit={v => reject.mutate({ lineId: rejecting, reasonCodeId: v.reasonCodeId, note: v.note ?? '' })} />
      )}
    </div>
  );
}
