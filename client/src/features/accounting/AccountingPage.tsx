import { useState, useEffect, useMemo, Fragment } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caisseApi, suppliersApi, expenseCategoriesApi, paymentsApi, invoicesApi } from '../../api/accounting.api';
import { withholdingApi } from '../../api/withholding.api';
import type { WithholdingType } from '../../api/withholding.api';
import { employeesApi } from '../../api/employees.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { reportsApi } from '../../api/reports.api';
import type { FinanceDetailKind, FinanceDetailRow } from '../../api/reports.api';
import { format, getDaysInMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, BarChart3, LayoutDashboard,
  X, Download, AlertTriangle, ChevronDown, ChevronRight, Wallet,
  TrendingDown, ClipboardList, ShoppingCart, Receipt, Users,
  Loader2, Coins, Scale, Trash2, Package, FileWarning,
  ArrowUpRight, ArrowDownRight, Upload, Search, ArrowUp, ArrowDown,
  Check, RotateCcw, Calendar, ListTree, Notebook, BookOpen, FileBarChart, Lock, Building2, Landmark,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import LossesTab from './LossesTab';
import CaisseImportModal from './CaisseImportModal';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import PaymentAlertsWidget from '../../components/PaymentAlertsWidget';
import { useReferentiel } from '../../hooks/useReferentiel';
import { useAuth } from '../../context/AuthContext';
import PlanComptableTab from './PlanComptableTab';
import EcrituresTab from './EcrituresTab';
import GrandLivreTab from './GrandLivreTab';
import BalanceTab from './BalanceTab';
import CpcTab from './CpcTab';
import TvaTab from './TvaTab';
import ClotureTab from './ClotureTab';
import ImmobilisationsTab from './ImmobilisationsTab';
import BanqueTab from './BanqueTab';
import BilanTab from './BilanTab';
import RetenuesSourceTab from './RetenuesSourceTab';

type AccTab = 'pilotage' | 'caisse' | 'charges' | 'cheques' | 'dettes' | 'resume' | 'losses' | 'plan_comptable' | 'ecritures' | 'grand_livre' | 'balance' | 'cpc' | 'bilan' | 'tva' | 'ras' | 'cloture' | 'immobilisations' | 'banque';

const PAYMENT_TYPE_LABELS: Record<string, string> = { invoice: 'Facture', salary: 'Salaire', expense: 'Dépense', income: 'Revenu' };
const INVOICE_STATUS_LABELS: Record<string, string> = { pending: 'En attente', partial: 'Partiel', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
const INVOICE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', partial: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '\uFEFF';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  // Compatible web et mobile (Capacitor)
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/**
 * Formatte une date payment_date (colonne DATE PG) en evitant le piege timezone.
 * pg renvoie DATE sous forme de Date object → JSON donne "YYYY-MM-DDT00:00:00.000Z"
 * → `new Date(...)` + `format()` peuvent shifter de +/- 1 jour selon le fuseau
 * du serveur ET du navigateur. On parse directement les premiers 10 caracteres
 * ("YYYY-MM-DD") sans passer par Date, ce qui evite tout shift.
 *
 * @param raw  Date ISO "2026-05-31T00:00:00.000Z" ou "2026-05-31" ou Date object
 * @param fmt  'iso' (defaut: yyyy-MM-dd) ou 'fr' (dd/MM/yyyy)
 */
function fmtPaymentDate(raw: unknown, fmt: 'iso' | 'fr' = 'iso'): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // format inattendu — on retourne tel quel
  if (fmt === 'iso') return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function parseLocalDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

interface DayData {
  date: string;
  dayNum: number;
  payments: Record<string, any>[];
  entries: number;
  exits: number;
  cashCaissiere: number;
  cashSysteme: number;
  cardReceipt: number;
  ecart: number;
  totalRecettes: number;
  totalSales: number;
  saleCount: number;
  cashNetCumul: number;
  cardCumul: number;
  solde: number;
}

function buildDailyData(
  rawPayments: Record<string, any>[],
  rawSessions: Record<string, any>[],
  rawSales: Record<string, any>[],
  previousBalance: { cashNet: number; cardCumul: number },
  year: number,
  month: number,
): DayData[] {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const sessionMap = new Map<string, { cashCaissiere: number; cashSysteme: number; card: number }>();
  for (const s of rawSessions) {
    const d = (s.session_date as string).slice(0, 10);
    sessionMap.set(d, {
      cashCaissiere: parseFloat(s.cash_caissiere as string) || 0,
      cashSysteme: parseFloat(s.cash_systeme as string) || 0,
      card: parseFloat(s.card_revenue as string) || 0,
    });
  }

  const salesMap = new Map<string, { total: number; count: number; cashSales: number; cardSales: number }>();
  for (const s of rawSales) {
    const d = (s.sale_date as string).slice(0, 10);
    salesMap.set(d, {
      total: parseFloat(s.total_sales as string) || 0,
      count: parseInt(s.sale_count as string) || 0,
      cashSales: parseFloat(s.cash_sales as string) || 0,
      cardSales: parseFloat(s.card_sales as string) || 0,
    });
  }

  const paymentsByDay = new Map<string, Record<string, any>[]>();
  for (const p of rawPayments) {
    const d = (p.payment_date as string).slice(0, 10);
    if (!paymentsByDay.has(d)) paymentsByDay.set(d, []);
    paymentsByDay.get(d)!.push(p);
  }

  let cashNet = previousBalance.cashNet;
  let cardCumul = previousBalance.cardCumul;
  const days: DayData[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayPayments = paymentsByDay.get(dateStr) || [];
    const session = sessionMap.get(dateStr) || { cashCaissiere: 0, cashSysteme: 0, card: 0 };
    const daySales = salesMap.get(dateStr) || { total: 0, count: 0, cashSales: 0, cardSales: 0 };

    // Cash système = ventes cash reelles (source de verite = table sales)
    const cashSysteme = daySales.cashSales;
    // Carte = ventes carte reelles
    const cardReceipt = daySales.cardSales;
    // Total encaissé = ce que la caissière a encaissé (cash + carte). Sert à l'affichage et à l'écart.
    const hasSession = sessionMap.has(dateStr);
    const cashCaissiere = hasSession
      ? (session.cashCaissiere) // actual_amount saisi par la caissiere
      : (cashSysteme + cardReceipt); // fallback: total ventes
    // Cash réel entrant dans le tiroir (HORS carte, qui part en banque) → alimente le solde cash.
    const cashIn = hasSession ? session.cashCaissiere : cashSysteme;

    let entries = 0, exits = 0;
    let cashEntries = 0, bankEntries = 0, cashExits = 0, bankExits = 0;
    for (const p of dayPayments) {
      const amount = parseFloat(p.amount as string) || 0;
      const isCash = (p.payment_method as string) === 'cash';
      if (p.type === 'income') {
        entries += amount;
        if (isCash) cashEntries += amount; else bankEntries += amount;
      } else {
        exits += amount;
        if (isCash) cashExits += amount; else bankExits += amount;
      }
    }

    cashNet = cashNet + cashEntries + cashIn - cashExits;
    cardCumul = cardCumul + cardReceipt + bankEntries - bankExits;

    if (dayPayments.length > 0 || cashCaissiere > 0 || cardReceipt > 0 || daySales.count > 0) {
      days.push({
        date: dateStr,
        dayNum: day,
        payments: dayPayments,
        entries,
        exits,
        cashCaissiere,
        cashSysteme,
        cardReceipt,
        ecart: cashCaissiere - (cashSysteme + cardReceipt),
        totalRecettes: cashCaissiere + cardReceipt,
        totalSales: daySales.total,
        saleCount: daySales.count,
        cashNetCumul: cashNet,
        cardCumul,
        solde: cashNet + cardCumul,
      });
    }
  }

  return days;
}

type AccSection = 'exploitation' | 'comptabilite';

const TAB_META: { key: AccTab; label: string; icon: typeof Wallet; section: AccSection }[] = [
  // ─── Exploitation (vue métier, tous rôles) ───
  { key: 'pilotage', label: 'Pilotage', icon: LayoutDashboard, section: 'exploitation' },
  { key: 'caisse', label: 'Caisse', icon: Wallet, section: 'exploitation' },
  { key: 'charges', label: 'Charges & Dépenses', icon: TrendingDown, section: 'exploitation' },
  { key: 'cheques', label: 'Chèques et Traites', icon: Receipt, section: 'exploitation' },
  { key: 'dettes', label: 'Dettes', icon: Scale, section: 'exploitation' },
  { key: 'resume', label: 'Résumé', icon: BarChart3, section: 'exploitation' },
  { key: 'losses', label: 'Pertes', icon: AlertTriangle, section: 'exploitation' },
  // ─── Comptabilité (vue normée, admin) ───
  { key: 'plan_comptable', label: 'Plan comptable', icon: ListTree, section: 'comptabilite' },
  { key: 'ecritures', label: 'Journal', icon: Notebook, section: 'comptabilite' },
  { key: 'grand_livre', label: 'Grand livre', icon: BookOpen, section: 'comptabilite' },
  { key: 'balance', label: 'Balance', icon: Scale, section: 'comptabilite' },
  { key: 'cpc', label: 'CPC', icon: FileBarChart, section: 'comptabilite' },
  { key: 'bilan', label: 'Bilan', icon: Scale, section: 'comptabilite' },
  { key: 'tva', label: 'TVA', icon: Receipt, section: 'comptabilite' },
  { key: 'ras', label: 'Retenues source', icon: Scale, section: 'comptabilite' },
  { key: 'immobilisations', label: 'Immobilisations', icon: Building2, section: 'comptabilite' },
  { key: 'banque', label: 'Banque', icon: Landmark, section: 'comptabilite' },
  { key: 'cloture', label: 'Clôture', icon: Lock, section: 'comptabilite' },
];

export default function AccountingPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<AccTab>('pilotage');
  const [section, setSection] = useState<AccSection>('exploitation');

  // La section Comptabilité (états normés CGNC) est accessible à l'admin et au gérant.
  // L'admin pourra étendre l'accès via la gestion des utilisateurs.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const sections: { key: AccSection; label: string; icon: typeof Wallet }[] = [
    { key: 'exploitation', label: 'Exploitation', icon: LayoutDashboard },
    ...(isAdmin ? [{ key: 'comptabilite' as const, label: 'Comptabilité', icon: BookOpen }] : []),
  ];

  const visibleTabs = TAB_META.filter(t => t.section === section && (t.section === 'exploitation' || isAdmin));
  const currentLabel = TAB_META.find(t => t.key === tab)?.label;

  const switchSection = (s: AccSection) => {
    setSection(s);
    const first = TAB_META.find(t => t.section === s);
    if (first) setTab(first.key);
  };

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar + sélecteur de section */}
      <div className="odoo-control-bar" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="odoo-breadcrumb">
          <span>Comptabilité</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{currentLabel}</span>
        </div>
        {sections.length > 1 && (
          <div style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--theme-bg-secondary)', borderRadius: 8, marginLeft: 'auto' }}>
            {sections.map(s => {
              const SIcon = s.icon;
              const active = section === s.key;
              return (
                <button key={s.key} onClick={() => switchSection(s.key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
                    background: active ? 'var(--theme-bg-card)' : 'transparent',
                    color: active ? 'var(--theme-text)' : 'var(--theme-text-muted)',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  <SIcon size={14} /> {s.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tabs de la section active */}
      <div className="odoo-tabs">
        {visibleTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Suivi des echeances fournisseurs (visible sur tous les onglets) */}
        <PaymentAlertsWidget />
        {tab === 'pilotage' && <PilotageTab />}
        {tab === 'caisse' && <CaisseTab />}
        {tab === 'charges' && <ChargesTab />}
        {tab === 'cheques' && <ChequesTab />}
        {tab === 'dettes' && <DettesTab />}
        {tab === 'resume' && <ResumeTab />}
        {tab === 'losses' && <LossesTab />}
        {tab === 'plan_comptable' && <PlanComptableTab />}
        {tab === 'ecritures' && <EcrituresTab />}
        {tab === 'grand_livre' && <GrandLivreTab />}
        {tab === 'balance' && <BalanceTab />}
        {tab === 'cpc' && <CpcTab />}
        {tab === 'bilan' && <BilanTab />}
        {tab === 'tva' && <TvaTab />}
        {tab === 'ras' && <RetenuesSourceTab />}
        {tab === 'immobilisations' && <ImmobilisationsTab />}
        {tab === 'banque' && <BanqueTab />}
        {tab === 'cloture' && <ClotureTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════ DETTES TAB ═══════════════════════ */
/**
 * Suivi des dettes & creances adossees aux factures (vue "qui doit quoi").
 *
 *   - CREANCES ("Ils nous doivent") : factures emises (invoice_type='emitted')
 *     non soldees -> ce que les clients nous doivent.
 *   - DETTES   ("Nous leur devons") : factures recues (invoice_type='received')
 *     non soldees -> ce qu'on doit aux fournisseurs.
 *
 * Vue agregee par tiers : pour chaque client/fournisseur, somme du reste a
 * payer (total_amount - paid_amount) sur ses factures ouvertes, dont la part
 * en retard (echeance depassee). On deplie un tiers pour voir le detail
 * facture par facture et enregistrer un reglement (partiel ou total).
 *
 * Aucune table dediee : pure agregation sur invoices + payments existants.
 * Enregistrer un reglement ici cree un `payment` lie a la facture (meme flux
 * que le reste de la compta) -> paid_amount/status resynchronises, et l'argent
 * apparait dans Caisse / Cheques selon la methode choisie.
 */
type DebtInvoice = {
  id: string;
  invoice_number: string;
  invoice_type: 'received' | 'emitted';
  invoice_date: string;
  due_date: string | null;
  total_amount: string;
  paid_amount: string;
  remaining_amount: string;
  status: string;
  is_overdue: boolean;
  expected_payment_mode: string | null;
  notes: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  customer_id: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_phone: string | null;
};

function DettesTab() {
  const queryClient = useQueryClient();
  const { entries: paymentMethods } = useReferentiel('payment_methods');
  const [side, setSide] = useState<'receivables' | 'payables'>('receivables');
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payingInvoice, setPayingInvoice] = useState<DebtInvoice | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  // Retenue a la source (RAS) — paiements sortants uniquement.
  const [payAmount, setPayAmount] = useState('');
  const [rasTypeId, setRasTypeId] = useState('');
  const [rasAmount, setRasAmount] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoice-debts'],
    queryFn: () => invoicesApi.debts() as Promise<{ receivables: DebtInvoice[]; payables: DebtInvoice[] }>,
  });

  const { data: rasTypes = [] } = useQuery({
    queryKey: ['withholding-types'],
    queryFn: () => withholdingApi.listTypes() as Promise<WithholdingType[]>,
    enabled: side === 'payables',
  });

  const createPayment = useMutation({
    mutationFn: (payload: Record<string, any>) => paymentsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-debts'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      queryClient.invalidateQueries({ queryKey: ['payments-checks'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success('Règlement enregistré');
      setPayingInvoice(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const isReceivable = side === 'receivables';

  // A l'ouverture du modal : initialise le montant brut et reinitialise la RAS.
  useEffect(() => {
    if (payingInvoice) {
      setPayAmount((parseFloat(payingInvoice.remaining_amount) || 0).toFixed(2));
      setRasTypeId('');
      setRasAmount('');
    }
  }, [payingInvoice]);

  const rawInvoices: DebtInvoice[] = useMemo(() => {
    if (!data) return [];
    return (isReceivable ? data.receivables : data.payables) || [];
  }, [data, isReceivable]);

  const tierName = (inv: DebtInvoice): string => {
    if (isReceivable) {
      const full = [inv.customer_first_name, inv.customer_last_name].filter(Boolean).join(' ').trim();
      return full || 'Client comptoir';
    }
    return inv.supplier_name || 'Sans fournisseur';
  };
  const tierKey = (inv: DebtInvoice): string =>
    (isReceivable ? inv.customer_id : inv.supplier_id) || '__none__';
  const tierPhone = (inv: DebtInvoice): string | null =>
    isReceivable ? inv.customer_phone : inv.supplier_phone;

  // Agrege les factures ouvertes par tiers, applique recherche + filtre retard.
  const tiers = useMemo(() => {
    const map = new Map<string, {
      key: string; name: string; phone: string | null;
      invoices: DebtInvoice[]; totalDue: number; overdueDue: number; oldestDue: string | null;
    }>();
    for (const inv of rawInvoices) {
      const remaining = parseFloat(inv.remaining_amount) || 0;
      if (remaining <= 0) continue;
      const key = tierKey(inv);
      if (!map.has(key)) {
        map.set(key, { key, name: tierName(inv), phone: tierPhone(inv), invoices: [], totalDue: 0, overdueDue: 0, oldestDue: null });
      }
      const t = map.get(key)!;
      t.invoices.push(inv);
      t.totalDue += remaining;
      if (inv.is_overdue) t.overdueDue += remaining;
      const due = inv.due_date ? inv.due_date.slice(0, 10) : null;
      if (due && (!t.oldestDue || due < t.oldestDue)) t.oldestDue = due;
    }
    let list = Array.from(map.values());
    const q = searchTerm.trim().toLowerCase();
    if (q) list = list.filter(t => t.name.toLowerCase().includes(q) || (t.phone || '').toLowerCase().includes(q));
    if (onlyOverdue) list = list.filter(t => t.overdueDue > 0);
    return list.sort((a, b) => b.totalDue - a.totalDue);
  }, [rawInvoices, searchTerm, onlyOverdue, isReceivable]);

  const totals = useMemo(() => {
    let totalDue = 0, overdueDue = 0, invoiceCount = 0;
    for (const t of tiers) { totalDue += t.totalDue; overdueDue += t.overdueDue; invoiceCount += t.invoices.length; }
    return { totalDue, overdueDue, invoiceCount, tierCount: tiers.length };
  }, [tiers]);

  // Totaux globaux par sens (pour les boutons toggle), independants des filtres.
  const sideTotals = useMemo(() => {
    const sum = (rows: DebtInvoice[] = []) => rows.reduce((s, inv) => s + (parseFloat(inv.remaining_amount) || 0), 0);
    return { receivables: sum(data?.receivables), payables: sum(data?.payables) };
  }, [data]);

  const toggleTier = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openPayment = (inv: DebtInvoice) => {
    setPayingInvoice(inv);
    setPayMethod(inv.expected_payment_mode || 'cash');
  };

  const handleExport = () => {
    const rows: string[][] = [];
    for (const t of tiers) {
      for (const inv of t.invoices) {
        rows.push([
          t.name,
          inv.invoice_number,
          fmtPaymentDate(inv.invoice_date, 'fr'),
          inv.due_date ? fmtPaymentDate(inv.due_date, 'fr') : '',
          n(parseFloat(inv.total_amount) || 0),
          n(parseFloat(inv.paid_amount) || 0),
          n(parseFloat(inv.remaining_amount) || 0),
          inv.is_overdue ? 'En retard' : (INVOICE_STATUS_LABELS[inv.status] || inv.status),
        ]);
      }
    }
    exportCSV(`${isReceivable ? 'creances' : 'dettes'}_${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['TIERS', 'N FACTURE', 'DATE', 'ECHEANCE', 'TOTAL', 'PAYE', 'RESTE (DH)', 'STATUT'], rows);
  };

  const accent = isReceivable ? '#0e7c3a' : '#b71c1c';
  const tierLabel = isReceivable ? 'Client' : 'Fournisseur';

  return (
    <>
      {/* Toggle sens : creances vs dettes */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([
          { key: 'receivables' as const, label: 'Ils nous doivent', sub: 'Créances clients', total: sideTotals.receivables, color: '#0e7c3a', Icon: ArrowDownRight },
          { key: 'payables' as const, label: 'Nous leur devons', sub: 'Dettes fournisseurs', total: sideTotals.payables, color: '#b71c1c', Icon: ArrowUpRight },
        ]).map(opt => {
          const active = side === opt.key;
          return (
            <button key={opt.key} onClick={() => setSide(opt.key)}
              style={{
                flex: '1 1 240px', textAlign: 'left', cursor: 'pointer',
                padding: '12px 16px', borderRadius: 6,
                border: active ? `1.5px solid ${opt.color}` : '1px solid var(--theme-bg-separator)',
                background: active ? (opt.key === 'receivables' ? '#f0f9f4' : '#fff5f5') : 'var(--theme-bg-card)',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: active ? opt.color : 'var(--theme-text-muted)' }}>
                <opt.Icon size={13} /> {opt.label}
              </div>
              <div style={{ fontSize: '1.375rem', fontWeight: 700, color: active ? opt.color : 'var(--theme-text)', fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
                {n(opt.total)} DH
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{opt.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Stat tiles du sens actif */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Coins size={11} style={{ display: 'inline', marginRight: 4 }} />Total dû</div>
          <div className="odoo-stat-card-value" style={{ color: accent }}>{n(totals.totalDue)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{totals.tierCount} tiers · {totals.invoiceCount} facture{totals.invoiceCount > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />En retard</div>
          <div className="odoo-stat-card-value" style={{ color: totals.overdueDue > 0 ? '#dc3545' : 'var(--theme-text-muted)' }}>
            {n(totals.overdueDue)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Échéance dépassée</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Scale size={11} style={{ display: 'inline', marginRight: 4 }} />À jour</div>
          <div className="odoo-stat-card-value">{n(Math.max(0, totals.totalDue - totals.overdueDue))} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">Non encore échu</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder={`Rechercher un ${tierLabel.toLowerCase()}...`}
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} title="Effacer"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer', color: 'var(--theme-text-muted)' }}>
          <input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} />
          En retard uniquement
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
      </div>

      {/* Tableau des tiers */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : tiers.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Scale size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>
            {onlyOverdue || searchTerm
              ? 'Aucun tiers ne correspond aux filtres'
              : isReceivable ? 'Aucune créance ouverte — tous les clients sont à jour' : 'Aucune dette ouverte — tous les fournisseurs sont réglés'}
          </p>
        </div>
      ) : (
        <div className="odoo-section">
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>{tierLabel}</th>
                <th style={{ textAlign: 'center' }}>Factures</th>
                <th>Plus ancienne échéance</th>
                <th style={{ textAlign: 'right' }}>En retard</th>
                <th style={{ textAlign: 'right' }}>Total dû</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(t => {
                const open = expanded.has(t.key);
                return (
                  <Fragment key={t.key}>
                    <tr onClick={() => toggleTier(t.key)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--theme-text-muted)' }}>
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td>
                        <strong>{t.name}</strong>
                        {t.phone && <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 6 }}>{t.phone}</span>}
                      </td>
                      <td style={{ textAlign: 'center', color: 'var(--theme-text-muted)' }}>{t.invoices.length}</td>
                      <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                        {t.oldestDue ? fmtPaymentDate(t.oldestDue, 'fr') : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {t.overdueDue > 0 ? <span className="odoo-tag odoo-tag-red">{n(t.overdueDue)}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: accent }}>
                        {n(t.totalDue)} DH
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '8px 16px' }}>
                          <table className="odoo-table" style={{ margin: 0, background: 'transparent' }}>
                            <thead>
                              <tr>
                                <th>N° facture</th>
                                <th>Date</th>
                                <th>Échéance</th>
                                <th style={{ textAlign: 'right' }}>Total</th>
                                <th style={{ textAlign: 'right' }}>Payé</th>
                                <th style={{ textAlign: 'right' }}>Reste</th>
                                <th style={{ textAlign: 'center' }}>Statut</th>
                                <th style={{ textAlign: 'center', width: 90 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.invoices.map(inv => (
                                <tr key={inv.id}>
                                  <td style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{inv.invoice_number}</td>
                                  <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>{fmtPaymentDate(inv.invoice_date, 'fr')}</td>
                                  <td style={{ whiteSpace: 'nowrap', color: inv.is_overdue ? '#dc3545' : 'var(--theme-text-muted)', fontWeight: inv.is_overdue ? 600 : 400 }}>
                                    {inv.due_date ? fmtPaymentDate(inv.due_date, 'fr') : '—'}
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(parseFloat(inv.total_amount) || 0)}</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>{n(parseFloat(inv.paid_amount) || 0)}</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: accent }}>{n(parseFloat(inv.remaining_amount) || 0)}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span className={`odoo-tag ${inv.is_overdue ? 'odoo-tag-red' : 'odoo-tag-grey'}`}>
                                      {inv.is_overdue ? 'En retard' : (INVOICE_STATUS_LABELS[inv.status] || inv.status)}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <button onClick={() => openPayment(inv)}
                                      className="odoo-btn-secondary"
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: '0.6875rem' }}>
                                      <Coins size={11} /> {isReceivable ? 'Encaisser' : 'Payer'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={4} style={{ padding: 12, fontWeight: 600 }}>
                  Total {isReceivable ? 'créances' : 'dettes'} ({totals.tierCount} tiers)
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: '#dc3545', fontFamily: 'ui-monospace, monospace' }}>
                  {totals.overdueDue > 0 ? `${n(totals.overdueDue)}` : '—'}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: accent, fontFamily: 'ui-monospace, monospace' }}>
                  {n(totals.totalDue)} DH
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal : enregistrer un reglement */}
      {payingInvoice && (() => {
        const remaining = parseFloat(payingInvoice.remaining_amount) || 0;
        const partyName = isReceivable
          ? ([payingInvoice.customer_first_name, payingInvoice.customer_last_name].filter(Boolean).join(' ').trim() || 'Client comptoir')
          : (payingInvoice.supplier_name || 'Fournisseur');
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
              <div className={`p-5 flex items-center justify-between ${isReceivable ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-red-500 to-rose-500'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <Coins size={18} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">{isReceivable ? 'Encaisser un règlement' : 'Payer une facture'}</h2>
                    <p className="text-xs text-white/80">{payingInvoice.invoice_number} · {partyName}</p>
                  </div>
                </div>
                <button onClick={() => setPayingInvoice(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                  <X size={18} className="text-white" />
                </button>
              </div>
              <form onSubmit={e => {
                e.preventDefault();
                const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
                const amount = parseFloat(payAmount);
                if (!Number.isFinite(amount) || amount <= 0) { notify.error('Montant invalide'); return; }
                if (amount > remaining + 0.01) { notify.error(`Le montant dépasse le reste à payer (${n(remaining)} DH)`); return; }
                const retenue = parseFloat(rasAmount) || 0;
                if (!isReceivable && rasTypeId && retenue >= amount) {
                  notify.error('La retenue doit être inférieure au montant brut'); return;
                }
                const payload: Record<string, any> = {
                  invoiceId: payingInvoice.id,
                  type: isReceivable ? 'income' : 'invoice',
                  amount,
                  paymentMethod: fd.paymentMethod,
                  paymentDate: fd.paymentDate,
                  description: fd.description || undefined,
                };
                if (!isReceivable && payingInvoice.supplier_id) payload.supplierId = payingInvoice.supplier_id;
                if (!isReceivable && rasTypeId && retenue > 0) {
                  payload.withholdingTypeId = rasTypeId;
                  payload.withholdingAmount = Math.round(retenue * 100) / 100;
                }
                if (fd.paymentMethod === 'check' || fd.paymentMethod === 'traite') {
                  payload.checkNumber = fd.checkNumber || undefined;
                  payload.checkDate = fd.checkDate || undefined;
                }
                createPayment.mutate(payload);
              }} className="p-5 space-y-4">
                <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 flex justify-between">
                  <span>Reste à payer</span>
                  <strong style={{ fontFamily: 'ui-monospace, monospace', color: accent }}>{n(remaining)} DH</strong>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{!isReceivable && rasTypeId ? 'Montant brut *' : 'Montant *'}</label>
                    <input name="amount" type="number" step="0.01" min="0" max={remaining}
                      value={payAmount}
                      onChange={e => {
                        setPayAmount(e.target.value);
                        // Recalcule la retenue suggeree si un type RAS est selectionne.
                        if (rasTypeId) {
                          const t = rasTypes.find(x => x.id === rasTypeId);
                          const rate = t ? parseFloat(String(t.rate ?? 0)) : 0;
                          const br = parseFloat(e.target.value) || 0;
                          if (rate > 0) setRasAmount(((br * rate) / 100).toFixed(2));
                        }
                      }}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                    <input name="paymentDate" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Méthode</label>
                  <select name="paymentMethod" value={payMethod} onChange={e => setPayMethod(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                  </select>
                </div>
                {!isReceivable && (() => {
                  const brut = parseFloat(payAmount) || 0;
                  const retenue = parseFloat(rasAmount) || 0;
                  const net = Math.max(0, brut - retenue);
                  const selRas = rasTypes.find(x => x.id === rasTypeId);
                  return (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Retenue à la source (RAS)</label>
                      <select value={rasTypeId} onChange={e => {
                        const id = e.target.value;
                        setRasTypeId(id);
                        const t = rasTypes.find(x => x.id === id);
                        const rate = t ? parseFloat(String(t.rate ?? 0)) : 0;
                        setRasAmount(id && rate > 0 ? ((brut * rate) / 100).toFixed(2) : '');
                      }} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                        <option value="">Aucune retenue</option>
                        {rasTypes.map(t => (
                          <option key={t.id} value={t.id}>{t.label}{t.rate ? ` — ${t.rate}%` : ''}</option>
                        ))}
                      </select>
                      {rasTypeId && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Montant retenu (DH)</label>
                              <input type="number" step="0.01" min="0" value={rasAmount}
                                onChange={e => setRasAmount(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Net versé</label>
                              <div className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm font-semibold" style={{ fontFamily: 'ui-monospace, monospace' }}>{n(net)} DH</div>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500">
                            La retenue de <strong>{n(retenue)} DH</strong> sera déclarée à l'État (compte <strong>{selRas?.account_code}</strong>) et apparaîtra dans <strong>Retenues source → À reverser</strong>. Le bénéficiaire reçoit le net.
                          </p>
                        </>
                      )}
                    </div>
                  );
                })()}
                {(payMethod === 'check' || payMethod === 'traite') && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">N° {payMethod === 'traite' ? 'traite' : 'chèque'}</label>
                      <input name="checkNumber" type="text"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Date {payMethod === 'traite' ? 'traite' : 'chèque'}</label>
                      <input name="checkDate" type="date"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Note</label>
                  <textarea name="description" rows={2}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                {(payMethod === 'check' || payMethod === 'traite') && (
                  <p className="text-xs text-amber-600">
                    {payMethod === 'traite' ? 'La traite' : 'Le chèque'} apparaîtra dans l'onglet <strong>Chèques et Traites</strong> en attente d'encaissement. La dette est néanmoins réduite dès maintenant.
                  </p>
                )}
                <div className="flex gap-3 justify-end pt-2">
                  <button type="button" onClick={() => setPayingInvoice(null)}
                    className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                  <button type="submit" disabled={createPayment.isPending}
                    className={`px-5 py-2.5 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2 ${isReceivable ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-red-500 to-rose-500'}`}>
                    {createPayment.isPending && <Loader2 size={14} className="animate-spin" />}
                    {isReceivable ? 'Encaisser' : 'Payer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </>
  );
}

/* ═══════════════════════ MODALE DETAIL PILOTAGE ═══════════════════════ */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces', check: 'Chèque', traite: 'Traite', transfer: 'Virement', bank: 'Banque',
};

/** Config d'affichage par carte : titre, couleur d'accent, colonnes du tableau */
const DETAIL_CONFIG: Record<FinanceDetailKind, {
  title: string;
  accent: string;
  bg: string;
  /** filtre déroulant contextuel (statut, méthode…) ; options dérivées des lignes présentes */
  filter?: {
    placeholder: string;
    value: (r: FinanceDetailRow) => string | null | undefined;
    display: (v: string) => string;
  };
  /** colonnes : header + alignement + rendu d'une ligne + clé de tri */
  columns: Array<{ label: string; align?: 'right'; render: (r: FinanceDetailRow) => ReactNode; sortValue: (r: FinanceDetailRow) => string | number }>;
}> = {
  engagement: {
    title: 'Engagement — factures de la période', accent: '#0d4d8c', bg: '#f0f6ff',
    filter: { placeholder: 'Tous les statuts', value: r => r.status, display: v => INVOICE_STATUS_LABELS[v] || v },
    columns: [
      { label: 'N° facture', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Date', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Statut', render: r => INVOICE_STATUS_LABELS[r.status || ''] || r.status || '—', sortValue: r => INVOICE_STATUS_LABELS[r.status || ''] || r.status || '' },
      { label: 'Montant', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n(r.amount)} DH</span>, sortValue: r => r.amount },
    ],
  },
  treasury: {
    title: 'Trésorerie sortie — paiements effectifs', accent: '#0e7c3a', bg: '#f0f9f4',
    filter: { placeholder: 'Toutes les méthodes', value: r => r.method, display: v => PAYMENT_METHOD_LABELS[v] || v },
    columns: [
      { label: 'Date', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Bénéficiaire', render: r => r.supplierName || r.label || '—', sortValue: r => r.supplierName || r.label || '' },
      { label: 'Méthode', render: r => PAYMENT_METHOD_LABELS[r.method || ''] || r.method || '—', sortValue: r => PAYMENT_METHOD_LABELS[r.method || ''] || r.method || '' },
      { label: 'Réf', render: r => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Montant', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n(r.amount)} DH</span>, sortValue: r => r.amount },
    ],
  },
  remainingToPay: {
    title: 'Reste à payer — factures non soldées', accent: '#856404', bg: '#fff9e6',
    filter: { placeholder: 'Tous les statuts', value: r => r.status, display: v => INVOICE_STATUS_LABELS[v] || v },
    columns: [
      { label: 'N° facture', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Échéance', render: r => (r.dueDate ? fmtPaymentDate(r.dueDate, 'fr') : '—'), sortValue: r => r.dueDate || '' },
      { label: 'Total', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n(r.total ?? 0)}</span>, sortValue: r => r.total ?? 0 },
      { label: 'Payé', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n(r.paid ?? 0)}</span>, sortValue: r => r.paid ?? 0 },
      { label: 'Reste', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#856404' }}>{n(r.amount)} DH</span>, sortValue: r => r.amount },
    ],
  },
  receivedNotInvoiced: {
    title: 'Reçu non facturé — BC livrés sans facture', accent: '#b71c1c', bg: '#fff5f5',
    columns: [
      { label: 'N° BC', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Date livraison', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Montant estimé', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n(r.amount)} DH</span>, sortValue: r => r.amount },
    ],
  },
  unpaidInvoices: {
    title: 'Factures impayées (toutes périodes)', accent: '#856404', bg: 'var(--theme-bg-page)',
    filter: { placeholder: 'Tous les statuts', value: r => r.status, display: v => INVOICE_STATUS_LABELS[v] || v },
    columns: [
      { label: 'N° facture', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Date', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Échéance', render: r => (r.dueDate ? fmtPaymentDate(r.dueDate, 'fr') : '—'), sortValue: r => r.dueDate || '' },
      { label: 'Reste', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n(r.amount)} DH</span>, sortValue: r => r.amount },
    ],
  },
  uncashedChecks: {
    title: 'Chèques émis non encaissés', accent: '#856404', bg: '#fff9e6',
    columns: [
      { label: 'Bénéficiaire', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Réf', render: r => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Émis le', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Échéance', render: r => (r.dueDate ? fmtPaymentDate(r.dueDate, 'fr') : '—'), sortValue: r => r.dueDate || '' },
      { label: 'Montant', align: 'right', render: r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n(r.amount)} DH</span>, sortValue: r => r.amount },
    ],
  },
};

/** Texte agrégé d'une ligne pour la recherche plein-texte (insensible à la casse) */
function financeRowSearchText(r: FinanceDetailRow): string {
  return [
    r.ref, r.supplierRef, r.supplierName, r.label,
    INVOICE_STATUS_LABELS[r.status || ''] || r.status,
    PAYMENT_METHOD_LABELS[r.method || ''] || r.method,
    r.date, r.dueDate,
  ].filter(Boolean).join(' ').toLowerCase();
}

function FinanceDetailPanel({ kind, dateFrom, dateTo, onClose }: {
  kind: FinanceDetailKind;
  dateFrom: string;
  dateTo: string;
  onClose: () => void;
}) {
  const cfg = DETAIL_CONFIG[kind];
  const { data, isLoading } = useQuery({
    queryKey: ['finance-detail', kind, dateFrom, dateTo],
    queryFn: () => reportsApi.financeOverviewDetail(kind, dateFrom, dateTo),
  });
  const allRows = useMemo(() => data ?? [], [data]);

  // Contrôles recherche / filtre / tri
  const [search, setSearch] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // On réinitialise les contrôles quand on change de carte
  useEffect(() => { setSearch(''); setFilterValue(''); setSortCol(null); setSortDir('asc'); }, [kind]);

  // Options du filtre déroulant : valeurs distinctes effectivement présentes
  const filterOptions = useMemo(() => {
    if (!cfg.filter) return [];
    const seen = new Set<string>();
    for (const r of allRows) {
      const v = cfg.filter.value(r);
      if (v) seen.add(v);
    }
    return [...seen].sort();
  }, [allRows, cfg]);

  const rows = useMemo(() => {
    let out = allRows;
    const q = search.trim().toLowerCase();
    if (q) out = out.filter(r => financeRowSearchText(r).includes(q));
    if (cfg.filter && filterValue) out = out.filter(r => cfg.filter!.value(r) === filterValue);
    if (sortCol != null) {
      const acc = cfg.columns[sortCol].sortValue;
      out = [...out].sort((a, b) => {
        const va = acc(a), vb = acc(b);
        const cmp = (typeof va === 'number' && typeof vb === 'number')
          ? va - vb
          : String(va).localeCompare(String(vb), 'fr', { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [allRows, search, filterValue, sortCol, sortDir, cfg]);

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const hasControls = search !== '' || filterValue !== '' || sortCol != null;

  const toggleSort = (i: number) => {
    if (sortCol === i) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(i); setSortDir('asc'); }
  };

  return (
    <div style={{ border: `1px solid ${cfg.accent}33`, borderRadius: 4, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--theme-bg-separator)', background: cfg.bg }}>
        <div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: cfg.accent }}>{cfg.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {rows.length} ligne{rows.length > 1 ? 's' : ''}
            {rows.length !== allRows.length && <> sur {allRows.length}</>}
            {' '}— total <strong style={{ fontFamily: 'ui-monospace, monospace', color: cfg.accent }}>{n(total)} DH</strong>
          </div>
        </div>
        <button onClick={onClose} title="Fermer le détail"
          style={{ padding: 6, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <X size={18} style={{ color: 'var(--theme-text-muted)' }} />
        </button>
      </div>
      {/* Barre de recherche / filtre / tri */}
      {!isLoading && allRows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 16px', borderBottom: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--theme-text-muted)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="odoo-input" style={{ paddingLeft: 26, width: 200 }} />
          </div>
          {cfg.filter && filterOptions.length > 0 && (
            <select value={filterValue} onChange={e => setFilterValue(e.target.value)} className="odoo-input" style={{ width: 180 }}>
              <option value="">{cfg.filter.placeholder}</option>
              {filterOptions.map(v => <option key={v} value={v}>{cfg.filter!.display(v)}</option>)}
            </select>
          )}
          {hasControls && (
            <button onClick={() => { setSearch(''); setFilterValue(''); setSortCol(null); setSortDir('asc'); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              <RotateCcw size={12} /> Réinitialiser
            </button>
          )}
        </div>
      )}
      {/* Body */}
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <Loader2 size={18} className="animate-spin" style={{ display: 'inline-block', marginRight: 8 }} />
            Chargement du détail...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.875rem' }}>
            {allRows.length === 0 ? 'Aucune ligne à afficher.' : 'Aucune ligne ne correspond à la recherche.'}
          </div>
        ) : (
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                {cfg.columns.map((c, i) => (
                  <th key={i} onClick={() => toggleSort(i)}
                    style={{ textAlign: c.align === 'right' ? 'right' : undefined, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {c.label}
                    {sortCol === i && (sortDir === 'asc'
                      ? <ArrowUp size={11} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
                      : <ArrowDown size={11} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  {cfg.columns.map((c, i) => (
                    <td key={i} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════ PILOTAGE TAB ═══════════════════════ */
/**
 * Vue de synthese pour l'admin : croise 3 dimensions financieres :
 *   - ENGAGEMENT (factures recues sur la periode, peu importe statut)
 *   - TRESORERIE (cash sorti = paye en cash + cheques encaisses)
 *   - PIPELINE (impayes, cheques non encaisses, recus non factures)
 *
 * Le DELTA entre engagement et tresorerie + le pipeline donne la vraie
 * vision : "j'ai engage X, paye Y, il reste Z a debourser, et W de cheques
 * vont sortir dans les 30 jours".
 *
 * Source : reportsApi.financeOverview qui aggrege tout cote backend.
 */
function PilotageTab() {
  const now = new Date();
  const [periodMode, setPeriodMode] = useState<'month' | 'custom'>('month');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(now, 'yyyy-MM-dd'));

  // Calcul des dates effectives selon le mode
  const { dateFrom, dateTo, periodLabel } = useMemo(() => {
    if (periodMode === 'custom') {
      return {
        dateFrom: customFrom, dateTo: customTo,
        periodLabel: `${format(parseLocalDate(customFrom), 'dd MMM', { locale: fr })} → ${format(parseLocalDate(customTo), 'dd MMM yyyy', { locale: fr })}`,
      };
    }
    const lastDay = new Date(year, month, 0).getDate();
    return {
      dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
      dateTo: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      periodLabel: format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: fr }),
    };
  }, [periodMode, month, year, customFrom, customTo]);

  const { data, isLoading } = useQuery({
    queryKey: ['finance-overview', dateFrom, dateTo],
    queryFn: () => reportsApi.financeOverview(dateFrom, dateTo),
  });

  // Carte ouverte en drill-down (null = aucune)
  const [detailKind, setDetailKind] = useState<FinanceDetailKind | null>(null);

  // Au clic sur une carte, on amene le panneau de detail dans le champ de vision
  useEffect(() => {
    if (!detailKind) return;
    const t = setTimeout(() => {
      document.getElementById('pilotage-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
    return () => clearTimeout(t);
  }, [detailKind]);

  if (isLoading || !data) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Loader2 size={20} className="animate-spin" style={{ display: 'inline-block', marginRight: 8 }} />
        Chargement du pilotage...
      </div>
    );
  }

  const { kpis, pipeline, topSuppliers } = data;
  const cashPct = kpis.treasury.total > 0 ? (kpis.treasury.byMethod.cash.total / kpis.treasury.total) * 100 : 0;
  const checkPct = kpis.treasury.total > 0 ? (kpis.treasury.byMethod.check.total / kpis.treasury.total) * 100 : 0;
  const transferPct = kpis.treasury.total > 0 ? ((kpis.treasury.byMethod.transfer.total + kpis.treasury.byMethod.bank.total) / kpis.treasury.total) * 100 : 0;

  // Delta engagement - tresorerie : ce qui a ete engage mais pas encore sorti
  const deltaToPay = kpis.engagement.total - kpis.treasury.total;

  return (
    <>
      {/* Selecteur periode */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--theme-bg-page)', borderRadius: 4 }}>
          {[
            { key: 'month' as const, label: 'Par mois' },
            { key: 'custom' as const, label: 'Periode personnalisee' },
          ].map(opt => (
            <button key={opt.key} onClick={() => setPeriodMode(opt.key)}
              style={{
                padding: '6px 12px', border: 'none', borderRadius: 3,
                cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500,
                background: periodMode === opt.key ? 'var(--theme-bg-card)' : 'transparent',
                color: periodMode === opt.key ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                boxShadow: periodMode === opt.key ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}>
              {opt.label}
            </button>
          ))}
        </div>
        {periodMode === 'month' ? (
          <>
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="odoo-input" style={{ width: 130 }}>
              {Array.from({ length: 12 }, (_, k) => k + 1).map(m => (
                <option key={m} value={m}>{format(new Date(2026, m - 1, 1), 'MMMM', { locale: fr })}</option>
              ))}
            </select>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="odoo-input" style={{ width: 90 }}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        ) : (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="odoo-input" style={{ width: 140 }} />
            <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="odoo-input" style={{ width: 140 }} />
          </>
        )}
        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
          <Calendar size={12} style={{ display: 'inline', marginRight: 4 }} />
          <strong style={{ textTransform: 'capitalize' }}>{periodLabel}</strong>
        </span>
      </div>

      {/* SECTION 1 : KPIs principaux */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {/* Engagement */}
        <div className="kpi-clickable" title="Cliquer pour voir le détail" onClick={() => setDetailKind(k => k === 'engagement' ? null : 'engagement')}
          style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #c4d8eb', background: '#f0f6ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#0d4d8c', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <ClipboardList size={11} /> Engagement
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d4d8c', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(kpis.engagement.total)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {kpis.engagement.count} facture{kpis.engagement.count > 1 ? 's' : ''} sur la periode
          </div>
        </div>

        {/* Tresorerie sortie */}
        <div className="kpi-clickable" title="Cliquer pour voir le détail" onClick={() => setDetailKind(k => k === 'treasury' ? null : 'treasury')}
          style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #d4edda', background: '#f0f9f4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#0e7c3a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <ArrowDownRight size={11} /> Tresorerie sortie
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0e7c3a', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(kpis.treasury.total)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            Cash effectivement debourse
          </div>
        </div>

        {/* Reste a payer (delta) */}
        <div className="kpi-clickable" title="Cliquer pour voir le détail" onClick={() => setDetailKind(k => k === 'remainingToPay' ? null : 'remainingToPay')}
          style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #ffeaa7', background: '#fff9e6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#856404', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <Coins size={11} /> Reste a payer
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#856404', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(kpis.remainingToPay.total)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {kpis.remainingToPay.count} facture{kpis.remainingToPay.count > 1 ? 's' : ''} de la periode
          </div>
        </div>

        {/* Recu non facture */}
        <div className="kpi-clickable" title="Cliquer pour voir le détail" onClick={() => setDetailKind(k => k === 'receivedNotInvoiced' ? null : 'receivedNotInvoiced')}
          style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #f5c6cb', background: '#fff5f5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#b71c1c', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <FileWarning size={11} /> Recu non facture
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b71c1c', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(kpis.receivedNotInvoiced.total)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {kpis.receivedNotInvoiced.count} BC livre{kpis.receivedNotInvoiced.count > 1 ? 's' : ''}, facture manquante
          </div>
        </div>
      </div>

      {/* Equation explicite : Engagement = Tresorerie + Reste */}
      <div className="odoo-alert" style={{ fontSize: '0.8125rem', background: 'var(--theme-bg-page)', border: '1px solid var(--theme-bg-separator)' }}>
        <strong>Equation tresorerie :</strong> sur cette periode, tu as engage{' '}
        <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(kpis.engagement.total)} DH</strong>{' '}
        de factures fournisseur. Tu as deja debourse{' '}
        <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#0e7c3a' }}>{n(kpis.treasury.total)} DH</strong>{' '}
        en cash. Il reste donc{' '}
        <strong style={{ fontFamily: 'ui-monospace, monospace', color: deltaToPay > 0 ? '#856404' : '#0e7c3a' }}>{n(Math.max(0, deltaToPay))} DH</strong>{' '}
        engages mais pas encore sortis du compte.
        {kpis.receivedNotInvoiced.total > 0 && (
          <> Attention : <strong style={{ color: '#b71c1c' }}>{n(kpis.receivedNotInvoiced.total)} DH</strong> de marchandises recues n'ont PAS encore de facture saisie — engagement potentiellement sous-estime.</>
        )}
      </div>

      {/* SECTION 2 : Pipeline (vue a date) */}
      <div>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8, color: 'var(--theme-text)' }}>
          Pipeline (vue a date — ce qui va impacter la tresorerie)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {/* Factures impayees */}
          <div className="kpi-clickable" title="Cliquer pour voir le détail" onClick={() => setDetailKind(k => k === 'unpaidInvoices' ? null : 'unpaidInvoices')}
            style={{ padding: '12px 14px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Factures impayees (total)
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              {n(pipeline.unpaidInvoices.total)} DH
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {pipeline.unpaidInvoices.count} facture{pipeline.unpaidInvoices.count > 1 ? 's' : ''} en attente
            </div>
          </div>

          {/* Cheques non encaisses */}
          <div className="kpi-clickable" title="Cliquer pour voir le détail" onClick={() => setDetailKind(k => k === 'uncashedChecks' ? null : 'uncashedChecks')}
            style={{ padding: '12px 14px', borderRadius: 4, border: '1px solid #ffeaa7', background: '#fff9e6' }}>
            <div style={{ fontSize: '0.6875rem', color: '#856404', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Cheques non encaisses
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#856404', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              {n(pipeline.uncashedChecks.total)} DH
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {pipeline.uncashedChecks.count} cheque{pipeline.uncashedChecks.count > 1 ? 's' : ''} en attente
            </div>
            {/* Breakdown par echeance */}
            {pipeline.uncashedChecks.count > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f3df9b', fontSize: '0.6875rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {pipeline.uncashedChecks.overdue > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b71c1c' }}>
                    <span>⚠ En retard</span>
                    <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(pipeline.uncashedChecks.overdue)}</strong>
                  </div>
                )}
                {pipeline.uncashedChecks.next7d > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>≤ 7 jours</span>
                    <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(pipeline.uncashedChecks.next7d)}</strong>
                  </div>
                )}
                {pipeline.uncashedChecks.next30d > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>8-30 jours</span>
                    <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(pipeline.uncashedChecks.next30d)}</strong>
                  </div>
                )}
                {pipeline.uncashedChecks.later > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>plus tard</span>
                    <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(pipeline.uncashedChecks.later)}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Receptions sans facture */}
          <div style={{ padding: '12px 14px', borderRadius: 4, border: pipeline.receivedNotInvoiced.count > 0 ? '1px solid #f5c6cb' : '1px solid var(--theme-bg-separator)', background: pipeline.receivedNotInvoiced.count > 0 ? '#fff5f5' : 'var(--theme-bg-card)' }}>
            <div style={{ fontSize: '0.6875rem', color: pipeline.receivedNotInvoiced.count > 0 ? '#b71c1c' : 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Recu sans facture
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: pipeline.receivedNotInvoiced.count > 0 ? '#b71c1c' : 'inherit', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              {n(pipeline.receivedNotInvoiced.total)} DH
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {pipeline.receivedNotInvoiced.count} BC livre{pipeline.receivedNotInvoiced.count > 1 ? 's' : ''}, a comptabiliser
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3 : Repartition methodes de paiement */}
      {kpis.treasury.total > 0 && (
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8, color: 'var(--theme-text)' }}>
            Repartition des paiements effectifs sur la periode
          </h3>
          <div style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
            {/* Barre proportionnelle */}
            <div style={{ display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', marginBottom: 12, background: 'var(--theme-bg-page)' }}>
              {cashPct > 0 && (
                <div style={{ width: `${cashPct}%`, background: '#28a745', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.75rem', fontWeight: 600 }}>
                  {cashPct >= 8 && `${Math.round(cashPct)}%`}
                </div>
              )}
              {checkPct > 0 && (
                <div style={{ width: `${checkPct}%`, background: '#fd7e14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.75rem', fontWeight: 600 }}>
                  {checkPct >= 8 && `${Math.round(checkPct)}%`}
                </div>
              )}
              {transferPct > 0 && (
                <div style={{ width: `${transferPct}%`, background: '#007bff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.75rem', fontWeight: 600 }}>
                  {transferPct >= 8 && `${Math.round(transferPct)}%`}
                </div>
              )}
            </div>
            {/* Legende */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: '0.8125rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#28a745', borderRadius: 2 }} />
                  <strong>Especes</strong>
                  <span style={{ color: 'var(--theme-text-muted)' }}>({kpis.treasury.byMethod.cash.count})</span>
                </div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, marginLeft: 18 }}>{n(kpis.treasury.byMethod.cash.total)} DH</div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#fd7e14', borderRadius: 2 }} />
                  <strong>Cheque (encaisse)</strong>
                  <span style={{ color: 'var(--theme-text-muted)' }}>({kpis.treasury.byMethod.check.count})</span>
                </div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, marginLeft: 18 }}>{n(kpis.treasury.byMethod.check.total)} DH</div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: '#007bff', borderRadius: 2 }} />
                  <strong>Virement / Banque</strong>
                  <span style={{ color: 'var(--theme-text-muted)' }}>({kpis.treasury.byMethod.transfer.count + kpis.treasury.byMethod.bank.count})</span>
                </div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, marginLeft: 18 }}>{n(kpis.treasury.byMethod.transfer.total + kpis.treasury.byMethod.bank.total)} DH</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL drill-down : s'affiche ici quand on clique une carte */}
      {detailKind && (
        <div id="pilotage-detail">
          <FinanceDetailPanel
            kind={detailKind}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onClose={() => setDetailKind(null)}
          />
        </div>
      )}

      {/* SECTION 4 : Top fournisseurs crediteurs */}
      <div>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8, color: 'var(--theme-text)' }}>
          Top fournisseurs crediteurs (montants dus a date)
        </h3>
        {topSuppliers.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4, fontSize: '0.875rem' }}>
            Aucun fournisseur avec montant du. Tous les soldes sont a zero.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'hidden' }}>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>#</th>
                  <th>Fournisseur</th>
                  <th style={{ textAlign: 'right' }}>Factures impayees</th>
                  <th style={{ textAlign: 'right' }}>Cheques non encaisses</th>
                  <th style={{ textAlign: 'right' }}>Total du</th>
                </tr>
              </thead>
              <tbody>
                {topSuppliers.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{i + 1}</td>
                    <td><strong>{s.name}</strong></td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                      {s.unpaidTotal > 0 ? (
                        <>
                          {n(s.unpaidTotal)}
                          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({s.unpaidCount})</span>
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                      {s.uncashedChecksTotal > 0 ? (
                        <>
                          {n(s.uncashedChecksTotal)}
                          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({s.uncashedChecksCount})</span>
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: 'var(--theme-accent)' }}>
                      {n(s.totalDue)} DH
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Liste detaillee : receptions sans facture (si il y en a) */}
      {pipeline.receivedNotInvoiced.list.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8, color: '#b71c1c' }}>
            <FileWarning size={13} style={{ display: 'inline', marginRight: 4 }} />
            Marchandises recues sans facture (a saisir)
          </h3>
          <div style={{ border: '1px solid #f5c6cb', borderRadius: 4, overflow: 'hidden' }}>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>N° BC</th>
                  <th>Fournisseur</th>
                  <th>Date livraison</th>
                  <th style={{ textAlign: 'right' }}>Montant estime</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.receivedNotInvoiced.list.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.orderNumber}</td>
                    <td>{r.supplierName}</td>
                    <td>{r.deliveryDate ? format(parseLocalDate(r.deliveryDate), 'dd/MM/yyyy') : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n(r.total)} DH</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </>
  );
}

/* ═══════════════════════ CAISSE TAB ═══════════════════════ */
/* Tresorerie pure : uniquement les entrees + solde cumule */
function CaisseTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [showImportModal, setShowImportModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['caisse-register', year, month],
    queryFn: () => caisseApi.register(year, month),
  });

  const days = useMemo(() => {
    if (!data) return [];
    return buildDailyData(data.payments, data.sessions, data.sales || [], data.previousBalance, year, month);
  }, [data, year, month]);

  const monthTotals = useMemo(() => {
    let entries = 0, exits = 0, cashCaissiere = 0, cashSysteme = 0, cardReceipts = 0, totalSales = 0, saleCount = 0;
    for (const d of days) {
      entries += d.entries;
      exits += d.exits;
      cashCaissiere += d.cashCaissiere;
      cashSysteme += d.cashSysteme;
      cardReceipts += d.cardReceipt;
      totalSales += d.totalSales;
      saleCount += d.saleCount;
    }
    const lastDay = days[days.length - 1];
    return {
      entries, exits, cashCaissiere, cashSysteme, cardReceipts, totalSales, saleCount,
      ecart: cashCaissiere - (cashSysteme + cardReceipts),
      totalRecettes: cashCaissiere + cardReceipts + entries,
      cashNet: lastDay?.cashNetCumul || data?.previousBalance?.cashNet || 0,
      cardCumul: lastDay?.cardCumul || data?.previousBalance?.cardCumul || 0,
      solde: lastDay?.solde || ((data?.previousBalance?.cashNet || 0) + (data?.previousBalance?.cardCumul || 0)),
    };
  }, [days, data]);

  const toggleDay = (day: number) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const handleExport = () => {
    const rows: string[][] = [];
    for (const d of days) {
      const dateStr = format(parseLocalDate(d.date), 'dd/MM/yyyy');
      rows.push([`LE ${dateStr}`, '', '', '']);
      rows.push(['', 'VENTES', `${d.saleCount} ventes`, n(d.totalSales)]);
      rows.push(['', 'TOTAL ENCAISSE', '', n(d.cashCaissiere)]);
      rows.push(['', 'CASH REEL', '', n(d.cashSysteme)]);
      rows.push(['', 'CARTE', '', n(d.cardReceipt)]);
      if (d.entries > 0) rows.push(['', 'AUTRES ENTREES', '', n(d.entries)]);
      rows.push(['', 'ECART CAISSE', '', n(d.ecart)]);
      rows.push(['', 'SOLDE CUMULE', '', n(d.solde)]);
      rows.push(['', '', '', '']);
    }
    rows.push(['', 'TOTAL RECETTES MOIS', '', n(monthTotals.totalRecettes)]);
    rows.push(['', 'SOLDE FINAL', '', n(monthTotals.solde)]);
    exportCSV(`caisse_${MONTH_NAMES[month - 1]}_${year}.csv`, ['', 'LIBELLE', 'DETAIL', 'MONTANT (DH)'], rows);
  };

  return (
    <>
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowImportModal(true)} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Upload size={13} /> Importer Excel
        </button>
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
      </div>

      {showImportModal && <CaisseImportModal onClose={() => setShowImportModal(false)} />}

      {/* Report line */}
      {data && (data.previousBalance.cashNet !== 0 || data.previousBalance.cardCumul !== 0) && (
        <div className="odoo-alert warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ArrowUpRight size={14} /> Report mois précédent
          </span>
          <span style={{ display: 'inline-flex', gap: 16, fontSize: '0.75rem' }}>
            <span>Cash: <strong>{n(data.previousBalance.cashNet)} DH</strong></span>
            <span>Carte: <strong>{n(data.previousBalance.cardCumul)} DH</strong></span>
            <span>Total: <strong>{n(data.previousBalance.cashNet + data.previousBalance.cardCumul)} DH</strong></span>
          </span>
        </div>
      )}

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ShoppingCart size={11} style={{ display: 'inline', marginRight: 4 }} />Ventes du mois</div>
          <div className="odoo-stat-card-value">{n(monthTotals.totalSales)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{monthTotals.saleCount} vente{monthTotals.saleCount > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Coins size={11} style={{ display: 'inline', marginRight: 4 }} />Recettes</div>
          <div className="odoo-stat-card-value">{n(monthTotals.totalRecettes)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">
            Cash {n(monthTotals.cashCaissiere)} · Carte {n(monthTotals.cardReceipts)}
            {monthTotals.entries > 0 && ` · Autres ${n(monthTotals.entries)}`}
          </div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Scale size={11} style={{ display: 'inline', marginRight: 4 }} />Écart caisse</div>
          <div className="odoo-stat-card-value" style={{ color: monthTotals.ecart === 0 ? 'var(--theme-text-muted)' : monthTotals.ecart > 0 ? '#28a745' : '#dc3545' }}>
            {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Caissière vs Système</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Wallet size={11} style={{ display: 'inline', marginRight: 4 }} />Solde actuel</div>
          <div className="odoo-stat-card-value" style={{ color: monthTotals.solde >= 0 ? '#28a745' : '#dc3545' }}>
            {n(monthTotals.solde)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Cash {n(monthTotals.cashNet)} · Carte {n(monthTotals.cardCumul)}</div>
        </div>
      </div>

      {/* Écart caisse alert */}
      {monthTotals.ecart !== 0 && (
        <div className={`odoo-alert ${monthTotals.ecart > 0 ? 'warning' : 'danger'}`}>
          <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6 }} />
          Écart caisse du mois : <strong>{monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH</strong> (Total encaissé vs Cash réel + Carte)
        </div>
      )}

      {/* Reconciliation alerts — significant daily discrepancies */}
      {(data as Record<string, any>)?.reconciliationAlerts && ((data as Record<string, any>).reconciliationAlerts as { date: string; ecart: number }[]).length > 0 && (
        <div className="odoo-section">
          <div className="odoo-section-header">
            <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6, color: '#dc3545' }} />
            {((data as Record<string, any>).reconciliationAlerts as { date: string; ecart: number }[]).length} jour(s) avec écart caisse significatif (&gt; 5 DH)
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              {((data as Record<string, any>).reconciliationAlerts as { date: string; cashCaissiere: number; cashSysteme: number; ecart: number }[]).map(a => (
                <tr key={a.date}>
                  <td><span className="odoo-status-dot danger" /></td>
                  <td style={{ textTransform: 'capitalize' }}>{format(parseLocalDate(a.date), 'EEEE dd/MM', { locale: fr })}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Caissière {n(a.cashCaissiere)}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Système {n(a.cashSysteme)}</td>
                  <td style={{ textAlign: 'right' }}><span className="odoo-tag odoo-tag-red">{a.ecart > 0 ? '+' : ''}{n(a.ecart)} DH</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Daily sections */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : days.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Wallet size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune activité pour ce mois</p>
        </div>
      ) : (
        <div className="odoo-section">
          <div className="odoo-section-header">Journal quotidien</div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Ventes</th>
                <th style={{ textAlign: 'right' }}>Total encaissé</th>
                <th style={{ textAlign: 'right' }}>Carte</th>
                <th style={{ textAlign: 'right' }}>Écart</th>
                <th style={{ textAlign: 'right' }}>Solde cumulé</th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => {
                const expanded = expandedDays.has(day.dayNum);
                const dateLabel = format(parseLocalDate(day.date), 'EEEE dd MMM', { locale: fr });
                const ecartTagClass = day.ecart === 0 ? 'odoo-tag-grey'
                  : day.ecart > 0 ? 'odoo-tag-green' : 'odoo-tag-red';
                return (
                  <Fragment key={day.dayNum}>
                    <tr onClick={() => toggleDay(day.dayNum)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--theme-text-muted)' }}>
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{dateLabel}</td>
                      <td style={{ textAlign: 'right' }}>{day.totalSales > 0 ? n(day.totalSales) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>{day.cashCaissiere > 0 ? n(day.cashCaissiere) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>{day.cardReceipt > 0 ? n(day.cardReceipt) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {day.ecart !== 0 ? <span className={`odoo-tag ${ecartTagClass}`}>{day.ecart > 0 ? '+' : ''}{n(day.ecart)}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: day.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(day.solde)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Cash réel</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashSysteme)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Total encaissé</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashCaissiere)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Carte</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cardReceipt)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Solde cash</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashNetCumul)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Solde carte</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cardCumul)} DH</div>
                            </div>
                          </div>
                          {day.entries > 0 && day.payments.filter(p => p.type === 'income').length > 0 && (
                            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--theme-bg-separator)' }}>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>Autres entrées</div>
                              {day.payments.filter(p => p.type === 'income').map((p, idx) => {
                                const amount = parseFloat(p.amount as string) || 0;
                                return (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '2px 0' }}>
                                    <span style={{ color: 'var(--theme-text-muted)' }}>{(p.description as string) || (p.category_name as string) || 'Revenu'}</span>
                                    <span style={{ fontWeight: 600, color: '#28a745' }}>+{n(amount)} DH</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Monthly recap */}
      {days.length > 0 && (
        <div className="odoo-section">
          <div className="odoo-section-header">
            <BarChart3 size={13} style={{ display: 'inline', marginRight: 6 }} />
            Récap {MONTH_NAMES[month - 1]} {year}
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <tbody>
              <tr>
                <td style={{ color: 'var(--theme-text-muted)' }}>Total Ventes ({monthTotals.saleCount})</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.totalSales)} DH</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--theme-text-muted)' }}>Total encaissé</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.cashCaissiere)} DH</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--theme-text-muted)' }}>Carte Encaissée</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.cardReceipts)} DH</td>
              </tr>
              {monthTotals.entries > 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Autres Entrées</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.entries)} DH</td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 600 }}>Total Recettes</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#28a745' }}>{n(monthTotals.totalRecettes)} DH</td>
              </tr>
              {monthTotals.ecart !== 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Écart Caisse</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: monthTotals.ecart > 0 ? '#28a745' : '#dc3545' }}>
                    {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} DH
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Solde Final</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.125rem', color: monthTotals.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(monthTotals.solde)} DH</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ CHARGES & DEPENSES TAB ═══════════════════════ */
/* Tout ce qui sort : achats fournisseurs, salaires, depenses diverses */
function ChargesTab() {
  const { entries: paymentMethods, getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const queryClient = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Record<string, any> | null>(null);
  // Modal de categorisation d'une facture (s'applique a toutes ses lignes)
  const [categorizingInvoice, setCategorizingInvoice] = useState<Record<string, any> | null>(null);
  const [categorizingCategoryId, setCategorizingCategoryId] = useState<string>('');
  const [filterRoot, setFilterRoot] = useState<string>('all');
  const [filterLeaf, setFilterLeaf] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Plage de dates pour filtrer dans la periode chargee (mois courant par defaut).
  // Format ISO YYYY-MM-DD. Vide = pas de borne sur ce cote.
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [sortCol, setSortCol] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  useEffect(() => {
    // Init la cascade categorie a l'ouverture du modal d'edition
    setEditCategoryId(editingPayment ? (editingPayment.category_id as string) || '' : '');
  }, [editingPayment]);

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: payments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payments-charges', year, month],
    queryFn: () => paymentsApi.list({ dateFrom, dateTo }),
  });
  // Achats fournisseurs : on lit les lignes des factures INTEGRALEMENT PAYEES
  // (status = 'paid'), datees a la date du dernier paiement (MAX(payments)).
  // Logique tresorerie : la charge apparait quand le cash est sorti, pas a la
  // date facture. Les impayees/partielles ne sont pas la — visibles dans
  // l'onglet "Factures recues" du module Achats.
  const { data: invoiceLines = [], isLoading: isLoadingLines } = useQuery({
    queryKey: ['invoice-line-expenses', year, month],
    queryFn: () => invoicesApi.lineExpenses({ dateFrom, dateTo }),
  });
  const isLoading = isLoadingPayments || isLoadingLines;
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: () => expenseCategoriesApi.list() });
  const { data: eligiblePOs = [] } = useQuery({ queryKey: ['eligible-pos'], queryFn: purchaseOrdersApi.eligible });

  // Form state for new expense
  const [formCategoryId, setFormCategoryId] = useState<string>('');
  const [formPOId, setFormPOId] = useState<string>('');
  // State du modal "Modifier la depense" : cascade categorie controllee
  const [editCategoryId, setEditCategoryId] = useState<string>('');

  // Check if selected category requires a PO (look up the leaf category)
  const selectedCategory = (categories as Record<string, any>[]).find(c => String(c.id) === formCategoryId);
  // ─── BC OBLIGATOIRE — DESACTIVE TEMPORAIREMENT ───────────────────
  // Pour reactiver : passer ENFORCE_PO_REQUIREMENT a true.
  // L'info `categoryRequiresPO` reste calculee pour afficher une banniere
  // d'avertissement sur les categories concernees.
  const ENFORCE_PO_REQUIREMENT = false;
  const categoryRequiresPO = selectedCategory ? (selectedCategory.requires_po as boolean) : false;
  const requiresPO = ENFORCE_PO_REQUIREMENT && categoryRequiresPO;
  const showPOWaivedBanner = !ENFORCE_PO_REQUIREMENT && categoryRequiresPO;

  /**
   * Detection "depense de personnel" : on remonte les parents de la categorie
   * selectionnee jusqu'a la racine (level 1). Si la racine est "Charges de
   * personnel", on bascule le selecteur Fournisseur en selecteur Employe.
   * UUID stable du seed migrations/019.
   */
  const PERSONNEL_ROOT_ID = '10000000-0000-0000-0000-000000000004';
  const isPersonnelCategory = (catId: string | null): boolean => {
    if (!catId) return false;
    const all = categories as Record<string, any>[];
    let current = all.find(c => String(c.id) === catId);
    // Garde-fou contre les boucles dans le graphe categories
    const seen = new Set<string>();
    while (current) {
      const id = String(current.id);
      if (seen.has(id)) return false;
      seen.add(id);
      if (id === PERSONNEL_ROOT_ID) return true;
      if (!current.parent_id) return false;
      current = all.find(c => String(c.id) === String(current!.parent_id));
    }
    return false;
  };
  const isPersonnelExpense = isPersonnelCategory(formCategoryId);

  // Salaires et avances ne se saisissent plus ici : ils sont crees par le
  // module RH (Paie / Avances) et apparaissent ensuite en lecture seule dans
  // cette liste. Bloque : sous-arbre "Salaires" (L2) + feuille "Avances sur
  // salaire". Les autres categories personnel (primes...) restent saisissables.
  const SALAIRES_SUBTREE_ID = '20000000-0000-0000-0000-000000000006';
  const AVANCES_CATEGORY_ID = '30000000-0000-0000-0000-000000000023';
  const isRhManagedCategory = (() => {
    if (!formCategoryId) return false;
    if (formCategoryId === AVANCES_CATEGORY_ID) return true;
    if (String(selectedCategory?.name || '').trim() === 'Avances sur salaire') return true;
    const all = categories as Record<string, any>[];
    let current = all.find(c => String(c.id) === formCategoryId);
    const seen = new Set<string>();
    while (current) {
      const id = String(current.id);
      if (seen.has(id)) return false;
      seen.add(id);
      if (id === SALAIRES_SUBTREE_ID || String(current.name).trim() === 'Salaires') return true;
      if (!current.parent_id) return false;
      current = all.find(c => String(c.id) === String(current!.parent_id));
    }
    return false;
  })();

  // Build full path label for display: "Categorie > Sous-cat > Type"
  const getCategoryPath = (catId: string) => {
    const all = categories as Record<string, any>[];
    const cat = all.find(c => String(c.id) === catId);
    if (!cat) return '';
    const parts: string[] = [String(cat.name)];
    let current = cat;
    while (current.parent_id) {
      const parent = all.find(c => String(c.id) === String(current.parent_id));
      if (parent) { parts.unshift(String(parent.name)); current = parent; }
      else break;
    }
    return parts.join(' > ');
  };

  // Auto-fill from selected PO
  const selectedPO = (eligiblePOs as Record<string, any>[]).find(po => po.id === formPOId);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Dépense enregistrée');
      setShowForm(false);
      setFormCategoryId('');
      setFormPOId('');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => paymentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Modifié avec succès');
      setEditingPayment(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la modification');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Supprimé');
    },
  });

  // Categorise UNE seule ligne de charge (les autres lignes de la meme
  // facture / bon de commande ne sont pas touchees).
  const updateInvoiceCategoryMutation = useMutation({
    mutationFn: ({ id, source, categoryId }: { id: string; source: string; categoryId: string | null }) =>
      invoicesApi.updateLineCategory(id, source, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
      notify.success('Ligne categorisee');
      setCategorizingInvoice(null);
      setCategorizingCategoryId('');
    },
    onError: () => notify.error('Erreur lors de la categorisation'),
  });

  // Sorties affichees :
  //   - payments hors income et hors invoice (les anciens reglements cheque
  //     ne sont plus la source des achats),
  //   - salaires ET avances inclus en LECTURE SEULE : crees uniquement depuis
  //     RH (Paie / Avances). Pas de double comptage : le paiement salaire est
  //     net de la retenue d'avance, donc avance + salaire = net reel decaisse,
  //   - + 1 ligne par ingredient de facture recue (via invoicesApi.lineExpenses).
  const otherPayments = (payments as Record<string, any>[]).filter(p => p.type !== 'income' && p.type !== 'invoice');
  const outgoing = useMemo(
    () => [...(invoiceLines as Record<string, any>[]), ...otherPayments],
    [invoiceLines, otherPayments]
  );

  const grandTotal = useMemo(() => outgoing.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0), [outgoing]);

  // Category tree helpers
  const catMap = useMemo(() => {
    const m: Record<string, any> = {};
    (categories as any[]).forEach(c => { m[String(c.id)] = c; });
    return m;
  }, [categories]);

  const getRootId = (catId: string | null): string | null => {
    if (!catId) return null;
    let c = catMap[catId]; let limit = 4;
    while (c && limit-- > 0) {
      if (c.level === 1) return String(c.id);
      if (!c.parent_id) return null;
      c = catMap[String(c.parent_id)];
    }
    return null;
  };

  const getSubId = (catId: string | null): string | null => {
    if (!catId) return null;
    const c = catMap[catId];
    if (!c) return null;
    if (c.level === 2) return String(c.id);
    if (c.level === 3) { const par = catMap[String(c.parent_id)]; if (par?.level === 2) return String(par.id); }
    return null;
  };

  // Root categories that have payments, sorted by display_order
  const rootCatsWithPayments = useMemo(() => {
    const rootIds = new Set<string>();
    outgoing.forEach(p => { const rid = getRootId(p.category_id as string | null); rootIds.add(rid ?? '__none__'); });
    const roots = (categories as any[])
      .filter(c => c.level === 1 && rootIds.has(String(c.id)))
      .sort((a, b) => (a.display_order || 99) - (b.display_order || 99));
    if (rootIds.has('__none__')) roots.push({ id: '__none__', name: 'Sans catégorie', level: 1, display_order: 999 });
    return roots;
  }, [categories, outgoing]);


  // Top 3 root categories by total for stat cards
  const topCats = useMemo(() => rootCatsWithPayments
    .map(rc => ({
      ...rc,
      total: (outgoing.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === String(rc.id))
        .reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0)),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3),
  [rootCatsWithPayments, outgoing]);

  // Leaf categories available for the current root filter
  const availableLeaves = useMemo(() => {
    const base = filterRoot === 'all' ? outgoing : outgoing.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === filterRoot);
    const leaves = new Set<string>();
    base.forEach(p => { if (p.category_name) leaves.add(p.category_name as string); });
    return Array.from(leaves).sort();
  }, [outgoing, filterRoot, catMap]);

  // Filtered + sorted rows
  const displayed = useMemo(() => {
    let list = outgoing;
    if (filterRoot !== 'all') list = list.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === filterRoot);
    if (filterLeaf !== 'all') list = list.filter(p => (p.category_name as string || '') === filterLeaf);
    if (filterMethod !== 'all') list = list.filter(p => (p.payment_method as string || '') === filterMethod);
    // Filtre plage de dates : compare la portion YYYY-MM-DD (ISO lexicographique).
    if (filterDateFrom) list = list.filter(p => String(p.payment_date || '').slice(0, 10) >= filterDateFrom);
    if (filterDateTo) list = list.filter(p => String(p.payment_date || '').slice(0, 10) <= filterDateTo);
    // Recherche texte sur designation/description, beneficiaire, reference, N° facture, categorie
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter(p => {
        const beneficiaire = (p.supplier_name as string) ||
          (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : '');
        const rid = getRootId(p.category_id as string | null);
        const rootName = rid ? (catMap[rid]?.name as string || '') : '';
        const fields = [
          p.description as string, p.designation as string,
          p.reference as string, p.invoice_number as string,
          beneficiaire, p.category_name as string, rootName,
        ];
        return fields.some(f => (f || '').toLowerCase().includes(q));
      });
    }
    return [...list].sort((a, b) => {
      let va: any = '', vb: any = '';
      if (sortCol === 'date') { va = a.payment_date; vb = b.payment_date; }
      else if (sortCol === 'cat') { const ra = getRootId(a.category_id as string | null); const rb = getRootId(b.category_id as string | null); va = ra ? catMap[ra]?.name || '' : ''; vb = rb ? catMap[rb]?.name || '' : ''; }
      else if (sortCol === 'type') { va = a.category_name || ''; vb = b.category_name || ''; }
      else if (sortCol === 'amount') { va = parseFloat(a.amount) || 0; vb = parseFloat(b.amount) || 0; }
      else if (sortCol === 'beneficiaire') { va = a.supplier_name || (a.employee_first_name ? `${a.employee_first_name} ${a.employee_last_name}` : ''); vb = b.supplier_name || (b.employee_first_name ? `${b.employee_first_name} ${b.employee_last_name}` : ''); }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [outgoing, filterRoot, filterLeaf, filterMethod, filterDateFrom, filterDateTo, searchTerm, sortCol, sortDir, catMap]);

  const displayedTotal = useMemo(() => displayed.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0), [displayed]);

  const toggleSort = (col: string) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('asc'); } };
  const SortIcon = ({ col }: { col: string }) => sortCol === col ? <span style={{ marginLeft: 3, opacity: 0.7, fontSize: '0.625rem' }}>{sortDir === 'asc' ? '▲' : '▼'}</span> : <span style={{ marginLeft: 3, opacity: 0.2, fontSize: '0.625rem' }}>▼</span>;

  const handleExport = () => {
    const rows = displayed.map(p => [
      fmtPaymentDate(p.payment_date, 'fr'),
      (p.reference as string) || '',
      (() => { const rid = getRootId(p.category_id as string | null); return rid ? catMap[rid]?.name || '' : ''; })(),
      (p.category_name as string) || '',
      (p.supplier_name as string) || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : ''),
      (p.designation as string) || '',
      getPaymentLabel(p.payment_method as string) || '',
      (p.description as string) || '',
      n(parseFloat(p.amount as string) || 0),
    ]);
    exportCSV(`charges_${MONTH_NAMES[month - 1]}_${year}.csv`,
      ['DATE', 'REF', 'CATEGORIE', 'SOUS-CATEGORIE', 'BENEFICIAIRE', 'METHODE', 'DESCRIPTION', 'MONTANT (DH)'], rows);
  };


  return (
    <>
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Nouvelle dépense
        </button>
      </div>

      {/* Stat tiles: total + top 3 categories */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ArrowDownRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total sorties</div>
          <div className="odoo-stat-card-value" style={{ color: '#dc3545' }}>{n(grandTotal)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{outgoing.length} opération{outgoing.length > 1 ? 's' : ''}</div>
        </div>
        {topCats.map(tc => (
          <div key={tc.id} className="odoo-stat-card">
            <div className="odoo-stat-card-label">{tc.name}</div>
            <div className="odoo-stat-card-value">{n(tc.total)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
            <div className="odoo-stat-card-sub">{grandTotal > 0 ? Math.round(tc.total / grandTotal * 100) : 0}% du total</div>
          </div>
        ))}
      </div>

      {/* Filter bar : recherche + filtres + reset */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text"
            placeholder="Rechercher (description, bénéficiaire, réf, catégorie...)"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="odoo-search-input"
            style={{ flex: 1, minWidth: 0 }} />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} title="Effacer la recherche"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <select value={filterRoot} onChange={e => { setFilterRoot(e.target.value); setFilterLeaf('all'); }} className="odoo-filter-dropdown">
          <option value="all">Toutes catégories</option>
          {rootCatsWithPayments.map(rc => <option key={String(rc.id)} value={String(rc.id)}>{rc.name}</option>)}
        </select>
        <select value={filterLeaf} onChange={e => setFilterLeaf(e.target.value)} className="odoo-filter-dropdown">
          <option value="all">Tous types</option>
          {availableLeaves.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} className="odoo-filter-dropdown">
          <option value="all">Toutes méthodes</option>
          {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Filtre date : restreint a une plage dans la periode chargee">
          <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>Du</span>
          <input type="date" value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            min={dateFrom} max={dateTo}
            className="odoo-filter-dropdown"
            style={{ padding: '4px 6px' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>au</span>
          <input type="date" value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            min={dateFrom} max={dateTo}
            className="odoo-filter-dropdown"
            style={{ padding: '4px 6px' }} />
        </div>
        {(filterRoot !== 'all' || filterLeaf !== 'all' || filterMethod !== 'all' || filterDateFrom || filterDateTo || searchTerm) && (
          <button onClick={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearchTerm(''); }}
            className="odoo-filter-dropdown" style={{ color: '#dc3545', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={11} /> Réinitialiser
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--theme-text-muted)', alignSelf: 'center' }}>
          {displayed.length !== outgoing.length ? `${displayed.length} / ${outgoing.length} résultats` : `${displayed.length} résultat${displayed.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Flat table with referentiel columns */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : outgoing.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Receipt size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune sortie pour cette période</p>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Receipt size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune sortie ne correspond à ces filtres</p>
          <button onClick={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setFilterDateFrom(''); setFilterDateTo(''); setSearchTerm(''); }}
            style={{ marginTop: 8, color: '#0d6efd', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}>
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('date')} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Date<SortIcon col="date" /></th>
                <th>Désignation</th>
                <th onClick={() => toggleSort('beneficiaire')} style={{ cursor: 'pointer', userSelect: 'none' }}>Bénéficiaire<SortIcon col="beneficiaire" /></th>
                <th onClick={() => toggleSort('cat')} style={{ cursor: 'pointer', userSelect: 'none' }}>Catégorie<SortIcon col="cat" /></th>
                <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer', userSelect: 'none' }}>Type<SortIcon col="type" /></th>
                <th>Méthode</th>
                <th onClick={() => toggleSort('amount')} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}>Montant<SortIcon col="amount" /></th>
                <th style={{ textAlign: 'center', width: 72 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(p => {
                const rootId = getRootId(p.category_id as string | null);
                const rootName = rootId ? catMap[rootId]?.name || '—' : '—';
                const leafName = p.category_name as string || '—';
                const isRootLeaf = rootId && catMap[rootId]?.name === leafName;
                return (
                  <tr key={p.id as string}>
                    <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>{fmtPaymentDate(p.payment_date, 'fr')}</td>
                    <td style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(p.description as string) || '—'}
                    </td>
                    <td style={{ fontWeight: 500, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.supplier_name as string || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : '—')}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text)' }}>{rootName}</span>
                    </td>
                    <td>
                      {!isRootLeaf && leafName !== '—' ? (
                        <span className="odoo-tag odoo-tag-grey">{leafName}</span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{getPaymentLabel(p.payment_method as string)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545', whiteSpace: 'nowrap' }}>
                      {n(parseFloat(p.amount as string))} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {p.type === 'invoice' ? (
                        <button
                          onClick={() => {
                            setCategorizingInvoice(p);
                            setCategorizingCategoryId((p.category_id as string) || '');
                          }}
                          style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--theme-text-muted)' }}
                          title="Categoriser cette ligne">
                          <Pencil size={13} />
                        </button>
                      ) : p.type !== 'salary' && p.type !== 'advance' ? (
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button onClick={() => setEditingPayment(p)} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--theme-text-muted)' }} title="Modifier"><Pencil size={13} /></button>
                          <button onClick={() => deleteMutation.mutate(p.id as string)} style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc3545' }} title="Supprimer"><X size={13} /></button>
                        </div>
                      ) : <span style={{ fontSize: '0.6875rem', color: 'var(--theme-bg-separator)' }} title="Géré depuis RH → Paie / Avances">RH</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={6} style={{ padding: 12, fontWeight: 600 }}>
                  Total {MONTH_NAMES[month - 1]} {year} ({displayed.length} opération{displayed.length > 1 ? 's' : ''}{displayed.length !== outgoing.length ? ` filtrée${displayed.length > 1 ? 's' : ''}` : ''})
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: '#dc3545' }}>
                  {n(displayedTotal)} DH
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add expense modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-rose-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Plus size={20} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">Nouvelle dépense</h2>
              </div>
              <button onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'expense';
              fd.categoryId = formCategoryId || undefined;
              if (requiresPO && formPOId) {
                fd.purchaseOrderId = formPOId;
                if (selectedPO) fd.supplierId = selectedPO.supplier_id as string;
              }
              if (!fd.supplierId) delete fd.supplierId;
              // Pour les depenses de personnel : on a un employeeId au lieu d'un supplierId.
              // Le payload backend (payments.create) supporte deja les deux champs.
              if (isPersonnelExpense) {
                delete fd.supplierId;
                if (!fd.employeeId) delete fd.employeeId;
              } else {
                delete fd.employeeId;
              }
              if (!fd.categoryId) { notify.error('Veuillez sélectionner une catégorie'); return; }
              if (isRhManagedCategory) { notify.error('Les salaires et avances se gèrent dans Ressources Humaines (onglets Paie et Avances) — ils apparaîtront ici automatiquement une fois payés'); return; }
              if (requiresPO && !formPOId) { notify.error('Cette catégorie nécessite un bon de commande'); return; }
              createMutation.mutate(fd);
            }} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Categorie *</label>
                <CategoryCascadeSelector
                  value={formCategoryId}
                  onChange={(id) => { setFormCategoryId(id); setFormPOId(''); }}
                  type="expense"
                />
              </div>

              {isRhManagedCategory && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                  ⚠️ Les salaires et avances ne se saisissent plus ici : utilisez <strong>Ressources Humaines → Paie</strong> (salaires)
                  ou <strong>→ Avances</strong> (avances, avec retenue automatique à la paie).
                  Une fois payés, ils apparaissent automatiquement dans cette liste.
                </div>
              )}
              {showPOWaivedBanner && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
                  ℹ️ Cette catégorie demande normalement un bon de commande, mais l'obligation est <strong>temporairement désactivée</strong>. Tu peux saisir la dépense directement.
                </div>
              )}
              {requiresPO && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <label className="block text-sm font-medium mb-1.5 text-amber-800">
                    <ClipboardList size={14} className="inline mr-1" /> Bon de commande *
                  </label>
                  <select value={formPOId} onChange={e => setFormPOId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white" required>
                    <option value="">Sélectionner un BC...</option>
                    {(eligiblePOs as Record<string, any>[]).map(po => (
                      <option key={po.id as string} value={po.id as string}>
                        {po.order_number as string} — {po.supplier_name as string} — {n(parseFloat(po.total_amount as string) || 0)} DH
                      </option>
                    ))}
                  </select>
                  {selectedPO && (
                    <p className="text-xs text-amber-700 mt-2">
                      Fournisseur: <strong>{selectedPO.supplier_name as string}</strong> | Montant BC: <strong>{n(parseFloat(selectedPO.total_amount as string) || 0)} DH</strong>
                    </p>
                  )}
                  {(eligiblePOs as Record<string, any>[]).length === 0 && (
                    <p className="text-xs text-red-600 mt-2">
                      Aucun bon de commande disponible. Créez d'abord un BC dans l'onglet Bons de commande.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
                  <input name="amount" type="number" step="0.01" disabled={isRhManagedCategory}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" required
                    defaultValue={selectedPO ? parseFloat(selectedPO.total_amount as string) || '' : ''} key={formPOId} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" disabled={isRhManagedCategory}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Methode</label>
                  <select name="paymentMethod" disabled={isRhManagedCategory}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                    {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                  </select></div>
                {!requiresPO && !isPersonnelExpense && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur</label>
                    <select name="supplierId" disabled={isRhManagedCategory}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                      <option value="">Aucun</option>
                      {(suppliers as Record<string, any>[]).filter(s => s.is_active).map(s => (
                        <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                      ))}
                    </select></div>
                )}
                {/* Categorie sous "Charges de personnel" : on affiche le selecteur Employe.
                    Le champ est obligatoire (un salaire/prime doit etre rattache a une ressource). */}
                {!requiresPO && isPersonnelExpense && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Ressource / Employé *</label>
                    <select name="employeeId" required disabled={isRhManagedCategory}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                      <option value="">Choisir un employé...</option>
                      {(employees as Record<string, any>[])
                        .filter(emp => emp.is_active !== false)
                        .sort((a, b) => String(a.first_name || a.name || '').localeCompare(String(b.first_name || b.name || '')))
                        .map(emp => {
                          const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ')
                            || (emp.name as string) || (emp.email as string) || 'Sans nom';
                          const role = emp.role || emp.position;
                          return (
                            <option key={emp.id as string} value={emp.id as string}>
                              {fullName}{role ? ` — ${role}` : ''}
                            </option>
                          );
                        })}
                    </select></div>
                )}
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea name="description" rows={2} disabled={isRhManagedCategory}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" /></div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={createMutation.isPending || isRhManagedCategory}
                  title={isRhManagedCategory ? 'Saisie depuis Ressources Humaines → Paie / Avances' : undefined}
                  className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
                  {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit expense modal */}
      {editingPayment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Pencil size={18} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">Modifier la depense</h2>
              </div>
              <button onClick={() => setEditingPayment(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              // categoryId est gere par la cascade controllee, pas via FormData
              fd.categoryId = editCategoryId || null;
              updateMutation.mutate({ id: editingPayment.id as string, data: fd });
            }} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
                    defaultValue={parseFloat(editingPayment.amount as string) || 0} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
                    defaultValue={fmtPaymentDate(editingPayment.payment_date)} /></div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Methode</label>
                <select name="paymentMethod" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" defaultValue={editingPayment.payment_method as string || 'cash'}>
                  {paymentMethods.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                </select></div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Categorie</label>
                <CategoryCascadeSelector
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  type="expense"
                />
                {editingPayment.category_id && !editCategoryId && (
                  <p className="text-xs text-amber-600 mt-1">
                    Categorie actuelle : <span className="font-medium">{getCategoryPath(String(editingPayment.category_id))}</span>
                  </p>
                )}
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea name="description" rows={2} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue={editingPayment.description as string || ''} /></div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setEditingPayment(null)}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={updateMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de categorisation d'une ligne de charge (ligne seule) */}
      {categorizingInvoice && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Pencil size={18} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Catégoriser la ligne</h2>
                  <p className="text-xs text-white/80">
                    {(categorizingInvoice.invoice_number as string) || '—'} · {(categorizingInvoice.supplier_name as string) || ''}
                  </p>
                </div>
              </div>
              <button onClick={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              if (!categorizingCategoryId) { notify.error('Sélectionnez une catégorie'); return; }
              updateInvoiceCategoryMutation.mutate({
                id: categorizingInvoice.id as string,
                source: (categorizingInvoice.line_source as string) || 'invoice_item',
                categoryId: categorizingCategoryId,
              });
            }} className="p-5 space-y-4">
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Cette catégorie s&apos;applique <strong>uniquement à cette ligne</strong>. Les autres lignes de la facture / du bon de commande ne sont pas modifiées.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie *</label>
                <CategoryCascadeSelector
                  value={categorizingCategoryId}
                  onChange={setCategorizingCategoryId}
                  type="expense"
                />
                {categorizingInvoice.category_id && (
                  <p className="text-xs text-amber-600 mt-1">
                    Catégorie actuelle : <span className="font-medium">{getCategoryPath(String(categorizingInvoice.category_id))}</span>
                  </p>
                )}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={updateInvoiceCategoryMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {updateInvoiceCategoryMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════ CHEQUES TAB ═══════════════════════ */
/**
 * Gestion des cheques emis : liste avec status (en attente / encaisse),
 * action manuelle pour confirmer l'encaissement bancaire.
 *
 * Workflow :
 *   1. Quand tu paies une facture par cheque, un payment est cree avec
 *      payment_method='check' et cashed_at=NULL.
 *   2. Le cheque apparait ici dans "En attente" avec son echeance, beneficiaire,
 *      montant, facture associee.
 *   3. Quand la banque debite ton compte, tu cliques "Marquer encaisse" et
 *      saisis la date du debit (par defaut = aujourd'hui).
 *   4. La charge apparait alors dans l'onglet Charges a cette date.
 *
 * Tant qu'un cheque n'est pas encaisse, il N'EST PAS compte dans Charges
 * (logique tresorerie stricte : pas de cash sorti = pas de charge).
 */
type CheckRow = {
  id: string;
  amount: string;
  payment_date: string;
  check_number: string | null;
  check_date: string | null;
  cashed_at: string | null;
  cashed_note: string | null;
  cashed_by_name: string | null;
  payment_type: string;
  payment_method: 'check' | 'traite';
  supplier_name: string | null;
  employee_name: string | null;
  category_name: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_due_date: string | null;
  invoice_total: string | null;
  purchase_order_number: string | null;
  description: string | null;
  reference: string | null;
  status: 'pending' | 'cashed' | 'overdue';
};

// Un cheque physique peut regler PLUSIEURS factures : N paiements partagent
// alors le meme N° de cheque et le meme beneficiaire. Le tableau affiche une
// seule ligne par cheque (montant total), depliable pour lister les factures.
type CheckGroup = {
  key: string;
  rows: CheckRow[];
  first: CheckRow;
  totalAmount: number;
  anyOverdue: boolean;
  allCashed: boolean;
  anyCashed: boolean;
  pendingRows: CheckRow[];
};

function ChequesTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'cashed' | 'all'>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmingGroup, setConfirmingGroup] = useState<CheckGroup | null>(null);
  // Cheques multi-factures depliés (cle de groupe -> visible)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // Filtres : KPI clic (dueWindow), beneficiaire (single), periode echeance, methode.
  // Tous inline dans la meme barre — meme style que ChargesTab.
  const [dueWindow, setDueWindow] = useState<'all' | 'overdue' | 'next7d' | 'next30d' | 'later'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [dueFromDate, setDueFromDate] = useState<string>('');
  const [dueToDate, setDueToDate] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<'all' | 'check' | 'traite'>('all');
  const [sortBy, setSortBy] = useState<'echeance' | 'emission' | 'amount' | 'supplier'>('echeance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // On charge TOUS les cheques pour que les KPIs et l'equation tresorerie
  // restent coherents quel que soit le filtre actif. Le tableau est ensuite
  // filtre cote client (statut + recherche).
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['payments-checks', 'all'],
    queryFn: () => paymentsApi.listChecks({ status: 'all' }),
  });

  // Un cheque multi-factures = N paiements : l'encaissement marque TOUS les
  // paiements du cheque en une fois (un cheque est debite une seule fois).
  const markMutation = useMutation({
    mutationFn: ({ ids, data }: { ids: string[]; data: { cashedAt?: string; note?: string } }) =>
      Promise.all(ids.map(id => paymentsApi.markCashed(id, data))),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payments-checks'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success(vars.ids.length > 1
        ? `Cheque marque comme encaisse (${vars.ids.length} factures)`
        : 'Cheque marque comme encaisse');
      setConfirmingGroup(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur');
    },
  });

  const unmarkMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => paymentsApi.unmarkCashed(id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-checks'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
      notify.success('Encaissement annule (cheque a nouveau en attente)');
    },
    onError: () => notify.error('Erreur lors de l\'annulation'),
  });

  // Suppression definitive d'un paiement (cheque inclus). Distinct de unmark :
  // ici le paiement disparait completement, la facture revient au statut pending
  // ou partial selon les paiements restants. Sert a corriger une erreur de saisie.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => paymentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-checks'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success('Paiement supprime — facture mise a jour');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la suppression');
    },
  });

  // Filtres frontend (statut + recherche, car la query renvoie tout)
  const data = checks as CheckRow[];

  // Liste des beneficiaires distincts pour le dropdown.
  const uniqueSuppliers = useMemo(() => {
    const set = new Set<string>();
    data.forEach(c => {
      const name = c.supplier_name || c.employee_name || c.category_name;
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [data]);

  const filtered = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const fromDate = dueFromDate ? parseLocalDate(dueFromDate) : null;
    const toDate = dueToDate ? parseLocalDate(dueToDate) : null;
    const q = searchTerm.trim().toLowerCase();

    let result = data.filter(c => {
      // ─── Statut ────────────────────────────────────────────
      if (statusFilter === 'cashed' && c.status !== 'cashed') return false;
      if (statusFilter === 'pending' && c.status === 'cashed') return false;

      // ─── Fenetre d'echeance (KPI cliquable) ────────────────
      // Meme priorite que le statut backend et la colonne Echeance.
      if (dueWindow !== 'all' && c.status !== 'cashed') {
        const dueStr = c.check_date || c.invoice_due_date;
        if (dueWindow === 'overdue') {
          if (c.status !== 'overdue') return false;
        } else if (!dueStr) {
          if (dueWindow !== 'later') return false;
        } else {
          const due = parseLocalDate(dueStr.slice(0, 10));
          const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (dueWindow === 'next7d' && (diffDays < 0 || diffDays > 7)) return false;
          if (dueWindow === 'next30d' && (diffDays < 8 || diffDays > 30)) return false;
          if (dueWindow === 'later' && diffDays <= 30) return false;
        }
      }

      // ─── Beneficiaire ──────────────────────────────────────
      if (supplierFilter !== 'all') {
        const name = c.supplier_name || c.employee_name || c.category_name || '';
        if (name !== supplierFilter) return false;
      }

      // ─── Periode d'echeance ────────────────────────────────
      if (fromDate || toDate) {
        const dueStr = c.check_date || c.invoice_due_date;
        if (!dueStr) return false;
        const due = parseLocalDate(dueStr.slice(0, 10));
        if (fromDate && due < fromDate) return false;
        if (toDate && due > toDate) return false;
      }

      // ─── Methode (cheque/traite) ───────────────────────────
      if (methodFilter !== 'all' && c.payment_method !== methodFilter) return false;

      // ─── Recherche texte ───────────────────────────────────
      if (q) {
        const hay = [
          c.supplier_name, c.employee_name, c.category_name,
          c.check_number, c.invoice_number, c.purchase_order_number,
          c.description, c.reference,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // ─── Tri ─────────────────────────────────────────────────
    const dir = sortDir === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'echeance') {
        const da = (a.check_date || a.invoice_due_date || a.payment_date || '').slice(0, 10);
        const db = (b.check_date || b.invoice_due_date || b.payment_date || '').slice(0, 10);
        cmp = da.localeCompare(db);
      } else if (sortBy === 'emission') {
        cmp = (a.payment_date || '').slice(0, 10).localeCompare((b.payment_date || '').slice(0, 10));
      } else if (sortBy === 'amount') {
        cmp = (parseFloat(a.amount) || 0) - (parseFloat(b.amount) || 0);
      } else if (sortBy === 'supplier') {
        const sa = a.supplier_name || a.employee_name || a.category_name || '';
        const sb = b.supplier_name || b.employee_name || b.category_name || '';
        cmp = sa.localeCompare(sb, 'fr');
      }
      return cmp * dir;
    });
    return result;
  }, [data, statusFilter, dueWindow, supplierFilter, dueFromDate, dueToDate,
      methodFilter, searchTerm, sortBy, sortDir]);

  // Regroupement par cheque physique : meme methode + meme N° + meme beneficiaire.
  // Les paiements sans N° de cheque restent des lignes individuelles. L'ordre des
  // groupes suit le tri courant (position de leur premiere ligne).
  const groups = useMemo<CheckGroup[]>(() => {
    const map = new Map<string, CheckRow[]>();
    const order: string[] = [];
    filtered.forEach(c => {
      const benef = c.supplier_name || c.employee_name || c.category_name || '';
      const key = c.check_number
        ? `${c.payment_method}::${c.check_number}::${benef}`
        : `solo::${c.id}`;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(c);
    });
    return order.map(key => {
      const rows = map.get(key)!;
      return {
        key, rows, first: rows[0],
        totalAmount: rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
        anyOverdue: rows.some(r => r.status === 'overdue'),
        allCashed: rows.every(r => r.status === 'cashed'),
        anyCashed: rows.some(r => r.status === 'cashed'),
        pendingRows: rows.filter(r => r.status !== 'cashed'),
      };
    });
  }, [filtered]);

  const toggleExpanded = (key: string) => setExpandedKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const hasActiveFilters = dueWindow !== 'all' || supplierFilter !== 'all' ||
    dueFromDate !== '' || dueToDate !== '' || methodFilter !== 'all';

  const resetFilters = () => {
    setDueWindow('all'); setSupplierFilter('all');
    setDueFromDate(''); setDueToDate('');
    setMethodFilter('all');
  };

  // Compteurs globaux (toujours sur l'ensemble des cheques, peu importe le filtre)
  const counts = useMemo(() => {
    const acc = { pending: 0, cashed: 0, overdue: 0, totalPending: 0, totalCashed: 0 };
    data.forEach(c => {
      if (c.status === 'cashed') { acc.cashed++; acc.totalCashed += parseFloat(c.amount) || 0; }
      else { acc.pending++; acc.totalPending += parseFloat(c.amount) || 0; }
      if (c.status === 'overdue') acc.overdue++;
    });
    return acc;
  }, [data]);

  // Decoupage des cheques en attente par fenetre d'echeance — meme logique
  // que le Pilotage (uncashedChecks). Sert au bandeau pipeline.
  const breakdown = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const acc = {
      overdue: 0, overdueCount: 0,
      next7d: 0, next7dCount: 0,
      next30d: 0, next30dCount: 0,
      later: 0, laterCount: 0,
    };
    data.filter(c => c.status !== 'cashed').forEach(c => {
      const amt = parseFloat(c.amount) || 0;
      // L'echeance effective doit utiliser la meme priorite que :
      //   - le statut calcule par le backend (COALESCE(check_date, invoice_due_date))
      //   - la colonne "Echeance" du tableau (check_date || invoice_due_date)
      // Sinon les KPIs et la liste affichent des comptes contradictoires
      // (KPI dit "5 en retard" mais aucune ligne avec badge Retard).
      if (c.status === 'overdue') { acc.overdue += amt; acc.overdueCount++; return; }
      const dueStr = c.check_date || c.invoice_due_date;
      if (!dueStr) { acc.later += amt; acc.laterCount++; return; }
      try {
        const due = parseLocalDate(dueStr.slice(0, 10));
        const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) { acc.next7d += amt; acc.next7dCount++; }
        else if (diffDays <= 30) { acc.next30d += amt; acc.next30dCount++; }
        else { acc.later += amt; acc.laterCount++; }
      } catch {
        acc.later += amt; acc.laterCount++;
      }
    });
    return acc;
  }, [data]);

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return format(parseLocalDate(iso.slice(0, 10)), 'dd/MM/yyyy'); }
    catch { return iso; }
  };

  const beneficiaire = (c: CheckRow) =>
    c.supplier_name || c.employee_name || (c.payment_type === 'expense' ? c.category_name : null) || '—';

  const totalEmis = counts.totalPending + counts.totalCashed;
  const totalEmisCount = counts.pending + counts.cashed;

  return (
    <>
      {/* SECTION 1 : KPIs principaux (4 colonnes, meme grammaire visuelle que Pilotage) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {/* En attente d'encaissement */}
        <div style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #ffeaa7', background: '#fff9e6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#856404', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <Coins size={11} /> En attente d'encaissement
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#856404', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(counts.totalPending)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {counts.pending} cheque{counts.pending > 1 ? 's' : ''} a debourser
          </div>
        </div>

        {/* Encaisses */}
        <div style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #d4edda', background: '#f0f9f4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#0e7c3a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <ArrowDownRight size={11} /> Encaisses
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0e7c3a', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(counts.totalCashed)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {counts.cashed} cheque{counts.cashed > 1 ? 's' : ''} sortis du compte
          </div>
        </div>

        {/* Total emis */}
        <div style={{ padding: '14px 16px', borderRadius: 4, border: '1px solid #c4d8eb', background: '#f0f6ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: '#0d4d8c', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <Receipt size={11} /> Total emis
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d4d8c', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(totalEmis)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {totalEmisCount} cheque{totalEmisCount > 1 ? 's' : ''} au total
          </div>
        </div>

        {/* En retard (cheques dont l'echeance est depassee) */}
        <div style={{ padding: '14px 16px', borderRadius: 4, border: breakdown.overdueCount > 0 ? '1px solid #f5c6cb' : '1px solid var(--theme-bg-separator)', background: breakdown.overdueCount > 0 ? '#fff5f5' : 'var(--theme-bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', color: breakdown.overdueCount > 0 ? '#b71c1c' : 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <AlertTriangle size={11} /> En retard
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: breakdown.overdueCount > 0 ? '#b71c1c' : 'inherit', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>{n(breakdown.overdue)} DH</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {breakdown.overdueCount === 0
              ? 'Toutes les echeances sont a jour'
              : `${breakdown.overdueCount} cheque${breakdown.overdueCount > 1 ? 's' : ''} hors delai`}
          </div>
        </div>
      </div>

      {/* Equation explicite — meme pattern que le Pilotage */}
      {totalEmisCount > 0 && (
        <div className="odoo-alert" style={{ fontSize: '0.8125rem', background: 'var(--theme-bg-page)', border: '1px solid var(--theme-bg-separator)' }}>
          <strong>Suivi cheques :</strong> tu as emis{' '}
          <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(totalEmis)} DH</strong>{' '}
          de cheques au total. Sur ce montant,{' '}
          <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#0e7c3a' }}>{n(counts.totalCashed)} DH</strong>{' '}
          ont deja ete debites du compte et{' '}
          <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#856404' }}>{n(counts.totalPending)} DH</strong>{' '}
          sont encore en attente d'encaissement.
          {breakdown.overdue > 0 && (
            <> Attention : <strong style={{ color: '#b71c1c' }}>{n(breakdown.overdue)} DH</strong> de cheques ont depasse leur echeance et peuvent etre presentes a tout moment — prevois la tresorerie.</>
          )}
        </div>
      )}

      {/* SECTION 2 : Pipeline d'encaissement — cartes cliquables qui filtrent la liste */}
      {counts.pending > 0 && (() => {
        const buckets = [
          { key: 'overdue' as const, label: '⚠ En retard', amt: breakdown.overdue, count: breakdown.overdueCount, color: '#b71c1c', bg: '#fff5f5', border: '#f5c6cb' },
          { key: 'next7d' as const, label: '≤ 7 jours', amt: breakdown.next7d, count: breakdown.next7dCount, color: '#856404', bg: '#fff9e6', border: '#ffeaa7' },
          { key: 'next30d' as const, label: '8 - 30 jours', amt: breakdown.next30d, count: breakdown.next30dCount, color: 'var(--theme-text)', bg: 'var(--theme-bg-card)', border: 'var(--theme-bg-separator)' },
          { key: 'later' as const, label: 'Plus tard', amt: breakdown.later, count: breakdown.laterCount, color: 'var(--theme-text)', bg: 'var(--theme-bg-card)', border: 'var(--theme-bg-separator)' },
        ];
        return (
          <div>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8, color: 'var(--theme-text)' }}>
              Pipeline d'encaissement <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)' }}>(clique une carte pour filtrer)</span>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {buckets.map(b => {
                const active = dueWindow === b.key;
                const dim = b.count === 0;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setDueWindow(active ? 'all' : b.key)}
                    disabled={dim}
                    title={active ? `Annuler le filtre ${b.label}` : `Filtrer sur ${b.label}`}
                    style={{
                      padding: '12px 14px', borderRadius: 4,
                      border: active ? `2px solid ${b.color}` : `1px solid ${b.border}`,
                      background: b.bg, textAlign: 'left',
                      cursor: dim ? 'default' : 'pointer',
                      opacity: dim ? 0.55 : 1,
                      transition: 'box-shadow 0.15s, transform 0.05s',
                      boxShadow: active ? `0 2px 6px ${b.color}33` : 'none',
                      transform: active ? 'translateY(-1px)' : 'none',
                    }}>
                    <div style={{ fontSize: '0.6875rem', color: b.color, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                      {b.label}{active && ' ✓'}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: b.color, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
                      {n(b.amt)} DH
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                      {b.count} cheque{b.count > 1 ? 's' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Filtres : tous inline dans une seule barre — meme style que ChargesTab */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 220px', minWidth: 180 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text"
            placeholder="Rechercher (beneficiaire, N° cheque, facture, BC, notes...)"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="odoo-search-input"
            style={{ flex: 1, minWidth: 0 }} />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} title="Effacer la recherche"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          )}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'pending' | 'cashed' | 'all')}
          className="odoo-filter-dropdown">
          <option value="pending">En attente ({counts.pending})</option>
          <option value="cashed">Encaisses ({counts.cashed})</option>
          <option value="all">Tous</option>
        </select>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="odoo-filter-dropdown">
          <option value="all">Tous beneficiaires</option>
          {uniqueSuppliers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={methodFilter} onChange={e => setMethodFilter(e.target.value as 'all' | 'check' | 'traite')}
          className="odoo-filter-dropdown">
          <option value="all">Toutes methodes</option>
          <option value="check">Cheque</option>
          <option value="traite">Traite</option>
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="Filtre echeance">
          <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>Du</span>
          <input type="date" value={dueFromDate}
            onChange={e => setDueFromDate(e.target.value)}
            className="odoo-filter-dropdown"
            style={{ padding: '4px 6px' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>au</span>
          <input type="date" value={dueToDate}
            onChange={e => setDueToDate(e.target.value)}
            className="odoo-filter-dropdown"
            style={{ padding: '4px 6px' }} />
        </div>
        {(hasActiveFilters || searchTerm) && (
          <button onClick={() => { resetFilters(); setSearchTerm(''); }}
            className="odoo-filter-dropdown" style={{ color: '#dc3545', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={11} /> Reinitialiser
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--theme-text-muted)', alignSelf: 'center' }}>
          {groups.length !== filtered.length
            ? `${groups.length} cheques · ${filtered.length} paiements${filtered.length !== data.length ? ` (sur ${data.length})` : ''}`
            : filtered.length !== data.length ? `${filtered.length} / ${data.length} resultats` : `${filtered.length} resultat${filtered.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Tableau */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={20} className="animate-spin" style={{ display: 'inline-block', marginRight: 8 }} /> Chargement...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
          {(hasActiveFilters || searchTerm) ? (
            <>
              Aucun cheque ne correspond aux filtres actuels.
              {(hasActiveFilters || searchTerm) && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" onClick={() => { resetFilters(); setSearchTerm(''); }}
                    className="odoo-btn-secondary" style={{ fontSize: '0.75rem' }}>
                    Reinitialiser les filtres
                  </button>
                </div>
              )}
            </>
          ) : statusFilter === 'pending' ? 'Aucun cheque en attente d\'encaissement.' :
             statusFilter === 'cashed' ? 'Aucun cheque encaisse.' :
             'Aucun cheque emis.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, overflow: 'auto' }}>
          <table className="odoo-table" style={{ margin: 0, minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>N° Cheque</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => { if (sortBy === 'supplier') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('supplier'); setSortDir('asc'); } }}>
                  Beneficiaire {sortBy === 'supplier' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th>Contexte</th>
                <th style={{ width: 110, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => { if (sortBy === 'emission') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('emission'); setSortDir('desc'); } }}>
                  Date emission {sortBy === 'emission' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ width: 110, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => { if (sortBy === 'echeance') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('echeance'); setSortDir('asc'); } }}>
                  Echeance {sortBy === 'echeance' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ width: 110 }}>Encaisse le</th>
                <th style={{ width: 110, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => { if (sortBy === 'amount') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('amount'); setSortDir('desc'); } }}>
                  Montant {sortBy === 'amount' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ width: 100 }}>Statut</th>
                <th style={{ width: 160, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const c = g.first;
                const multi = g.rows.length > 1;
                const isExpanded = multi && expandedKeys.has(g.key);
                const isCashed = g.allCashed;
                const isOverdue = !g.allCashed && g.anyOverdue;
                // Emission = premiere date de paiement ; echeance = date du cheque
                // (commune a toutes les factures) sinon la plus proche des factures.
                const emissionDate = multi
                  ? g.rows.reduce((min, r) => (r.payment_date && (!min || r.payment_date < min) ? r.payment_date : min), '' as string) || null
                  : c.payment_date;
                const dueDate = c.check_date
                  || g.rows.reduce((min, r) => (r.invoice_due_date && (!min || r.invoice_due_date < min) ? r.invoice_due_date : min), '' as string)
                  || null;
                const lastCashed = g.rows.reduce((max, r) => (r.cashed_at && (!max || r.cashed_at > max) ? r.cashed_at : max), '' as string) || null;
                return (
                  <Fragment key={g.key}>
                  <tr onClick={multi ? () => toggleExpanded(g.key) : undefined}
                    style={multi ? { cursor: 'pointer' } : undefined}
                    title={multi ? (isExpanded ? 'Cliquer pour replier les factures' : 'Cliquer pour lister les factures') : undefined}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {multi && (isExpanded ? <ChevronDown size={13} style={{ color: 'var(--theme-accent)' }} /> : <ChevronRight size={13} style={{ color: 'var(--theme-accent)' }} />)}
                        {c.check_number || <span style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>—</span>}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{beneficiaire(c)}</div>
                      {c.payment_type && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'capitalize' }}>
                          {c.payment_type === 'invoice' ? 'Facture' : c.payment_type === 'salary' ? 'Salaire' : c.payment_type === 'expense' ? 'Depense' : c.payment_type}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem' }}>
                      {multi ? (
                        <div>
                          <strong>{g.rows.length} factures</strong>
                          <span style={{ color: 'var(--theme-text-muted)' }}> — {isExpanded ? 'replier' : 'cliquer pour lister'}</span>
                        </div>
                      ) : (
                        <>
                          {c.invoice_number && (
                            <div>
                              Facture <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{c.invoice_number}</strong>
                              {c.invoice_total && <span style={{ color: 'var(--theme-text-muted)' }}> ({n(parseFloat(c.invoice_total))} DH)</span>}
                            </div>
                          )}
                          {c.purchase_order_number && (
                            <div style={{ color: 'var(--theme-text-muted)' }}>
                              BC <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{c.purchase_order_number}</strong>
                            </div>
                          )}
                          {!c.invoice_number && !c.purchase_order_number && (c.description || c.category_name) && (
                            <div style={{ color: 'var(--theme-text-muted)' }}>{c.description || c.category_name}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>{fmtDate(emissionDate)}</td>
                    <td>
                      {fmtDate(dueDate)}
                      {isOverdue && (
                        <div style={{ fontSize: '0.6875rem', color: '#b71c1c', fontWeight: 600 }}>en retard</div>
                      )}
                    </td>
                    <td>
                      {isCashed && lastCashed ? (
                        <div>
                          {fmtDate(lastCashed)}
                          {c.cashed_by_name && (
                            <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                              par {c.cashed_by_name}
                            </div>
                          )}
                        </div>
                      ) : g.anyCashed ? (
                        <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>partiel</span>
                      ) : (
                        <span style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                      {n(g.totalAmount)} DH
                    </td>
                    <td>
                      {isCashed ? (
                        <span className="odoo-tag" style={{ background: '#d4edda', color: '#0e7c3a' }}>Encaisse</span>
                      ) : isOverdue ? (
                        <span className="odoo-tag" style={{ background: '#f8d7da', color: '#b71c1c' }}>Retard</span>
                      ) : (
                        <span className="odoo-tag odoo-tag-orange">En attente</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {!isCashed ? (
                          <button onClick={() => setConfirmingGroup(g)}
                            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: '0.75rem' }}>
                            <Check size={11} /> Marquer encaisse
                          </button>
                        ) : (
                          <button onClick={() => {
                            const msg = multi
                              ? `Annuler la confirmation d'encaissement ? Les ${g.rows.length} paiements du cheque repasseront en attente et seront retires des charges.`
                              : 'Annuler la confirmation d\'encaissement ? Le cheque repassera en attente et sera retire des charges.';
                            if (confirm(msg)) unmarkMutation.mutate(g.rows.map(r => r.id));
                          }}
                            disabled={unmarkMutation.isPending}
                            className="odoo-pager-btn" title="Annuler l'encaissement (cheque revient en attente)">
                            <RotateCcw size={11} />
                          </button>
                        )}
                        {/* Suppression definitive : uniquement au niveau paiement.
                            Pour un cheque multi-factures, deplier la ligne et supprimer
                            la facture concernee. */}
                        {!multi && (
                          <button onClick={() => {
                            const ctx = c.invoice_number ? `facture ${c.invoice_number}` :
                                        c.purchase_order_number ? `BC ${c.purchase_order_number}` :
                                        'paiement';
                            const amount = parseFloat(c.amount).toFixed(2);
                            const msg = `Supprimer DEFINITIVEMENT ce paiement ?\n\n` +
                                        `Beneficiaire : ${c.supplier_name || c.employee_name || '—'}\n` +
                                        `Montant : ${amount} DH\n` +
                                        `Contexte : ${ctx}\n\n` +
                                        `Cette action est irreversible. La facture associee sera ` +
                                        `recalculee (statut + montant restant).`;
                            if (confirm(msg)) deleteMutation.mutate(c.id);
                          }}
                            disabled={deleteMutation.isPending}
                            className="odoo-pager-btn" title="Supprimer ce paiement (corriger erreur de saisie)"
                            style={{ color: '#b71c1c' }}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Sous-lignes : une par facture reglee par ce cheque */}
                  {isExpanded && g.rows.map(r => (
                    <tr key={r.id} style={{ background: 'var(--theme-bg-page)' }}>
                      <td />
                      <td style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>└ Facture</td>
                      <td style={{ fontSize: '0.75rem' }}>
                        {r.invoice_number ? (
                          <div>
                            Facture <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{r.invoice_number}</strong>
                            {r.invoice_total && <span style={{ color: 'var(--theme-text-muted)' }}> ({n(parseFloat(r.invoice_total))} DH)</span>}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--theme-text-muted)' }}>{r.description || r.purchase_order_number || '—'}</span>
                        )}
                        {r.purchase_order_number && r.invoice_number && (
                          <div style={{ color: 'var(--theme-text-muted)' }}>
                            BC <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{r.purchase_order_number}</strong>
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.75rem' }}>{fmtDate(r.payment_date)}</td>
                      <td style={{ fontSize: '0.75rem' }}>{fmtDate(r.check_date || r.invoice_due_date)}</td>
                      <td style={{ fontSize: '0.75rem' }}>
                        {r.cashed_at ? fmtDate(r.cashed_at) : <span style={{ color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                        {n(parseFloat(r.amount))} DH
                      </td>
                      <td>
                        {r.status === 'cashed' ? (
                          <span className="odoo-tag" style={{ background: '#d4edda', color: '#0e7c3a', fontSize: '0.6875rem' }}>Encaisse</span>
                        ) : r.status === 'overdue' ? (
                          <span className="odoo-tag" style={{ background: '#f8d7da', color: '#b71c1c', fontSize: '0.6875rem' }}>Retard</span>
                        ) : (
                          <span className="odoo-tag odoo-tag-orange" style={{ fontSize: '0.6875rem' }}>En attente</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => {
                          const amount = parseFloat(r.amount).toFixed(2);
                          const msg = `Retirer cette facture du cheque ${c.check_number || ''} ?\n\n` +
                                      `Facture : ${r.invoice_number || '—'}\n` +
                                      `Montant : ${amount} DH\n\n` +
                                      `Le paiement est supprime definitivement ; la facture sera ` +
                                      `recalculee (statut + montant restant).`;
                          if (confirm(msg)) deleteMutation.mutate(r.id);
                        }}
                          disabled={deleteMutation.isPending}
                          className="odoo-pager-btn" title="Retirer cette facture du cheque (supprime le paiement)"
                          style={{ color: '#b71c1c' }}>
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal confirmation encaissement — un cheque multi-factures est encaisse
          en une seule fois : tous ses paiements en attente sont marques ensemble. */}
      {confirmingGroup && (
        <ConfirmCashedModal
          check={{ ...confirmingGroup.first, amount: String(confirmingGroup.totalAmount) }}
          invoices={confirmingGroup.rows.length > 1
            ? confirmingGroup.rows.map(r => ({ number: r.invoice_number, amount: parseFloat(r.amount) || 0 }))
            : undefined}
          onClose={() => setConfirmingGroup(null)}
          onConfirm={(cashedAt, note) => markMutation.mutate({
            ids: confirmingGroup.pendingRows.map(r => r.id),
            data: { cashedAt, note },
          })}
          isPending={markMutation.isPending}
        />
      )}
    </>
  );
}

/* Mini-modal : confirme l'encaissement d'un cheque avec date + note.
   `invoices` (optionnel) : liste des factures reglees par un cheque multi-factures. */
function ConfirmCashedModal({
  check, invoices, onClose, onConfirm, isPending,
}: {
  check: CheckRow;
  invoices?: { number: string | null; amount: number }[];
  onClose: () => void;
  onConfirm: (cashedAt: string, note: string | undefined) => void;
  isPending: boolean;
}) {
  const [cashedAt, setCashedAt] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [note, setNote] = useState<string>('');

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, background: 'var(--theme-bg-card)', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Check size={14} style={{ color: '#0e7c3a' }} />
            <span>Confirmer encaissement</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>
              {check.check_number || `${parseFloat(check.amount).toFixed(2)} DH`}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '10px 12px', background: 'var(--theme-bg-page)', borderRadius: 4, fontSize: '0.8125rem' }}>
            <div><strong>Beneficiaire :</strong> {check.supplier_name || check.employee_name || '—'}</div>
            <div><strong>Montant :</strong> {n(parseFloat(check.amount))} DH</div>
            {invoices && invoices.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                <strong>{invoices.length} factures reglees par ce cheque :</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                  {invoices.map((inv, i) => (
                    <li key={i} style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {inv.number || '—'} · {n(inv.amount)} DH
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              check.invoice_number && <div><strong>Facture :</strong> {check.invoice_number}</div>
            )}
            {check.invoice_due_date && (
              <div style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginTop: 4 }}>
                Echeance prevue : {format(parseLocalDate(check.invoice_due_date.slice(0, 10)), 'dd/MM/yyyy')}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
              Date d'encaissement effective *
            </label>
            <input type="date" value={cashedAt} onChange={e => setCashedAt(e.target.value)}
              className="odoo-input" style={{ width: '100%' }} />
            <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 4 }}>
              Date du debit bancaire (releve de compte). Sert de date de charge en tresorerie.
            </p>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
              Note (optionnel)
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Ex : vu sur releve bancaire du 12/07"
              className="odoo-input" style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => onConfirm(cashedAt, note.trim() || undefined)} disabled={isPending || !cashedAt}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {isPending && <Loader2 size={12} className="animate-spin" />}
            <Check size={13} /> Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════ RESUME TAB ═══════════════════════ */
/* Vue consolidee : entrees vs sorties avec resultat net */
function ResumeTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['caisse-register', year, month],
    queryFn: () => caisseApi.register(year, month),
  });

  const days = useMemo(() => {
    if (!data) return [];
    return buildDailyData(data.payments, data.sessions, data.sales || [], data.previousBalance, year, month);
  }, [data, year, month]);

  // Build full month grid (all days, even empty ones)
  const allDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(new Date(year, month - 1));
    const dayMap = new Map(days.map(d => [d.dayNum, d]));
    const result: (DayData | null)[] = [];
    let lastCashNet = data?.previousBalance?.cashNet || 0;
    let lastCardCumul = data?.previousBalance?.cardCumul || 0;
    let lastSolde = lastCashNet + lastCardCumul;

    for (let d = 1; d <= daysInMonth; d++) {
      const day = dayMap.get(d);
      if (day) {
        lastCashNet = day.cashNetCumul;
        lastCardCumul = day.cardCumul;
        lastSolde = day.solde;
        result.push(day);
      } else {
        result.push({
          date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          dayNum: d,
          payments: [],
          entries: 0, exits: 0,
          cashCaissiere: 0, cashSysteme: 0, cardReceipt: 0, ecart: 0, totalRecettes: 0,
          totalSales: 0, saleCount: 0,
          cashNetCumul: lastCashNet, cardCumul: lastCardCumul, solde: lastSolde,
        });
      }
    }
    return result;
  }, [days, data, year, month]);

  const totals = useMemo(() => {
    let entries = 0, exits = 0, cashR = 0, cardR = 0, sales = 0, salesCount = 0;
    for (const d of days) {
      entries += d.entries; exits += d.exits;
      cashR += d.cashCaissiere; cardR += d.cardReceipt;
      sales += d.totalSales; salesCount += d.saleCount;
    }
    const last = allDays[allDays.length - 1];
    const totalEntrees = cashR + cardR + entries;
    const resultat = totalEntrees - exits;
    return { entries, exits, cashR, cardR, sales, salesCount, recettes: cashR + cardR, totalEntrees, resultat, cashNet: last?.cashNetCumul || 0, cardCumul: last?.cardCumul || 0, solde: last?.solde || 0 };
  }, [days, allDays]);

  const handleExport = () => {
    exportCSV(`resume_${MONTH_NAMES[month - 1]}_${year}.csv`,
      ['DATE', 'VENTES', 'ENTREES', 'SORTIES', 'CASH', 'CARTE', 'SOLDE'],
      allDays.filter(d => d !== null).map(d => [
        format(parseLocalDate(d!.date), 'dd/MM/yyyy'),
        n(d!.totalSales), n(d!.cashCaissiere + d!.cardReceipt + d!.entries), n(d!.exits),
        n(d!.cashNetCumul), n(d!.cardCumul), n(d!.solde),
      ])
    );
  };

  return (
    <>
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
      </div>

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ArrowUpRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total entrées</div>
          <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{n(totals.totalEntrees)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">
            Cash {n(totals.cashR)} · Carte {n(totals.cardR)}{totals.entries > 0 && ` · Autres ${n(totals.entries)}`}
          </div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><ArrowDownRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total sorties</div>
          <div className="odoo-stat-card-value" style={{ color: '#dc3545' }}>{n(totals.exits)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">Achats + Salaires + Dépenses</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Scale size={11} style={{ display: 'inline', marginRight: 4 }} />Résultat net du mois</div>
          <div className="odoo-stat-card-value" style={{ color: totals.resultat >= 0 ? '#28a745' : '#dc3545' }}>
            {totals.resultat >= 0 ? '+' : ''}{n(totals.resultat)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Entrées − Sorties</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Wallet size={11} style={{ display: 'inline', marginRight: 4 }} />Solde cumulé</div>
          <div className="odoo-stat-card-value" style={{ color: totals.solde >= 0 ? '#28a745' : '#dc3545' }}>
            {n(totals.solde)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
          </div>
          <div className="odoo-stat-card-sub">Cash {n(totals.cashNet)} · Carte {n(totals.cardCumul)}</div>
        </div>
      </div>

      {/* Daily grid */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement du résumé...</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Ventes</th>
                <th style={{ textAlign: 'right' }}>Entrées</th>
                <th style={{ textAlign: 'right' }}>Sorties</th>
                <th style={{ textAlign: 'right' }}>Cash cumul</th>
                <th style={{ textAlign: 'right' }}>Carte cumul</th>
                <th style={{ textAlign: 'right' }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {allDays.map(d => {
                if (!d) return null;
                const dayEntrees = d.cashCaissiere + d.cardReceipt + d.entries;
                const hasActivity = dayEntrees > 0 || d.exits > 0;
                return (
                  <tr key={d.dayNum} style={{ opacity: hasActivity ? 1 : 0.4 }}>
                    <td style={{ textTransform: 'capitalize' }}>{format(parseLocalDate(d.date), 'dd/MM EEE', { locale: fr })}</td>
                    <td style={{ textAlign: 'right' }}>{d.totalSales > 0 ? <span style={{ fontWeight: 600 }}>{n(d.totalSales)}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                    <td style={{ textAlign: 'right', color: dayEntrees > 0 ? '#28a745' : 'var(--theme-bg-separator)' }}>
                      {dayEntrees > 0 ? n(dayEntrees) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: d.exits > 0 ? '#dc3545' : 'var(--theme-bg-separator)' }}>
                      {d.exits > 0 ? n(d.exits) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{n(d.cashNetCumul)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{n(d.cardCumul)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: d.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(d.solde)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td style={{ padding: 12, fontWeight: 700 }}>TOTAL</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(totals.sales)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#28a745' }}>{n(totals.totalEntrees)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545' }}>{n(totals.exits)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(totals.cashNet)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(totals.cardCumul)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: totals.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(totals.solde)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

/* ============ CASCADE CATEGORY SELECTOR ============ */

