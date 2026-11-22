import { useState, useMemo, useRef } from 'react';
import { usePaymentModes, modeFromLegacy, PaymentModeSelect, CashLimitGauge, type CashOverride } from '../../components/purchasing/PaymentModeFields';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Coins, Plus, CalendarClock, Pencil, Repeat, Trash2, Power, Building2,
} from 'lucide-react';
import {
  paymentSchedulesApi, debtsApi, recurringChargesApi,
  paymentsApi, suppliersApi,
} from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { useReferentiel } from '../../hooks/useReferentiel';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusTag } from '../../components/ui/StatusTag';
import { money, currencySymbol } from '../../utils/money';
import { KpiCard, KpiGrid, LoadingState, ErrorState, Toolbar, EmptyState, SectionHeader, DataPanel, HeaderActions, Modal, FormSection, FormField, FormFooter, Alert } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';

/**
 * ECHEANCIER — le calendrier des sorties d'argent (migration 258).
 *
 * Repond a deux questions que l'onglet Dettes ne savait pas traiter :
 *
 *   « Combien je dois sortir ce mois-ci pour le four acheté à crédit ? »
 *     -> une facture (ou une dette sans facture) est découpée en N échéances.
 *
 *   « Le loyer de septembre est-il payé ? »
 *     -> un modèle de charge fixe génère les échéances à l'avance ; une charge
 *        non payée reste visible même si personne n'a rien saisi.
 *
 * Le REGLEMENT n'est pas un objet a part : c'est un `payment` ordinaire portant
 * scheduledPaymentId. La caisse, le suivi des cheques/traites et le grand livre
 * fonctionnent donc exactement comme pour une facture classique.
 */

