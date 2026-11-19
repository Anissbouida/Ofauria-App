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
import { money as fmtMoney } from '../../utils/money';
import TransferFormatDialog from './TransferFormatDialog';

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
  const { data: runs = [], isLoading } = useQuery({ queryKey: ['payment-runs'], queryFn: paymentRunsApi.list });
  const { data: modes } = useQuery({ queryKey: ['payment-modes'], queryFn: paymentsApi.modes });
  const banks = (modes?.treasuryAccounts ?? []).filter(t => t.kind === 'bank');
  const [formatOpen, setFormatOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatusBanner tone="info" icon={Banknote} title="Paiements fournisseurs en lot"
        actions={<span style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" className="odoo-btn-secondary" disabled={!banks.length} onClick={() => setFormatOpen(true)} title="Format du fichier attendu par le portail de la banque"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Settings2 size={14} /> Format banque</button>
          <button type="button" className="odoo-btn-primary" onClick={onNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Nouvelle campagne</button>
        </span>}>
        Regroupez les factures fournisseurs échues dans une campagne de virement : approbation, fichier pour la banque, puis exécution en un geste
        (règlements, écritures et lettrage créés pour chaque facture).
      </StatusBanner>
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : runs.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}>Aucune campagne pour l'instant.</div>
      ) : (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, overflowX: 'auto', background: 'var(--odoo-bg)' }}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Campagne</th><th style={{ textAlign: 'left' }}>Date de paiement</th><th style={{ textAlign: 'left' }}>Compte</th>
              <th style={{ textAlign: 'right' }}>Factures</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'left' }}>État</th><th style={{ textAlign: 'left' }}>Préparée par</th>
            </tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                  <td style={{ fontWeight: 500 }}>{r.run_number}</td>
                  <td>{dmy(r.payment_date)}</td>
                  <td>{r.treasury_label}</td>
                  <td style={{ textAlign: 'right' }}>{r.lines}{r.rejected ? ` (${r.rejected} rejetée${r.rejected > 1 ? 's' : ''})` : ''}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.total_amount)}</td>
                  <td><StatusTag tone={STATUS[r.status].tone} label={STATUS[r.status].label} /></td>
                  <td>{r.created_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const { data: candidates = [], isLoading } = useQuery({ queryKey: ['payment-run-candidates', dueBefore], queryFn: () => paymentRunsApi.candidates(dueBefore) });
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
        <button type="button" className="odoo-pager-btn" onClick={onBack} title="Retour aux campagnes"><ArrowLeft size={16} /></button>
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>Nouvelle campagne de paiement</span>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', fontSize: '0.85rem' }}>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontWeight: 500 }}>Factures échues au plus tard le</span>
          <input type="date" className="odoo-input" value={dueBefore} onChange={e => { setDueBefore(e.target.value); setPicked({}); }} /></label>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontWeight: 500 }}>Date du virement</span>
          <input type="date" className="odoo-input" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label>
        <label style={{ display: 'grid', gap: 4 }}><span style={{ fontWeight: 500 }}>Compte débité</span>
          <select className="odoo-input" value={bankId} onChange={e => setTreasuryId(e.target.value)} aria-label="Compte débité">
            {banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select></label>
      </div>

      {isLoading ? <Loader2 size={16} className="animate-spin" /> : bySupplier.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--theme-text-muted)' }}>Aucune facture payable à cette date (validée, non soldée, sans blocage, en dirhams).</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {bySupplier.map(([supplierId, g]) => {
            const supplierTotal = g.rows.filter(c => picked[c.invoice_id] !== undefined).reduce((t, c) => t + (Number(picked[c.invoice_id].replace(',', '.')) || 0), 0);
            return (
              <section key={supplierId} style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', overflowX: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--odoo-border)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  {!g.ribValid && <StatusTag tone="late" label="RIB manquant ou invalide" icon={AlertTriangle} title="À compléter sur la fiche fournisseur avant la soumission" />}
                  <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--theme-text-muted)' }}>Sélection : <strong style={{ color: 'var(--odoo-text)' }}>{money(supplierTotal)}</strong></span>
                </div>
                <table className="odoo-table" style={{ width: '100%' }}>
                  <thead><tr><th style={{ width: 36 }} /><th style={{ textAlign: 'left' }}>Facture</th><th style={{ textAlign: 'left' }}>Échéance</th>
                    <th style={{ textAlign: 'right' }}>Reste à payer</th><th style={{ textAlign: 'right' }}>À régler</th></tr></thead>
                  <tbody>
                    {g.rows.map(c => {
                      const on = picked[c.invoice_id] !== undefined;
                      return (
                        <tr key={c.invoice_id} style={{ opacity: c.open_run ? 0.55 : 1 }}>
                          <td><input type="checkbox" checked={on} disabled={!!c.open_run} onChange={() => toggle(c)} aria-label={`Sélectionner ${c.invoice_number}`} /></td>
                          <td>{c.supplier_invoice_number || c.invoice_number}{c.open_run && <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}> — déjà dans {c.open_run}</span>}</td>
                          <td>{dmy(c.due_date)}</td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(c.remaining)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {on ? <input className="odoo-input" type="text" inputMode="decimal" style={{ width: 120, textAlign: 'right' }} aria-label={`Montant pour ${c.invoice_number}`}
                              value={picked[c.invoice_id]} onChange={e => setPicked(p => ({ ...p, [c.invoice_id]: e.target.value }))} /> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}

      <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)' }}>
        <span>{selected.length} facture{selected.length > 1 ? 's' : ''} · <strong>{money(total)}</strong></span>
        {forecast && (
          <span style={{ fontSize: '0.8rem', color: forecast.firstBelowThreshold ? '#c62828' : 'var(--theme-text-muted)' }}
            title="Prévision de trésorerie avec ces factures payées à la date du virement (les autres à leur échéance)">
            {atDate ? `Solde prévu le ${dmy(paymentDate)} : ${money(atDate.balance)} · ` : ''}point bas sur 13 semaines : {money(forecast.minimum.balance)} le {dmy(forecast.minimum.date)}
            {forecast.firstBelowThreshold ? ' — sous le seuil d\'alerte' : ''}
          </span>
        )}
        <button type="button" className="odoo-btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
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
  const { data: run, isLoading } = useQuery({ queryKey: ['payment-run', id], queryFn: () => paymentRunsApi.get(id) });
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

  if (isLoading || !run) return <Loader2 size={16} className="animate-spin" />;
  const st = STATUS[run.status];
  const badRib = run.lines.some(l => !l.ribValid);
  const busy = act.isPending;
  const btn = (kind: 'submit' | 'file' | 'letter' | 'execute' | 'cancel', label: string, Icon: typeof Send, primary = false) => (
    <button type="button" className={primary ? 'odoo-btn-primary' : 'odoo-btn-secondary'} disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      onClick={async () => {
        if (kind === 'execute' && !(await confirm(`Exécuter la campagne ${run.run_number} ? ${run.lines.filter(l => l.status === 'pending').length} règlement(s) seront créés, avec leurs écritures. À faire une fois le virement remis à la banque.`, { title: 'Exécuter la campagne', confirmLabel: 'Exécuter' }))) return;
        if (kind === 'cancel' && !(await confirm(`Annuler la campagne ${run.run_number} ? Les factures redeviennent disponibles pour une autre campagne.`, { title: 'Annuler la campagne', confirmLabel: 'Annuler la campagne', danger: true }))) return;
        act.mutate(kind);
      }}>
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="odoo-pager-btn" onClick={onBack} title="Retour aux campagnes"><ArrowLeft size={16} /></button>
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{run.run_number}</span>
        <StatusTag tone={st.tone} label={st.label} />
        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>Virement du {dmy(run.payment_date)} · {run.treasury_label} · {money(run.total_amount)}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          {run.status === 'draft' && btn('submit', 'Soumettre', Send, true)}
          {['approved', 'file_generated', 'executed'].includes(run.status) && btn('file', 'Fichier de virement', Download, run.status === 'approved')}
          {['approved', 'file_generated', 'executed'].includes(run.status) && btn('letter', 'Lettre d\'ordre', FileText)}
          {run.status === 'file_generated' && btn('execute', 'Exécuter', Play, true)}
          {['draft', 'pending_approval', 'approved', 'file_generated'].includes(run.status) && btn('cancel', 'Annuler', X)}
        </span>
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

      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, overflowX: 'auto', background: 'var(--odoo-bg)' }}>
        <table className="odoo-table" style={{ width: '100%' }}>
          <thead><tr>
            <th style={{ textAlign: 'left' }}>Fournisseur</th><th style={{ textAlign: 'left' }}>Facture</th><th style={{ textAlign: 'left' }}>RIB</th>
            <th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'left' }}>État</th><th />
          </tr></thead>
          <tbody>
            {run.lines.map(l => (
              <tr key={l.id}>
                <td style={{ fontWeight: 500 }}>{l.supplier_name}</td>
                <td>{l.supplier_invoice_number || l.invoice_number}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: l.ribValid ? undefined : '#c62828' }}>{l.rib ?? 'absent'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.amount)}</td>
                <td>
                  <StatusTag tone={l.status === 'paid' ? 'done' : l.status === 'rejected' ? 'late' : 'draft'} label={l.status === 'paid' ? 'Réglée' : l.status === 'rejected' ? 'Rejetée' : 'À régler'} />
                  {l.reject_reason && <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}> — {l.reject_reason}</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {run.status === 'executed' && l.status === 'paid' && (
                    <button type="button" className="odoo-btn-secondary" onClick={() => setRejecting(l.id)}>Rejet bancaire</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
