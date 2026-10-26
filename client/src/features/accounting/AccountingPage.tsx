import { useState, useEffect, useMemo, Fragment } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { caisseApi, suppliersApi, expenseCategoriesApi, paymentsApi, invoicesApi } from '../../api/accounting.api';
import { withholdingApi } from '../../api/withholding.api';
import type { WithholdingType } from '../../api/withholding.api';
import { employeesApi } from '../../api/employees.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { purchasingSettingsApi } from '../../api/purchasing-settings.api';
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
  ArrowLeftRight, Ban, Clock, CalendarClock, CheckCircle2, Filter,
  Target,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
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
import BudgetTab from './BudgetTab';
import RetenuesSourceTab from './RetenuesSourceTab';
import EcheancierView from './EcheancierView';
import { usePaymentModes, modeFromLegacy, PaymentModeSelect, CashLimitGauge, paymentModeLabel, PaymentStatusTag, type CashOverride } from '../../components/purchasing/PaymentModeFields';
import ReasonCodeDialog from '../../components/purchasing/ReasonCodeDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter, Pager, PAGE_SIZE, periodParams, periodLabel,
  periodLabel as periodLabelOf, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';

type AccTab = 'budget' | 'pilotage' | 'caisse' | 'charges' | 'cheques' | 'dettes' | 'resume' | 'losses' | 'plan_comptable' | 'ecritures' | 'grand_livre' | 'balance' | 'cpc' | 'bilan' | 'tva' | 'ras' | 'cloture' | 'immobilisations' | 'banque';

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