function n(v: number) {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Meme parade timezone que AccountingPage : on ne passe jamais par `new Date`. */
function fmtDate(raw: unknown): string {
  if (!raw) return '—';
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function moisLabel(periode: string): string {
  const [y, m] = periode.split('-').map(Number);
  return `${MOIS[m - 1]} ${y}`;
}

const PERIODICITES: { value: number; label: string }[] = [
  { value: 1, label: 'Tous les mois' },
  { value: 2, label: 'Tous les 2 mois' },
  { value: 3, label: 'Tous les 3 mois (trimestre)' },
  { value: 6, label: 'Tous les 6 mois (semestre)' },
  { value: 12, label: 'Tous les ans' },
];

const SOURCE_LABELS: Record<string, string> = {
  invoice: 'Facture échelonnée',
  debt: 'Dette à crédit',
  recurring: 'Charge fixe',
};

type Echeance = {
  id: string;
  source_kind: 'invoice' | 'debt' | 'recurring';
  invoice_id: string | null;
  debt_id: string | null;
  recurring_charge_id: string | null;
  label: string;
  due_date: string;
  amount_due: string | null;
  amount_paid: string;
  remaining_amount: string;
  amount_pending: boolean;
  is_overdue: boolean;
  status: string;
  installment_no: number | null;
  installment_total: number | null;
  expected_payment_mode: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  category_id: string | null;
  category_name: string | null;
  invoice_number: string | null;
  debt_label: string | null;
};

type RecurringCharge = {
  id: string; label: string; category_id: string; category_name: string | null;
  supplier_id: string | null; supplier_name: string | null;
  amount: string | null; interval_months: number; due_day: number;
  start_date: string; end_date: string | null; is_active: boolean;
  expected_payment_mode: string | null; notes: string | null;
  next_due_date: string | null; overdue_count: number;
};

export default function EcheancierView() {
  const queryClient = useQueryClient();
  const { entries: paymentMethods } = useReferentiel('payment_methods');

  const [showAll, setShowAll] = useState(false);
  const [paying, setPaying] = useState<Echeance | null>(null);
  const [editingAmount, setEditingAmount] = useState<Echeance | null>(null);
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);

  const { data: echeances = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['payment-schedules', showAll],
    queryFn: () => paymentSchedulesApi.list({ status: showAll ? 'all' : 'open' }) as Promise<Echeance[]>,
  });

  /** Invalidation commune : l'echeance touche la caisse, les cheques et les dettes. */
  const refreshAll = () => {
    for (const key of [
      'payment-schedules', 'debts-list', 'recurring-charges', 'invoice-debts',
      'payments-charges', 'caisse-register', 'payments-checks',
      'invoice-payment-alerts', 'invoices',
    ]) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const createPayment = useMutation({
    mutationFn: (payload: Record<string, unknown>) => paymentsApi.create(payload),
    onSuccess: () => { refreshAll(); notify.success('Règlement enregistré'); setPaying(null); },
    onError: (err: unknown) => notify.error(apiMessage(err) || 'Erreur lors de l\'enregistrement'),
  });

  const updateEcheance = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      paymentSchedulesApi.update(id, data),
    onSuccess: () => { refreshAll(); notify.success('Échéance mise à jour'); setEditingAmount(null); },
    onError: (err: unknown) => notify.error(apiMessage(err) || 'Erreur lors de la mise à jour'),
  });

  /* ─── Regroupement par mois d'echeance ─── */
  const groupes = useMemo(() => {
    const map = new Map<string, Echeance[]>();
    for (const e of echeances) {
      const periode = String(e.due_date).slice(0, 7);
      if (!map.has(periode)) map.set(periode, []);
      map.get(periode)!.push(e);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([periode, rows]) => ({
        periode,
        rows,
        total: rows.reduce((s, r) => s + (parseFloat(r.remaining_amount) || 0), 0),
        // Une echeance sans montant (electricite pas encore recue) n'est pas
        // chiffrable : on la signale au lieu de la compter pour 0.
        indefinis: rows.filter(r => r.amount_pending).length,
      }));
  }, [echeances]);

  const stats = useMemo(() => {
    const moisCourant = format(new Date(), 'yyyy-MM');
    let retard = 0, ceMois = 0, aVenir = 0, nbRetard = 0, nbIndefinis = 0;
    for (const e of echeances) {
      if (e.status === 'paid' || e.status === 'cancelled') continue;
      const reste = parseFloat(e.remaining_amount) || 0;
      if (e.amount_pending) nbIndefinis++;
      if (e.is_overdue) { retard += reste; nbRetard++; }
      else if (String(e.due_date).slice(0, 7) === moisCourant) ceMois += reste;
      else aVenir += reste;
    }
    return { retard, ceMois, aVenir, nbRetard, nbIndefinis };
  }, [echeances]);

  return (
    <>
      {/* ─── Indicateurs ─── */}
      <KpiGrid>
        <KpiCard label="En retard" value={<>{n(stats.retard)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>{stats.nbRetard} échéance{stats.nbRetard > 1 ? 's' : ''} dépassée{stats.nbRetard > 1 ? 's' : ''}</>} tone={stats.retard > 0 ? 'red' : undefined} />
        <KpiCard label="Reste ce mois" value={<>{n(stats.ceMois)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub="Échéances non encore dépassées" />
        <KpiCard label="À venir" value={<>{n(stats.aVenir)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>{stats.nbIndefinis > 0
              ? `${stats.nbIndefinis} montant${stats.nbIndefinis > 1 ? 's' : ''} à renseigner`
              : 'Mois suivants'}</>} />
      </KpiGrid>

      {/* ─── Barre d'actions ─── */}
      <HeaderActions>
        <button type="button" onClick={() => setShowDebtForm(true)} className="odoo-btn-primary">
          <Plus size={13} aria-hidden="true" /> Dette à crédit
        </button>
      </HeaderActions>

      <Toolbar>
        <label htmlFor="ech-show-all" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input id="ech-show-all" type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Afficher aussi les échéances réglées
        </label>
        <span className="ds-grow" />
        <button type="button" onClick={() => setShowRecurring(v => !v)} className="odoo-btn-secondary ds-btn-sm" aria-pressed={showRecurring}>
          <Repeat size={13} aria-hidden="true" /> Charges fixes
        </button>
      </Toolbar>

      {showRecurring && <RecurringChargesPanel onClose={() => setShowRecurring(false)} onChanged={refreshAll} />}

      {/* ─── Calendrier ─── */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : groupes.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Aucune échéance à venir"
          text="Créez une dette à crédit pour du matériel acheté en plusieurs fois, ou une charge fixe pour que le loyer et l'électricité apparaissent chaque mois." />
      ) : (
        groupes.map(g => (
          <div key={g.periode} style={{ display: 'grid', gap: 8 }}>
            <SectionHeader title={<span style={{ textTransform: 'capitalize' }}>{moisLabel(g.periode)}</span>}
              note={<><strong className="ds-num" style={{ color: 'var(--ds-ink)' }}>{money(g.total)}</strong>{g.indefinis > 0 ? ` · ${g.indefinis} à chiffrer` : ''}</>} />
            <DataPanel label={`Échéances de ${moisLabel(g.periode)}`}>
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Échéance</th>
                  <th>Libellé</th>
                  <th>Type</th>
                  <th>Bénéficiaire</th>
                  <th className="ds-num">Montant dû ({currencySymbol()})</th>
                  <th className="ds-num">Payé ({currencySymbol()})</th>
                  <th className="ds-num">Reste ({currencySymbol()})</th>
                  <th className="ds-actions" style={{ width: 140 }}><span className="ds-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(e => {
                  const reste = parseFloat(e.remaining_amount) || 0;
                  const solde = e.status === 'paid';
                  return (
                    <tr key={e.id} style={solde ? { opacity: 0.55 } : undefined}>
                      <td style={{
                        whiteSpace: 'nowrap',
                        color: e.is_overdue && !solde ? 'var(--ds-danger)' : undefined,
                        fontWeight: e.is_overdue && !solde ? 600 : 400,
                      }}>
                        {fmtDate(e.due_date)}
                      </td>
                      <td>
                        <span className="ds-strong">{e.label}</span>
                        {e.installment_total && e.installment_total > 1 && (
                          <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--ds-muted)' }}>
                            {e.installment_no}/{e.installment_total}
                          </span>
                        )}
                        {e.category_name && (
                          <div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>{e.category_name}</div>
                        )}
                      </td>
                      <td>
                        {SOURCE_LABELS[e.source_kind]}
                        {e.invoice_number && <div className="ds-ref" style={{ fontWeight: 400, fontSize: 12 }}>{e.invoice_number}</div>}
                      </td>
                      <td>{e.supplier_name || '—'}</td>
                      <td className="ds-num">
                        {e.amount_pending
                          ? <StatusTag tone="todo" label="À chiffrer" />
                          : n(parseFloat(e.amount_due || '0'))}
                      </td>
                      <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>
                        {n(parseFloat(e.amount_paid) || 0)}
                      </td>
                      <td className="ds-num ds-strong">
                        {solde ? <StatusTag tone="done" label="Réglée" /> : e.amount_pending ? '—' : n(reste)}
                      </td>
                      <td className="ds-actions">
                        {!solde && (
                          <>
                            <button type="button" onClick={() => setPaying(e)} className="odoo-btn-secondary ds-btn-sm"
                              disabled={e.amount_pending}
                              title={e.amount_pending ? 'Renseignez d\'abord le montant' : 'Enregistrer le règlement'}>
                              <Coins size={12} aria-hidden="true" /> Payer
                            </button>
                            <RowMenu items={[{ label: 'Modifier le montant ou la date', icon: Pencil, onSelect: () => setEditingAmount(e) }]} />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="ds-strong">Reste du mois{g.indefinis > 0 ? ` (${g.indefinis} à chiffrer)` : ''}</td>
                  <td className="ds-num ds-strong">{n(g.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            </DataPanel>
          </div>
        ))
      )}

      {/* ─── Modal : regler une echeance ─── */}
      {paying && (
        <PayEcheanceModal
          echeance={paying}
          paymentMethods={paymentMethods as Array<{ code: string; label: string }>}
          pending={createPayment.isPending}
          onClose={() => setPaying(null)}
          onSubmit={payload => createPayment.mutate(payload)}
        />
      )}

      {/* ─── Modal : corriger montant / date ─── */}
      {editingAmount && (
        <EditEcheanceModal
          echeance={editingAmount}
          pending={updateEcheance.isPending}
          onClose={() => setEditingAmount(null)}
          onSubmit={data => updateEcheance.mutate({ id: editingAmount.id, data })}
        />
      )}

      {/* ─── Modal : nouvelle dette a credit ─── */}
      {showDebtForm && (
        <DebtFormModal onClose={() => setShowDebtForm(false)} onCreated={refreshAll} />
      )}
    </>
  );
}

/* ═══════════════════════ Modal : reglement d'une echeance ═══════════════════════ */

function PayEcheanceModal({ echeance, pending, onClose, onSubmit }: {
  echeance: Echeance;
  paymentMethods: Array<{ code: string; label: string }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const reste = parseFloat(echeance.remaining_amount) || 0;
  const [amount, setAmount] = useState(reste.toFixed(2));
  // Mig 310 : method = mode TYPÉ ; legacy = méthode héritée (pilote le bloc chèque/effet).
  const [method, setMethod] = useState(modeFromLegacy(echeance.expected_payment_mode || 'cash'));
  const [payDate, setPayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [override, setOverride] = useState<CashOverride>(null);
  const { byCode } = usePaymentModes();
  const modeDef = byCode(method);
  const legacy = modeDef?.legacy_method ?? method;

  const formRef = useRef<HTMLFormElement>(null);
  const isEffect = legacy === 'check' || legacy === 'traite';

  return (
    <Modal title={<><Coins size={16} aria-hidden="true" style={{ color: 'var(--theme-accent)', verticalAlign: '-2px' }} /> Régler une échéance</>}
      subtitle={`${echeance.label} · ${fmtDate(echeance.due_date)}`} onClose={onClose} width={480} locked={pending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => formRef.current?.requestSubmit()} busy={pending} submitLabel={pending ? 'Enregistrement...' : 'Enregistrer'} />}>
      <form ref={formRef} onSubmit={ev => {
        ev.preventDefault();
        const fd = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>;
        const montant = parseFloat(amount);
        if (!Number.isFinite(montant) || montant <= 0) { notify.error('Montant invalide'); return; }
        if (montant > reste + 0.01) {
          notify.error(`Le montant dépasse le reste à payer (${money(reste)})`); return;
        }
        const payload: Record<string, unknown> = {
          scheduledPaymentId: echeance.id,
          // Une echeance de facture reste un reglement de facture : on passe
          // invoiceId pour que paid_amount/statut de la facture suivent aussi.
          ...(echeance.invoice_id
            ? { invoiceId: echeance.invoice_id, type: 'invoice' }
            : { type: 'expense' }),
          categoryId: echeance.category_id || undefined,
          supplierId: echeance.supplier_id || undefined,
          amount: montant,
          paymentMode: method,
          paymentMethod: legacy,
          paymentDate: fd.paymentDate,
          reference: fd.reference || undefined,
          description: fd.description || echeance.label,
        };
        if (override) payload.cashOverride = override;
        if (legacy === 'check' || legacy === 'traite') {
          payload.checkNumber = fd.checkNumber || undefined;
          payload.checkDate = fd.checkDate || undefined;
        }
        onSubmit(payload);
      }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Alert tone="info">
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>Reste à payer sur cette échéance</span>
            <strong className="ds-num" style={{ color: 'var(--ds-danger)' }}>{money(reste)}</strong>
          </span>
        </Alert>
        <FormSection title="Règlement">
          <div className="ds-form-grid">
            <FormField label={`Montant (${currencySymbol()})`} htmlFor="pay-amount" required>
              <input id="pay-amount" className="ds-input" type="number" step="0.01" min="0" max={reste} value={amount}
                onChange={e => setAmount(e.target.value)} required />
            </FormField>
            <FormField label="Date" htmlFor="pay-date" required>
              <input id="pay-date" className="ds-input" name="paymentDate" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} required />
            </FormField>
          </div>
          <FormField label="Mode de règlement">
            <PaymentModeSelect value={method} onChange={setMethod} />
          </FormField>
          {modeDef?.requires_reference && !isEffect && (
            <FormField label="Référence du virement" htmlFor="pay-ref" required>
              <input id="pay-ref" className="ds-input" name="reference" required placeholder="N° d'ordre ou référence bancaire" />
            </FormField>
          )}
          <CashLimitGauge supplierId={echeance.supplier_id} date={payDate} amount={parseFloat(amount) || 0}
            modeCode={method} override={override} onOverrideChange={setOverride} />
        </FormSection>
        {isEffect && (
          <FormSection title={legacy === 'traite' ? 'Traite' : 'Chèque'}>
            <div className="ds-form-grid">
              <FormField label={`N° ${legacy === 'traite' ? 'traite' : 'chèque'}`} htmlFor="pay-check-no" required>
                <input id="pay-check-no" className="ds-input" name="checkNumber" type="text" required />
              </FormField>
              <FormField label={`Date ${legacy === 'traite' ? 'traite' : 'chèque'}`} htmlFor="pay-check-date">
                <input id="pay-check-date" className="ds-input" name="checkDate" type="date" />
              </FormField>
            </div>
          </FormSection>
        )}
        <FormField label="Description" htmlFor="pay-desc">
          <input id="pay-desc" className="ds-input" name="description" type="text" defaultValue={echeance.label} />
        </FormField>
        <button type="submit" className="ds-sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}

/* ═══════════════════════ Modal : corriger une echeance ═══════════════════════ */

function EditEcheanceModal({ echeance, pending, onClose, onSubmit }: {
  echeance: Echeance;
  pending: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const [amount, setAmount] = useState(echeance.amount_due ? parseFloat(echeance.amount_due).toFixed(2) : '');
  const [dueDate, setDueDate] = useState(String(echeance.due_date).slice(0, 10));

  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Modal title="Modifier l'échéance" subtitle={echeance.label} onClose={onClose} width={480} locked={pending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => formRef.current?.requestSubmit()} busy={pending} submitLabel={pending ? 'Enregistrement...' : 'Enregistrer'} />}>
      <form ref={formRef} onSubmit={ev => {
        ev.preventDefault();
        const montant = amount.trim() === '' ? null : parseFloat(amount);
        if (montant !== null && (!Number.isFinite(montant) || montant <= 0)) {
          notify.error('Montant invalide'); return;
        }
        onSubmit({ amountDue: montant, dueDate });
      }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {echeance.amount_pending && (
          <Alert tone="warning">
            Cette échéance vient d'une charge à montant variable. Saisissez le montant
            de la facture reçue pour pouvoir enregistrer le règlement.
          </Alert>
        )}
        <div className="ds-form-grid">
          <FormField label={`Montant dû (${currencySymbol()})`} htmlFor="ech-amount">
            <input id="ech-amount" className="ds-input" type="number" step="0.01" min="0" value={amount}
              onChange={e => setAmount(e.target.value)} placeholder="À chiffrer" />
          </FormField>
          <FormField label="Date d'échéance" htmlFor="ech-date" required>
            <input id="ech-date" className="ds-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
          </FormField>
        </div>
        <button type="submit" className="ds-sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}

/* ═══════════════════════ Modal : nouvelle dette a credit ═══════════════════════ */

function DebtFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { entries: paymentMethods } = useReferentiel('payment_methods');
  const [label, setLabel] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [total, setTotal] = useState('');
  const [installments, setInstallments] = useState('1');
  const [intervalMonths, setIntervalMonths] = useState('1');
  const [firstDueDate, setFirstDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mode, setMode] = useState('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => suppliersApi.list() as Promise<Array<{ id: string; name: string }>>,
  });

  const create = useMutation({
    mutationFn: (data: Parameters<typeof debtsApi.create>[0]) => debtsApi.create(data),
    onSuccess: () => { onCreated(); notify.success('Dette créée avec son échéancier'); onClose(); },
    onError: (err: unknown) => notify.error(apiMessage(err) || 'Erreur lors de la création'),
  });

  // Apercu de la mensualite : le dernier terme absorbe l'arrondi cote serveur.
  const nbEch = Math.max(1, Math.floor(parseFloat(installments) || 1));
  const montant = parseFloat(total) || 0;
  const mensualite = nbEch > 0 ? Math.floor((montant / nbEch) * 100) / 100 : 0;

  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Modal title={<><Building2 size={16} aria-hidden="true" style={{ color: 'var(--theme-accent)', verticalAlign: '-2px' }} /> Dette à crédit</>}
      subtitle="Matériel ou équipement acheté en plusieurs fois" onClose={onClose} width={560} locked={create.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => formRef.current?.requestSubmit()} busy={create.isPending} submitLabel={create.isPending ? 'Création...' : 'Créer la dette'} />}>
      <form ref={formRef} onSubmit={ev => {
        ev.preventDefault();
        if (!label.trim()) { notify.error('Libellé requis'); return; }
        if (montant <= 0) { notify.error('Montant total invalide'); return; }
        create.mutate({
          label: label.trim(),
          totalAmount: montant,
          installments: nbEch,
          firstDueDate,
          intervalMonths: Math.max(1, Math.floor(parseFloat(intervalMonths) || 1)),
          supplierId: supplierId || null,
          categoryId: categoryId || null,
          expectedPaymentMode: mode || null,
        });
      }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Alert tone="info">
          À utiliser quand la facture n'est <strong>pas</strong> saisie dans le système.
          Si elle existe déjà, échelonnez-la directement depuis <strong>Achats → Factures reçues</strong>
          pour éviter de compter la dette deux fois.
        </Alert>
        <FormSection title="Dette">
          <FormField label="Libellé" htmlFor="debt-label" required>
            <input id="debt-label" className="ds-input" type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Ex : Four rotatif 10 plaques" required />
          </FormField>
          <FormField label="Fournisseur">
            <SearchSelect
              options={suppliers.map(s => ({ id: s.id, label: s.name }))}
              value={supplierId} onChange={setSupplierId}
              placeholder="Aucun fournisseur" width="100%" size="md" ariaLabel="Fournisseur" />
          </FormField>
          <FormField label="Catégorie de charge">
            <CategoryCascadeSelector value={categoryId} onChange={setCategoryId} type="expense" />
          </FormField>
        </FormSection>
        <FormSection title="Échéancier">
          <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <FormField label={`Montant total (${currencySymbol()})`} htmlFor="debt-total" required>
              <input id="debt-total" className="ds-input" type="number" step="0.01" min="0" value={total} onChange={e => setTotal(e.target.value)} required />
            </FormField>
            <FormField label="Nb échéances" htmlFor="debt-n" required>
              <input id="debt-n" className="ds-input" type="number" min="1" max="120" value={installments}
                onChange={e => setInstallments(e.target.value)} required />
            </FormField>
            <FormField label="Tous les (mois)" htmlFor="debt-interval">
              <input id="debt-interval" className="ds-input" type="number" min="1" max="12" value={intervalMonths}
                onChange={e => setIntervalMonths(e.target.value)} />
            </FormField>
          </div>
          <div className="ds-form-grid">
            <FormField label="1ère échéance" htmlFor="debt-first" required>
              <input id="debt-first" className="ds-input" type="date" value={firstDueDate} onChange={e => setFirstDueDate(e.target.value)} required />
            </FormField>
            <FormField label="Règlement prévu" htmlFor="debt-mode">
              <select id="debt-mode" className="ds-input" value={mode} onChange={e => setMode(e.target.value)}>
                <option value="">Non précisé</option>
                {(paymentMethods as Array<{ code: string; label: string }>).map(m => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          {montant > 0 && nbEch > 1 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)' }}>
              {nbEch} échéances d'environ <strong className="ds-num" style={{ color: 'var(--ds-ink)' }}>{money(mensualite)}</strong>,
              la dernière ajustée pour tomber juste sur {money(montant)}.
            </p>
          )}
        </FormSection>
        <button type="submit" className="ds-sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}

/* ═══════════════════════ Panneau : charges fixes recurrentes ═══════════════════════ */

/**
 * Gestion des modeles de charges fixes. Creer un modele suffit : les echeances
 * des ~3 mois a venir sont generees automatiquement cote serveur, et
 * reapparaissent tant qu'elles ne sont pas reglees.
 */
function RecurringChargesPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RecurringCharge | null>(null);
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: charges = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recurring-charges', showInactive],
    queryFn: () => recurringChargesApi.list(showInactive) as Promise<RecurringCharge[]>,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recurring-charges'] });
    onChanged();
  };

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      recurringChargesApi.update(id, { isActive }),
    onSuccess: () => { refresh(); notify.success('Charge fixe mise à jour'); },
    onError: (err: unknown) => notify.error(apiMessage(err) || 'Erreur'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => recurringChargesApi.remove(id),
    onSuccess: () => { refresh(); notify.success('Charge fixe supprimée'); },
    onError: (err: unknown) => notify.error(apiMessage(err) || 'Erreur lors de la suppression'),
  });

  return (
    <div>
      <SectionHeader title={<><Repeat size={14} aria-hidden="true" /> Charges fixes récurrentes</>}>
        <label htmlFor="rc-inactive" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input id="rc-inactive" type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Inactives
        </label>
        <button type="button" onClick={() => setCreating(true)} className="odoo-btn-primary ds-btn-sm">
          <Plus size={13} aria-hidden="true" /> Ajouter
        </button>
        <button type="button" onClick={onClose} className="odoo-btn-secondary ds-btn-sm">Fermer</button>
      </SectionHeader>

      <DataPanel label="Charges fixes récurrentes">
      {isLoading ? (
        <LoadingState bare />
      ) : isError ? (
        <ErrorState bare error={error} onRetry={() => refetch()} />
      ) : charges.length === 0 ? (
        <EmptyState bare icon={Repeat} title="Aucune charge fixe" text="Ajoutez le loyer, l'électricité ou l'eau : leurs échéances apparaîtront ensuite d'elles-mêmes dans l'échéancier." />
      ) : (
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Charge</th>
              <th>Catégorie</th>
              <th>Périodicité</th>
              <th className="ds-num">Montant ({currencySymbol()})</th>
              <th>Prochaine échéance</th>
              <th className="ds-actions" style={{ width: 90 }}><span className="ds-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {charges.map(c => (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.5 }}>
                <td>
                  <span className="ds-strong">{c.label}</span>
                  {c.supplier_name && (
                    <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{c.supplier_name}</div>
                  )}
                </td>
                <td>{c.category_name || '—'}</td>
                <td>
                  {PERIODICITES.find(p => p.value === c.interval_months)?.label || `Tous les ${c.interval_months} mois`}
                  <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>le {c.due_day} du mois</div>
                </td>
                <td className="ds-num">
                  {c.amount ? n(parseFloat(c.amount)) : <StatusTag tone="todo" label="Variable" />}
                </td>
                <td>
                  {fmtDate(c.next_due_date)}
                  {c.overdue_count > 0 && <span style={{ marginLeft: 6 }}><StatusTag tone="late" label={`${c.overdue_count} en retard`} /></span>}
                </td>
                <td className="ds-actions">
                  <button type="button" onClick={() => setEditing(c)} className="ds-icon-btn" title="Modifier" aria-label={`Modifier la charge fixe ${c.label}`}>
                    <Pencil size={15} />
                  </button>
                  <RowMenu items={[
                    { label: c.is_active ? 'Désactiver' : 'Réactiver', icon: Power, onSelect: () => toggleActive.mutate({ id: c.id, isActive: !c.is_active }) },
                    { label: 'Supprimer', icon: Trash2, danger: true, onSelect: async () => {
                      if (await confirm(`Supprimer la charge fixe « ${c.label} » ?`, { title: 'Supprimer la charge fixe', danger: true, confirmLabel: 'Supprimer' })) remove.mutate(c.id);
                    } },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </DataPanel>

      {(creating || editing) && (
        <RecurringChargeForm
          charge={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { refresh(); setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function RecurringChargeForm({ charge, onClose, onSaved }: {
  charge: RecurringCharge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { entries: paymentMethods } = useReferentiel('payment_methods');
  const [label, setLabel] = useState(charge?.label || '');
  const [categoryId, setCategoryId] = useState(charge?.category_id || '');
  const [supplierId, setSupplierId] = useState(charge?.supplier_id || '');
  const [variable, setVariable] = useState(charge ? charge.amount === null : false);
  const [amount, setAmount] = useState(charge?.amount ? parseFloat(charge.amount).toFixed(2) : '');
  const [intervalMonths, setIntervalMonths] = useState(String(charge?.interval_months ?? 1));
  const [dueDay, setDueDay] = useState(String(charge?.due_day ?? 1));
  const [startDate, setStartDate] = useState(
    charge ? String(charge.start_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(charge?.end_date ? String(charge.end_date).slice(0, 10) : '');
  const [mode, setMode] = useState(charge?.expected_payment_mode || '');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => suppliersApi.list() as Promise<Array<{ id: string; name: string }>>,
  });

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      charge ? recurringChargesApi.update(charge.id, data) : recurringChargesApi.create(data),
    onSuccess: () => { notify.success(charge ? 'Charge fixe modifiée' : 'Charge fixe créée'); onSaved(); },
    onError: (err: unknown) => notify.error(apiMessage(err) || 'Erreur lors de l\'enregistrement'),
  });

  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Modal title={<><Repeat size={16} aria-hidden="true" style={{ color: 'var(--theme-accent)', verticalAlign: '-2px' }} /> {charge ? 'Modifier la charge fixe' : 'Nouvelle charge fixe'}</>}
      subtitle="Loyer, électricité, eau, internet..." onClose={onClose} width={560} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => formRef.current?.requestSubmit()} busy={save.isPending} submitLabel={save.isPending ? 'Enregistrement...' : 'Enregistrer'} />}>
      <form ref={formRef} onSubmit={ev => {
        ev.preventDefault();
        if (!label.trim()) { notify.error('Libellé requis'); return; }
        if (!categoryId) { notify.error('Catégorie requise'); return; }
        const montant = variable ? null : parseFloat(amount);
        if (!variable && (!Number.isFinite(montant as number) || (montant as number) <= 0)) {
          notify.error('Montant invalide'); return;
        }
        save.mutate({
          label: label.trim(),
          categoryId,
          supplierId: supplierId || null,
          amount: montant,
          intervalMonths: Math.max(1, Math.floor(parseFloat(intervalMonths) || 1)),
          dueDay: Math.min(31, Math.max(1, Math.floor(parseFloat(dueDay) || 1))),
          startDate,
          endDate: endDate || null,
          expectedPaymentMode: mode || null,
        });
      }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <FormSection title="Charge">
          <FormField label="Libellé" htmlFor="rcf-label" required>
            <input id="rcf-label" className="ds-input" type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Ex : Loyer local commercial" required />
          </FormField>
          <FormField label="Catégorie" required>
            <CategoryCascadeSelector value={categoryId} onChange={setCategoryId} type="expense" required />
          </FormField>
          <FormField label="Fournisseur / bailleur">
            <SearchSelect
              options={suppliers.map(s => ({ id: s.id, label: s.name }))}
              value={supplierId} onChange={setSupplierId}
              placeholder="Aucun" width="100%" size="md" ariaLabel="Fournisseur / bailleur" />
          </FormField>
        </FormSection>
        <FormSection title="Montant">
          <label htmlFor="rcf-variable" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input id="rcf-variable" type="checkbox" checked={variable} onChange={e => setVariable(e.target.checked)} />
            Montant variable (facture à recevoir)
          </label>
          {variable ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
              L'échéance sera créée sans montant. Vous le saisirez à réception de la facture —
              c'est le fonctionnement typique de l'électricité et de l'eau.
            </p>
          ) : (
            <FormField label={`Montant (${currencySymbol()})`} htmlFor="rcf-amount" required>
              <input id="rcf-amount" className="ds-input" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
            </FormField>
          )}
        </FormSection>
        <FormSection title="Calendrier">
          <div className="ds-form-grid">
            <FormField label="Périodicité" htmlFor="rcf-interval">
              <select id="rcf-interval" className="ds-input" value={intervalMonths} onChange={e => setIntervalMonths(e.target.value)}>
                {PERIODICITES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </FormField>
            <FormField label="Jour d'échéance" htmlFor="rcf-day">
              <input id="rcf-day" className="ds-input" type="number" min="1" max="31" value={dueDay} onChange={e => setDueDay(e.target.value)} />
            </FormField>
            <FormField label="À partir du" htmlFor="rcf-start" required>
              <input id="rcf-start" className="ds-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </FormField>
            <FormField label="Jusqu'au (fin de bail)" htmlFor="rcf-end">
              <input id="rcf-end" className="ds-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Règlement prévu" htmlFor="rcf-mode">
            <select id="rcf-mode" className="ds-input" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="">Non précisé</option>
              {(paymentMethods as Array<{ code: string; label: string }>).map(m => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
          </FormField>
        </FormSection>
        {charge && (
          <Alert tone="warning">
            Les échéances déjà réglées ne bougent pas. Seules les échéances futures
            non réglées seront regénérées avec ces nouveaux paramètres.
          </Alert>
        )}
        <button type="submit" className="ds-sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Modal>
  );
}

/* ═══════════════════════ helpers ═══════════════════════ */

function apiMessage(err: unknown): string | null {
  return err && typeof err === 'object' && 'response' in err
    ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? null
    : null;
}
