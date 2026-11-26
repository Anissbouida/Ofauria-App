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
  Plus, Pencil, BarChart3, LayoutDashboard, X, Download, AlertTriangle, ChevronDown, ChevronRight, Wallet, TrendingDown, ClipboardList, Receipt, Loader2, Coins, Scale, Trash2, FileWarning, ArrowUpRight, ArrowDownRight, Upload, Search, ArrowUp, ArrowDown, Check, RotateCcw, Calendar, ListTree, Notebook, BookOpen, FileBarChart, Lock, Building2, Landmark, ArrowLeftRight, Ban, Clock, CalendarClock, CheckCircle2, Filter, Target, NotebookPen, Link2, Hourglass, Percent, ArrowRightLeft, FileStack, Banknote, TrendingUp,
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
import JournalTemplatesTab from './JournalTemplatesTab';
import EcrituresTab from './EcrituresTab';
import LettrageTab from './LettrageTab';
import AgedBalanceTab from './AgedBalanceTab';
import CorporateTaxTab from './CorporateTaxTab';
import FxRevaluationTab from './FxRevaluationTab';
import LiasseTab from './LiasseTab';
import BillsPortfolioTab from './BillsPortfolioTab';
import ConsolidationTab from './ConsolidationTab';
import GrandLivreTab from './GrandLivreTab';
import BalanceTab from './BalanceTab';
import CpcTab from './CpcTab';
import TvaTab from './TvaTab';
import ClotureTab from './ClotureTab';
import ImmobilisationsTab from './ImmobilisationsTab';
import BanqueTab from './BanqueTab';
import PaymentRunsTab from './PaymentRunsTab';
import BilanTab from './BilanTab';
import BudgetTab from './BudgetTab';
import PrepaidChargesTab from './PrepaidChargesTab';
import CashFlowTab from './CashFlowTab';
import CashForecastTab from './CashForecastTab';
import CostCentersTab from './CostCentersTab';
import RetenuesSourceTab from './RetenuesSourceTab';
import EcheancierView from './EcheancierView';
import { usePaymentModes, modeFromLegacy, PaymentModeSelect, CashLimitGauge, paymentModeLabel, PaymentStatusTag, type CashOverride } from '../../components/purchasing/PaymentModeFields';
import ReasonCodeDialog from '../../components/purchasing/ReasonCodeDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ModuleShell, useCapabilityScreens, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
// Barre d'outils commune (prj-toolbar, prj-search, prj-views) : styles de base du gabarit Liste.
import '../projects/projects.css';
import {
  StagePipeline, PeriodFilter, SelectFilter, Pager, PAGE_SIZE, periodParams, periodLabel, periodLabel as periodLabelOf, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { money, currencySymbol } from '../../utils/money';
import { MonthYearField, HeaderActions, HeaderSlotContext, Alert, DataPanel, EmptyState, ErrorState, FormField, FormFooter, FormSection, Modal, KpiCard, KpiGrid, LoadingState, NoResultState, PageHeader, SearchBar, SectionHeader, TableFooter, Toolbar, Tabs, Segmented } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';

type AccTab = 'budget' | 'pilotage' | 'caisse' | 'charges' | 'cheques' | 'dettes' | 'resume' | 'losses' | 'plan_comptable' | 'ecritures' | 'grand_livre' | 'balance' | 'cpc' | 'bilan' | 'tva' | 'ras' | 'cloture' | 'immobilisations' | 'banque' | 'cca' | 'cashflow' | 'costcenters' | 'entry_templates' | 'lettrage' | 'aged_balance' | 'is' | 'fx' | 'liasse' | 'effets' | 'consolidation' | 'paiements_lot' | 'prevision';

const INVOICE_STATUS_LABELS: Record<string, string> = { pending: 'En attente', partial: 'Partiel', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
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
        <div key={g.title} style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--ds-sep)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-muted)', marginBottom: 4 }}>{g.title}</div>
          {g.rows.map((p, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '2px 0' }}>
              <span style={{ color: 'var(--ds-muted)' }}>{g.label(p)}</span>
              <span style={{ fontWeight: 600, color: g.sign > 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{g.sign > 0 ? '+' : '−'}{money(parseFloat(p.amount as string) || 0)}</span>
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

/**
 * Rubriques standard (ModuleShell) : Opérations = le travail courant, Rapports = les
 * états, Paramétrage = le référentiel. `adminOnly` = vue normée CGNC, réservée à
 * l'admin et au gérant (ancienne section « Comptabilité »).
 */
const TAB_META: (Omit<ModuleView<AccTab>, 'hidden'> & { adminOnly?: boolean })[] = [
  { key: 'pilotage', label: 'Pilotage', icon: LayoutDashboard, section: 'dashboard' },
  // ─── Opérations ───
  { key: 'caisse', label: 'Caisse', icon: Wallet, section: 'operations' },
  { key: 'charges', label: 'Charges & dépenses', icon: TrendingDown, section: 'operations' },
  { key: 'cheques', label: 'Chèques et traites', icon: Receipt, section: 'operations' },
  { key: 'effets', label: "Portefeuille d'effets", icon: Wallet, section: 'operations', adminOnly: true },
  { key: 'dettes', label: 'Créances & dettes', icon: Scale, section: 'operations' },
  { key: 'banque', label: 'Banque', icon: Landmark, section: 'operations', adminOnly: true },
  { key: 'paiements_lot', label: 'Paiements en lot', icon: Banknote, section: 'operations', adminOnly: true },
  { key: 'cca', label: "Charges payées d'avance", icon: CalendarClock, section: 'operations', adminOnly: true },
  { key: 'ecritures', label: 'Journal', icon: Notebook, section: 'operations', adminOnly: true },
  { key: 'lettrage', label: 'Lettrage', icon: Link2, section: 'operations', adminOnly: true },
  { key: 'immobilisations', label: 'Immobilisations', icon: Building2, section: 'operations', adminOnly: true },
  { key: 'ras', label: 'Retenues à la source', icon: Scale, section: 'operations', adminOnly: true },
  { key: 'is', label: 'Impôt sur les sociétés', icon: Percent, section: 'operations', adminOnly: true },
  { key: 'fx', label: 'Écarts de change', icon: ArrowRightLeft, section: 'operations', adminOnly: true },
  { key: 'cloture', label: 'Clôture', icon: Lock, section: 'operations', adminOnly: true },
  // ─── Rapports ───
  { key: 'resume', label: 'Résumé', icon: BarChart3, section: 'reports' },
  { key: 'losses', label: 'Pertes', icon: AlertTriangle, section: 'reports' },
  { key: 'grand_livre', label: 'Grand livre', icon: BookOpen, section: 'reports', adminOnly: true },
  { key: 'balance', label: 'Balance', icon: Scale, section: 'reports', adminOnly: true },
  { key: 'aged_balance', label: 'Balance âgée', icon: Hourglass, section: 'reports', adminOnly: true },
  { key: 'cpc', label: 'CPC', icon: FileBarChart, section: 'reports', adminOnly: true },
  { key: 'bilan', label: 'Bilan', icon: Scale, section: 'reports', adminOnly: true },
  { key: 'tva', label: 'TVA', icon: Receipt, section: 'reports', adminOnly: true },
  { key: 'liasse', label: 'Liasse fiscale', icon: FileStack, section: 'reports', adminOnly: true },
  { key: 'consolidation', label: 'Consolidation', icon: Building2, section: 'reports', adminOnly: true },
  { key: 'budget', label: 'Budget', icon: Target, section: 'reports', adminOnly: true },
  { key: 'cashflow', label: 'Flux de trésorerie', icon: ArrowLeftRight, section: 'reports', adminOnly: true },
  { key: 'prevision', label: 'Prévision de trésorerie', icon: TrendingUp, section: 'reports', adminOnly: true },
  { key: 'costcenters', label: 'Analytique', icon: Target, section: 'reports', adminOnly: true },
  // ─── Paramétrage ───
  { key: 'plan_comptable', label: 'Plan comptable', icon: ListTree, section: 'setup', adminOnly: true },
  { key: 'entry_templates', label: 'Modèles d’écritures', icon: NotebookPen, section: 'setup', adminOnly: true },
];

/** Description d'une ligne sous le titre de chaque écran (gabarit de page du Design System). */
const PAGE_LEADS: Record<AccTab, string> = {
  pilotage: 'Trésorerie, flux de la période, échéances et points à traiter.',
  caisse: 'Ventes, recettes et sorties de caisse du mois, jour par jour.',
  charges: 'Sorties d\'argent de la période : achats, salaires et dépenses, par catégorie.',
  cheques: 'Chèques et traites émis, de l\'émission jusqu\'à l\'encaissement.',
  effets: 'Effets reçus des clients : remise à l\'encaissement, escompte et dénouement.',
  dettes: 'Ce que les clients doivent et ce qui est dû aux fournisseurs, facture par facture.',
  banque: 'Relevés bancaires importés et rapprochement avec le grand livre.',
  paiements_lot: 'Campagnes de règlement des fournisseurs par virement groupé.',
  cca: 'Charges réglées d\'avance, constatées mois par mois.',
  ecritures: 'Écritures comptables par journal, du brouillon à la comptabilisation.',
  lettrage: 'Rapprochement des factures et des règlements sur les comptes de tiers.',
  immobilisations: 'Biens immobilisés, plans d\'amortissement et dotations.',
  ras: 'Retenues à la source prélevées, à déclarer et à reverser à la DGI.',
  is: 'Résultat fiscal, impôt dû, acomptes et solde de l\'exercice.',
  fx: 'Réévaluation des créances et dettes en devises à la clôture.',
  cloture: 'Contrôles, écritures d\'inventaire et clôture des périodes et de l\'exercice.',
  resume: 'Entrées, sorties et résultat du mois.',
  losses: 'Pertes déclarées, valorisées au coût de revient.',
  grand_livre: 'Mouvements de chaque compte sur la période, avec solde progressif.',
  balance: 'Soldes d\'ouverture, mouvements et soldes de clôture par compte.',
  aged_balance: 'Créances et dettes ventilées par ancienneté d\'échéance.',
  cpc: 'Compte de produits et charges de la période.',
  bilan: 'Actif et passif à la date d\'arrêté.',
  tva: 'TVA collectée, TVA déductible et TVA due de la période.',
  liasse: 'États de synthèse de l\'exercice et dépôt de la liasse fiscale.',
  consolidation: 'États consolidés des points de vente.',
  budget: 'Budget de l\'exercice comparé au réalisé.',
  cashflow: 'Encaissements et décaissements par compte de trésorerie.',
  prevision: 'Trésorerie attendue des prochaines semaines.',
  costcenters: 'Résultat par section analytique et ventilation des charges.',
  plan_comptable: 'Comptes du plan comptable (CGNC) et comptes auxiliaires.',
  entry_templates: 'Modèles d\'écritures réutilisables et écritures récurrentes.',
};

export default function AccountingPage() {
  const { user } = useAuth();

  // La vue normée (états CGNC) est accessible à l'admin et au gérant.
  // L'admin pourra étendre l'accès via la gestion des utilisateurs.
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const views: ModuleView<AccTab>[] = useCapabilityScreens('accounting', TAB_META.map(({ adminOnly, ...v }) => ({ ...v, hidden: adminOnly && !isAdmin })));
  const { current, select } = useModuleView(views);
  const tab = current?.key;
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  return (
    <ModuleShell title="Comptabilité" views={views} current={current} onSelect={select} flush look="apple"
      actions={<div ref={setHeaderSlot} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }} />}>
      {/* Gabarit de page (Design System) : fil d'Ariane « Comptabilité › Rubrique › Page » posé par ModuleShell,
          actions de l'écran en haut à droite (HeaderActions), puis titre et description d'une ligne. */}
      <HeaderSlotContext.Provider value={headerSlot}>
      <div className="acc-page">
      <PageHeader title={current?.label} description={tab ? PAGE_LEADS[tab] : undefined} />
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
      {tab === 'entry_templates' && <JournalTemplatesTab />}
      {tab === 'ecritures' && <EcrituresTab />}
      {tab === 'lettrage' && <LettrageTab />}
      {tab === 'grand_livre' && <GrandLivreTab />}
      {tab === 'balance' && <BalanceTab />}
      {tab === 'aged_balance' && <AgedBalanceTab />}
      {tab === 'cpc' && <CpcTab />}
      {tab === 'budget' && <BudgetTab />}
      {tab === 'bilan' && <BilanTab />}
      {tab === 'tva' && <TvaTab />}
      {tab === 'ras' && <RetenuesSourceTab />}
      {tab === 'immobilisations' && <ImmobilisationsTab />}
      {tab === 'banque' && <BanqueTab />}
      {tab === 'paiements_lot' && <PaymentRunsTab />}
      {tab === 'is' && <CorporateTaxTab />}
      {tab === 'fx' && <FxRevaluationTab />}
      {tab === 'liasse' && <LiasseTab />}
      {tab === 'effets' && <BillsPortfolioTab />}
      {tab === 'consolidation' && <ConsolidationTab />}
      {tab === 'cloture' && <ClotureTab />}
      {tab === 'cca' && <PrepaidChargesTab />}
      {tab === 'cashflow' && <CashFlowTab />}
      {tab === 'prevision' && <CashForecastTab />}
      {tab === 'costcenters' && <CostCentersTab />}
      </div>
      </HeaderSlotContext.Provider>
    </ModuleShell>
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

  const { data, isLoading, isError, error, refetch } = useQuery({
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
      return full || 'Client non renseigné';
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
      ['TIERS', 'N FACTURE', 'DATE', 'ECHEANCE', 'TOTAL', 'PAYE', `RESTE (${currencySymbol()})`, 'STATUT'], rows);
  };

  const tierLabel = isReceivable ? 'Client' : 'Fournisseur';

  return (
    <>
      {/* Sens : créances / dettes / échéancier */}
      <Tabs label="Créances et dettes" value={side} onChange={k => { setSide(k); setSituation(''); }}
        tabs={[
          { key: 'receivables', label: `Ils nous doivent · ${money(sideTotals.receivables)}` },
          { key: 'payables', label: `Nous leur devons · ${money(sideTotals.payables)}` },
          { key: 'schedule', label: 'Échéancier' },
        ]} />
      {side === 'payables' && sideTotals.credits > 0 && (
        <Alert tone="info">Dont {money(sideTotals.credits)} de crédits sans facture, suivis dans l'échéancier.</Alert>
      )}

      {/* Vue echeancier : calendrier des sorties (mig 258). Les autres vues
          restent centrees sur les factures ouvertes, agregees par tiers. */}
      {side === 'schedule' ? <EcheancierView /> : (<>

      {/* Situation des tiers : une carte par situation (clic = filtre) */}
      <StagePipeline
        title={isReceivable ? 'Où en sont mes créances' : 'Où en sont mes dettes'}
        summary={`${totals.tierCount} ${isReceivable ? 'client' : 'fournisseur'}${totals.tierCount > 1 ? 's' : ''} · ${totals.invoiceCount} facture${totals.invoiceCount > 1 ? 's' : ''} · ${money(totals.totalDue)}`}
        stages={[
          { key: 'overdue', label: 'Échues', hint: 'échéance dépassée', icon: AlertTriangle },
          { key: 'soon', label: 'Échéance ≤ 7 j', hint: isReceivable ? 'à relancer' : 'à préparer', icon: Clock },
          { key: 'later', label: 'À venir', hint: 'pas encore échues', icon: Calendar },
        ]}
        stats={{
          overdue: { count: situationCounts.overdue.n, sub: `${money(situationCounts.overdue.amount)}`, late: situationCounts.overdue.n, alertLabel: isReceivable ? 'à relancer' : 'à régler' },
          soon: { count: situationCounts.soon.n, sub: `${money(situationCounts.soon.amount)}` },
          later: { count: situationCounts.later.n, sub: `${money(situationCounts.later.amount)}` },
        }}
        isActive={k => situation === k}
        onPick={k => setSituation(situation === k ? '' : (k as 'overdue' | 'soon' | 'later'))}
      />

      {/* Filtres */}
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary">
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
      </HeaderActions>

      <div className="prj-toolbar">
        <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder={`Rechercher un ${tierLabel.toLowerCase()}…`} />
        {situation && (
          <button type="button" onClick={() => setSituation('')} className="ds-btn-ghost ds-btn-sm">
            <X size={12} aria-hidden="true" /> Effacer le filtre
          </button>
        )}
      </div>

      {/* Tableau des tiers */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : shownTiers.length === 0 ? (
        situation || searchTerm
          ? <NoResultState text="Aucun tiers ne correspond aux filtres." onReset={() => { setSituation(''); setSearchTerm(''); }} />
          : <EmptyState icon={Scale} title={isReceivable ? 'Aucune créance ouverte' : 'Aucune dette ouverte'}
              text={isReceivable ? 'Tous les clients sont à jour.' : 'Tous les fournisseurs sont réglés.'} />
      ) : (
        <DataPanel label={isReceivable ? 'Créances par client' : 'Dettes par fournisseur'} footer={
          <TableFooter page={page} pageSize={PAGE_SIZE} total={shownTiers.length} onPage={setPage}
            note={`${isReceivable ? 'client' : 'fournisseur'}${shownTiers.length > 1 ? 's' : ''} · total dû ${money(totals.totalDue)} · cliquez une ligne pour voir ses factures`} />
        }>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 20 }}><span className="ds-sr-only">Détail</span></th>
                <th>{tierLabel}</th>
                <th className="ds-num">Factures</th>
                <th>Plus ancienne échéance</th>
                <th className="ds-num">En retard ({currencySymbol()})</th>
                <th className="ds-num">Total dû ({currencySymbol()})</th>
                <th className="ds-actions">Prochaine action</th>
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
                      <td style={{ color: 'var(--ds-muted)' }}>
                        {open ? <ChevronDown size={13} aria-label="Replier" /> : <ChevronRight size={13} aria-label="Déplier" />}
                      </td>
                      <td>
                        <span className="ds-strong">{t.name}</span>
                        {t.phone && <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 6 }}>{t.phone}</span>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '12px', color: 'var(--ds-muted)', marginTop: 1 }}>
                          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: t.situation === 'overdue' ? 'var(--ds-danger)' : t.situation === 'soon' ? 'var(--ds-warning)' : 'var(--ds-success)' }} />
                          {t.situation === 'overdue' ? 'Échue' : t.situation === 'soon' ? 'Échéance ≤ 7 j' : 'À venir'}
                        </div>
                      </td>
                      <td className="ds-num">{t.invoices.length}</td>
                      <td>
                        {t.oldestDue ? fmtPaymentDate(t.oldestDue, 'fr') : '—'}
                      </td>
                      <td className="ds-num">
                        {t.overdueDue > 0 ? <span style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>{n(t.overdueDue)}</span> : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                      </td>
                      <td className="ds-num ds-strong">{n(t.totalDue)}</td>
                      <td className="ds-actions" onClick={e => e.stopPropagation()}>
                        {nextInv && (
                          <button type="button" onClick={() => openPayment(nextInv)}
                            className="odoo-btn-secondary ds-btn-sm"
                            title={`${isReceivable ? 'Encaisser' : 'Payer'} la facture ${nextInv.invoice_number}${t.invoices.length > 1 ? ' (la plus urgente)' : ''}`}>
                            {isReceivable ? 'Encaisser' : 'Payer'}{t.invoices.length > 1 ? ` ${nextInv.invoice_number}` : ''}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--ds-bg)', padding: '8px 16px' }}>
                          <table className="odoo-table ds-dense" style={{ background: 'transparent' }}>
                            <thead>
                              <tr>
                                <th>N° facture</th>
                                <th>Date</th>
                                <th>Échéance</th>
                                <th className="ds-num">Total ({currencySymbol()})</th>
                                <th className="ds-num">Payé ({currencySymbol()})</th>
                                <th className="ds-num">Reste ({currencySymbol()})</th>
                                <th>Statut</th>
                                <th className="ds-actions" style={{ width: 110 }}><span className="ds-sr-only">Actions</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.invoices.map(inv => (
                                <tr key={inv.id}>
                                  <td className="ds-ref">{inv.invoice_number}</td>
                                  <td style={{ whiteSpace: 'nowrap' }}>{fmtPaymentDate(inv.invoice_date, 'fr')}</td>
                                  <td style={{ whiteSpace: 'nowrap', color: inv.is_overdue ? 'var(--ds-danger)' : undefined, fontWeight: inv.is_overdue ? 600 : 400 }}>
                                    {inv.due_date ? fmtPaymentDate(inv.due_date, 'fr') : '—'}
                                  </td>
                                  <td className="ds-num">{n(parseFloat(inv.total_amount) || 0)}</td>
                                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(parseFloat(inv.paid_amount) || 0)}</td>
                                  <td className="ds-num ds-strong">{n(parseFloat(inv.remaining_amount) || 0)}</td>
                                  <td>
                                    <StatusTag tone={inv.is_overdue ? 'late' : inv.status === 'partial' ? 'progress' : 'todo'}
                                      label={inv.is_overdue ? 'Échue' : (INVOICE_STATUS_LABELS[inv.status] || inv.status)} />
                                  </td>
                                  <td className="ds-actions">
                                    <button type="button" onClick={() => openPayment(inv)} className="odoo-btn-secondary ds-btn-sm">
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
              <tr>
                <td colSpan={4}>Total {isReceivable ? 'créances' : 'dettes'} ({totals.tierCount} tiers)</td>
                <td className="ds-num" style={{ color: totals.overdueDue > 0 ? 'var(--ds-danger)' : undefined }}>
                  {totals.overdueDue > 0 ? `${n(totals.overdueDue)}` : '—'}
                </td>
                <td className="ds-num">{n(totals.totalDue)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
      )}

      {/* Modal : enregistrer un reglement */}
      {payingInvoice && (() => {
        const remaining = parseFloat(payingInvoice.remaining_amount) || 0;
        const partyName = isReceivable
          ? ([payingInvoice.customer_first_name, payingInvoice.customer_last_name].filter(Boolean).join(' ').trim() || 'Client non renseigné')
          : (payingInvoice.supplier_name || 'Fournisseur');
        return (
          <Modal title={isReceivable ? 'Encaisser un règlement' : 'Payer une facture'} subtitle={`${payingInvoice.invoice_number} · ${partyName}`}
            onClose={() => setPayingInvoice(null)} width={520} locked={createPayment.isPending}
            footer={<FormFooter onCancel={() => setPayingInvoice(null)} busy={createPayment.isPending} submitLabel={isReceivable ? 'Encaisser' : 'Payer'}
              onSubmit={() => (document.getElementById('dettes-pay-form') as HTMLFormElement | null)?.requestSubmit()} />}>
              <form id="dettes-pay-form" onSubmit={e => {
                e.preventDefault();
                const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
                const amount = parseFloat(payAmount);
                if (!Number.isFinite(amount) || amount <= 0) { notify.error('Montant invalide'); return; }
                const avoir = parseFloat(avoirAmount) || 0;
                if (amount + avoir > remaining + 0.01) { notify.error(`Le total (${money(amount + avoir)}) dépasse le reste à payer (${money(remaining)})`); return; }
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
              }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <Alert tone="info">
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>Reste à payer</span>
                    <strong className="ds-num">{money(remaining)}</strong>
                  </span>
                </Alert>
                <FormSection title="Règlement">
                  <div className="ds-form-grid">
                    <FormField label={!isReceivable && rasTypeId ? 'Montant brut' : 'Montant'} htmlFor="pay-amount" required>
                      <input id="pay-amount" name="amount" type="number" step="0.01" min="0" max={remaining}
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
                        className="ds-input" required />
                    </FormField>
                    <FormField label="Date" htmlFor="pay-date" required>
                      <input id="pay-date" name="paymentDate" type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                        className="ds-input" required />
                    </FormField>
                  </div>
                  <FormField label="Mode de règlement">
                    <PaymentModeSelect value={payMethod} onChange={setPayMethod} />
                  </FormField>
                  {payModeDef?.requires_reference && payLegacy !== 'check' && payLegacy !== 'traite' && (
                    <FormField label="Référence du virement" htmlFor="pay-ref" required>
                      <input id="pay-ref" name="reference" required placeholder="N° d'ordre ou référence bancaire" className="ds-input" />
                    </FormField>
                  )}
                  {!isReceivable && (
                    <CashLimitGauge supplierId={payingInvoice.supplier_id} date={payDate} amount={parseFloat(payAmount) || 0}
                      modeCode={payMethod} override={payOverride} onOverrideChange={setPayOverride} />
                  )}
                </FormSection>
                {!isReceivable && (() => {
                  const brut = parseFloat(payAmount) || 0;
                  const retenue = parseFloat(rasAmount) || 0;
                  const net = Math.max(0, brut - retenue);
                  const selRas = rasTypes.find(x => x.id === rasTypeId);
                  return (
                    <FormSection title="Retenue à la source (RAS)">
                      <FormField label="Type de retenue" htmlFor="pay-ras-type">
                        <select id="pay-ras-type" value={rasTypeId} onChange={e => {
                          const id = e.target.value;
                          setRasTypeId(id);
                          const t = rasTypes.find(x => x.id === id);
                          const rate = t ? parseFloat(String(t.rate ?? 0)) : 0;
                          setRasAmount(id && rate > 0 ? ((brut * rate) / 100).toFixed(2) : '');
                        }} className="ds-input">
                          <option value="">Aucune retenue</option>
                          {rasTypes.map(t => (
                            <option key={t.id} value={t.id}>{t.label}{t.rate ? ` — ${t.rate}%` : ''}</option>
                          ))}
                        </select>
                      </FormField>
                      {rasTypeId && (
                        <>
                          <div className="ds-form-grid">
                            <FormField label={`Montant retenu (${currencySymbol()})`} htmlFor="pay-ras-amount">
                              <input id="pay-ras-amount" type="number" step="0.01" min="0" value={rasAmount}
                                onChange={e => setRasAmount(e.target.value)} className="ds-input" />
                            </FormField>
                            <FormField label="Net versé" htmlFor="pay-ras-net">
                              <output id="pay-ras-net" className="ds-input ds-num" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontWeight: 600 }}>{money(net)}</output>
                            </FormField>
                          </div>
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
                            La retenue de <strong>{money(retenue)}</strong> sera déclarée à l'État (compte <strong>{selRas?.account_code}</strong>) et apparaîtra dans <strong>Retenues source → À reverser</strong>. Le bénéficiaire reçoit le net.
                          </p>
                        </>
                      )}
                    </FormSection>
                  );
                })()}
                {(payLegacy === 'check' || payLegacy === 'traite') && (
                  <FormSection title={payLegacy === 'traite' ? 'Traite' : 'Chèque'}>
                    <div className="ds-form-grid">
                      <FormField label={`N° ${payLegacy === 'traite' ? 'traite' : 'chèque'}`} htmlFor="pay-check-number">
                        <input id="pay-check-number" name="checkNumber" type="text" className="ds-input" />
                      </FormField>
                      <FormField label={`Date ${payLegacy === 'traite' ? 'traite' : 'chèque'}`} htmlFor="pay-check-date">
                        <input id="pay-check-date" name="checkDate" type="date" className="ds-input" />
                      </FormField>
                    </div>
                    {!isReceivable && (() => {
                      const av = parseFloat(avoirAmount) || 0;
                      const chk = parseFloat(payAmount) || 0;
                      return (
                        <>
                          <div className="ds-form-grid">
                            <FormField label={`Avoir fournisseur (${currencySymbol()})`} htmlFor="pay-avoir">
                              <input id="pay-avoir" type="number" step="0.01" min="0" value={avoirAmount}
                                onChange={e => setAvoirAmount(e.target.value)} placeholder="0.00" className="ds-input" />
                            </FormField>
                            {av > 0 && (
                              <FormField label="Total réglé" htmlFor="pay-avoir-total">
                                <output id="pay-avoir-total" className="ds-input ds-num" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontWeight: 600 }}>{money(chk + av)}</output>
                              </FormField>
                            )}
                          </div>
                          {av > 0 && (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
                              L'avoir de <strong>{money(av)}</strong> sera déduit de la dette. {payLegacy === 'traite' ? 'La traite' : 'Le chèque'} émis sera de <strong>{money(chk)}</strong>.
                            </p>
                          )}
                        </>
                      );
                    })()}
                    <Alert tone="warning">
                      {payLegacy === 'traite' ? 'La traite' : 'Le chèque'} apparaîtra dans l'onglet <strong>Chèques et Traites</strong> en attente d'encaissement. La dette est néanmoins réduite dès maintenant.
                    </Alert>
                  </FormSection>
                )}
                <FormField label="Note" htmlFor="pay-note">
                  <textarea id="pay-note" name="description" rows={2} className="ds-input" />
                </FormField>
              </form>
          </Modal>
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
    title: 'Engagement — factures de la période', accent: 'var(--ds-info)', bg: 'var(--ds-info-bg)',
    filter: { placeholder: 'Tous les statuts', value: r => r.status, display: v => INVOICE_STATUS_LABELS[v] || v },
    columns: [
      { label: 'N° facture', render: r => <span className="ds-ref">{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Date', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Statut', render: r => INVOICE_STATUS_LABELS[r.status || ''] || r.status || '—', sortValue: r => INVOICE_STATUS_LABELS[r.status || ''] || r.status || '' },
      { label: 'Montant', align: 'right', render: r => <span className="ds-strong">{n(r.amount)}</span>, sortValue: r => r.amount },
    ],
  },
  treasury: {
    title: 'Trésorerie sortie — paiements effectifs', accent: 'var(--ds-success)', bg: 'var(--ds-success-bg)',
    filter: { placeholder: 'Toutes les méthodes', value: r => r.method, display: v => PAYMENT_METHOD_LABELS[v] || v },
    columns: [
      { label: 'Date', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Bénéficiaire', render: r => r.supplierName || r.label || '—', sortValue: r => r.supplierName || r.label || '' },
      { label: 'Méthode', render: r => PAYMENT_METHOD_LABELS[r.method || ''] || r.method || '—', sortValue: r => PAYMENT_METHOD_LABELS[r.method || ''] || r.method || '' },
      { label: 'Réf', render: r => <span className="ds-ref">{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Montant', align: 'right', render: r => <span className="ds-strong">{n(r.amount)}</span>, sortValue: r => r.amount },
    ],
  },
  remainingToPay: {
    title: 'Reste à payer — factures non soldées', accent: 'var(--ds-warning)', bg: 'var(--ds-warning-bg)',
    filter: { placeholder: 'Tous les statuts', value: r => r.status, display: v => INVOICE_STATUS_LABELS[v] || v },
    columns: [
      { label: 'N° facture', render: r => <span className="ds-ref">{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Échéance', render: r => (r.dueDate ? fmtPaymentDate(r.dueDate, 'fr') : '—'), sortValue: r => r.dueDate || '' },
      { label: 'Total', align: 'right', render: r => n(r.total ?? 0), sortValue: r => r.total ?? 0 },
      { label: 'Payé', align: 'right', render: r => n(r.paid ?? 0), sortValue: r => r.paid ?? 0 },
      { label: 'Reste', align: 'right', render: r => <span className="ds-strong" style={{ color: 'var(--ds-warning)' }}>{n(r.amount)}</span>, sortValue: r => r.amount },
    ],
  },
  receivedNotInvoiced: {
    title: 'Reçu non facturé — BC livrés sans facture', accent: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)',
    columns: [
      { label: 'N° BC', render: r => <span className="ds-ref">{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Date livraison', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Montant estimé', align: 'right', render: r => <span className="ds-strong">{n(r.amount)}</span>, sortValue: r => r.amount },
    ],
  },
  unpaidInvoices: {
    title: 'Factures impayées (toutes périodes)', accent: 'var(--ds-warning)', bg: 'var(--ds-bg)',
    filter: { placeholder: 'Tous les statuts', value: r => r.status, display: v => INVOICE_STATUS_LABELS[v] || v },
    columns: [
      { label: 'N° facture', render: r => <span className="ds-ref">{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Fournisseur', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Date', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Échéance', render: r => (r.dueDate ? fmtPaymentDate(r.dueDate, 'fr') : '—'), sortValue: r => r.dueDate || '' },
      { label: 'Reste', align: 'right', render: r => <span className="ds-strong">{n(r.amount)}</span>, sortValue: r => r.amount },
    ],
  },
  uncashedChecks: {
    title: 'Chèques émis non encaissés', accent: 'var(--ds-warning)', bg: 'var(--ds-warning-bg)',
    columns: [
      { label: 'Bénéficiaire', render: r => r.supplierName || '—', sortValue: r => r.supplierName || '' },
      { label: 'Réf', render: r => <span className="ds-ref">{r.ref || '—'}</span>, sortValue: r => r.ref || '' },
      { label: 'Émis le', render: r => (r.date ? fmtPaymentDate(r.date, 'fr') : '—'), sortValue: r => r.date || '' },
      { label: 'Échéance', render: r => (r.dueDate ? fmtPaymentDate(r.dueDate, 'fr') : '—'), sortValue: r => r.dueDate || '' },
      { label: 'Montant', align: 'right', render: r => <span className="ds-strong">{n(r.amount)}</span>, sortValue: r => r.amount },
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
  const { data, isLoading, isError, error, refetch } = useQuery({
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
    <div>
      <SectionHeader title={`Détail · ${cfg.title}`}
        note={<>{rows.length} ligne{rows.length > 1 ? 's' : ''}{rows.length !== allRows.length && <> sur {allRows.length}</>} · <strong>{money(total)}</strong></>}>
        <button type="button" onClick={onClose} className="ds-icon-btn" aria-label="Fermer le détail" title="Fermer le détail"><X size={16} /></button>
      </SectionHeader>
      <DataPanel label={cfg.title}
        bulk={!isLoading && allRows.length > 0 ? (
          <Toolbar>
            <SearchBar value={search} onChange={setSearch} placeholder="Rechercher..." label="Rechercher dans le détail" />
            {cfg.filter && filterOptions.length > 0 && (
              <SelectFilter label={cfg.filter.placeholder.replace(/^Tou(te)?s (les )?/i, '') || 'Filtre'} icon={Filter} value={filterValue} onChange={setFilterValue}
                allLabel="Tous" options={filterOptions.map(v => ({ key: v, label: cfg.filter!.display(v) }))} />
            )}
            {hasControls && (
              <button type="button" onClick={() => { setSearch(''); setFilterValue(''); setSortCol(null); setSortDir('asc'); }}
                className="ds-btn-ghost ds-btn-sm">
                <X size={12} /> Effacer les filtres
              </button>
            )}
          </Toolbar>
        ) : undefined}
        footer={rows.length > 0 ? <Pager page={page} total={rows.length} onPage={setPage} note={cfg.title} /> : undefined}>
        {isLoading ? (
          <LoadingState bare label="Chargement du détail…" />
        ) : isError ? (
          <ErrorState bare error={error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          allRows.length === 0
            ? <EmptyState bare icon={ClipboardList} title="Aucune ligne à afficher" />
            : <NoResultState bare text="Aucune ligne ne correspond à la recherche." onReset={() => setSearch('')} />
        ) : (
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                {cfg.columns.map((c, i) => (
                  <th key={i} className={c.align === 'right' ? 'ds-num' : undefined}
                    aria-sort={sortCol === i ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    style={{ whiteSpace: 'nowrap' }}><button type="button" className="ds-sort" onClick={() => toggleSort(i)}>
                    {c.label}{c.align === 'right' ? ` (${currencySymbol()})` : ''}
                    {sortCol === i && (sortDir === 'asc'
                      ? <ArrowUp size={11} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
                      : <ArrowDown size={11} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />)}
                  </button></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map(r => (
                <tr key={r.id}>
                  {cfg.columns.map((c, i) => (
                    <td key={i} className={c.align === 'right' ? 'ds-num' : undefined}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={cfg.columns.length - 1} className="ds-strong">Total{rows.length !== allRows.length ? ' (filtré)' : ''}</td>
                <td className="ds-num ds-strong">{n(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </DataPanel>
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

  const { data, isLoading, isError, error, refetch } = useQuery({
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

  if (isError) return <ErrorState title="Le pilotage n'a pas pu être chargé" error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <LoadingState label="Chargement du pilotage…" />
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
      <div className="prj-toolbar">
        <PeriodFilter label="Période" title="Période d'analyse des flux"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <span style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>
          <strong style={{ textTransform: 'capitalize', color: 'var(--ds-ink)' }}>{periodLabel}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>Cliquez une carte pour voir le détail</span>
      </div>

      {/* 1. Flux de la période : engagé → payé → reste à payer (+ reçu non facturé) */}
      <StagePipeline
        title={`Flux de la période · ${periodLabel}`}
        summary={`${money(kpis.engagement.total)} engagés · ${money(kpis.treasury.total)} payés`}
        stages={[
          { key: 'engagement', label: 'Engagé', hint: 'factures fournisseur reçues', icon: ClipboardList },
          { key: 'treasury', label: 'Payé', hint: 'cash réellement sorti', icon: ArrowDownRight },
          { key: 'remainingToPay', label: 'Reste à payer', hint: 'factures de la période', icon: Coins },
          { key: 'receivedNotInvoiced', label: 'Reçu non facturé', hint: 'BC livrés sans facture', icon: FileWarning },
        ]}
        stats={{
          engagement: { count: kpis.engagement.count, sub: `${money(kpis.engagement.total)}` },
          treasury: { count: kpis.treasury.byMethod.cash.count + kpis.treasury.byMethod.check.count + kpis.treasury.byMethod.transfer.count + kpis.treasury.byMethod.bank.count, sub: `${money(kpis.treasury.total)}` },
          remainingToPay: { count: kpis.remainingToPay.count, sub: `${money(kpis.remainingToPay.total)}` },
          receivedNotInvoiced: { count: kpis.receivedNotInvoiced.count, sub: `${money(kpis.receivedNotInvoiced.total)}`, late: kpis.receivedNotInvoiced.count, alertLabel: 'facture à saisir' },
        }}
        isActive={k => detailKind === k}
        onPick={toggleDetail}
      />

      {/* Équation de trésorerie, en clair */}
      <StatusBanner tone={kpis.receivedNotInvoiced.total > 0 ? 'warning' : 'info'} icon={Scale}
        title={`Engagé ${money(kpis.engagement.total)} · payé ${money(kpis.treasury.total)} · reste à payer ${money(kpis.remainingToPay.total)}`}>
        {deltaToPay < 0
          ? `Les paiements de la période (${money(kpis.treasury.total)}) dépassent ce qui y a été engagé : ils règlent aussi des factures des périodes précédentes.`
          : kpis.remainingToPay.total > 0
            ? `${money(kpis.remainingToPay.total)} des factures de la période ne sont pas encore payés.`
            : 'Toutes les factures de la période sont payées.'}
        {kpis.receivedNotInvoiced.total > 0 && ` Attention : ${money(kpis.receivedNotInvoiced.total)} de marchandises reçues n'ont pas encore de facture saisie — l'engagement est sous-estimé.`}
      </StatusBanner>

      {/* 2. À date : ce qui va peser sur la trésorerie */}
      <StagePipeline
        title="À date · ce qui va sortir du compte"
        summary={`${money(pipeline.unpaidInvoices.total + pipeline.uncashedChecks.total)} à décaisser`}
        stages={[
          { key: 'unpaidInvoices', label: 'Factures impayées', hint: 'toutes périodes', icon: Receipt },
          { key: 'uncashedChecks', label: 'Chèques non encaissés', hint: 'émis, pas encore débités', icon: Wallet },
          { key: 'receivedNotInvoiced', label: 'Reçu sans facture', hint: 'à comptabiliser', icon: FileWarning },
        ]}
        stats={{
          unpaidInvoices: { count: pipeline.unpaidInvoices.count, sub: `${money(pipeline.unpaidInvoices.total)}` },
          uncashedChecks: {
            count: pipeline.uncashedChecks.count,
            sub: `${money(pipeline.uncashedChecks.total)}${pipeline.uncashedChecks.next7d > 0 ? ` · ${n(pipeline.uncashedChecks.next7d)} sous 7 j` : ''}`,
            late: pipeline.uncashedChecks.overdue > 0 ? 1 : 0, alertLabel: `échus : ${money(pipeline.uncashedChecks.overdue)}`,
          },
          receivedNotInvoiced: { count: pipeline.receivedNotInvoiced.count, sub: `${money(pipeline.receivedNotInvoiced.total)}` },
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
          <SectionHeader title="Répartition des paiements de la période" />
          <div className="ds-panel" style={{ padding: '16px 20px', marginTop: 8 }}>
            {/* Barre proportionnelle */}
            <div style={{ display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', marginBottom: 12, background: 'var(--ds-bg)' }}>
              {cashPct > 0 && (
                <div style={{ width: `${cashPct}%`, background: 'var(--ds-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 600 }}>
                  {cashPct >= 8 && `${Math.round(cashPct)}%`}
                </div>
              )}
              {checkPct > 0 && (
                <div style={{ width: `${checkPct}%`, background: 'var(--ds-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 600 }}>
                  {checkPct >= 8 && `${Math.round(checkPct)}%`}
                </div>
              )}
              {transferPct > 0 && (
                <div style={{ width: `${transferPct}%`, background: 'var(--ds-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 600 }}>
                  {transferPct >= 8 && `${Math.round(transferPct)}%`}
                </div>
              )}
            </div>
            {/* Legende */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: '13px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: 'var(--ds-success)', borderRadius: 2 }} />
                  <strong>Espèces</strong>
                  <span style={{ color: 'var(--ds-muted)' }}>({kpis.treasury.byMethod.cash.count})</span>
                </div>
                <div className="ds-num ds-strong" style={{ marginLeft: 18, textAlign: 'left' }}>{money(kpis.treasury.byMethod.cash.total)}</div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: 'var(--ds-warning)', borderRadius: 2 }} />
                  <strong>Chèque (encaissé)</strong>
                  <span style={{ color: 'var(--ds-muted)' }}>({kpis.treasury.byMethod.check.count})</span>
                </div>
                <div className="ds-num ds-strong" style={{ marginLeft: 18, textAlign: 'left' }}>{money(kpis.treasury.byMethod.check.total)}</div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 12, height: 12, background: 'var(--ds-info)', borderRadius: 2 }} />
                  <strong>Virement et banque</strong>
                  <span style={{ color: 'var(--ds-muted)' }}>({kpis.treasury.byMethod.transfer.count + kpis.treasury.byMethod.bank.count})</span>
                </div>
                <div className="ds-num ds-strong" style={{ marginLeft: 18, textAlign: 'left' }}>{money(kpis.treasury.byMethod.transfer.total + kpis.treasury.byMethod.bank.total)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4 : Top fournisseurs crediteurs */}
      <div>
        <SectionHeader title="Fournisseurs à qui l'on doit le plus" note="à date" />
        <div style={{ height: 8 }} />
        {topSuppliers.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Aucun montant dû aux fournisseurs" text="Tous les soldes sont à zéro." />
        ) : (
          <DataPanel label="Fournisseurs à qui l'on doit le plus">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>Rang</th>
                  <th>Fournisseur</th>
                  <th className="ds-num">Factures impayées ({currencySymbol()})</th>
                  <th className="ds-num">Chèques non encaissés ({currencySymbol()})</th>
                  <th className="ds-num">Total dû ({currencySymbol()})</th>
                </tr>
              </thead>
              <tbody>
                {topSuppliers.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ color: 'var(--ds-muted)' }}>{i + 1}</td>
                    <td className="ds-strong">{s.name}</td>
                    <td className="ds-num">
                      {s.unpaidTotal > 0 ? (
                        <>
                          {n(s.unpaidTotal)}
                          <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 4 }}>({s.unpaidCount})</span>
                        </>
                      ) : '—'}
                    </td>
                    <td className="ds-num">
                      {s.uncashedChecksTotal > 0 ? (
                        <>
                          {n(s.uncashedChecksTotal)}
                          <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 4 }}>({s.uncashedChecksCount})</span>
                        </>
                      ) : '—'}
                    </td>
                    <td className="ds-num ds-strong">{n(s.totalDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </div>

      {/* Liste detaillee : receptions sans facture (si il y en a) */}
      {pipeline.receivedNotInvoiced.list.length > 0 && (
        <div>
          <SectionHeader title="Marchandises reçues sans facture" note="à saisir" />
          <div style={{ height: 8 }} />
          <DataPanel label="Marchandises reçues sans facture">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>N° BC</th>
                  <th>Fournisseur</th>
                  <th>Date de livraison</th>
                  <th className="ds-num">Montant estimé ({currencySymbol()})</th>
                </tr>
              </thead>
              <tbody>
                {pipeline.receivedNotInvoiced.list.map(r => (
                  <tr key={r.id}>
                    <td className="ds-ref">{r.orderNumber}</td>
                    <td className="ds-strong">{r.supplierName}</td>
                    <td>{r.deliveryDate ? format(parseLocalDate(r.deliveryDate), 'dd/MM/yyyy') : '—'}</td>
                    <td className="ds-num">{n(Number(r.total) || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total ({pipeline.receivedNotInvoiced.list.length} BC)</td>
                  <td className="ds-num">{n(pipeline.receivedNotInvoiced.list.reduce((acc, r) => acc + (Number(r.total) || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </DataPanel>
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

  const { data, isLoading, isError, error, refetch } = useQuery({
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
    exportCSV(`caisse_${MONTH_NAMES[month - 1]}_${year}.csv`, ['', 'LIBELLE', 'DETAIL', `MONTANT (${currencySymbol()})`], rows);
  };

  return (
    <>
      <HeaderActions>
        <button type="button" onClick={() => setShowImportModal(true)} className="odoo-btn-secondary">
          <Upload size={13} aria-hidden="true" /> Importer Excel
        </button>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary">
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
      </HeaderActions>

      {showImportModal && <CaisseImportModal onClose={() => setShowImportModal(false)} />}

      {/* Report line */}
      {data && (data.previousBalance.cashNet !== 0 || data.previousBalance.cardCumul !== 0 || isAdmin) && (
        <div className="ds-alert info" role="status" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ArrowUpRight size={14} aria-hidden="true" /> Report du mois précédent
            {data.reportOverride && (
              <StatusTag tone="todo" label="Ajusté" title={data.reportOverride.note || 'Report fixé manuellement par un admin'} />
            )}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, fontSize: 13, fontWeight: 400, color: 'var(--ds-ink)' }}>
            <span>Espèces : <strong>{money(data.previousBalance.cashNet)}</strong></span>
            <span>Carte : <strong>{money(data.previousBalance.cardCumul)}</strong></span>
            <span>Total : <strong>{money(data.previousBalance.cashNet + data.previousBalance.cardCumul)}</strong></span>
            {isAdmin && (
              <button type="button" onClick={() => setShowReportModal(true)} className="odoo-btn-secondary ds-btn-sm"
                title="Modifier le report du mois précédent">
                <Pencil size={12} aria-hidden="true" /> Modifier
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

      {/* Écart caisse alert */}
      {monthTotals.ecart !== 0 && (
        <Alert tone={monthTotals.ecart > 0 ? 'warning' : 'danger'} icon={AlertTriangle}>
          Écart de caisse du mois : {monthTotals.ecart > 0 ? '+' : ''}{money(monthTotals.ecart)} (total encaissé comparé aux espèces réelles et à la carte)
        </Alert>
      )}

      {/* Reconciliation alerts — significant daily discrepancies */}
      {(data as Record<string, any>)?.reconciliationAlerts && ((data as Record<string, any>).reconciliationAlerts as { date: string; ecart: number }[]).length > 0 && (
        <div>
          <SectionHeader title={`${((data as Record<string, any>).reconciliationAlerts as { date: string; ecart: number }[]).length} jour(s) avec écart caisse significatif (> 5 ${currencySymbol()})`} />
          <DataPanel label="Jours avec écart caisse significatif">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 20 }}><span className="ds-sr-only">Alerte</span></th>
                <th>Jour</th>
                <th className="ds-num">Caissière ({currencySymbol()})</th>
                <th className="ds-num">Système ({currencySymbol()})</th>
                <th className="ds-num">Écart ({currencySymbol()})</th>
              </tr>
            </thead>
            <tbody>
              {((data as Record<string, any>).reconciliationAlerts as { date: string; cashCaissiere: number; cashSysteme: number; ecart: number }[]).map(a => (
                <tr key={a.date}>
                  <td><span className="odoo-status-dot danger" role="img" title="Écart caisse significatif" aria-label="Écart caisse significatif" /></td>
                  <td style={{ textTransform: 'capitalize' }}>{format(parseLocalDate(a.date), 'EEEE dd/MM', { locale: fr })}</td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(a.cashCaissiere)}</td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(a.cashSysteme)}</td>
                  <td className="ds-num ds-strong" style={{ color: 'var(--ds-danger)' }}>{a.ecart > 0 ? '+' : ''}{n(a.ecart)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </DataPanel>
        </div>
      )}

      {/* Indicateurs du mois */}
      <KpiGrid>
        <KpiCard label="Ventes du mois" value={<>{n(monthTotals.totalSales)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>{monthTotals.saleCount} vente{monthTotals.saleCount > 1 ? 's' : ''}</>} />
        <KpiCard label="Recettes" value={<>{n(monthTotals.totalRecettes)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>Caisse {n(monthTotals.cashCaissiere)} · Carte {n(monthTotals.cardReceipts)}
            {monthTotals.cardCommission > 0 && ` (commission −${n(monthTotals.cardCommission)})`}
            {monthTotals.clientReceipts > 0 && ` · Règlements clients ${n(monthTotals.clientReceipts)}`}
            {monthTotals.otherEntries > 0 && ` · Autres ${n(monthTotals.otherEntries)}`}</>} />
        <KpiCard label="Écart caisse" value={<>{monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub="Caissière vs Système" tone={monthTotals.ecart === 0 ? undefined : monthTotals.ecart > 0 ? 'green' : 'red'} />
        <KpiCard label="Solde actuel" value={<>{n(monthTotals.solde)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>Cash {n(monthTotals.cashNet)} · Carte {n(monthTotals.cardCumul)}</>} tone={monthTotals.solde >= 0 ? 'green' : 'red'} />
      </KpiGrid>

      <Toolbar>
        <MonthYearField month={month} year={year} onMonth={setMonth} onYear={setYear} />
      </Toolbar>

      {/* Daily sections */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : days.length === 0 ? (
        <EmptyState icon={Wallet} title="Aucune activité sur ce mois" text="Les ventes, recettes et sorties de caisse apparaîtront ici, jour par jour." />
      ) : (
        <>
        {monthTotals.clientReceipts > 0 && (
          <div>
            <SectionHeader title="Règlements clients du mois" note="factures encaissées par la direction, hors ventes de caisse" />
            <DataPanel label="Règlements clients du mois">
            <table className="odoo-table ds-dense">
              <thead>
                <tr>
                  <th>Date</th><th>Facture</th><th>Client</th><th>Mode</th><th>Référence</th>
                  <th className="ds-num">Montant ({currencySymbol()})</th>
                </tr>
              </thead>
              <tbody>
                {days.flatMap(d => d.payments.filter(isClientReceipt)).map(p => (
                  <tr key={p.id as string} style={{ cursor: 'default' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{format(parseLocalDate(String(p.payment_date).slice(0, 10)), 'dd/MM/yyyy')}</td>
                    <td className="ds-ref">{p.invoice_number as string}</td>
                    <td>{(p.customer_name as string) || '—'}</td>
                    <td><StatusTag tone={p.payment_method === 'cash' ? 'done' : 'progress'} label={caissePayLabel(p.payment_method)} />
                      <span style={{ fontSize: '12px', color: 'var(--ds-muted)', marginLeft: 6 }}>{p.payment_method === 'cash' ? 'solde cash' : 'solde banque'}</span></td>
                    <td style={{ color: 'var(--ds-muted)' }}>{(p.reference as string) || '—'}</td>
                    <td className="ds-num" style={{ fontWeight: 700, color: 'var(--ds-success)' }}>+{n(parseFloat(p.amount as string) || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total des règlements clients</td>
                  <td className="ds-num" style={{ color: 'var(--ds-success)' }}>+{n(monthTotals.clientReceipts)}</td>
                </tr>
              </tfoot>
            </table>
            </DataPanel>
          </div>
        )}
        <div>
          <SectionHeader title="Journal quotidien" note={`montants en ${currencySymbol()}`} />
          <DataPanel label="Journal quotidien">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 20 }}><span className="ds-sr-only">Détail</span></th>
                <th>Date</th>
                <th className="ds-num">Ventes</th>
                <th className="ds-num">Total encaissé</th>
                <th className="ds-num">Carte</th>
                {cardPct > 0 && <th className="ds-num" title={`Retenue du prestataire carte (${cardPct} %)`}>Commission</th>}
                <th className="ds-num" title="Encaissements de factures clients (professionnels)">Règlements clients</th>
                <th className="ds-num">Autres entrées</th>
                <th className="ds-num" title="Fournisseurs, salaires, dépenses">Sorties</th>
                <th className="ds-num">Écart</th>
                <th className="ds-num">Solde cumulé</th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => {
                const expanded = expandedDays.has(day.dayNum);
                const dateLabel = format(parseLocalDate(day.date), 'EEEE dd MMM', { locale: fr });
                return (
                  <Fragment key={day.dayNum}>
                    <tr onClick={() => toggleDay(day.dayNum)} style={{ cursor: 'pointer' }}>
                      <td style={{ color: 'var(--ds-muted)' }}>
                        {expanded ? <ChevronDown size={13} aria-label="Replier le jour" /> : <ChevronRight size={13} aria-label="Déplier le jour" />}
                      </td>
                      <td className="ds-strong" style={{ textTransform: 'capitalize' }}>{dateLabel}</td>
                      <td className="ds-num">{day.totalSales > 0 ? n(day.totalSales) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                      <td className="ds-num">{day.cashCaissiere > 0 ? n(day.cashCaissiere) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                      <td className="ds-num">{day.cardReceipt > 0 ? n(day.cardReceipt) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                      {cardPct > 0 && <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{day.cardCommission > 0 ? `−${n(day.cardCommission)}` : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>}
                      <td className="ds-num" style={{ color: 'var(--ds-success)', fontWeight: day.clientReceipts > 0 ? 600 : undefined }}>{day.clientReceipts > 0 ? `+${n(day.clientReceipts)}` : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                      <td className="ds-num" style={{ color: 'var(--ds-success)' }}>{day.entries - day.clientReceipts > 0 ? `+${n(day.entries - day.clientReceipts)}` : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                      <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{day.exits > 0 ? `−${n(day.exits)}` : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                      <td className="ds-num">
                        {day.ecart !== 0 ? <span style={{ fontWeight: 600, color: day.ecart > 0 ? 'var(--ds-warning)' : 'var(--ds-danger)' }}>{day.ecart > 0 ? '+' : ''}{n(day.ecart)}</span> : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                      </td>
                      <td className="ds-num" style={{ fontWeight: 700, color: day.solde >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{n(day.solde)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={cardPct > 0 ? 11 : 10} style={{ background: 'color-mix(in srgb, var(--ds-bg) 55%, var(--ds-card))', padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Cash réel</div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{money(day.cashSysteme)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Total encaissé</div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{money(day.cashCaissiere)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Carte</div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{money(day.cardReceipt)}</div>
                            </div>
                            {day.cardCommission > 0 && (
                              <div>
                                <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Carte nette en banque</div>
                                <div style={{ fontWeight: 600, fontSize: '14px' }}>{money(day.cardReceipt - day.cardCommission)} <span style={{ fontWeight: 400, fontSize: '12px', color: 'var(--ds-danger)' }}>(−{n(day.cardCommission)} commission {cardPct} %)</span></div>
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Solde cash</div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{money(day.cashNetCumul)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Solde carte</div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{money(day.cardCumul)}</div>
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
          </DataPanel>
        </div>
        </>
      )}

      {/* Monthly recap */}
      {days.length > 0 && (
        <div>
          <SectionHeader title={`Récap ${MONTH_NAMES[month - 1]} ${year}`} />
          <DataPanel label={`Récap ${MONTH_NAMES[month - 1]} ${year}`}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Poste</th>
                <th className="ds-num">Montant ({currencySymbol()})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ color: 'var(--ds-muted)' }}>Total Ventes ({monthTotals.saleCount})</td>
                <td className="ds-num" style={{ fontWeight: 600 }}>{n(monthTotals.totalSales)}</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--ds-muted)' }}>Total encaissé</td>
                <td className="ds-num" style={{ fontWeight: 600 }}>{n(monthTotals.cashCaissiere)}</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--ds-muted)' }}>Carte Encaissée</td>
                <td className="ds-num" style={{ fontWeight: 600 }}>{n(monthTotals.cardReceipts)}</td>
              </tr>
              {monthTotals.cardCommission > 0 && (
                <tr>
                  <td style={{ color: 'var(--ds-muted)' }}>Commission carte ({cardPct} %) — non versée en banque</td>
                  <td className="ds-num" style={{ fontWeight: 600, color: 'var(--ds-danger)' }}>−{n(monthTotals.cardCommission)}</td>
                </tr>
              )}
              {monthTotals.clientReceipts > 0 && (
                <tr>
                  <td style={{ color: 'var(--ds-muted)' }}>Règlements clients (factures)</td>
                  <td className="ds-num" style={{ fontWeight: 600, color: 'var(--ds-success)' }}>{n(monthTotals.clientReceipts)}</td>
                </tr>
              )}
              {monthTotals.otherEntries > 0 && (
                <tr>
                  <td style={{ color: 'var(--ds-muted)' }}>Autres entrées</td>
                  <td className="ds-num" style={{ fontWeight: 600 }}>{n(monthTotals.otherEntries)}</td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 600 }}>Total Recettes</td>
                <td className="ds-num" style={{ fontWeight: 700, color: 'var(--ds-success)' }}>{n(monthTotals.totalRecettes)}</td>
              </tr>
              {monthTotals.exits > 0 && (
                <tr>
                  <td style={{ color: 'var(--ds-muted)' }}>Sorties (fournisseurs, salaires, dépenses)</td>
                  <td className="ds-num" style={{ fontWeight: 600, color: 'var(--ds-danger)' }}>−{n(monthTotals.exits)}</td>
                </tr>
              )}
              {monthTotals.ecart !== 0 && (
                <tr>
                  <td style={{ color: 'var(--ds-muted)' }}>Écart Caisse</td>
                  <td className="ds-num" style={{ fontWeight: 600, color: monthTotals.ecart > 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>
                    {monthTotals.ecart > 0 ? '+' : ''}{n(monthTotals.ecart)}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Solde Final</td>
                <td className="ds-num" style={{ color: monthTotals.solde >= 0 ? 'var(--ds-success)' : 'var(--ds-danger)' }}>{n(monthTotals.solde)}</td>
              </tr>
            </tfoot>
          </table>
          </DataPanel>
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
    <Modal title="Report mois précédent" subtitle={`${MONTH_NAMES[month - 1]} ${year}`} onClose={onClose} width={480} locked={busy}
      footer={
        <FormFooter onCancel={onClose} onSubmit={() => saveMut.mutate()} busy={busy}>
          {override && (
            <button type="button" onClick={() => deleteMut.mutate()} disabled={busy} className="ds-btn-danger">
              <Trash2 size={13} /> Supprimer l'ajustement
            </button>
          )}
        </FormFooter>
      }>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)' }}>
        Fixe le solde reporté au 1er {MONTH_NAMES[month - 1].toLowerCase()} {year}.
        Les mois suivants repartiront de cette valeur, augmentée des mouvements enregistrés depuis.
      </p>
      <FormSection title="Soldes reportés">
        <div className="ds-form-grid">
          <FormField label={`Cash (${currencySymbol()})`} htmlFor="report-cash">
            <input id="report-cash" type="text" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)}
              className="ds-input" style={{ textAlign: 'right' }} />
          </FormField>
          <FormField label={`Carte (${currencySymbol()})`} htmlFor="report-card">
            <input id="report-card" type="text" inputMode="decimal" value={card} onChange={e => setCard(e.target.value)}
              className="ds-input" style={{ textAlign: 'right' }} />
          </FormField>
        </div>
        <div style={{ fontSize: 13, color: 'var(--ds-muted)', textAlign: 'right' }}>
          Total : <strong>{money(cashNum + cardNum)}</strong>
        </div>
        <FormField label="Motif (optionnel)" htmlFor="report-note">
          <input id="report-note" type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="Ex : reprise historique avant mise en prod" className="ds-input" />
        </FormField>
      </FormSection>
    </Modal>
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
  const [expEmployeeId, setExpEmployeeId] = useState('');
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

  const { data: payments = [], isLoading: isLoadingPayments, isError: isPaymentsError, error: paymentsError, refetch: refetchPayments } = useQuery({
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
  const SortIcon = ({ col }: { col: string }) => sortCol === col ? <span style={{ marginLeft: 3, opacity: 0.7, fontSize: '11px' }}>{sortDir === 'asc' ? '▲' : '▼'}</span> : <span style={{ marginLeft: 3, opacity: 0.2, fontSize: '11px' }}>▼</span>;

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
      ['DATE', 'REF', 'CATEGORIE', 'SOUS-CATEGORIE', 'BENEFICIAIRE', 'METHODE', 'DESCRIPTION', `MONTANT (${currencySymbol()})`], rows);
  };


  return (
    <>
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary">
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <button type="button" onClick={() => setShowTransfer(true)} className="odoo-btn-secondary"
          title="Versement d'espèces en banque, retrait : ni charge, ni fournisseur">
          <ArrowLeftRight size={13} aria-hidden="true" /> Mouvement interne
        </button>
        <button type="button" onClick={() => {
          setExpMode('cash'); setExpSupplierId(''); setExpEmployeeId(''); setExpAmount(0); setExpDate(format(new Date(), 'yyyy-MM-dd')); setExpOverride(null);
          setShowForm(true);
        }} className="odoo-btn-primary">
          <Plus size={14} aria-hidden="true" /> Nouvelle dépense
        </button>
      </HeaderActions>

      {/* Répartition : une carte par grande catégorie (clic = filtre), plus les lignes à catégoriser */}
      <StagePipeline
        title={`Sorties · ${periodLabel}`}
        summary={`${statBase.length} opération${statBase.length > 1 ? 's' : ''} · ${money(grandTotal)}${filterMethod !== 'all' ? ` · ${getPaymentLabel(filterMethod)}` : ''}`}
        stages={[
          { key: 'all', label: 'Toutes', hint: 'total des sorties', icon: ArrowDownRight },
          ...topCats.filter(tc => String(tc.id) !== '__none__').map(tc => ({ key: String(tc.id), label: String(tc.name), hint: `${grandTotal > 0 ? Math.round(tc.total / grandTotal * 100) : 0} % du total`, icon: Wallet })),
          ...(uncategorized.count > 0 ? [{ key: '__none__', label: 'À catégoriser', hint: 'sans catégorie', icon: FileWarning }] : []),
        ]}
        stats={{
          all: { count: statBase.length, sub: `${money(grandTotal)}` },
          ...Object.fromEntries(topCats.map(tc => [String(tc.id), { count: statBase.filter(p => (getRootId(p.category_id as string | null) ?? '__none__') === String(tc.id)).length, sub: `${money(tc.total)}` }])),
          __none__: { count: uncategorized.count, sub: `${money(uncategorized.total)}`, late: uncategorized.count, alertLabel: 'à classer' },
        }}
        isActive={k => (k === 'all' ? filterRoot === 'all' : filterRoot === k)}
        onPick={k => { setFilterRoot(k === 'all' || filterRoot === k ? 'all' : k); setFilterLeaf('all'); }}
      />

      {/* Filter bar : recherche + filtres + reset */}
      <div className="prj-toolbar">
        <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Rechercher (description, bénéficiaire, référence, catégorie…)" />
        <PeriodFilter label="Période" title="Date de sortie de l'argent (encaissement pour les chèques)"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
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
            className="ds-btn-ghost ds-btn-sm">
            <X size={12} aria-hidden="true" /> Effacer les filtres
          </button>
        )}
      </div>

      {/* Flat table with referentiel columns */}
      {isLoading ? (
        <LoadingState />
      ) : isPaymentsError ? (
        <ErrorState error={paymentsError} onRetry={() => refetchPayments()} />
      ) : outgoing.length === 0 ? (
        <EmptyState icon={Receipt} title="Aucune sortie sur cette période" text="Les achats, salaires et dépenses réglés sur la période apparaîtront ici." />
      ) : displayed.length === 0 ? (
        <NoResultState text="Aucune sortie ne correspond aux filtres." onReset={() => { setFilterRoot('all'); setFilterLeaf('all'); setFilterMethod('all'); setSearchTerm(''); }} />
      ) : (
        <DataPanel label="Charges et dépenses" footer={
          <TableFooter page={page} pageSize={PAGE_SIZE} total={displayed.length} onPage={setPage}
            note={`opération${displayed.length > 1 ? 's' : ''}${displayed.length !== outgoing.length ? ` filtrée${displayed.length > 1 ? 's' : ''} sur ${outgoing.length}` : ''} · total ${money(displayedTotal)} · ${periodLabel}`} />
        }>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th><button type="button" className="ds-sort" onClick={() => toggleSort('date')}>Date<SortIcon col="date" /></button></th>
                <th>Désignation</th>
                <th><button type="button" className="ds-sort" onClick={() => toggleSort('beneficiaire')}>Bénéficiaire<SortIcon col="beneficiaire" /></button></th>
                <th><button type="button" className="ds-sort" onClick={() => toggleSort('cat')}>Catégorie<SortIcon col="cat" /></button></th>
                <th><button type="button" className="ds-sort" onClick={() => toggleSort('type')}>Type<SortIcon col="type" /></button></th>
                <th>Méthode</th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => toggleSort('amount')}>Montant ({currencySymbol()})<SortIcon col="amount" /></button></th>
                <th className="ds-actions" style={{ width: 150 }}><span className="ds-sr-only">Actions</span></th>
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
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtPaymentDate(p.payment_date, 'fr')}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(p.description as string) || '—'}
                    </td>
                    <td className="ds-strong" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.supplier_name as string || (p.employee_first_name ? `${p.employee_first_name} ${p.employee_last_name}` : '—')}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {rootName}
                    </td>
                    <td>
                      {!isRootLeaf && leafName !== '—' ? (
                        <span style={{ color: 'var(--ds-body)' }}>{leafName}</span>
                      ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--ds-muted)' }}>
                      {p.payment_mode ? paymentModeLabel(p, payModes) : getPaymentLabel(p.payment_method as string)} <PaymentStatusTag p={p} />
                    </td>
                    <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap', textDecoration: p.status === 'void' && !p.voids_payment_id ? 'line-through' : undefined }}>
                      {n(parseFloat(p.amount as string))}
                    </td>
                    <td className="ds-actions">
                      {(() => {
                        const isVoid = p.status === 'void' || !!p.voids_payment_id;
                        const needsCategory = !rootId && p.status !== 'void' && !p.voids_payment_id;
                        const categorize = () => {
                          if (p.type === 'invoice') { setCategorizingInvoice(p); setCategorizingCategoryId((p.category_id as string) || ''); }
                          else setEditingPayment(p);
                        };
                        const editable = p.type !== 'invoice' && !isVoid && p.type !== 'salary' && p.type !== 'advance';
                        return (
                          <>
                            {needsCategory ? (
                              <button type="button" className="odoo-btn-secondary ds-btn-sm" title="Classer cette sortie dans une catégorie de charge" onClick={categorize}>Catégoriser</button>
                            ) : p.type === 'invoice' ? (
                              <button type="button" className="ds-icon-btn" aria-label="Catégoriser cette ligne" title="Catégoriser cette ligne" onClick={categorize}><Pencil size={15} /></button>
                            ) : editable ? (
                              <button type="button" className="ds-icon-btn" aria-label="Modifier la dépense" title="Modifier la catégorie ou la description" onClick={() => setEditingPayment(p)}><Pencil size={15} /></button>
                            ) : null}
                            {p.type !== 'invoice' && isVoid && <StatusTag tone="cancelled" label="Annulée" title={(p.void_note as string) || undefined} />}
                            {p.type !== 'invoice' && !isVoid && !editable && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }} title="Géré depuis RH → Paie / Avances">RH</span>}
                            {editable && <RowMenu items={[{ label: 'Annuler la dépense', icon: Ban, danger: true, onSelect: () => setVoidTarget(p) }]} />}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Total {periodLabel} ({displayed.length} opération{displayed.length > 1 ? 's' : ''})</td>
                <td className="ds-num">{n(displayedTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
      )}

      {/* Add expense modal */}
      {showForm && (
        <Modal title="Nouvelle dépense" onClose={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }} width={560} locked={createMutation.isPending}
          footer={<FormFooter onCancel={() => { setShowForm(false); setFormCategoryId(''); setFormPOId(''); }} busy={createMutation.isPending} disabled={isRhManagedCategory}
            onSubmit={() => (document.getElementById('charges-expense-form') as HTMLFormElement | null)?.requestSubmit()} />}>
            <form id="charges-expense-form" onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'expense';
              fd.categoryId = formCategoryId || undefined;
              fd.supplierId = expSupplierId || undefined;
              fd.employeeId = expEmployeeId || undefined;
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
            }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <FormSection title="Classement">
                <FormField label="Catégorie" required>
                  <CategoryCascadeSelector
                    value={formCategoryId}
                    onChange={(id) => { setFormCategoryId(id); setFormPOId(''); }}
                    type="expense"
                  />
                </FormField>

                {isRhManagedCategory && (
                  <Alert tone="warning" icon={AlertTriangle}>
                    Les salaires et avances ne se saisissent plus ici : utilisez <strong>Ressources Humaines → Paie</strong> (salaires)
                    ou <strong>→ Avances</strong> (avances, avec retenue automatique à la paie).
                    Une fois payés, ils apparaissent automatiquement dans cette liste.
                  </Alert>
                )}
                {showPOWaivedBanner && (
                  <Alert tone="info">
                    Cette catégorie demande normalement un bon de commande, mais la règle « BC requis avant dépense » est <strong>désactivée</strong> (paramètre des Achats). Tu peux saisir la dépense directement.
                  </Alert>
                )}
                {requiresPO && (
                  <FormField label={`Bon de commande (obligatoire au-delà de ${poRule?.threshold} ${poRule?.currency})`}
                    hint={selectedPO ? <>Fournisseur : <strong>{selectedPO.supplier_name as string}</strong> | Montant BC : <strong>{money(parseFloat(selectedPO.total_amount as string) || 0)}</strong></> : undefined}
                    error={(eligiblePOs as Record<string, any>[]).length === 0 ? 'Aucun bon de commande disponible. Créez d\'abord un BC dans l\'onglet Bons de commande.' : undefined}>
                    <SearchSelect
                      ariaLabel="Bon de commande"
                      placeholder="Sélectionner un BC..."
                      width="100%"
                      size="md"
                      value={formPOId}
                      onChange={setFormPOId}
                      options={(eligiblePOs as Record<string, any>[]).map(po => ({
                        id: po.id as string,
                        label: `${po.order_number as string} — ${po.supplier_name as string} — ${money(parseFloat(po.total_amount as string) || 0)}`,
                      }))}
                    />
                  </FormField>
                )}
              </FormSection>

              <FormSection title="Règlement">
                <div className="ds-form-grid">
                  <FormField label="Montant" htmlFor="exp-amount" required>
                    <input id="exp-amount" name="amount" type="number" step="0.01" disabled={isRhManagedCategory}
                      onChange={e => setExpAmount(parseFloat(e.target.value) || 0)}
                      className="ds-input" required
                      defaultValue={selectedPO ? parseFloat(selectedPO.total_amount as string) || '' : ''} key={formPOId} />
                  </FormField>
                  <FormField label="Date" htmlFor="exp-date" required>
                    <input id="exp-date" name="paymentDate" type="date" disabled={isRhManagedCategory}
                      className="ds-input" required value={expDate} onChange={e => setExpDate(e.target.value)} />
                  </FormField>
                  <FormField label="Mode de règlement">
                    <PaymentModeSelect value={expMode} onChange={setExpMode} />
                  </FormField>
                  {!(requiresPO && formPOId) && !isPersonnelExpense && (
                    <FormField label="Fournisseur">
                      <SearchSelect
                        ariaLabel="Fournisseur"
                        placeholder="Aucun"
                        width="100%"
                        size="md"
                        disabled={isRhManagedCategory}
                        value={expSupplierId}
                        onChange={setExpSupplierId}
                        options={(suppliers as Record<string, any>[]).filter(s => s.is_active).map(s => ({ id: s.id as string, label: s.name as string }))}
                      />
                    </FormField>
                  )}
                  {/* Categorie sous "Charges de personnel" : on affiche le selecteur Employe.
                      Le champ est obligatoire (un salaire/prime doit etre rattache a une ressource). */}
                  {!(requiresPO && formPOId) && isPersonnelExpense && (
                    <FormField label="Ressource / Employé" required>
                      <SearchSelect
                        ariaLabel="Ressource / Employé"
                        placeholder="Choisir un employé..."
                        width="100%"
                        size="md"
                        disabled={isRhManagedCategory}
                        value={expEmployeeId}
                        onChange={setExpEmployeeId}
                        options={(employees as Record<string, any>[])
                          .filter(emp => emp.is_active !== false)
                          .sort((a, b) => String(a.first_name || a.name || '').localeCompare(String(b.first_name || b.name || '')))
                          .map(emp => {
                            const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ')
                              || (emp.name as string) || (emp.email as string) || 'Sans nom';
                            const role = emp.role || emp.position;
                            return { id: emp.id as string, label: `${fullName}${role ? ` — ${role}` : ''}` };
                          })}
                      />
                    </FormField>
                  )}
                </div>

                {/* Mig 310 : chèque / effet → N° (suivi dans Chèques et Traites) ; virement → référence obligatoire. */}
                {(expLegacy === 'check' || expLegacy === 'traite') ? (
                  <div className="ds-form-grid">
                    <FormField label={`N° ${expLegacy === 'traite' ? 'd\'effet' : 'de chèque'}`} htmlFor="exp-check-number" required>
                      <input id="exp-check-number" name="checkNumber" required className="ds-input" />
                    </FormField>
                    <FormField label="Échéance" htmlFor="exp-check-date">
                      <input id="exp-check-date" name="checkDate" type="date" className="ds-input" />
                    </FormField>
                  </div>
                ) : expModeDef?.requires_reference ? (
                  <FormField label="Référence du virement" htmlFor="exp-ref" required>
                    <input id="exp-ref" name="reference" required placeholder="N° d'ordre ou référence bancaire" className="ds-input" />
                  </FormField>
                ) : null}
                <CashLimitGauge supplierId={(requiresPO && formPOId && selectedPO ? selectedPO.supplier_id as string : expSupplierId) || null}
                  date={expDate} amount={expAmount} modeCode={expMode} override={expOverride} onOverrideChange={setExpOverride} />
              </FormSection>

              <FormField label="Description" htmlFor="exp-desc">
                <textarea id="exp-desc" name="description" rows={2} disabled={isRhManagedCategory} className="ds-input" />
              </FormField>
            </form>
        </Modal>
      )}

      {/* Edit expense modal */}
      {editingPayment && (
        <Modal title="Modifier la dépense" onClose={() => setEditingPayment(null)} width={560} locked={updateMutation.isPending}
          footer={<FormFooter onCancel={() => setEditingPayment(null)} busy={updateMutation.isPending}
            onSubmit={() => (document.getElementById('charges-edit-form') as HTMLFormElement | null)?.requestSubmit()} />}>
            <form id="charges-edit-form" onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              // Mig 310 : seuls catégorie et description se modifient ; montant, date et mode
              // d'un paiement exécuté sont figés (annuler avec motif puis ressaisir).
              updateMutation.mutate({ id: editingPayment.id as string, data: {
                categoryId: editCategoryId || null, description: fd.description ?? '',
              } });
            }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Alert tone="info" icon={Lock}>
                <span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 2 }}>
                  <span>Montant</span><strong className="ds-num" style={{ textAlign: 'right' }}>{money(parseFloat(editingPayment.amount as string) || 0)}</strong>
                  <span>Date</span><span style={{ textAlign: 'right' }}>{fmtPaymentDate(editingPayment.payment_date, 'fr')}</span>
                  <span>Mode</span><span style={{ textAlign: 'right' }}>{editingPayment.payment_mode ? paymentModeLabel(editingPayment, payModes) : getPaymentLabel(editingPayment.payment_method as string)}</span>
                </span>
                <span style={{ display: 'block', marginTop: 6 }}>Montant, date et mode ne se modifient plus : annulez la dépense avec un motif puis ressaisissez-la.</span>
              </Alert>

              <FormField label="Catégorie"
                hint={editingPayment.category_id && !editCategoryId ? <>Catégorie actuelle : <strong>{getCategoryPath(String(editingPayment.category_id))}</strong></> : undefined}>
                <CategoryCascadeSelector
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  type="expense"
                />
              </FormField>

              <FormField label="Description" htmlFor="edit-exp-desc">
                <textarea id="edit-exp-desc" name="description" rows={2} className="ds-input"
                  defaultValue={editingPayment.description as string || ''} />
              </FormField>
            </form>
        </Modal>
      )}

      {voidTarget && (
        <ReasonCodeDialog title={`Annuler la dépense de ${money(parseFloat(voidTarget.amount as string))}`} scope="void_payment"
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
        <Modal title="Catégoriser la ligne" subtitle={`${(categorizingInvoice.invoice_number as string) || '—'} · ${(categorizingInvoice.supplier_name as string) || ''}`}
          onClose={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }} width={560} locked={updateInvoiceCategoryMutation.isPending}
          footer={<FormFooter onCancel={() => { setCategorizingInvoice(null); setCategorizingCategoryId(''); }} busy={updateInvoiceCategoryMutation.isPending}
            onSubmit={() => (document.getElementById('charges-categorize-form') as HTMLFormElement | null)?.requestSubmit()} />}>
            <form id="charges-categorize-form" onSubmit={e => {
              e.preventDefault();
              if (!categorizingCategoryId) { notify.error('Sélectionnez une catégorie'); return; }
              updateInvoiceCategoryMutation.mutate({
                id: categorizingInvoice.id as string,
                source: (categorizingInvoice.line_source as string) || 'invoice_item',
                categoryId: categorizingCategoryId,
              });
            }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Alert tone="warning">
                Cette catégorie s&apos;applique <strong>uniquement à cette ligne</strong>. Les autres lignes de la facture / du bon de commande ne sont pas modifiées.
              </Alert>
              <FormField label="Catégorie" required
                hint={categorizingInvoice.category_id ? <>Catégorie actuelle : <strong>{getCategoryPath(String(categorizingInvoice.category_id))}</strong></> : undefined}>
                <CategoryCascadeSelector
                  value={categorizingCategoryId}
                  onChange={setCategorizingCategoryId}
                  type="expense"
                />
              </FormField>
            </form>
        </Modal>
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

/** Statut d'un chèque : étiquette commune (couleur + libellé). */
function CheckStatusDot({ status }: { status: 'pending' | 'overdue' | 'cashed' }) {
  return status === 'cashed' ? <StatusTag tone="done" label="Encaissé" />
    : status === 'overdue' ? <StatusTag tone="late" label="Échu" />
    : <StatusTag tone="todo" label="À encaisser" />;
}

function ChequesTab() {
  const confirm = useConfirm();
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
  const { data: checks = [], isLoading, isError, error, refetch } = useQuery({
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
      notify.success('Encaissement annulé (chèque à nouveau en attente)');
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
      {breakdown.overdueCount > 0 && view === 'open' && dueWindow !== 'overdue' && (
        <StatusBanner tone="danger" icon={AlertTriangle}
          title={`${breakdown.overdueCount} chèque${breakdown.overdueCount > 1 ? 's' : ''} échu${breakdown.overdueCount > 1 ? 's' : ''} : ${money(breakdown.overdue)}`}
          actions={<button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setDueWindow('overdue')}>Les afficher</button>}>
          Ils peuvent être présentés à la banque à tout moment : prévoyez la trésorerie, et marquez-les encaissés dès qu'ils sont débités.
        </StatusBanner>
      )}

      {/* Pipeline d'encaissement : fenêtres d'échéance des chèques émis, puis encaissés (historique) */}
      <StagePipeline
        title="Où en sont mes chèques et traites"
        summary={`${money(counts.totalPending)} à encaisser${breakdown.overdue > 0 ? ` · dont ${money(breakdown.overdue)} échus` : ''}`}
        stages={CHECK_STAGES}
        stats={{
          overdue: { count: breakdown.overdueCount, sub: `${money(breakdown.overdue)}`, late: breakdown.overdueCount, alertLabel: 'présentables à tout moment' },
          next7d: { count: breakdown.next7dCount, sub: `${money(breakdown.next7d)}` },
          next30d: { count: breakdown.next30dCount, sub: `${money(breakdown.next30d)}` },
          later: { count: breakdown.laterCount, sub: `${money(breakdown.later)}` },
          cashed: { count: counts.cashed, sub: `${money(counts.totalCashed)}` },
        }}
        isActive={k => (k === 'cashed' ? view === 'history' : view === 'open' && dueWindow === k)}
        onPick={k => {
          if (k === 'cashed') { switchView('history'); return; }
          switchView('open');
          setDueWindow(dueWindow === k ? 'all' : (k as 'overdue' | 'next7d' | 'next30d' | 'later'));
        }}
      />

      {/* Barre d'outils : recherche, filtres, puis bascule « à encaisser / encaissés » à droite */}
      <Toolbar>
        <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Rechercher (bénéficiaire, n° de chèque, facture, BC, notes…)" label="Rechercher un chèque" />
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
        {view === 'open' && dueWindow !== 'all' && (
          <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => setDueWindow('all')} title="Retirer le filtre d'échéance">
            Échéance : {CHECK_STAGES.find(s => s.key === dueWindow)?.label} <X size={12} aria-hidden="true" />
          </button>
        )}
        {(hasActiveFilters || searchTerm) && (
          <button type="button" onClick={() => { resetFilters(); setSearchTerm(''); }} className="ds-btn-ghost ds-btn-sm">
            <X size={12} aria-hidden="true" /> Effacer les filtres
          </button>
        )}
        <Segmented label="Période" value={view} onChange={switchView}
          options={[{ key: 'open', label: 'À encaisser', count: counts.pending }, { key: 'history', label: 'Encaissés', count: counts.cashed }]} />
      </Toolbar>

      {/* Tableau */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        (hasActiveFilters || searchTerm)
          ? <NoResultState text="Aucun chèque ne correspond aux filtres." onReset={() => { resetFilters(); setSearchTerm(''); }} />
          : <EmptyState icon={Receipt} title={statusFilter === 'pending' ? 'Aucun chèque en attente d\'encaissement' : statusFilter === 'cashed' ? 'Aucun chèque encaissé' : 'Aucun chèque émis'}
              text="Les chèques et traites émis en règlement apparaissent ici jusqu'à leur débit en banque." />
      ) : (
        <DataPanel label="Chèques et traites" footer={
          <TableFooter page={page} pageSize={PAGE_SIZE} total={groups.length} onPage={setPage}
            note={`chèque${groups.length > 1 ? 's' : ''} · ${money(groups.reduce((s, g) => s + g.totalAmount, 0))} · ${view === 'open' ? 'émis, pas encore débités' : `encaissés · ${periodLabel(period, customFrom, customTo)}`}`} />
        }>
          <table className="odoo-table ds-dense" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>N° de chèque</th>
                <th><button type="button" className="ds-sort" onClick={() => { if (sortBy === 'supplier') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('supplier'); setSortDir('asc'); } }}>
                  Bénéficiaire {sortBy === 'supplier' && (sortDir === 'asc' ? '▲' : '▼')}
                </button></th>
                <th>Contexte</th>
                <th style={{ width: 110 }}><button type="button" className="ds-sort" onClick={() => { if (sortBy === 'emission') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('emission'); setSortDir('desc'); } }}>
                  Date d'émission {sortBy === 'emission' && (sortDir === 'asc' ? '▲' : '▼')}
                </button></th>
                <th style={{ width: 110 }}><button type="button" className="ds-sort" onClick={() => { if (sortBy === 'echeance') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('echeance'); setSortDir('asc'); } }}>
                  Échéance {sortBy === 'echeance' && (sortDir === 'asc' ? '▲' : '▼')}
                </button></th>
                <th style={{ width: 110 }}>Encaissé le</th>
                <th className="ds-num" style={{ width: 130 }}><button type="button" className="ds-sort" onClick={() => { if (sortBy === 'amount') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy('amount'); setSortDir('desc'); } }}>
                  Montant ({currencySymbol()}) {sortBy === 'amount' && (sortDir === 'asc' ? '▲' : '▼')}
                </button></th>
                <th style={{ width: 130 }}>Statut</th>
                <th className="ds-actions" style={{ width: 190 }}><span className="ds-sr-only">Actions</span></th>
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
                    <td className="ds-ref">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {multi && (isExpanded ? <ChevronDown size={13} style={{ color: 'var(--ds-accent)' }} /> : <ChevronRight size={13} style={{ color: 'var(--ds-accent)' }} />)}
                        {c.check_number || <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                      </span>
                    </td>
                    <td>
                      <div className="ds-strong">{beneficiaire(c)}</div>
                      {c.payment_type && (
                        <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                          {c.payment_type === 'invoice' ? 'Facture' : c.payment_type === 'salary' ? 'Salaire' : c.payment_type === 'expense' ? 'Dépense' : c.payment_type}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '12px' }}>
                      {multi ? (
                        <div>
                          <strong>{g.rows.length} factures</strong>
                          <span style={{ color: 'var(--ds-muted)' }}> — {isExpanded ? 'replier' : 'cliquer pour lister'}</span>
                        </div>
                      ) : (
                        <>
                          {c.invoice_number && (
                            <div>
                              Facture <strong className="ds-ref">{c.invoice_number}</strong>
                              {c.invoice_total && <span style={{ color: 'var(--ds-muted)' }}> ({money(parseFloat(c.invoice_total))})</span>}
                            </div>
                          )}
                          {c.purchase_order_number && (
                            <div style={{ color: 'var(--ds-muted)' }}>
                              BC <strong className="ds-ref">{c.purchase_order_number}</strong>
                            </div>
                          )}
                          {!c.invoice_number && !c.purchase_order_number && (c.description || c.category_name) && (
                            <div style={{ color: 'var(--ds-muted)' }}>{c.description || c.category_name}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>{fmtDate(emissionDate)}</td>
                    <td>
                      {fmtDate(dueDate)}
                      {isOverdue && (
                        <div style={{ fontSize: '12px', color: 'var(--ds-danger)', fontWeight: 600 }}>en retard</div>
                      )}
                    </td>
                    <td>
                      {isCashed && lastCashed ? (
                        <div>
                          {fmtDate(lastCashed)}
                          {c.cashed_by_name && (
                            <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>
                              par {c.cashed_by_name}
                            </div>
                          )}
                        </div>
                      ) : g.anyCashed ? (
                        <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>partiel</span>
                      ) : (
                        <span style={{ color: 'var(--ds-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="ds-num ds-strong">
                      {n(g.totalAmount)}
                    </td>
                    <td><CheckStatusDot status={isCashed ? 'cashed' : isOverdue ? 'overdue' : 'pending'} /></td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      {!isCashed && (
                        <button type="button" onClick={() => setConfirmingGroup(g)} className="odoo-btn-secondary ds-btn-sm"
                          title="Le chèque a été débité du compte : enregistrer l'encaissement">
                          Marquer encaissé
                        </button>
                      )}
                      {/* Annulation motivée (mig 310) : uniquement au niveau paiement. Pour un chèque
                          multi-factures, déplier la ligne et annuler la facture concernée. */}
                      <RowMenu label={`Actions sur le chèque ${c.check_number || ''}`} items={[
                        ...(isCashed ? [{ label: 'Annuler l\'encaissement', icon: RotateCcw, danger: true, disabled: unmarkMutation.isPending, onSelect: async () => {
                          const msg = multi
                            ? `Annuler la confirmation d'encaissement ? Les ${g.rows.length} paiements du chèque repasseront en attente et seront retirés des charges.`
                            : 'Annuler la confirmation d\'encaissement ? Le chèque repassera en attente et sera retiré des charges.';
                          if (await confirm(msg, { title: 'Annuler l\'encaissement', danger: true, confirmLabel: 'Annuler l\'encaissement', cancelLabel: 'Retour' })) unmarkMutation.mutate(g.rows.map(r => r.id));
                        } }] : []),
                        ...(!multi ? [{ label: c.cashed_at ? 'Annuler ce paiement (annulez d\'abord l\'encaissement)' : 'Annuler ce paiement', icon: Ban, danger: true,
                          disabled: deleteMutation.isPending || !!c.cashed_at,
                          onSelect: () => setVoidCheck({ id: c.id, amount: c.amount,
                            label: c.invoice_number ? `facture ${c.invoice_number}` : c.purchase_order_number ? `BC ${c.purchase_order_number}` : (c.supplier_name || c.employee_name || 'paiement') }) }] : []),
                      ]} />
                    </td>
                  </tr>
                  {/* Sous-lignes : une par facture reglee par ce cheque */}
                  {isExpanded && g.rows.map(r => (
                    <tr key={r.id} style={{ background: 'var(--ds-bg)' }}>
                      <td />
                      <td style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>└ Facture</td>
                      <td style={{ fontSize: '12px' }}>
                        {r.invoice_number ? (
                          <div>
                            Facture <strong className="ds-ref">{r.invoice_number}</strong>
                            {r.invoice_total && <span style={{ color: 'var(--ds-muted)' }}> ({money(parseFloat(r.invoice_total))})</span>}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--ds-muted)' }}>{r.description || r.purchase_order_number || '—'}</span>
                        )}
                        {r.purchase_order_number && r.invoice_number && (
                          <div style={{ color: 'var(--ds-muted)' }}>
                            BC <strong className="ds-ref">{r.purchase_order_number}</strong>
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '12px' }}>{fmtDate(r.payment_date)}</td>
                      <td style={{ fontSize: '12px' }}>{fmtDate(r.check_date || r.invoice_due_date)}</td>
                      <td style={{ fontSize: '12px' }}>
                        {r.cashed_at ? fmtDate(r.cashed_at) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                      </td>
                      <td className="ds-num" style={{ fontSize: '12px' }}>
                        {n(parseFloat(r.amount) || 0)}
                      </td>
                      <td><CheckStatusDot status={r.status === 'cashed' ? 'cashed' : r.status === 'overdue' ? 'overdue' : 'pending'} /></td>
                      <td className="ds-actions">
                        <button type="button" onClick={() => setVoidCheck({ id: r.id, amount: r.amount, label: `facture ${r.invoice_number || '—'} (chèque ${c.check_number || ''})` })}
                          disabled={deleteMutation.isPending || !!r.cashed_at}
                          className="ds-icon-btn" title="Annuler la part de ce chèque sur cette facture (motif obligatoire)"
                          aria-label={`Annuler la part du chèque sur la facture ${r.invoice_number || ''}`}
                          style={{ color: 'var(--ds-danger)' }}>
                          <Ban size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Total ({groups.length} chèque{groups.length > 1 ? 's' : ''})</td>
                <td className="ds-num">{n(groups.reduce((s, g) => s + g.totalAmount, 0))}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
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
        <ReasonCodeDialog title={`Annuler le paiement de ${money(parseFloat(voidCheck.amount))}`} scope="void_payment"
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
    <Modal title="Confirmer l'encaissement" subtitle={check.check_number || `${parseFloat(check.amount).toFixed(2)} ${currencySymbol()}`}
      onClose={onClose} width={480} locked={isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => onConfirm(cashedAt, note.trim() || undefined)} busy={isPending} disabled={!cashedAt} submitLabel="Confirmer" />}>
      <Alert tone="info">
        <span style={{ display: 'block' }}><strong>Bénéficiaire :</strong> {check.supplier_name || check.employee_name || '—'}</span>
        <span style={{ display: 'block' }}><strong>Montant :</strong> {money(parseFloat(check.amount))}</span>
        {invoices && invoices.length > 0 ? (
          <span style={{ display: 'block', marginTop: 6 }}>
            <strong>{invoices.length} factures réglées par ce chèque :</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
              {invoices.map((inv, i) => (
                <li key={i} className="ds-ref">
                  {inv.number || '—'} · {money(inv.amount)}
                </li>
              ))}
            </ul>
          </span>
        ) : (
          check.invoice_number && <span style={{ display: 'block' }}><strong>Facture :</strong> {check.invoice_number}</span>
        )}
        {check.invoice_due_date && (
          <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            Échéance prévue : {format(parseLocalDate(check.invoice_due_date.slice(0, 10)), 'dd/MM/yyyy')}
          </span>
        )}
      </Alert>
      <FormSection title="Encaissement">
        <FormField label="Date d'encaissement effective" htmlFor="cashed-at" required
          hint="Date du débit bancaire (relevé de compte). Sert de date de charge en trésorerie.">
          <input id="cashed-at" type="date" value={cashedAt} onChange={e => setCashedAt(e.target.value)} className="ds-input" />
        </FormField>
        <FormField label="Note (optionnel)" htmlFor="cashed-note">
          <textarea id="cashed-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Ex : vu sur relevé bancaire du 12/07" className="ds-input" />
        </FormField>
      </FormSection>
    </Modal>
  );
}


/* ═══════════════════════ RESUME TAB ═══════════════════════ */
/* Vue consolidee : entrees vs sorties avec resultat net */
function ResumeTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading, isError, error, refetch } = useQuery({
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
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary">
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
      </HeaderActions>

      {/* Indicateurs du mois */}
      <KpiGrid>
        <KpiCard label="Total entrées" value={<>{n(totals.totalEntrees)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>Caisse {n(totals.cashR)} · Carte {n(totals.cardR)}
            {totals.clientReceipts > 0 && ` · Règlements clients ${n(totals.clientReceipts)}`}
            {totals.entries - totals.clientReceipts > 0 && ` · Autres ${n(totals.entries - totals.clientReceipts)}`}</>} />
        <KpiCard label="Total sorties" value={<>{n(totals.exits)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub="Achats + Salaires + Dépenses" />
        <KpiCard label="Résultat net du mois" value={<>{totals.resultat >= 0 ? '+' : ''}{n(totals.resultat)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub="Entrées − Sorties" tone={totals.resultat >= 0 ? 'green' : 'red'} />
        <KpiCard label="Solde cumulé" value={<>{n(totals.solde)} <small style={{ fontSize: 13, color: 'var(--ds-muted)', fontWeight: 400 }}>{currencySymbol()}</small></>} sub={<>Cash {n(totals.cashNet)} · Carte {n(totals.cardCumul)}</>} tone={totals.solde >= 0 ? 'green' : 'red'} />
      </KpiGrid>

      <Toolbar>
        <MonthYearField month={month} year={year} onMonth={setMonth} onYear={setYear} />
      </Toolbar>

      {/* Daily grid */}
      {isLoading ? (
        <LoadingState label="Chargement du résumé…" />
      ) : isError ? (
        <ErrorState title="Le résumé n'a pas pu être chargé" error={error} onRetry={() => refetch()} />
      ) : (
        <DataPanel label="Résumé du mois" footer={<TableFooter note={`${MONTH_NAMES[month - 1]} ${year} · montants en ${currencySymbol()}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Date</th>
                <th className="ds-num">Ventes ({currencySymbol()})</th>
                <th className="ds-num">Entrées ({currencySymbol()})</th>
                <th className="ds-num">Sorties ({currencySymbol()})</th>
                <th className="ds-num">Espèces cumulées ({currencySymbol()})</th>
                <th className="ds-num">Carte cumulée ({currencySymbol()})</th>
                <th className="ds-num">Solde ({currencySymbol()})</th>
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
                    <td className="ds-num">{d.totalSales > 0 ? <span className="ds-strong">{n(d.totalSales)}</span> : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                    <td className="ds-num" style={{ color: dayEntrees > 0 ? undefined : 'var(--ds-muted)' }}>
                      {dayEntrees > 0 ? n(dayEntrees) : '—'}
                    </td>
                    <td className="ds-num" style={{ color: d.exits > 0 ? undefined : 'var(--ds-muted)' }}>
                      {d.exits > 0 ? n(d.exits) : '—'}
                    </td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(d.cashNetCumul)}</td>
                    <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{n(d.cardCumul)}</td>
                    <td className="ds-num ds-strong" style={{ color: d.solde >= 0 ? undefined : 'var(--ds-danger)' }}>{n(d.solde)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="ds-num">{n(totals.sales)}</td>
                <td className="ds-num">{n(totals.totalEntrees)}</td>
                <td className="ds-num">{n(totals.exits)}</td>
                <td className="ds-num">{n(totals.cashNet)}</td>
                <td className="ds-num">{n(totals.cardCumul)}</td>
                <td className="ds-num" style={{ color: totals.solde >= 0 ? undefined : 'var(--ds-danger)' }}>{n(totals.solde)}</td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
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
  return (
    <Modal title="Mouvement interne" onClose={onClose} width={520} locked={pending}
      footer={<FormFooter onCancel={onClose} busy={pending} disabled={!valid}
        onSubmit={() => (document.getElementById('internal-transfer-form') as HTMLFormElement | null)?.requestSubmit()} />}>
        <form id="internal-transfer-form" onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSubmit({ fromAccountId: fromId, toAccountId: toId, amount: Math.round(amt * 100) / 100, paymentDate: date,
            reference: reference.trim() || undefined, description: description.trim() || undefined });
        }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)' }}>
            Un versement d'espèces en banque n'est pas une dépense : il ne touche ni les charges ni le plafond espèces des fournisseurs.
          </p>
          <FormSection title="Comptes">
            <div className="ds-form-grid">
              <FormField label="De" required error={fromId === toId ? 'Choisissez deux comptes différents.' : undefined}>
                <SearchSelect value={fromId} onChange={setFromId} clearable={false}
                  placeholder="Compte source" width="100%" size="md" ariaLabel="Compte source"
                  options={accounts.map(a => ({ id: String(a.id), label: a.label as string }))} />
              </FormField>
              <FormField label="Vers" required>
                <SearchSelect value={toId} onChange={setToId} clearable={false}
                  placeholder="Compte destination" width="100%" size="md" ariaLabel="Compte destination"
                  options={accounts.map(a => ({ id: String(a.id), label: a.label as string }))} />
              </FormField>
            </div>
          </FormSection>
          <FormSection title="Mouvement">
            <div className="ds-form-grid">
              <FormField label="Montant" htmlFor="transfer-amount" required>
                <input id="transfer-amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} className="ds-input" required />
              </FormField>
              <FormField label="Date" htmlFor="transfer-date" required>
                <input id="transfer-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" required />
              </FormField>
            </div>
            <FormField label={refRequired ? 'Référence bancaire' : 'Référence (bordereau de versement)'} htmlFor="transfer-ref" required={refRequired}>
              <input id="transfer-ref" value={reference} onChange={e => setReference(e.target.value)} className="ds-input" />
            </FormField>
            <FormField label="Note" htmlFor="transfer-note">
              <input id="transfer-note" value={description} onChange={e => setDescription(e.target.value)} className="ds-input" placeholder="Optionnel" />
            </FormField>
          </FormSection>
        </form>
    </Modal>
  );
}