/** Encaissement d'une facture client (et non une recette de caisse ni un revenu divers). */
const isClientReceipt = (p: Record<string, any>) => p.type === 'income' && p.invoice_type === 'emitted';
const CAISSE_PAY_LABELS: Record<string, string> = {
  cash: 'Espèces', bank: 'Virement', transfer: 'Virement', check: 'Chèque', traite: 'Traite', card: 'Carte', mobile: 'Mobile',
};
const caissePayLabel = (m: unknown) => CAISSE_PAY_LABELS[String(m)] ?? String(m ?? '');
/** Libellé d'une sortie : fournisseur, salarié, catégorie ou description. */
const exitLabel = (p: Record<string, any>) =>
  (p.supplier_name as string)
  || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name || ''}`.trim() : '')
  || (p.description as string) || (p.category_name as string) || 'Paiement';

interface DayData {
  date: string;
  dayNum: number;
  payments: Record<string, any>[];
  entries: number;
  /** Part des entrées venant du règlement de factures clients. */
  clientReceipts: number;
  exits: number;
  cashCaissiere: number;
  cashSysteme: number;
  cardReceipt: number;
  /** Commission du prestataire carte retenue sur cardReceipt (mig 356). */
  cardCommission: number;
  ecart: number;
  totalRecettes: number;
  totalSales: number;
  saleCount: number;
  cashNetCumul: number;
  cardCumul: number;
  solde: number;
}

/** Détail des mouvements d'un jour : règlements clients, autres entrées, sorties. */
function DayMovements({ payments }: { payments: Record<string, any>[] }) {
  const groups: Array<{ title: string; rows: Record<string, any>[]; sign: 1 | -1; label: (p: Record<string, any>) => string }> = [
    { title: 'Règlements clients', rows: payments.filter(isClientReceipt), sign: 1,
      label: p => `${p.invoice_number} · ${p.customer_name || 'Client'} · ${caissePayLabel(p.payment_method)}${p.reference ? ` · ${p.reference}` : ''}` },
    { title: 'Autres entrées', rows: payments.filter(p => p.type === 'income' && !isClientReceipt(p)), sign: 1,
      label: p => `${(p.description as string) || (p.category_name as string) || 'Revenu'} · ${caissePayLabel(p.payment_method)}` },
    { title: 'Sorties', rows: payments.filter(p => p.type !== 'income'), sign: -1,
      label: p => `${exitLabel(p)} · ${caissePayLabel(p.payment_method)}` },
  ];
  return (
    <>
      {groups.filter(g => g.rows.length > 0).map(g => (
        <div key={g.title} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--theme-bg-separator)' }}>
          <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>{g.title}</div>
          {g.rows.map((p, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '2px 0' }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>{g.label(p)}</span>
              <span style={{ fontWeight: 600, color: g.sign > 0 ? '#28a745' : '#b02a37' }}>{g.sign > 0 ? '+' : '−'}{n(parseFloat(p.amount as string) || 0)} DH</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function buildDailyData(
  rawPayments: Record<string, any>[],
  rawSessions: Record<string, any>[],
  rawSales: Record<string, any>[],
  previousBalance: { cashNet: number; cardCumul: number },
  year: number,
  month: number,
  cardCommissionPct = 0,
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
    // La banque ne reçoit que le net : le prestataire retient sa commission sur chaque transaction.
    const cardCommission = Math.round(cardReceipt * cardCommissionPct) / 100;
    // Cash réel entrant dans le tiroir (HORS carte, qui part en banque) → alimente le solde cash.
    const cashIn = hasSession ? session.cashCaissiere : cashSysteme;

    let entries = 0, exits = 0, clientReceipts = 0;
    let cashEntries = 0, bankEntries = 0, cashExits = 0, bankExits = 0;
    for (const p of dayPayments) {
      const amount = parseFloat(p.amount as string) || 0;
      const isCash = (p.payment_method as string) === 'cash';
      if (p.type === 'income') {
        entries += amount;
        if (isClientReceipt(p)) clientReceipts += amount;
        if (isCash) cashEntries += amount; else bankEntries += amount;
      } else {
        exits += amount;
        if (isCash) cashExits += amount; else bankExits += amount;
      }
    }

    cashNet = cashNet + cashEntries + cashIn - cashExits;
    cardCumul = cardCumul + cardReceipt - cardCommission + bankEntries - bankExits;

    if (dayPayments.length > 0 || cashCaissiere > 0 || cardReceipt > 0 || daySales.count > 0) {
      days.push({
        date: dateStr,
        dayNum: day,
        payments: dayPayments,
        entries,
        clientReceipts,
        exits,
        cashCaissiere,
        cashSysteme,
        cardReceipt,
        cardCommission,
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
  { key: 'budget', label: 'Budget', icon: Target, section: 'comptabilite' },
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
        {tab === 'budget' && <BudgetTab />}
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

/**
 * Dette echelonnee sans facture (mig 258) : materiel achete a credit dont la
 * facture n'est pas dans le systeme. Elle ne figure pas dans `payables` (qui
 * n'agrege que des factures) mais compte bel et bien dans ce qu'on doit.
 */
type StandaloneDebt = {
  id: string;
  label: string;
  supplier_name: string | null;
  remaining_amount: string;
  next_due_date: string | null;
  is_overdue: boolean;
};

function DettesTab() {
  const queryClient = useQueryClient();
  const { entries: paymentMethods } = useReferentiel('payment_methods');
  // 'schedule' = vue echeancier (calendrier des sorties : credits + charges fixes)
  const [side, setSide] = useState<'receivables' | 'payables' | 'schedule'>('receivables');
  const [searchTerm, setSearchTerm] = useState('');
  // Situation d'un tiers (clic sur une carte) : échu / échéance ≤ 7 j / à venir.
  const [situation, setSituation] = useState<'' | 'overdue' | 'soon' | 'later'>('');
  const onlyOverdue = situation === 'overdue';
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payingInvoice, setPayingInvoice] = useState<DebtInvoice | null>(null);
  // Mig 310 : payMethod = mode TYPÉ ; payLegacy = méthode héritée (pilote le bloc chèque/effet).
  const [payMethod, setPayMethod] = useState('cash');
  const [payDate, setPayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payOverride, setPayOverride] = useState<CashOverride>(null);
  const { byCode: payModeByCode } = usePaymentModes();
  const payModeDef = payModeByCode(payMethod);
  const payLegacy = payModeDef?.legacy_method ?? payMethod;
  // Retenue a la source (RAS) — paiements sortants uniquement.
  const [payAmount, setPayAmount] = useState('');
  const [rasTypeId, setRasTypeId] = useState('');
  const [rasAmount, setRasAmount] = useState('');
  const [avoirAmount, setAvoirAmount] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoice-debts'],
    queryFn: () => invoicesApi.debts() as Promise<{
      receivables: DebtInvoice[]; payables: DebtInvoice[]; standaloneDebts?: StandaloneDebt[];
    }>,
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
      setAvoirAmount('');
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
      invoices: DebtInvoice[]; totalDue: number; overdueDue: number; soonDue: number; oldestDue: string | null;
    }>();
    const in7 = format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd');
    for (const inv of rawInvoices) {
      const remaining = parseFloat(inv.remaining_amount) || 0;
      if (remaining <= 0) continue;
      const key = tierKey(inv);
      if (!map.has(key)) {
        map.set(key, { key, name: tierName(inv), phone: tierPhone(inv), invoices: [], totalDue: 0, overdueDue: 0, soonDue: 0, oldestDue: null });
      }
      const t = map.get(key)!;
      t.invoices.push(inv);
      t.totalDue += remaining;
      const due = inv.due_date ? inv.due_date.slice(0, 10) : null;
      if (inv.is_overdue) t.overdueDue += remaining;
      else if (due && due <= in7) t.soonDue += remaining;
      if (due && (!t.oldestDue || due < t.oldestDue)) t.oldestDue = due;
    }
    let list = Array.from(map.values()).map(t => ({
      ...t,
      situation: (t.overdueDue > 0 ? 'overdue' : t.soonDue > 0 ? 'soon' : 'later') as 'overdue' | 'soon' | 'later',
    }));
    const q = searchTerm.trim().toLowerCase();
    if (q) list = list.filter(t => t.name.toLowerCase().includes(q) || (t.phone || '').toLowerCase().includes(q));
    return list.sort((a, b) => b.overdueDue - a.overdueDue || b.totalDue - a.totalDue);
  }, [rawInvoices, searchTerm, isReceivable]);
  const situationCounts = useMemo(() => {
    const c = { overdue: { n: 0, amount: 0 }, soon: { n: 0, amount: 0 }, later: { n: 0, amount: 0 } };
    for (const t of tiers) { c[t.situation].n++; c[t.situation].amount += t.totalDue; }
    return c;
  }, [tiers]);
  const shownTiers = situation ? tiers.filter(t => t.situation === situation) : tiers;
  useEffect(() => { setPage(1); }, [situation, searchTerm, side]);
  const pagedTiers = shownTiers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totals = useMemo(() => {
    let totalDue = 0, overdueDue = 0, invoiceCount = 0;
    for (const t of tiers) { totalDue += t.totalDue; overdueDue += t.overdueDue; invoiceCount += t.invoices.length; }
    return { totalDue, overdueDue, invoiceCount, tierCount: tiers.length };
  }, [tiers]);

  // Totaux globaux par sens (pour les boutons toggle), independants des filtres.
  // Les dettes a credit sans facture s'ajoutent aux dettes fournisseurs : sans
  // elles, "Nous leur devons" sous-estimerait ce qu'on doit reellement.
  const sideTotals = useMemo(() => {
    const sum = (rows: DebtInvoice[] = []) => rows.reduce((s, inv) => s + (parseFloat(inv.remaining_amount) || 0), 0);
    const credits = (data?.standaloneDebts || []).reduce((s, d) => s + (parseFloat(d.remaining_amount) || 0), 0);
    return {
      receivables: sum(data?.receivables),
      payables: sum(data?.payables) + credits,
      credits,
    };
  }, [data]);

  const toggleTier = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openPayment = (inv: DebtInvoice) => {
    setPayingInvoice(inv);
    setPayMethod(modeFromLegacy(inv.expected_payment_mode || 'cash'));
    setPayDate(format(new Date(), 'yyyy-MM-dd'));
    setPayOverride(null);
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
      {/* Sens : créances / dettes / échéancier */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <div className="odoo-view-switcher" role="tablist" aria-label="Sens">
          {([
            { key: 'receivables' as const, label: `Ils nous doivent · ${n(sideTotals.receivables)} DH` },
            { key: 'payables' as const, label: `Nous leur devons · ${n(sideTotals.payables)} DH` },
            { key: 'schedule' as const, label: 'Échéancier' },
          ]).map(opt => (
            <button key={opt.key} type="button" role="tab" aria-selected={side === opt.key}
              onClick={() => { setSide(opt.key); setSituation(''); }}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.8125rem',
                background: side === opt.key ? 'var(--odoo-purple-light)' : 'transparent',
                color: side === opt.key ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
                fontWeight: side === opt.key ? 600 : 400,
              }}>
              {opt.label}
            </button>
          ))}
        </div>
        {side === 'payables' && sideTotals.credits > 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>dont {n(sideTotals.credits)} DH de crédits sans facture (voir Échéancier)</span>
        )}
      </div>

      {/* Vue echeancier : calendrier des sorties (mig 258). Les autres vues
          restent centrees sur les factures ouvertes, agregees par tiers. */}
      {side === 'schedule' ? <EcheancierView /> : (<>

      {/* Situation des tiers : une carte par situation (clic = filtre) */}
      <StagePipeline
        title={isReceivable ? 'Où en sont mes créances' : 'Où en sont mes dettes'}
        summary={`${totals.tierCount} ${isReceivable ? 'client' : 'fournisseur'}${totals.tierCount > 1 ? 's' : ''} · ${totals.invoiceCount} facture${totals.invoiceCount > 1 ? 's' : ''} · ${n(totals.totalDue)} DH`}
        stages={[
          { key: 'overdue', label: 'Échues', hint: 'échéance dépassée', icon: AlertTriangle },
          { key: 'soon', label: 'Échéance ≤ 7 j', hint: isReceivable ? 'à relancer' : 'à préparer', icon: Clock },
          { key: 'later', label: 'À venir', hint: 'pas encore échues', icon: Calendar },
        ]}
        stats={{
          overdue: { count: situationCounts.overdue.n, sub: `${n(situationCounts.overdue.amount)} DH`, late: situationCounts.overdue.n, alertLabel: isReceivable ? 'à relancer' : 'à régler' },
          soon: { count: situationCounts.soon.n, sub: `${n(situationCounts.soon.amount)} DH` },
          later: { count: situationCounts.later.n, sub: `${n(situationCounts.later.amount)} DH` },
        }}
        isActive={k => situation === k}
        onPick={k => setSituation(situation === k ? '' : (k as 'overdue' | 'soon' | 'later'))}
      />

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
        {situation && (
          <button type="button" onClick={() => setSituation('')} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer le filtre
          </button>
        )}
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
      ) : shownTiers.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Scale size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>
            {situation || searchTerm
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
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {pagedTiers.map(t => {
                const open = expanded.has(t.key);
                // Prochaine action : régler la facture la plus urgente (échue d'abord, puis la plus ancienne échéance).
                const nextInv = [...t.invoices].sort((x, y) =>
                  Number(!!y.is_overdue) - Number(!!x.is_overdue) || String(x.due_date ?? '9999').localeCompare(String(y.due_date ?? '9999')))[0];
                return (
                  <Fragment key={t.key}>
                    <tr onClick={() => toggleTier(t.key)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--theme-text-muted)' }}>
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td>
                        <strong>{t.name}</strong>
                        {t.phone && <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 6 }}>{t.phone}</span>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>
                          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: t.situation === 'overdue' ? '#dc3545' : t.situation === 'soon' ? '#d9822b' : '#28a745' }} />
                          {t.situation === 'overdue' ? 'Échue' : t.situation === 'soon' ? 'Échéance ≤ 7 j' : 'À venir'}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', color: 'var(--theme-text-muted)' }}>{t.invoices.length}</td>
                      <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                        {t.oldestDue ? fmtPaymentDate(t.oldestDue, 'fr') : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {t.overdueDue > 0 ? <span style={{ color: '#dc3545', fontWeight: 600 }}>{n(t.overdueDue)}</span> : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: accent }}>
                        {n(t.totalDue)} DH
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        {nextInv && (
                          <button type="button" onClick={() => openPayment(nextInv)}
                            className={nextInv.is_overdue ? 'odoo-btn-danger' : 'odoo-btn-primary'}
                            title={`${isReceivable ? 'Encaisser' : 'Payer'} la facture ${nextInv.invoice_number}${t.invoices.length > 1 ? ' (la plus urgente)' : ''}`}>
                            {isReceivable ? 'Encaisser' : 'Payer'}{t.invoices.length > 1 ? ` ${nextInv.invoice_number}` : ''}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '8px 16px' }}>
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
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: inv.is_overdue ? '#dc3545' : 'var(--odoo-text)', fontWeight: inv.is_overdue ? 600 : 400 }}>
                                      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: inv.is_overdue ? '#dc3545' : inv.status === 'partial' ? '#3b82f6' : '#d9822b' }} />
                                      {inv.is_overdue ? 'Échue' : (INVOICE_STATUS_LABELS[inv.status] || inv.status)}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <button type="button" onClick={() => openPayment(inv)} className="odoo-btn-secondary">
                                      {isReceivable ? 'Encaisser' : 'Payer'}
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
                <td></td>
              </tr>
            </tfoot>
          </table>
          <Pager page={page} total={shownTiers.length} onPage={setPage}
            note={`${shownTiers.length} ${isReceivable ? 'client' : 'fournisseur'}${shownTiers.length > 1 ? 's' : ''} · cliquez une ligne pour voir ses factures`} />
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
            <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 448, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Coins size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">{isReceivable ? 'Encaisser un règlement' : 'Payer une facture'}</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span>{payingInvoice.invoice_number} · {partyName}</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => setPayingInvoice(null)} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
              </div>
              <form onSubmit={e => {
                e.preventDefault();
                const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
                const amount = parseFloat(payAmount);
                if (!Number.isFinite(amount) || amount <= 0) { notify.error('Montant invalide'); return; }
                const avoir = parseFloat(avoirAmount) || 0;
                if (amount + avoir > remaining + 0.01) { notify.error(`Le total (${n(amount + avoir)} DH) dépasse le reste à payer (${n(remaining)} DH)`); return; }
                const retenue = parseFloat(rasAmount) || 0;
                if (!isReceivable && rasTypeId && retenue >= amount) {
                  notify.error('La retenue doit être inférieure au montant brut'); return;
                }
                const payload: Record<string, any> = {
                  invoiceId: payingInvoice.id,
                  type: isReceivable ? 'income' : 'invoice',
                  amount,
                  paymentMode: payMethod,
                  paymentMethod: payLegacy,
                  paymentDate: fd.paymentDate,
                  reference: fd.reference || undefined,
                  description: fd.description || undefined,
                };
                if (!isReceivable && payingInvoice.supplier_id) payload.supplierId = payingInvoice.supplier_id;
                if (!isReceivable && rasTypeId && retenue > 0) {
                  payload.withholdingTypeId = rasTypeId;
                  payload.withholdingAmount = Math.round(retenue * 100) / 100;
                }
                if (!isReceivable && payOverride) payload.cashOverride = payOverride;
                if (payLegacy === 'check' || payLegacy === 'traite') {
                  payload.checkNumber = fd.checkNumber || undefined;
                  payload.checkDate = fd.checkDate || undefined;
                  if (avoir > 0) payload.avoirAmount = Math.round(avoir * 100) / 100;
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
                    <input name="paymentDate" type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" required />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de règlement</label>
                  <PaymentModeSelect value={payMethod} onChange={setPayMethod} />
                </div>
                {payModeDef?.requires_reference && payLegacy !== 'check' && payLegacy !== 'traite' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Référence du virement *</label>
                    <input name="reference" required placeholder="N° d'ordre ou référence bancaire"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                )}
                {!isReceivable && (
                  <CashLimitGauge supplierId={payingInvoice.supplier_id} date={payDate} amount={parseFloat(payAmount) || 0}
                    modeCode={payMethod} override={payOverride} onOverrideChange={setPayOverride} />
                )}
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
                {(payLegacy === 'check' || payLegacy === 'traite') && (<>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">N° {payLegacy === 'traite' ? 'traite' : 'chèque'}</label>
                      <input name="checkNumber" type="text"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Date {payLegacy === 'traite' ? 'traite' : 'chèque'}</label>
                      <input name="checkDate" type="date"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                  {!isReceivable && (() => {
                    const av = parseFloat(avoirAmount) || 0;
                    const chk = parseFloat(payAmount) || 0;
                    return (
                      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Avoir fournisseur</label>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Montant avoir (DH)</label>
                            <input type="number" step="0.01" min="0" value={avoirAmount}
                              onChange={e => setAvoirAmount(e.target.value)}
                              placeholder="0.00"
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                          {av > 0 && (
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Total réglé</label>
                              <div className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm font-semibold" style={{ fontFamily: 'ui-monospace, monospace' }}>{n(chk + av)} DH</div>
                            </div>
                          )}
                        </div>
                        {av > 0 && (
                          <p className="text-xs text-gray-500">
                            L'avoir de <strong>{n(av)} DH</strong> sera déduit de la dette. {payLegacy === 'traite' ? 'La traite' : 'Le chèque'} émis sera de <strong>{n(chk)} DH</strong>.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </>)}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Note</label>
                  <textarea name="description" rows={2}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                {(payLegacy === 'check' || payLegacy === 'traite') && (
                  <p className="text-xs text-amber-600">
                    {payLegacy === 'traite' ? 'La traite' : 'Le chèque'} apparaîtra dans l'onglet <strong>Chèques et Traites</strong> en attente d'encaissement. La dette est néanmoins réduite dès maintenant.
                  </p>
                )}
                <div className="flex gap-3 justify-end pt-2">
                  <button type="button" onClick={() => setPayingInvoice(null)}
                    className="odoo-btn-secondary">Annuler</button>
                  <button type="submit" disabled={createPayment.isPending}
                    className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {createPayment.isPending && <Loader2 size={14} className="animate-spin" />}
                    {isReceivable ? 'Encaisser' : 'Payer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
      </>)}
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
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [kind, search, filterValue, sortCol, sortDir]);
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasControls = search !== '' || filterValue !== '' || sortCol != null;

  const toggleSort = (i: number) => {
    if (sortCol === i) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(i); setSortDir('asc'); }
  };

  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden', background: 'var(--odoo-bg)' }}>
      {/* En-tête */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <span>Détail</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{cfg.title}</span>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          {rows.length} ligne{rows.length > 1 ? 's' : ''}{rows.length !== allRows.length && <> sur {allRows.length}</>} · <strong style={{ color: 'var(--odoo-text)' }}>{n(total)} DH</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer le détail" title="Fermer le détail"><X size={14} /></button>
      </div>
      {/* Barre de recherche / filtre / tri */}
      {!isLoading && allRows.length > 0 && (
        <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0, borderRadius: 0 }}>
          <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." aria-label="Rechercher dans le détail"
            className="odoo-search-input" style={{ flex: '1 1 200px', minWidth: 0 }} />
          {cfg.filter && filterOptions.length > 0 && (
            <SelectFilter label={cfg.filter.placeholder.replace(/^Tou(te)?s (les )?/i, '') || 'Filtre'} icon={Filter} value={filterValue} onChange={setFilterValue}
              allLabel="Tous" options={filterOptions.map(v => ({ key: v, label: cfg.filter!.display(v) }))} />
          )}
          {hasControls && (
            <button type="button" onClick={() => { setSearch(''); setFilterValue(''); setSortCol(null); setSortDir('asc'); }}
              className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <X size={12} /> Effacer les filtres
            </button>
          )}
        </div>
      )}
      {/* Body */}
      <div style={{ overflowX: 'auto' }}>
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
              {pagedRows.map(r => (
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
      {rows.length > 0 && <Pager page={page} total={rows.length} onPage={setPage} note={cfg.title} />}
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
const PILOT_SECTION_TITLE: React.CSSProperties = {
  margin: '0 0 8px', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--odoo-text-muted)',
};

function PilotageTab() {
  const now = new Date();
  // Période commune (mêmes choix que les autres écrans) ; la fin manquante = aujourd'hui.
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(now, 'yyyy-MM-dd'));
  const { dateFrom, dateTo, periodLabel } = useMemo(() => {
    const r = periodParams(period, customFrom, customTo);
    return {
      dateFrom: r.dateFrom ?? '2000-01-01',
      dateTo: r.dateTo ?? format(new Date(), 'yyyy-MM-dd'),
      periodLabel: period === 'month' ? format(new Date(), 'MMMM yyyy', { locale: fr }) : periodLabelOf(period, customFrom, customTo),
    };
  }, [period, customFrom, customTo]);
  const toggleDetail = (k: string) => setDetailKind(d => (d === k ? null : (k as FinanceDetailKind)));

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
      {/* Période */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <PeriodFilter label="Période" title="Période d'analyse des flux"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
          <strong style={{ textTransform: 'capitalize', color: 'var(--odoo-text)' }}>{periodLabel}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Cliquez une carte pour voir le détail</span>
      </div>

      {/* 1. Flux de la période : engagé → payé → reste à payer (+ reçu non facturé) */}
      <StagePipeline
        title={`Flux de la période · ${periodLabel}`}
        summary={`${n(kpis.engagement.total)} DH engagés · ${n(kpis.treasury.total)} DH payés`}
        stages={[
          { key: 'engagement', label: 'Engagé', hint: 'factures fournisseur reçues', icon: ClipboardList },
          { key: 'treasury', label: 'Payé', hint: 'cash réellement sorti', icon: ArrowDownRight },
          { key: 'remainingToPay', label: 'Reste à payer', hint: 'factures de la période', icon: Coins },
          { key: 'receivedNotInvoiced', label: 'Reçu non facturé', hint: 'BC livrés sans facture', icon: FileWarning },
        ]}
        stats={{
          engagement: { count: kpis.engagement.count, sub: `${n(kpis.engagement.total)} DH` },
          treasury: { count: kpis.treasury.byMethod.cash.count + kpis.treasury.byMethod.check.count + kpis.treasury.byMethod.transfer.count + kpis.treasury.byMethod.bank.count, sub: `${n(kpis.treasury.total)} DH` },
          remainingToPay: { count: kpis.remainingToPay.count, sub: `${n(kpis.remainingToPay.total)} DH` },
          receivedNotInvoiced: { count: kpis.receivedNotInvoiced.count, sub: `${n(kpis.receivedNotInvoiced.total)} DH`, late: kpis.receivedNotInvoiced.count, alertLabel: 'facture à saisir' },
        }}
        isActive={k => detailKind === k}
        onPick={toggleDetail}
      />

      {/* Équation de trésorerie, en clair */}
      <StatusBanner tone={kpis.receivedNotInvoiced.total > 0 ? 'warning' : 'info'} icon={Scale}
        title={`Engagé ${n(kpis.engagement.total)} DH · payé ${n(kpis.treasury.total)} DH · reste à payer ${n(kpis.remainingToPay.total)} DH`}>
        {deltaToPay < 0
          ? `Les paiements de la période (${n(kpis.treasury.total)} DH) dépassent ce qui y a été engagé : ils règlent aussi des factures des périodes précédentes.`
          : kpis.remainingToPay.total > 0
            ? `${n(kpis.remainingToPay.total)} DH des factures de la période ne sont pas encore payés.`
            : 'Toutes les factures de la période sont payées.'}
        {kpis.receivedNotInvoiced.total > 0 && ` Attention : ${n(kpis.receivedNotInvoiced.total)} DH de marchandises reçues n'ont pas encore de facture saisie — l'engagement est sous-estimé.`}
      </StatusBanner>

      {/* 2. À date : ce qui va peser sur la trésorerie */}
      <StagePipeline
        title="À date · ce qui va sortir du compte"
        summary={`${n(pipeline.unpaidInvoices.total + pipeline.uncashedChecks.total)} DH à décaisser`}
        stages={[
          { key: 'unpaidInvoices', label: 'Factures impayées', hint: 'toutes périodes', icon: Receipt },
          { key: 'uncashedChecks', label: 'Chèques non encaissés', hint: 'émis, pas encore débités', icon: Wallet },
          { key: 'receivedNotInvoiced', label: 'Reçu sans facture', hint: 'à comptabiliser', icon: FileWarning },
        ]}
        stats={{
          unpaidInvoices: { count: pipeline.unpaidInvoices.count, sub: `${n(pipeline.unpaidInvoices.total)} DH` },
          uncashedChecks: {
            count: pipeline.uncashedChecks.count,
            sub: `${n(pipeline.uncashedChecks.total)} DH${pipeline.uncashedChecks.next7d > 0 ? ` · ${n(pipeline.uncashedChecks.next7d)} sous 7 j` : ''}`,
            late: pipeline.uncashedChecks.overdue > 0 ? 1 : 0, alertLabel: `échus : ${n(pipeline.uncashedChecks.overdue)} DH`,
          },
          receivedNotInvoiced: { count: pipeline.receivedNotInvoiced.count, sub: `${n(pipeline.receivedNotInvoiced.total)} DH` },
        }}
        isActive={k => detailKind === k}
        onPick={toggleDetail}
      />

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

      {/* SECTION 3 : Repartition methodes de paiement */}
      {kpis.treasury.total > 0 && (
        <div>
          <h3 style={PILOT_SECTION_TITLE}>Répartition des paiements de la période</h3>
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

      {/* SECTION 4 : Top fournisseurs crediteurs */}
      <div>
        <h3 style={PILOT_SECTION_TITLE}>Fournisseurs à qui l'on doit le plus (à date)</h3>
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
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {n(s.totalDue)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
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
          <h3 style={PILOT_SECTION_TITLE}>Marchandises reçues sans facture (à saisir)</h3>
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' }}>
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [showImportModal, setShowImportModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['caisse-register', year, month],
    queryFn: () => caisseApi.register(year, month),
  });

  const days = useMemo(() => {
    if (!data) return [];
    return buildDailyData(data.payments, data.sessions, data.sales || [], data.previousBalance, year, month, data.cardCommissionPct || 0);
  }, [data, year, month]);

  const cardPct: number = data?.cardCommissionPct || 0;
  const monthTotals = useMemo(() => {
    let entries = 0, clientReceipts = 0, exits = 0, cashCaissiere = 0, cashSysteme = 0, cardReceipts = 0, cardCommission = 0, totalSales = 0, saleCount = 0;
    for (const d of days) {
      cardCommission += d.cardCommission;
      entries += d.entries;
      clientReceipts += d.clientReceipts;
      exits += d.exits;
      cashCaissiere += d.cashCaissiere;
      cashSysteme += d.cashSysteme;
      cardReceipts += d.cardReceipt;
      totalSales += d.totalSales;
      saleCount += d.saleCount;
    }
    const lastDay = days[days.length - 1];
    return {
      entries, clientReceipts, otherEntries: entries - clientReceipts, exits, cashCaissiere, cashSysteme, cardReceipts, cardCommission, totalSales, saleCount,
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
      if (d.cardCommission > 0) rows.push(['', 'COMMISSION CARTE', '', n(-d.cardCommission)]);
      if (d.clientReceipts > 0) rows.push(['', 'REGLEMENTS CLIENTS (FACTURES)', '', n(d.clientReceipts)]);
      if (d.entries - d.clientReceipts > 0) rows.push(['', 'AUTRES ENTREES', '', n(d.entries - d.clientReceipts)]);
      if (d.exits > 0) rows.push(['', 'SORTIES (PAIEMENTS)', '', n(-d.exits)]);
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
        <SearchSelect
          options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
          value={String(month)}
          onChange={id => id && setMonth(parseInt(id, 10))}
          placeholder="Mois"
          width={150}
        />
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
      {data && (data.previousBalance.cashNet !== 0 || data.previousBalance.cardCumul !== 0 || isAdmin) && (
        <div className="odoo-alert warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ArrowUpRight size={14} /> Report mois précédent
            {data.reportOverride && (
              <span className="odoo-tag odoo-tag-orange" title={data.reportOverride.note || 'Report fixé manuellement par un admin'}>
                ajusté
              </span>
            )}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, fontSize: '0.75rem' }}>
            <span>Cash: <strong>{n(data.previousBalance.cashNet)} DH</strong></span>
            <span>Carte: <strong>{n(data.previousBalance.cardCumul)} DH</strong></span>
            <span>Total: <strong>{n(data.previousBalance.cashNet + data.previousBalance.cardCumul)} DH</strong></span>
            {isAdmin && (
              <button onClick={() => setShowReportModal(true)} className="odoo-btn-secondary"
                title="Modifier le report du mois précédent"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px' }}>
                <Pencil size={12} /> Modifier
              </button>
            )}
          </span>
        </div>
      )}

      {showReportModal && data && (
        <ReportOverrideModal
          year={year} month={month}
          current={data.previousBalance}
          override={data.reportOverride || null}
          onClose={() => setShowReportModal(false)}
        />
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
            Caisse {n(monthTotals.cashCaissiere)} · Carte {n(monthTotals.cardReceipts)}
            {monthTotals.cardCommission > 0 && ` (commission −${n(monthTotals.cardCommission)})`}
            {monthTotals.clientReceipts > 0 && ` · Règlements clients ${n(monthTotals.clientReceipts)}`}
            {monthTotals.otherEntries > 0 && ` · Autres ${n(monthTotals.otherEntries)}`}
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
        <>
        {monthTotals.clientReceipts > 0 && (
          <div className="odoo-section">
            <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Receipt size={13} /> Règlements clients du mois
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--theme-text-muted)' }}>
                · factures encaissées par la direction, hors ventes de caisse
              </span>
              <span style={{ marginLeft: 'auto', color: '#1e7e4f' }}>+{n(monthTotals.clientReceipts)} DH</span>
            </div>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Date</th><th>Facture</th><th>Client</th><th>Mode</th><th>Référence</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                {days.flatMap(d => d.payments.filter(isClientReceipt)).map(p => (
                  <tr key={p.id as string} style={{ cursor: 'default' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{format(parseLocalDate(String(p.payment_date).slice(0, 10)), 'dd/MM/yyyy')}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{p.invoice_number as string}</td>
                    <td>{(p.customer_name as string) || '—'}</td>
                    <td><span className={`odoo-tag ${p.payment_method === 'cash' ? 'odoo-tag-green' : 'odoo-tag-blue'}`}>{caissePayLabel(p.payment_method)}</span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginLeft: 6 }}>{p.payment_method === 'cash' ? 'solde cash' : 'solde banque'}</span></td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(p.reference as string) || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#1e7e4f' }}>+{n(parseFloat(p.amount as string) || 0)} DH</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                {cardPct > 0 && <th style={{ textAlign: 'right' }} title={`Retenue du prestataire carte (${cardPct} %)`}>Commission</th>}
                <th style={{ textAlign: 'right' }} title="Encaissements de factures clients (professionnels)">Règlements clients</th>
                <th style={{ textAlign: 'right' }}>Autres entrées</th>
                <th style={{ textAlign: 'right' }} title="Fournisseurs, salaires, dépenses">Sorties</th>
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
                      {cardPct > 0 && <td style={{ textAlign: 'right', color: '#b02a37' }}>{day.cardCommission > 0 ? `−${n(day.cardCommission)}` : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>}
                      <td style={{ textAlign: 'right', color: '#1e7e4f', fontWeight: day.clientReceipts > 0 ? 600 : undefined }}>{day.clientReceipts > 0 ? `+${n(day.clientReceipts)}` : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', color: '#1e7e4f' }}>{day.entries - day.clientReceipts > 0 ? `+${n(day.entries - day.clientReceipts)}` : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', color: '#b02a37' }}>{day.exits > 0 ? `−${n(day.exits)}` : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {day.ecart !== 0 ? <span className={`odoo-tag ${ecartTagClass}`}>{day.ecart > 0 ? '+' : ''}{n(day.ecart)}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: day.solde >= 0 ? '#28a745' : '#dc3545' }}>{n(day.solde)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={cardPct > 0 ? 11 : 10} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
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
                            {day.cardCommission > 0 && (
                              <div>
                                <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Carte nette en banque</div>
                                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cardReceipt - day.cardCommission)} DH <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#b02a37' }}>(−{n(day.cardCommission)} commission {cardPct} %)</span></div>
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Solde cash</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cashNetCumul)} DH</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)', letterSpacing: '0.05em' }}>Solde carte</div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{n(day.cardCumul)} DH</div>
                            </div>
                          </div>
                          <DayMovements payments={day.payments} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
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
              {monthTotals.cardCommission > 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Commission carte ({cardPct} %) — non versée en banque</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: '#b02a37' }}>−{n(monthTotals.cardCommission)} DH</td>
                </tr>
              )}
              {monthTotals.clientReceipts > 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Règlements clients (factures)</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: '#1e7e4f' }}>{n(monthTotals.clientReceipts)} DH</td>
                </tr>
              )}
              {monthTotals.otherEntries > 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Autres entrées</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(monthTotals.otherEntries)} DH</td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 600 }}>Total Recettes</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#28a745' }}>{n(monthTotals.totalRecettes)} DH</td>
              </tr>
              {monthTotals.exits > 0 && (
                <tr>
                  <td style={{ color: 'var(--theme-text-muted)' }}>Sorties (fournisseurs, salaires, dépenses)</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: '#b02a37' }}>−{n(monthTotals.exits)} DH</td>
                </tr>
              )}
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

/* Modale admin : fixer le « Report mois précédent » du mois affiché.
   Le report des mois suivants repart de cette valeur + flux ulterieurs. */
function ReportOverrideModal({ year, month, current, override, onClose }: {
  year: number; month: number;
  current: { cashNet: number; cardCumul: number };
  override: { cashNet: number; cardCumul: number; note?: string | null } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [cash, setCash] = useState(String(override ? override.cashNet : current.cashNet));
  const [card, setCard] = useState(String(override ? override.cardCumul : current.cardCumul));
  const [note, setNote] = useState(override?.note || '');

  const saveMut = useMutation({
    mutationFn: () => caisseApi.saveReportOverride({
      year, month,
      cashNet: parseFloat(cash.replace(',', '.')) || 0,
      cardCumul: parseFloat(card.replace(',', '.')) || 0,
      note: note.trim() || undefined,
    }),
    onSuccess: () => {
      notify.success('Report du mois modifié');
      qc.invalidateQueries({ queryKey: ['caisse-register'] });
      onClose();
    },
    onError: () => notify.error('Erreur lors de l\'enregistrement du report'),
  });

  const deleteMut = useMutation({
    mutationFn: () => caisseApi.deleteReportOverride(year, month),
    onSuccess: () => {
      notify.success('Ajustement supprimé — report recalculé');
      qc.invalidateQueries({ queryKey: ['caisse-register'] });
      onClose();
    },
    onError: () => notify.error('Erreur lors de la suppression de l\'ajustement'),
  });

  const busy = saveMut.isPending || deleteMut.isPending;
  const cashNum = parseFloat(cash.replace(',', '.')) || 0;
  const cardNum = parseFloat(card.replace(',', '.')) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-orange-500" />
            <h2 className="text-base font-semibold">Report mois précédent — {MONTH_NAMES[month - 1]} {year}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            Fixe le solde reporté au 1er {MONTH_NAMES[month - 1].toLowerCase()} {year}.
            Les mois suivants repartiront de cette valeur, augmentée des mouvements enregistrés depuis.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              Cash (DH)
              <input type="text" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)}
                className="odoo-filter-dropdown" style={{ width: '100%', marginTop: 4, textAlign: 'right' }} />
            </label>
            <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              Carte (DH)
              <input type="text" inputMode="decimal" value={card} onChange={e => setCard(e.target.value)}
                className="odoo-filter-dropdown" style={{ width: '100%', marginTop: 4, textAlign: 'right' }} />
            </label>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', textAlign: 'right' }}>
            Total : <strong>{n(cashNum + cardNum)} DH</strong>
          </div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block' }}>
            Motif (optionnel)
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Ex : reprise historique avant mise en prod"
              className="odoo-filter-dropdown" style={{ width: '100%', marginTop: 4 }} />
          </label>
        </div>

        <div className="flex items-center justify-between p-4 border-t">
          {override ? (
            <button onClick={() => deleteMut.mutate()} disabled={busy} className="odoo-btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#dc3545' }}>
              <Trash2 size={13} /> Supprimer l'ajustement
            </button>
          ) : <span />}
          <div style={{ display: 'inline-flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} className="odoo-btn-secondary">Annuler</button>
            <button onClick={() => saveMut.mutate()} disabled={busy} className="odoo-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy && <Loader2 size={13} className="animate-spin" />} Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════ CHARGES & DEPENSES TAB ═══════════════════════ */
/* Tout ce qui sort : achats fournisseurs, salaires, depenses diverses */
function ChargesTab() {
  const { entries: paymentMethods, getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const { user } = useAuth();
  // L'admin peut saisir manuellement salaires/avances (rattrapage, corrections) ;
  // les autres roles passent obligatoirement par RH (Paie / Avances).
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Record<string, any> | null>(null);
  // Mig 310 (D7) : mode typé, jauge espèces, annulation motivée, mouvement interne.
  const { modes: payModes, byCode: payModeByCode, treasuryAccounts } = usePaymentModes();
  const [expMode, setExpMode] = useState('cash');
  const [expSupplierId, setExpSupplierId] = useState('');
  const [expAmount, setExpAmount] = useState(0);
  const [expDate, setExpDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expOverride, setExpOverride] = useState<CashOverride>(null);
  const expModeDef = payModeByCode(expMode);
  const expLegacy = expModeDef?.legacy_method ?? expMode;
  const [voidTarget, setVoidTarget] = useState<Record<string, any> | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  // Modal de categorisation d'une facture (s'applique a toutes ses lignes)
  const [categorizingInvoice, setCategorizingInvoice] = useState<Record<string, any> | null>(null);
  const [categorizingCategoryId, setCategorizingCategoryId] = useState<string>('');
  const [filterRoot, setFilterRoot] = useState<string>('all');
  const [filterLeaf, setFilterLeaf] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Selecteur de periode facon Pilotage : "Par mois" ou "Periode personnalisee".
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(now, 'yyyy-MM-dd'));
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  useEffect(() => {
    // Init la cascade categorie a l'ouverture du modal d'edition
    setEditCategoryId(editingPayment ? (editingPayment.category_id as string) || '' : '');
  }, [editingPayment]);

  // Periode chargee : mois selectionne, ou plage personnalisee selon le mode.
  // Bornes envoyées au serveur : la fin manquante = aujourd'hui (les sorties futures n'existent pas).
  const range = periodParams(period, customFrom, customTo);
  const dateFrom = range.dateFrom ?? '2000-01-01';
  const dateTo = range.dateTo ?? format(now, 'yyyy-MM-dd');
  const useCustomRange = period !== 'month';
  const periodLabel = period === 'month'
    ? format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: fr })
    : periodLabelOf(period, customFrom, customTo);

  const { data: payments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payments-charges', dateFrom, dateTo],
    queryFn: () => paymentsApi.list({ dateFrom, dateTo }),
  });
  // Achats fournisseurs : on lit les lignes des factures INTEGRALEMENT PAYEES
  // (status = 'paid'), datees a la date du dernier paiement (MAX(payments)).
  // Logique tresorerie : la charge apparait quand le cash est sorti, pas a la
  // date facture. Les impayees/partielles ne sont pas la — visibles dans
  // l'onglet "Factures recues" du module Achats.
  const { data: invoiceLines = [], isLoading: isLoadingLines } = useQuery({
    queryKey: ['invoice-line-expenses', dateFrom, dateTo],
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
  // ─── BC REQUIS AVANT DÉPENSE (mig 306) ───────────────────────────
  // La règle vient du paramètre purchasing.expense_requires_po (table module_parameters),
  // le serveur l'applique ; l'écran se contente de la refléter.
  const { data: purchasingSettings } = useQuery({ queryKey: ['purchasing-settings'], queryFn: purchasingSettingsApi.get, staleTime: 60_000 });
  const poRule = purchasingSettings?.expenseRequiresPo;
  const categoryRequiresPO = selectedCategory ? (selectedCategory.requires_po as boolean) : false;
  const requiresPO = !!poRule?.enabled && categoryRequiresPO;
  const showPOWaivedBanner = !poRule?.enabled && categoryRequiresPO;

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
  const isRhManagedCategory = isAdmin ? false : (() => {
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

  // Mig 310 (G-D7-08) : un paiement exécuté ne se supprime plus, il s'annule avec un motif.
  const voidMutation = useMutation({
    mutationFn: ({ id, reasonCodeId, note }: { id: string; reasonCodeId: string; note?: string }) =>
      paymentsApi.void(id, { reasonCodeId, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Dépense annulée — contre-pièce passée');
      setVoidTarget(null);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });
  const transferMutation = useMutation({
    mutationFn: (data: { fromAccountId: string; toAccountId: string; amount: number; paymentDate: string; reference?: string; description?: string }) =>
      paymentsApi.internalTransfer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Mouvement interne enregistré');
      setShowTransfer(false);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Mouvement impossible')),
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

  // Base des cartes de stats : suit le filtre methode (ex : « Espèces » →
  // Total sorties = sorties cash uniquement). Les lignes de facture portent
  // desormais la methode du paiement qui a clôture la facture (cash / cheque
  // encaisse / virement), remontee par findLineExpenses.
  const statBase = useMemo(
    () => filterMethod === 'all' ? outgoing : outgoing.filter(p => ((p.payment_method as string) || '') === filterMethod),
    [outgoing, filterMethod]
  );

  const grandTotal = useMemo(() => statBase.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0), [statBase]);

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


  // Top 3 root categories by total for stat cards (suit le filtre methode)
  const topCats = useMemo(() => rootCatsWithPayments
    .map(rc => ({
      ...rc,
      total: (statBase.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === String(rc.id))
        .reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0)),
    }))
    .filter(rc => rc.total > 0 || filterMethod === 'all')
    .sort((a, b) => b.total - a.total)
    .slice(0, 3),
  [rootCatsWithPayments, statBase, filterMethod]);

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
    // La plage de dates "Du/au" est appliquee cote serveur (sur la date
    // effective : cashed_at pour les cheques) via la requete — pas de filtre
    // client ici, sinon un cheque encaisse dans la plage mais signe hors
    // plage serait exclu a tort.
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
  }, [outgoing, filterRoot, filterLeaf, filterMethod, searchTerm, sortCol, sortDir, catMap]);

  const displayedTotal = useMemo(() => displayed.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0), [displayed]);
  // Lignes sans catégorie : à classer pour que le CPC et les analyses soient justes.
  const uncategorized = useMemo(() => {
    const rows = statBase.filter(p => !getRootId(p.category_id as string | null));
    return { count: rows.length, total: rows.reduce((s, p) => s + (parseFloat(p.amount as string) || 0), 0) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statBase, catMap]);
  useEffect(() => { setPage(1); }, [filterRoot, filterLeaf, filterMethod, searchTerm, sortCol, sortDir, dateFrom, dateTo]);
  const pagedDisplayed = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
    const exportSuffix = useCustomRange ? `${customFrom}_${customTo}` : `${MONTH_NAMES[month - 1]}_${year}`;
    exportCSV(`charges_${exportSuffix}.csv`,
      ['DATE', 'REF', 'CATEGORIE', 'SOUS-CATEGORIE', 'BENEFICIAIRE', 'METHODE', 'DESCRIPTION', 'MONTANT (DH)'], rows);
  };


  return (
    <>
      {/* Search panel : period (facon Pilotage) + actions */}
      <div className="odoo-search-panel">
        <PeriodFilter label="Période" title="Date de sortie de l'argent (encaissement pour les chèques)"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
          <strong style={{ textTransform: 'capitalize', color: 'var(--odoo-text)' }}>{periodLabel}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
        <button onClick={() => setShowTransfer(true)} className="odoo-btn-secondary"
          title="Versement d'espèces en banque, retrait : ni charge, ni fournisseur"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeftRight size={13} /> Mouvement interne
        </button>
        <button onClick={() => {
          setExpMode('cash'); setExpSupplierId(''); setExpAmount(0); setExpDate(format(new Date(), 'yyyy-MM-dd')); setExpOverride(null);
          setShowForm(true);
        }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Nouvelle dépense
        </button>
      </div>

      {/* Répartition : une carte par grande catégorie (clic = filtre), plus les lignes à catégoriser */}
      <StagePipeline
        title={`Sorties · ${periodLabel}`}
        summary={`${statBase.length} opération${statBase.length > 1 ? 's' : ''} · ${n(grandTotal)} DH${filterMethod !== 'all' ? ` · ${getPaymentLabel(filterMethod)}` : ''}`}
        stages={[
          { key: 'all', label: 'Toutes', hint: 'total des sorties', icon: ArrowDownRight },
          ...topCats.filter(tc => String(tc.id) !== '__none__').map(tc => ({ key: String(tc.id), label: String(tc.name), hint: `${grandTotal > 0 ? Math.round(tc.total / grandTotal * 100) : 0} % du total`, icon: Wallet })),
          ...(uncategorized.count > 0 ? [{ key: '__none__', label: 'À catégoriser', hint: 'sans catégorie', icon: FileWarning }] : []),
        ]}
        stats={{
          all: { count: statBase.length, sub: `${n(grandTotal)} DH` },
          ...Object.fromEntries(topCats.map(tc => [String(tc.id), { count: statBase.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === String(tc.id)).length, sub: `${n(tc.total)} DH` }])),
          __none__: { count: uncategorized.count, sub: `${n(uncategorized.total)} DH`, late: uncategorized.count, alertLabel: 'à classer' },
        }}
        isActive={k => (k === 'all' ? filterRoot === 'all' : filterRoot === k)}
        onPick={k => { setFilterRoot(k === 'all' || filterRoot === k ? 'all' : k); setFilterLeaf('all'); }}
      />

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
        <SearchSelect
          options={rootCatsWithPayments.map(rc => ({ id: String(rc.id), label: rc.name }))}
          value={filterRoot === 'all' ? '' : filterRoot}
          onChange={id => { setFilterRoot(id || 'all'); setFilterLeaf('all'); }}
          placeholder="Toutes catégories"
        />
        <SearchSelect
          options={availableLeaves.map(l => ({ id: l, label: l }))}
          value={filterLeaf === 'all' ? '' : filterLeaf}
          onChange={id => setFilterLeaf(id || 'all')}
          placeholder="Tous types"
        />
        <SelectFilter label="Moyen" icon={Coins} value={filterMethod === 'all' ? '' : filterMethod}
          onChange={v => setFilterMethod(v || 'all')} allLabel="Tous"
          options={paymentMethods.map(m => ({ key: m.code, label: m.label }))} />
        {(filterRoot !== 'all' || filterLeaf !== 'all' || filterMethod !== 'all' || searchTerm) && (
          <button type="button" onClick={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setSearchTerm(''); }}
            className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
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
          <button onClick={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setSearchTerm(''); }}
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
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
                <th style={{ textAlign: 'right', width: 72 }}></th>
              </tr>
            </thead>
            <tbody>
              {pagedDisplayed.map(p => {
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
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                      {p.payment_mode ? paymentModeLabel(p, payModes) : getPaymentLabel(p.payment_method as string)} <PaymentStatusTag p={p} />
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545', whiteSpace: 'nowrap', textDecoration: p.status === 'void' && !p.voids_payment_id ? 'line-through' : undefined }}>
                      {n(parseFloat(p.amount as string))} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!rootId && p.status !== 'void' && !p.voids_payment_id && (
                        <button type="button" className="odoo-btn-primary" title="Classer cette sortie dans une catégorie de charge"
                          onClick={() => {
                            if (p.type === 'invoice') { setCategorizingInvoice(p); setCategorizingCategoryId((p.category_id as string) || ''); }
                            else setEditingPayment(p);
                          }}>
                          Catégoriser
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.type === 'invoice' ? (
                        <button type="button" className="odoo-pager-btn" aria-label="Catégoriser cette ligne" title="Catégoriser cette ligne"
                          onClick={() => { setCategorizingInvoice(p); setCategorizingCategoryId((p.category_id as string) || ''); }}>
                          <Pencil size={13} />
                        </button>
                      ) : p.status === 'void' || p.voids_payment_id ? (
                        <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }} title={(p.void_note as string) || ''}>annulée</span>
                      ) : p.type !== 'salary' && p.type !== 'advance' ? (
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          <button type="button" onClick={() => setEditingPayment(p)} className="odoo-pager-btn" aria-label="Modifier" title="Modifier la catégorie ou la description"><Pencil size={13} /></button>
                          <button type="button" onClick={() => setVoidTarget(p)} className="odoo-pager-btn" aria-label="Annuler la dépense" title="Annuler (motif obligatoire)" style={{ color: '#dc3545' }}><Ban size={13} /></button>
                        </div>
                      ) : <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }} title="Géré depuis RH → Paie / Avances">RH</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={6} style={{ padding: 12, fontWeight: 600 }}>
                  Total <span style={{ textTransform: 'capitalize' }}>{periodLabel}</span> ({displayed.length} opération{displayed.length > 1 ? 's' : ''}{displayed.length !== outgoing.length ? ` filtrée${displayed.length > 1 ? 's' : ''}` : ''})
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: '#dc3545' }}>
                  {n(displayedTotal)} DH
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          <Pager page={page} total={displayed.length} onPage={setPage}
            note={`${displayed.length} opération${displayed.length > 1 ? 's' : ''}${displayed.length !== outgoing.length ? ' (filtrées)' : ''} · ${periodLabel}`} />
        </div>
      )}

      {/* Add expense modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 512, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Plus size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">Nouvelle dépense</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
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
              if (requiresPO && !formPOId && fd.amount >= (poRule?.threshold ?? 0)) {
                notify.error(`Cette catégorie exige un bon de commande au-delà de ${poRule?.threshold} ${poRule?.currency}`); return;
              }
              fd.paymentMode = expMode;
              fd.paymentMethod = expLegacy;
              if (expOverride) fd.cashOverride = expOverride;
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
                  ℹ️ Cette catégorie demande normalement un bon de commande, mais la règle « BC requis avant dépense » est <strong>désactivée</strong> (paramètre des Achats). Tu peux saisir la dépense directement.
                </div>
              )}
              {requiresPO && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <label className="block text-sm font-medium mb-1.5 text-amber-800">
                    <ClipboardList size={14} className="inline mr-1" /> Bon de commande (obligatoire au-delà de {poRule?.threshold} {poRule?.currency})
                  </label>
                  <select value={formPOId} onChange={e => setFormPOId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
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
                    onChange={e => setExpAmount(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" required
                    defaultValue={selectedPO ? parseFloat(selectedPO.total_amount as string) || '' : ''} key={formPOId} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" disabled={isRhManagedCategory}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" required value={expDate} onChange={e => setExpDate(e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de règlement</label>
                  <PaymentModeSelect value={expMode} onChange={setExpMode} /></div>
                {!(requiresPO && formPOId) && !isPersonnelExpense && (
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur</label>
                    <select name="supplierId" disabled={isRhManagedCategory} onChange={e => setExpSupplierId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                      <option value="">Aucun</option>
                      {(suppliers as Record<string, any>[]).filter(s => s.is_active).map(s => (
                        <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                      ))}
                    </select></div>
                )}
                {/* Categorie sous "Charges de personnel" : on affiche le selecteur Employe.
                    Le champ est obligatoire (un salaire/prime doit etre rattache a une ressource). */}
                {!(requiresPO && formPOId) && isPersonnelExpense && (
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

              {/* Mig 310 : chèque / effet → N° (suivi dans Chèques et Traites) ; virement → référence obligatoire. */}
              {(expLegacy === 'check' || expLegacy === 'traite') ? (
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">N° {expLegacy === 'traite' ? 'd\'effet' : 'de chèque'} *</label>
                    <input name="checkNumber" required className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Échéance</label>
                    <input name="checkDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500" /></div>
                </div>
              ) : expModeDef?.requires_reference ? (
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Référence du virement *</label>
                  <input name="reference" required placeholder="N° d'ordre ou référence bancaire"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500" /></div>
              ) : null}
              <CashLimitGauge supplierId={(requiresPO && formPOId && selectedPO ? selectedPO.supplier_id as string : expSupplierId) || null}
                date={expDate} amount={expAmount} modeCode={expMode} override={expOverride} onOverrideChange={setExpOverride} />

              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea name="description" rows={2} disabled={isRhManagedCategory}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed" /></div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }}
                  className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending || isRhManagedCategory}
                  title={isRhManagedCategory ? 'Saisie depuis Ressources Humaines → Paie / Avances' : undefined}
                  className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
          <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 512, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Pencil size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">Modifier la depense</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => setEditingPayment(null)} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
              </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              // Mig 310 : seuls catégorie et description se modifient ; montant, date et mode
              // d'un paiement exécuté sont figés (annuler avec motif puis ressaisir).
              updateMutation.mutate({ id: editingPayment.id as string, data: {
                categoryId: editCategoryId || null, description: fd.description ?? '',
              } });
            }} className="p-5 space-y-4">
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 space-y-1">
                <div className="flex justify-between"><span>Montant</span><strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(parseFloat(editingPayment.amount as string) || 0)} DH</strong></div>
                <div className="flex justify-between"><span>Date</span><span>{fmtPaymentDate(editingPayment.payment_date, 'fr')}</span></div>
                <div className="flex justify-between"><span>Mode</span><span>{editingPayment.payment_mode ? paymentModeLabel(editingPayment, payModes) : getPaymentLabel(editingPayment.payment_method as string)}</span></div>
                <div style={{ color: 'var(--theme-text-muted)' }}>Montant, date et mode ne se modifient plus : annulez la dépense avec un motif puis ressaisissez-la.</div>
              </div>

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
                  className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={updateMutation.isPending}
                  className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {voidTarget && (
        <ReasonCodeDialog title={`Annuler la dépense de ${n(parseFloat(voidTarget.amount as string))} DH`} scope="void_payment"
          description="La dépense reste dans l'historique : une contre-pièce négative la neutralise et son écriture est extournée."
          confirmLabel="Annuler la dépense" danger pending={voidMutation.isPending}
          onClose={() => setVoidTarget(null)}
          onSubmit={(v) => voidMutation.mutate({ id: voidTarget.id as string, reasonCodeId: v.reasonCodeId, note: v.note })} />
      )}
      {showTransfer && (
        <InternalTransferModal accounts={treasuryAccounts} pending={transferMutation.isPending}
          onClose={() => setShowTransfer(false)} onSubmit={(d) => transferMutation.mutate(d)} />
      )}

      {/* Modal de categorisation d'une ligne de charge (ligne seule) */}
      {categorizingInvoice && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" role="dialog" style={{ width: '100%', maxWidth: 512, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div className="odoo-control-bar">
                <div className="odoo-breadcrumb">
                  <Pencil size={14} style={{ color: 'var(--theme-accent)' }} />
                  <span className="odoo-breadcrumb-current">Catégoriser la ligne</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span>{(categorizingInvoice.invoice_number as string) || '—'} · {(categorizingInvoice.supplier_name as string) || ''}</span>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
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
                  className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={updateInvoiceCategoryMutation.isPending}
                  className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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

const CHECK_STAGES: StageDef[] = [
  { key: 'overdue', label: 'Échus', hint: 'échéance dépassée', icon: AlertTriangle },
  { key: 'next7d', label: '≤ 7 jours', hint: 'à présenter bientôt', icon: Clock },
  { key: 'next30d', label: '8 – 30 jours', hint: 'ce mois-ci', icon: Calendar },
  { key: 'later', label: 'Plus tard', hint: 'au-delà de 30 j', icon: CalendarClock },
  { key: 'cashed', label: 'Encaissés', hint: 'voir l\'historique', icon: CheckCircle2 },
];

/** Statut d'un chèque : point de couleur + texte (pas de pastille). */
function CheckStatusDot({ status }: { status: 'pending' | 'overdue' | 'cashed' }) {
  const meta = status === 'cashed' ? { color: '#28a745', label: 'Encaissé' }
    : status === 'overdue' ? { color: '#dc3545', label: 'Échu' }
    : { color: '#d9822b', label: 'À encaisser' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: status === 'overdue' ? 600 : 400, color: status === 'overdue' ? '#b71c1c' : 'var(--odoo-text)' }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: meta.color }} />
      {meta.label}
    </span>
  );
}

function ChequesTab() {
  const queryClient = useQueryClient();
  // Vue : « À encaisser » (en attente / en retard) ou « Encaissés » (historique).
  const [view, setView] = useState<'open' | 'history'>('open');
  const statusFilter: 'pending' | 'cashed' = view === 'open' ? 'pending' : 'cashed';
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmingGroup, setConfirmingGroup] = useState<CheckGroup | null>(null);
  // Cheques multi-factures depliés (cle de groupe -> visible)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // Filtres : KPI clic (dueWindow), beneficiaire (single), periode echeance, methode.
  // Tous inline dans la meme barre — meme style que ChargesTab.
  const [dueWindow, setDueWindow] = useState<'all' | 'overdue' | 'next7d' | 'next30d' | 'later'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  // Période : sur l'échéance (à encaisser) ou sur la date d'encaissement (encaissés).
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const periodRange = periodParams(period, customFrom, customTo);
  const dueFromDate = periodRange.dateFrom ?? '';
  const dueToDate = periodRange.dateTo ?? '';
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

  // Mig 310 (G-D7-08) : un chèque/effet ne se supprime plus. « Annuler » passe une
  // contre-pièce motivée (chèque perdu, rejet, erreur) et extourne l'écriture ; il
  // se ré-émet ensuite depuis les paiements de la facture.
  const [voidCheck, setVoidCheck] = useState<{ id: string; amount: string; label: string } | null>(null);
  const deleteMutation = useMutation({
    mutationFn: ({ id, reasonCodeId, note }: { id: string; reasonCodeId: string; note?: string }) =>
      paymentsApi.void(id, { reasonCodeId, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments-checks'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success('Paiement annulé — facture mise à jour');
      setVoidCheck(null);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
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

      // ─── Periode (echeance, ou encaissement dans l'historique) ─
      if (fromDate || toDate) {
        const dueStr = view === 'history' ? c.cashed_at : (c.check_date || c.invoice_due_date);
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
  }, [data, statusFilter, view, dueWindow, supplierFilter, dueFromDate, dueToDate,
      methodFilter, searchTerm, sortBy, sortDir]);

  // Regroupement par cheque physique : meme methode + meme N° normalise.
  // Un cheque/traite physique a un numero unique — on ne separe pas par
  // beneficiaire car un seul effet peut couvrir des factures de categories
  // differentes chez le meme fournisseur.
  const groups = useMemo<CheckGroup[]>(() => {
    const map = new Map<string, CheckRow[]>();
    const order: string[] = [];
    filtered.forEach(c => {
      const num = c.check_number?.trim().toUpperCase().replace(/\s+/g, ' ');
      const key = num
        ? `${c.payment_method}::${num}`
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
    setPeriod(view === 'history' ? '3m' : 'all'); setCustomFrom(''); setCustomTo('');
    setMethodFilter('all');
  };
  const switchView = (next: 'open' | 'history') => {
    if (next === view) return;
    setView(next); setDueWindow('all');
    setPeriod(next === 'history' ? '3m' : 'all'); setCustomFrom(''); setCustomTo('');
    setSortBy(next === 'history' ? 'emission' : 'echeance'); setSortDir(next === 'history' ? 'desc' : 'asc');
  };
  useEffect(() => { setPage(1); }, [view, dueWindow, supplierFilter, period, customFrom, customTo, methodFilter, searchTerm, sortBy, sortDir]);
  const pagedGroups = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Sous-ensemble pour les KPIs : on applique les filtres "contextuels"
  // (beneficiaire, methode, periode d'echeance, recherche texte) mais PAS
  // le statut ni la fenetre pipeline — sinon cliquer "En attente" mettrait
  // "Encaisses" a zero. Ainsi les cartes reagissent aux filtres de la barre
  // sans se contredire entre elles.
  const dataForKpis = useMemo(() => {
    const fromDate = dueFromDate ? parseLocalDate(dueFromDate) : null;
    const toDate = dueToDate ? parseLocalDate(dueToDate) : null;
    const q = searchTerm.trim().toLowerCase();
    return data.filter(c => {
      if (supplierFilter !== 'all') {
        const name = c.supplier_name || c.employee_name || c.category_name || '';
        if (name !== supplierFilter) return false;
      }
      if (methodFilter !== 'all' && c.payment_method !== methodFilter) return false;
      if (fromDate || toDate) {
        const dueStr = c.check_date || c.invoice_due_date;
        if (!dueStr) return false;
        const due = parseLocalDate(dueStr.slice(0, 10));
        if (fromDate && due < fromDate) return false;
        if (toDate && due > toDate) return false;
      }
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
  }, [data, supplierFilter, methodFilter, dueFromDate, dueToDate, searchTerm]);

  const counts = useMemo(() => {
    const acc = { pending: 0, cashed: 0, overdue: 0, totalPending: 0, totalCashed: 0 };
    dataForKpis.forEach(c => {
      if (c.status === 'cashed') { acc.cashed++; acc.totalCashed += parseFloat(c.amount) || 0; }
      else { acc.pending++; acc.totalPending += parseFloat(c.amount) || 0; }
      if (c.status === 'overdue') acc.overdue++;
    });
    return acc;
  }, [dataForKpis]);

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
    dataForKpis.filter(c => c.status !== 'cashed').forEach(c => {
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
  }, [dataForKpis]);

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
      {/* Pipeline d'encaissement : fenêtres d'échéance des chèques émis, puis encaissés (historique) */}
      <StagePipeline
        title="Où en sont mes chèques et traites"
        summary={`${n(counts.totalPending)} DH à encaisser${breakdown.overdue > 0 ? ` · dont ${n(breakdown.overdue)} DH échus` : ''}`}
        stages={CHECK_STAGES}
        stats={{
          overdue: { count: breakdown.overdueCount, sub: `${n(breakdown.overdue)} DH`, late: breakdown.overdueCount, alertLabel: 'présentables à tout moment' },
          next7d: { count: breakdown.next7dCount, sub: `${n(breakdown.next7d)} DH` },
          next30d: { count: breakdown.next30dCount, sub: `${n(breakdown.next30d)} DH` },
          later: { count: breakdown.laterCount, sub: `${n(breakdown.later)} DH` },
          cashed: { count: counts.cashed, sub: `${n(counts.totalCashed)} DH` },
        }}
        isActive={k => (k === 'cashed' ? view === 'history' : view === 'open' && dueWindow === k)}
        onPick={k => {
          if (k === 'cashed') { switchView('history'); return; }
          switchView('open');
          setDueWindow(dueWindow === k ? 'all' : (k as 'overdue' | 'next7d' | 'next30d' | 'later'));
        }}
      />

      {breakdown.overdueCount > 0 && view === 'open' && dueWindow !== 'overdue' && (
        <StatusBanner tone="danger" icon={AlertTriangle}
          title={`${breakdown.overdueCount} chèque${breakdown.overdueCount > 1 ? 's' : ''} échu${breakdown.overdueCount > 1 ? 's' : ''} : ${n(breakdown.overdue)} DH`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => setDueWindow('overdue')}>Les afficher</button>}>
          Ils peuvent être présentés à la banque à tout moment : prévoyez la trésorerie, et marquez-les encaissés dès qu'ils sont débités.
        </StatusBanner>
      )}

      {/* Vue + filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`À encaisser · ${counts.pending}`} historyLabel={`Encaissés · ${counts.cashed}`} />
        {view === 'open' && dueWindow !== 'all' && (
          <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Échéance : {CHECK_STAGES.find(s => s.key === dueWindow)?.label}
            <button type="button" onClick={() => setDueWindow('all')} aria-label="Retirer le filtre d'échéance" style={{ display: 'inline-flex' }}><X size={11} /></button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          {groups.length} chèque{groups.length > 1 ? 's' : ''} · <strong style={{ color: 'var(--odoo-text)' }}>{n(groups.reduce((s, g) => s + g.totalAmount, 0))} DH</strong>
        </span>
      </div>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" aria-label="Rechercher un chèque"
          placeholder="Rechercher (bénéficiaire, N° chèque, facture, BC, notes...)"
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="odoo-search-input" style={{ flex: '1 1 220px', minWidth: 0 }} />
        <SelectFilter label="Moyen" icon={Receipt} value={methodFilter === 'all' ? '' : methodFilter}
          onChange={v => setMethodFilter((v || 'all') as 'all' | 'check' | 'traite')}
          options={[{ key: 'check', label: 'Chèque' }, { key: 'traite', label: 'Traite' }]} />
        <PeriodFilter label={view === 'history' ? 'Encaissé' : 'Échéance'}
          title={view === 'history' ? "Filtre sur la date d'encaissement" : "Filtre sur la date d'échéance"}
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <SearchSelect
          options={uniqueSuppliers.map(name => ({ id: name, label: name }))}
          value={supplierFilter === 'all' ? '' : supplierFilter}
          onChange={id => setSupplierFilter(id || 'all')}
          placeholder="Tous bénéficiaires"
        />
        {(hasActiveFilters || searchTerm) && (
          <button type="button" onClick={() => { resetFilters(); setSearchTerm(''); }} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
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
                <th style={{ width: 110 }}>Statut</th>
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {pagedGroups.map(g => {
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
                    <td><CheckStatusDot status={isCashed ? 'cashed' : isOverdue ? 'overdue' : 'pending'} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      {!isCashed && (
                        <button type="button" onClick={() => setConfirmingGroup(g)} className={isOverdue ? 'odoo-btn-danger' : 'odoo-btn-primary'}
                          title="Le chèque a été débité du compte : enregistrer l'encaissement">
                          Marquer encaissé
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 2 }}>
                        {isCashed && (
                          <button onClick={() => {
                            const msg = multi
                              ? `Annuler la confirmation d'encaissement ? Les ${g.rows.length} paiements du cheque repasseront en attente et seront retires des charges.`
                              : 'Annuler la confirmation d\'encaissement ? Le cheque repassera en attente et sera retire des charges.';
                            if (confirm(msg)) unmarkMutation.mutate(g.rows.map(r => r.id));
                          }}
                            disabled={unmarkMutation.isPending}
                            className="odoo-pager-btn" title="Annuler l'encaissement (cheque revient en attente)" aria-label="Annuler l'encaissement">
                            <RotateCcw size={13} />
                          </button>
                        )}
                        {/* Annulation motivée (mig 310) : uniquement au niveau paiement.
                            Pour un cheque multi-factures, deplier la ligne et supprimer
                            la facture concernee. */}
                        {!multi && (
                          <button onClick={() => setVoidCheck({ id: c.id, amount: c.amount,
                            label: c.invoice_number ? `facture ${c.invoice_number}` : c.purchase_order_number ? `BC ${c.purchase_order_number}` : (c.supplier_name || c.employee_name || 'paiement') })}
                            disabled={deleteMutation.isPending || !!c.cashed_at}
                            className="odoo-pager-btn" title={c.cashed_at ? 'Encaissé : annulez d\'abord l\'encaissement' : 'Annuler ce paiement (motif obligatoire)'}
                            style={{ color: '#b71c1c' }} aria-label="Annuler ce paiement">
                            <Ban size={13} />
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
                      <td><CheckStatusDot status={r.status === 'cashed' ? 'cashed' : r.status === 'overdue' ? 'overdue' : 'pending'} /></td>
                      <td />
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => setVoidCheck({ id: r.id, amount: r.amount, label: `facture ${r.invoice_number || '—'} (chèque ${c.check_number || ''})` })}
                          disabled={deleteMutation.isPending || !!r.cashed_at}
                          className="odoo-pager-btn" title="Annuler la part de ce chèque sur cette facture (motif obligatoire)"
                          style={{ color: '#b71c1c' }}>
                          <Ban size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} total={groups.length} onPage={setPage}
            note={view === 'open' ? 'Chèques et traites émis, pas encore débités' : `Encaissés · ${periodLabel(period, customFrom, customTo)}`} />
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
      {voidCheck && (
        <ReasonCodeDialog title={`Annuler le paiement de ${n(parseFloat(voidCheck.amount))} DH`} scope="void_payment"
          description={`Concerne : ${voidCheck.label}. Le paiement reste dans l'historique, une contre-pièce le neutralise et son écriture est extournée. Il pourra être ré-émis depuis les paiements de la facture.`}
          confirmLabel="Annuler le paiement" danger pending={deleteMutation.isPending}
          onClose={() => setVoidCheck(null)}
          onSubmit={(v) => deleteMutation.mutate({ id: voidCheck.id, reasonCodeId: v.reasonCodeId, note: v.note })} />
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
    return buildDailyData(data.payments, data.sessions, data.sales || [], data.previousBalance, year, month, data.cardCommissionPct || 0);
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
          entries: 0, clientReceipts: 0, exits: 0,
          cashCaissiere: 0, cashSysteme: 0, cardReceipt: 0, cardCommission: 0, ecart: 0, totalRecettes: 0,
          totalSales: 0, saleCount: 0,
          cashNetCumul: lastCashNet, cardCumul: lastCardCumul, solde: lastSolde,
        });
      }
    }
    return result;
  }, [days, data, year, month]);

  const totals = useMemo(() => {
    let entries = 0, clientReceipts = 0, exits = 0, cashR = 0, cardR = 0, sales = 0, salesCount = 0;
    for (const d of days) {
      entries += d.entries; clientReceipts += d.clientReceipts; exits += d.exits;
      cashR += d.cashCaissiere; cardR += d.cardReceipt;
      sales += d.totalSales; salesCount += d.saleCount;
    }
    const last = allDays[allDays.length - 1];
    const totalEntrees = cashR + cardR + entries;
    const resultat = totalEntrees - exits;
    return { entries, clientReceipts, exits, cashR, cardR, sales, salesCount, recettes: cashR + cardR, totalEntrees, resultat, cashNet: last?.cashNetCumul || 0, cardCumul: last?.cardCumul || 0, solde: last?.solde || 0 };
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
        <SearchSelect
          options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
          value={String(month)}
          onChange={id => id && setMonth(parseInt(id, 10))}
          placeholder="Mois"
          width={150}
        />
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
            Caisse {n(totals.cashR)} · Carte {n(totals.cardR)}
            {totals.clientReceipts > 0 && ` · Règlements clients ${n(totals.clientReceipts)}`}
            {totals.entries - totals.clientReceipts > 0 && ` · Autres ${n(totals.entries - totals.clientReceipts)}`}
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


/**
 * Mouvement interne (mig 310, G-D7-17) : versement d'espèces en banque, retrait.
 * Ni charge ni fournisseur : écriture banque D / caisse C (ou l'inverse).
 */
function InternalTransferModal({ accounts, pending, onClose, onSubmit }: {
  accounts: { id: string; label: string; kind: 'cash' | 'bank' }[]; pending?: boolean; onClose: () => void;
  onSubmit: (d: { fromAccountId: string; toAccountId: string; amount: number; paymentDate: string; reference?: string; description?: string }) => void;
}) {
  const cash = accounts.find(a => a.kind === 'cash');
  const bank = accounts.find(a => a.kind === 'bank');
  const [fromId, setFromId] = useState(cash?.id ?? '');
  const [toId, setToId] = useState(bank?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const from = accounts.find(a => a.id === fromId);
  const refRequired = from?.kind === 'bank';
  const amt = parseFloat(amount) || 0;
  const valid = !!fromId && !!toId && fromId !== toId && amt > 0 && !!date && (!refRequired || reference.trim().length > 0);
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';
  const lbl: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><ArrowLeftRight size={14} style={{ color: 'var(--theme-accent)' }} /><span className="odoo-breadcrumb-current">Mouvement interne</span></div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit({ fromAccountId: fromId, toAccountId: toId, amount: Math.round(amt * 100) / 100, paymentDate: date,
            reference: reference.trim() || undefined, description: description.trim() || undefined });
        }} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
            Un versement d'espèces en banque n'est pas une dépense : il ne touche ni les charges ni le plafond espèces des fournisseurs.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><label style={lbl}>De *</label>
              <select value={fromId} onChange={e => setFromId(e.target.value)} className={field}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select></div>
            <div><label style={lbl}>Vers *</label>
              <select value={toId} onChange={e => setToId(e.target.value)} className={field}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select></div>
          </div>
          {fromId === toId && <p style={{ margin: 0, fontSize: '0.75rem', color: '#b71c1c' }}>Choisissez deux comptes différents.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div><label style={lbl}>Montant *</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} className={field} required /></div>
            <div><label style={lbl}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} required /></div>
          </div>
          <div><label style={lbl}>{refRequired ? 'Référence bancaire *' : 'Référence (bordereau de versement)'}</label>
            <input value={reference} onChange={e => setReference(e.target.value)} className={field} /></div>
          <div><label style={lbl}>Note</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className={field} placeholder="Optionnel" /></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={!valid || pending} className="odoo-btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}
