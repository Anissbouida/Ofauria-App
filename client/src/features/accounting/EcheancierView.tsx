import { useState, useMemo, Fragment } from 'react';
import { usePaymentModes, modeFromLegacy, PaymentModeSelect, CashLimitGauge, type CashOverride } from '../../components/purchasing/PaymentModeFields';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  X, Coins, Plus, CalendarClock, AlertTriangle, Loader2, Pencil,
  Repeat, Trash2, ChevronDown, ChevronRight, Power, Building2,
} from 'lucide-react';
import {
  paymentSchedulesApi, debtsApi, recurringChargesApi,
  paymentsApi, suppliersApi,
} from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { useReferentiel } from '../../hooks/useReferentiel';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import SearchSelect from '../../components/ui/SearchSelect';

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

  const { data: echeances = [], isLoading } = useQuery({
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
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />En retard
          </div>
          <div className="odoo-stat-card-value" style={{ color: stats.retard > 0 ? '#dc3545' : 'var(--theme-text-muted)' }}>
            {n(stats.retard)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">{stats.nbRetard} échéance{stats.nbRetard > 1 ? 's' : ''} dépassée{stats.nbRetard > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <CalendarClock size={11} style={{ display: 'inline', marginRight: 4 }} />Reste ce mois
          </div>
          <div className="odoo-stat-card-value">{n(stats.ceMois)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">Échéances non encore dépassées</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">
            <Coins size={11} style={{ display: 'inline', marginRight: 4 }} />À venir
          </div>
          <div className="odoo-stat-card-value">{n(stats.aVenir)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">
            {stats.nbIndefinis > 0
              ? `${stats.nbIndefinis} montant${stats.nbIndefinis > 1 ? 's' : ''} à renseigner`
              : 'Mois suivants'}
          </div>
        </div>
      </div>

      {/* ─── Barre d'actions ─── */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer', color: 'var(--theme-text-muted)' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Afficher aussi les échéances réglées
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowRecurring(v => !v)} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Repeat size={13} /> Charges fixes
        </button>
        <button onClick={() => setShowDebtForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={13} /> Dette à crédit
        </button>
      </div>

      {showRecurring && <RecurringChargesPanel onClose={() => setShowRecurring(false)} onChanged={refreshAll} />}

      {/* ─── Calendrier ─── */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : groupes.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <CalendarClock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune échéance à venir.</p>
          <p style={{ fontSize: '0.75rem', marginTop: 6 }}>
            Créez une <strong>dette à crédit</strong> pour du matériel acheté en plusieurs fois,
            ou une <strong>charge fixe</strong> pour que le loyer et l'électricité apparaissent
            automatiquement chaque mois.
          </p>
        </div>
      ) : (
        groupes.map(g => (
          <div key={g.periode} className="odoo-section">
            <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ textTransform: 'capitalize' }}>{moisLabel(g.periode)}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
                {n(g.total)} DH
                {g.indefinis > 0 && (
                  <span style={{ fontWeight: 400, fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginLeft: 8 }}>
                    + {g.indefinis} à chiffrer
                  </span>
                )}
              </span>
            </div>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Échéance</th>
                  <th>Libellé</th>
                  <th>Type</th>
                  <th>Bénéficiaire</th>
                  <th style={{ textAlign: 'right' }}>Montant dû</th>
                  <th style={{ textAlign: 'right' }}>Payé</th>
                  <th style={{ textAlign: 'right' }}>Reste</th>
                  <th style={{ textAlign: 'center', width: 140 }}></th>
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
                        color: e.is_overdue && !solde ? '#dc3545' : 'var(--theme-text-muted)',
                        fontWeight: e.is_overdue && !solde ? 600 : 400,
                      }}>
                        {fmtDate(e.due_date)}
                      </td>
                      <td>
                        <strong>{e.label}</strong>
                        {e.installment_total && e.installment_total > 1 && (
                          <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>
                            {e.installment_no}/{e.installment_total}
                          </span>
                        )}
                        {e.category_name && (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{e.category_name}</div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                        {SOURCE_LABELS[e.source_kind]}
                        {e.invoice_number && <div style={{ fontFamily: 'ui-monospace, monospace' }}>{e.invoice_number}</div>}
                      </td>
                      <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>{e.supplier_name || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {e.amount_pending
                          ? <span className="odoo-tag odoo-tag-orange">À chiffrer</span>
                          : n(parseFloat(e.amount_due || '0'))}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>
                        {n(parseFloat(e.amount_paid) || 0)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: solde ? '#0e7c3a' : '#b71c1c' }}>
                        {solde ? 'Réglée' : e.amount_pending ? '—' : `${n(reste)} DH`}
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {!solde && (
                          <>
                            <button onClick={() => setEditingAmount(e)} className="odoo-btn-secondary"
                              title="Modifier le montant ou la date"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: '0.6875rem', marginRight: 4 }}>
                              <Pencil size={11} />
                            </button>
                            <button onClick={() => setPaying(e)} className="odoo-btn-secondary"
                              disabled={e.amount_pending}
                              title={e.amount_pending ? 'Renseignez d\'abord le montant' : 'Enregistrer le règlement'}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: '0.6875rem' }}>
                              <Coins size={11} /> Payer
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 448, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Coins size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">Régler une échéance</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span>{echeance.label} · {fmtDate(echeance.due_date)}</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
              </div>
        <form onSubmit={ev => {
          ev.preventDefault();
          const fd = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>;
          const montant = parseFloat(amount);
          if (!Number.isFinite(montant) || montant <= 0) { notify.error('Montant invalide'); return; }
          if (montant > reste + 0.01) {
            notify.error(`Le montant dépasse le reste à payer (${n(reste)} DH)`); return;
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
        }} className="p-5 space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 flex justify-between">
            <span>Reste à payer sur cette échéance</span>
            <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#b71c1c' }}>{n(reste)} DH</strong>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
              <input type="number" step="0.01" min="0" max={reste} value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
              <input name="paymentDate" type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de règlement</label>
            <PaymentModeSelect value={method} onChange={setMethod} />
          </div>
          {modeDef?.requires_reference && legacy !== 'check' && legacy !== 'traite' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Référence du virement *</label>
              <input name="reference" required placeholder="N° d'ordre ou référence bancaire"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
          )}
          <CashLimitGauge supplierId={echeance.supplier_id} date={payDate} amount={parseFloat(amount) || 0}
            modeCode={method} override={override} onOverrideChange={setOverride} />
          {(legacy === 'check' || legacy === 'traite') && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">N° {legacy === 'traite' ? 'traite' : 'chèque'}</label>
                <input name="checkNumber" type="text" required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Date {legacy === 'traite' ? 'traite' : 'chèque'}</label>
                <input name="checkDate" type="date"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <input name="description" type="text" defaultValue={echeance.label}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="odoo-btn-secondary" style={{ flex: 1 }}>Annuler</button>
            <button type="submit" disabled={pending} className="odoo-btn-primary" style={{ flex: 1 }}>
              {pending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" aria-label="Modifier l'échéance"
        style={{ width: '100%', maxWidth: 448, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <span className="odoo-breadcrumb-current">Modifier l'échéance</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span>{echeance.label}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={ev => {
          ev.preventDefault();
          const montant = amount.trim() === '' ? null : parseFloat(amount);
          if (montant !== null && (!Number.isFinite(montant) || montant <= 0)) {
            notify.error('Montant invalide'); return;
          }
          onSubmit({ amountDue: montant, dueDate });
        }} className="p-5 space-y-4">
          {echeance.amount_pending && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Cette échéance vient d'une charge à montant variable. Saisissez le montant
              de la facture reçue pour pouvoir enregistrer le règlement.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant dû (DH)</label>
              <input type="number" step="0.01" min="0" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="À chiffrer"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Date d'échéance</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" required />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="odoo-btn-secondary" style={{ flex: 1 }}>Annuler</button>
            <button type="submit" disabled={pending} className="odoo-btn-primary" style={{ flex: 1 }}>
              {pending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 512, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Building2 size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">Dette à crédit</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span>Matériel ou équipement acheté en plusieurs fois</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
              </div>
        <form onSubmit={ev => {
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
        }} className="p-5 space-y-4">
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
            À utiliser quand la facture n'est <strong>pas</strong> saisie dans le système.
            Si elle existe déjà, échelonnez-la directement depuis <strong>Achats → Factures reçues</strong>
            pour éviter de compter la dette deux fois.
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Libellé *</label>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Ex : Four rotatif 10 plaques"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur</label>
            <SearchSelect
              options={suppliers.map(s => ({ id: s.id, label: s.name }))}
              value={supplierId} onChange={setSupplierId}
              placeholder="Aucun fournisseur" width="100%" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie de charge</label>
            <CategoryCascadeSelector value={categoryId} onChange={setCategoryId} type="expense" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant total *</label>
              <input type="number" step="0.01" min="0" value={total} onChange={e => setTotal(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nb échéances *</label>
              <input type="number" min="1" max="120" value={installments}
                onChange={e => setInstallments(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tous les (mois)</label>
              <input type="number" min="1" max="12" value={intervalMonths}
                onChange={e => setIntervalMonths(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">1ère échéance *</label>
              <input type="date" value={firstDueDate} onChange={e => setFirstDueDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Règlement prévu</label>
              <select value={mode} onChange={e => setMode(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
                <option value="">Non précisé</option>
                {(paymentMethods as Array<{ code: string; label: string }>).map(m => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          {montant > 0 && nbEch > 1 && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
              {nbEch} échéances d'environ <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(mensualite)} DH</strong>,
              la dernière ajustée pour tomber juste sur {n(montant)} DH.
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="odoo-btn-secondary" style={{ flex: 1 }}>Annuler</button>
            <button type="submit" disabled={create.isPending} className="odoo-btn-primary" style={{ flex: 1 }}>
              {create.isPending ? 'Création...' : 'Créer la dette'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════ Panneau : charges fixes recurrentes ═══════════════════════ */

/**
 * Gestion des modeles de charges fixes. Creer un modele suffit : les echeances
 * des ~3 mois a venir sont generees automatiquement cote serveur, et
 * reapparaissent tant qu'elles ne sont pas reglees.
 */
function RecurringChargesPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RecurringCharge | null>(null);
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: charges = [], isLoading } = useQuery({
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
    <div className="odoo-section">
      <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span><Repeat size={13} style={{ display: 'inline', marginRight: 6 }} />Charges fixes récurrentes</span>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Inactives
          </label>
          <button onClick={() => setCreating(true)} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', fontSize: '0.6875rem' }}>
            <Plus size={11} /> Ajouter
          </button>
          <button onClick={onClose} className="odoo-btn-secondary"
            style={{ padding: '3px 8px', fontSize: '0.6875rem' }}>Fermer</button>
        </span>
      </div>

      {isLoading ? (
        <div style={{ padding: '1.5rem', textAlign: 'center' }}>
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : charges.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
          Aucune charge fixe. Ajoutez le loyer, l'électricité ou l'eau : leurs échéances
          apparaîtront ensuite toutes seules dans l'échéancier.
        </div>
      ) : (
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Charge</th>
              <th>Catégorie</th>
              <th>Périodicité</th>
              <th style={{ textAlign: 'right' }}>Montant</th>
              <th>Prochaine échéance</th>
              <th style={{ textAlign: 'center', width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {charges.map(c => (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.5 }}>
                <td>
                  <strong>{c.label}</strong>
                  {c.supplier_name && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{c.supplier_name}</div>
                  )}
                </td>
                <td style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{c.category_name || '—'}</td>
                <td style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                  {PERIODICITES.find(p => p.value === c.interval_months)?.label || `Tous les ${c.interval_months} mois`}
                  <div style={{ fontSize: '0.6875rem' }}>le {c.due_day} du mois</div>
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                  {c.amount ? `${n(parseFloat(c.amount))} DH` : <span className="odoo-tag odoo-tag-orange">Variable</span>}
                </td>
                <td style={{ fontSize: '0.8125rem' }}>
                  {fmtDate(c.next_due_date)}
                  {c.overdue_count > 0 && (
                    <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }}>
                      {c.overdue_count} en retard
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditing(c)} className="odoo-btn-secondary" title="Modifier"
                    style={{ padding: '3px 8px', fontSize: '0.6875rem', marginRight: 4 }}>
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => toggleActive.mutate({ id: c.id, isActive: !c.is_active })}
                    className="odoo-btn-secondary" title={c.is_active ? 'Désactiver' : 'Réactiver'}
                    style={{ padding: '3px 8px', fontSize: '0.6875rem', marginRight: 4 }}>
                    <Power size={11} />
                  </button>
                  <button onClick={() => {
                    if (confirm(`Supprimer la charge fixe « ${c.label} » ?`)) remove.mutate(c.id);
                  }} className="odoo-btn-secondary" title="Supprimer"
                    style={{ padding: '3px 8px', fontSize: '0.6875rem', color: '#dc3545' }}>
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 512, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Repeat size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">{charge ? 'Modifier la charge fixe' : 'Nouvelle charge fixe'}</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span>Loyer, électricité, eau, internet...</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
              </div>
        <form onSubmit={ev => {
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
        }} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Libellé *</label>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Ex : Loyer local commercial"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie *</label>
            <CategoryCascadeSelector value={categoryId} onChange={setCategoryId} type="expense" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur / bailleur</label>
            <SearchSelect
              options={suppliers.map(s => ({ id: s.id, label: s.name }))}
              value={supplierId} onChange={setSupplierId}
              placeholder="Aucun" width="100%" />
          </div>
          <div className="rounded-xl border border-gray-200 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={variable} onChange={e => setVariable(e.target.checked)} />
              Montant variable (facture à recevoir)
            </label>
            {variable ? (
              <p className="text-xs text-gray-500">
                L'échéance sera créée sans montant. Vous le saisirez à réception de la facture —
                c'est le fonctionnement typique de l'électricité et de l'eau.
              </p>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant (DH) *</label>
                <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Périodicité</label>
              <select value={intervalMonths} onChange={e => setIntervalMonths(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {PERIODICITES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Jour d'échéance</label>
              <input type="number" min="1" max="31" value={dueDay} onChange={e => setDueDay(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">À partir du *</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Jusqu'au (fin de bail)</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Règlement prévu</label>
            <select value={mode} onChange={e => setMode(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="">Non précisé</option>
              {(paymentMethods as Array<{ code: string; label: string }>).map(m => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
          </div>
          {charge && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Les échéances déjà réglées ne bougent pas. Seules les échéances futures
              non réglées seront regénérées avec ces nouveaux paramètres.
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="odoo-btn-secondary" style={{ flex: 1 }}>Annuler</button>
            <button type="submit" disabled={save.isPending} className="odoo-btn-primary" style={{ flex: 1 }}>
              {save.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════ helpers ═══════════════════════ */

function apiMessage(err: unknown): string | null {
  return err && typeof err === 'object' && 'response' in err
    ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? null
    : null;
}
