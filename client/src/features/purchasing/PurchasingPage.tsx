import { useState, useMemo, useRef, useEffect, Fragment, type CSSProperties } from 'react';
import { useApprovalsCount } from '../../api/approvals.api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersApi, invoicesApi, paymentsApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { format, differenceInCalendarDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Truck, FileText, Banknote,
  X, Download, AlertTriangle, ChevronRight,
  ClipboardList, Receipt, Paperclip, Eye, Trash2, Upload,
  Loader2, Coins, Filter, ArrowUpDown, ArrowUp, ArrowDown,
  Clock, CheckCircle2, Scale, CalendarClock, Ban, Settings, FileQuestion, Ship, Award,
  Boxes, FilePlus2, PackageCheck, LayoutDashboard,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import PurchaseOrdersTab, { ReceptionForm } from '../accounting/PurchaseOrdersTab';
import { useSearchParams } from 'react-router-dom';
import { rfqApi } from '../../api/rfq.api';
import { DETAIL_PARAMS } from './purchasingNav';
import SuppliersTab from './SuppliersTab';
import PurchasingPilotageTab from './PurchasingPilotageTab';
import PurchasingWorkbench from './PurchasingWorkbench';
import '../projects/projects.css';
import './purchasing.css';
import '../sales/sales.css';
import RfqTab, { RfqPage } from './RfqTab';
import { PurHeaderSlot, PurHeaderActions } from './PurHeaderActions';
import { usePurLayout, LayoutSwitch, SplitView, KanbanView, PaneHead, PaneState, InvoiceStageTag, pdate, pmoney, pn, KANBAN_ALL } from './PurLayouts';
import { ListKpi } from '../sales/ListTemplate';
import LandedCostTab from './LandedCostTab';
import SupplierScoreTab from './SupplierScoreTab';
import ReceptionsTab from './ReceptionsTab';
import PriceVariancesTab from './PriceVariancesTab';
import PurchaseRequestsPage from './PurchaseRequestsPage';
import ApprovalsPage from '../approvals/ApprovalsPage';
import { ToOrderBoard } from '../stock/ToOrderBoard';
import InvoiceControlModal from '../../components/purchasing/InvoiceControlModal';
import ReasonCodeDialog from '../../components/purchasing/ReasonCodeDialog';
import { usePaymentModes, modeFromLegacy, PaymentModeSelect, CashLimitGauge, paymentModeLabel, PaymentStatusTag, ReissuePaymentDialog, type CashOverride } from '../../components/purchasing/PaymentModeFields';
import { apiErrorMessage } from '../../api/errors';
import { currenciesApi, BASE_CURRENCY } from '../../api/currencies.api';
import { ShieldAlert, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { useReferentiel } from '../../hooks/useReferentiel';
import { RotateCcw, FilePenLine } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { ModuleShell, useModuleView, MODULE_SECTIONS, type ModuleView } from '../../components/layout/ModuleShell';
import {
  Breadcrumb, PageHeader, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState,
  FormField, FormFooter, Alert, Modal, ErrorState,
} from '../../components/ds';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter, Pager, ProcessBoardVariant,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { money, currencySymbol } from '../../utils/money';

type PurchasingTab = 'suppliers' | 'purchase_orders' | 'invoices' | 'pilotage' | 'rfq' | 'landed' | 'scores'
  | 'identification' | 'purchase_requests' | 'reception' | 'approvals' | 'price_variances' | 'workbench';

/**
 * Étapes du processus d'une facture reçue (dérivées côté serveur, cf.
 * invoiceRepository._receivedStagedCte). « Annulée » sort du processus : Historique seulement.
 */
const INV_STAGES: StageDef[] = [
  { key: 'draft', label: 'Brouillon', hint: 'à compléter', icon: FilePenLine },
  { key: 'blocked', label: 'Bloquée / litige', hint: 'paiement suspendu', icon: ShieldAlert },
  { key: 'to_pay', label: 'À payer', hint: 'reste dû', icon: Clock },
  { key: 'partial', label: 'Partiellement réglée', hint: 'reste dû', icon: Coins },
  { key: 'paid', label: 'Réglée', hint: 'voir l\'historique', icon: CheckCircle2 },
];
const INV_OPEN_STAGES = ['draft', 'blocked', 'to_pay', 'partial'];
// Filtre par statut : les choix dépendent de la vue (une facture réglée n'est jamais « à traiter »).
const INV_VIEW_STATUSES: Record<'open' | 'history', Array<{ key: string; label: string }>> = {
  open: [
    { key: 'pending', label: 'Non réglée' },
    { key: 'partial', label: 'Partiellement réglée' },
    { key: 'late', label: 'Échéance dépassée' },
    { key: 'disputed', label: 'En litige' },
    { key: 'blocked', label: 'Paiement bloqué' },
    { key: 'to_check', label: 'À vérifier (écarts)' },
  ],
  history: [
    { key: 'paid', label: 'Réglée' },
    { key: 'cancelled', label: 'Annulée' },
  ],
};

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/**
 * Rubriques standard (ModuleShell). Le tableau de bord est le Pilotage (ce qui reste à
 * recevoir, à facturer, à vérifier) ; les fournisseurs sont le référentiel du module.
 * Approbations et réglages vivent ailleurs : entrées-liens.
 */
/** Description d'une ligne sous le titre de chaque rubrique (gabarit de page du Design System). */
const PAGE_LEADS: Record<string, string> = {
  identification: 'Ruptures, stocks sous le seuil et demandes des ateliers à transformer en demandes d\'achat.',
  purchase_requests: 'Besoins du stock et des ateliers, à approuver puis à mettre en concurrence auprès des fournisseurs.',
  rfq: 'Consultations des fournisseurs : devis reçus, comparatif et attribution.',
  approvals: 'Pièces qui attendent une décision avant de poursuivre le circuit d\'achat.',
  purchase_orders: 'Commandes passées aux fournisseurs, du brouillon jusqu\'à la facture.',
  reception: 'Livraisons attendues et bons de réception enregistrés.',
  invoices: 'Factures des fournisseurs, du contrôle jusqu\'au règlement.',
  landed: 'Transport, douane, assurance et manutention ajoutés au coût des articles reçus.',
  price_variances: 'Écarts entre prix commandé, prix reçu et prix facturé, à décider par le gérant.',
  pilotage: 'Rapprochement commande, réception et facture, ligne par ligne.',
  scores: 'Note de chaque fournisseur : délais, complétude, conformité, prix et litiges.',
  suppliers: 'Fiches, conditions et situation de chaque fournisseur.',
};

export default function PurchasingPage() {
  const approvalsCount = useApprovalsCount();
  const views: ModuleView<PurchasingTab | 'approvals' | 'settings'>[] = [
    // Mig 312 (D9) : reçu non facturé, facturé non reçu, engagements, par ligne de BC.
    // Poste de travail (refonte 2026-11) : circuit d'achat, actions à mener, montants à suivre.
    { key: 'workbench', label: 'Poste de travail', icon: LayoutDashboard, section: 'dashboard' },
    // ─── OPÉRATIONS : les 7 étapes du cycle procure-to-pay, dans l'ordre ───
    // 1 Identification = besoins à commander (ruptures + stock sous le seuil), via l'écran
    // « À commander » ; 2 Demande d'achat = demandes en attente. L'approbation des achats
    // (mig 465) vient APRÈS la demande de prix : on approuve l'engagement chiffré (devis
    // retenu / BC), pas un besoin estimé. D'où l'ordre : Demande de prix (3) → Approbation (4).
    { key: 'identification', label: 'À commander', icon: Boxes, section: 'operations' },
    { key: 'purchase_requests', label: 'Demandes d\'achat', icon: FilePlus2, section: 'operations' },
    // Appels d'offres (mig 360) : demande de prix à plusieurs fournisseurs, devis, comparatif, BC.
    { key: 'rfq', label: 'Demandes de prix', icon: FileQuestion, section: 'operations' },
    { key: 'approvals', label: 'Approbations', icon: ClipboardCheck, section: 'operations', badge: approvalsCount },
    { key: 'purchase_orders', label: 'Bons de commande', icon: ClipboardList, section: 'operations' },
    // Réception (étape 6) : liste des bons de réception ; la réception se complète dans le détail du BC.
    { key: 'reception', label: 'Réceptions', icon: PackageCheck, section: 'operations' },
    { key: 'invoices', label: 'Factures reçues', icon: FileText, section: 'operations' },
    // Frais d'approche (mig 361) : transport, douane répartis sur une réception, appliqués au coût.
    { key: 'landed', label: 'Frais d\'approche', icon: Ship, section: 'operations' },
    // Écarts de prix (lot L3 P2P) : décision du gérant sur les écarts de réception + simulation
    // de la réévaluation facture → stock / écart (IPV). Contrôle de gestion, gérant/admin.
    { key: 'price_variances', label: 'Écarts de prix', icon: ShieldAlert, section: 'operations' },
    // Évaluation des fournisseurs (mig 362) : note calculée délais / complétude / conformité / prix / litiges.
    // Ancien tableau de bord : le rapprochement commande / réception / facture, par ligne.
    { key: 'pilotage', label: 'Rapprochement', icon: Scale, section: 'reports' },
    { key: 'scores', label: 'Évaluation des fournisseurs', icon: Award, section: 'reports' },
    { key: 'suppliers', label: 'Fournisseurs', icon: Truck, section: 'setup' },
    { key: 'settings', label: 'Réglages des achats', icon: Settings, section: 'setup', href: '/settings?page=purchasing', external: true },
  ];
  // Onglet ouvrable par lien (?tab=purchase_orders), ex. depuis Stock › À commander après création des BC.
  const { current, select } = useModuleView(views);
  const tab = current?.key;
  const CurrentIcon = current?.icon;
  const sectionLabel = MODULE_SECTIONS.find(s => s.key === current?.section)?.label;
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  // Ouverture d'un onglet pré-filtré (fournisseur, recherche, vue) depuis Fournisseurs ou Pilotage.
  const [focus, setFocus] = useState<TabFocus>({});
  // Pages de détail ouvertes par l'URL (purchasingNav) : réception d'un BC, demande de prix.
  const [params, setParams] = useSearchParams();
  const receptionPoId = tab === 'reception' ? params.get('po') : null;
  const rfqId = tab === 'rfq' ? params.get('rfq') : null;
  const fromTab = params.get('from') as PurchasingTab | null;
  // Changer de rubrique referme la page de détail (les paramètres po / rfq / from sont retirés).
  const openTab = (next: PurchasingTab, f: TabFocus = {}) => {
    setFocus(f);
    if (!DETAIL_PARAMS.some(k => params.has(k))) { select(next); return; }
    const p = new URLSearchParams(params);
    DETAIL_PARAMS.forEach(k => p.delete(k));
    p.set('tab', next);
    setParams(p);
  };
  // Retour de la page de détail vers la rubrique d'où l'on vient (Annuler, après validation).
  const closeDetail = () => openTab(fromTab ?? (tab as PurchasingTab), focus);
  // Numéro de la pièce pour le fil d'Ariane (mêmes clés de cache que les pages : pas de second appel).
  const { data: receptionPo } = useQuery({
    queryKey: ['purchase-orders', receptionPoId],
    queryFn: () => purchaseOrdersApi.getById(receptionPoId!),
    enabled: !!receptionPoId,
  });
  const { data: rfqDoc } = useQuery({
    queryKey: ['rfq', rfqId],
    queryFn: () => rfqApi.get(rfqId!),
    enabled: !!rfqId,
  });
  const detailLabel = receptionPoId ? (receptionPo?.order_number ?? '…') : rfqId ? (rfqDoc?.number ?? '…') : null;

  return (
    <ModuleShell title="Achats" views={views} current={current} onSelect={k => openTab(k as PurchasingTab)} bar={false} flush look="apple">
      {/* En-tête « Achats / rubrique », même barre que les onglets Ventes (SalesPageShell). */}
      <div className="odoo-control-bar">
        {/* Fil d'Ariane à trois niveaux : module › rubrique › page (Design System). */}
        <Breadcrumb icon={CurrentIcon} items={detailLabel ? [
          // Page de détail : « Achats › Réceptions › n° du BC », « Achats › Demandes de prix › n° ».
          { label: 'Achats', onClick: () => openTab('workbench') },
          { label: current?.label, onClick: () => openTab(tab as PurchasingTab) },
          { label: detailLabel },
        ] : [
          { label: 'Achats', onClick: tab === 'workbench' ? undefined : () => openTab('workbench') },
          ...(sectionLabel ? [{ label: sectionLabel }] : []),
          { label: current?.label },
        ]} />
        <div style={{ flex: 1 }} />
        <div ref={setHeaderSlot} style={{ display: 'flex', gap: 8, alignItems: 'center' }} />
      </div>
      {/* Refonte 2026-11 : toutes les rubriques partagent le style cartes/panneaux (purchasing.css, .pur-module) ;
          les briques processus passent au gabarit Liste de la refonte Ventes (pastilles, bascule segmentée). */}
      <PurHeaderSlot.Provider value={headerSlot}>
      <ProcessBoardVariant.Provider value="chips">
      <div className="pur-module pur-head-body">
      {/* Style Apple (2026-11) : grand titre de la rubrique ; le Poste de travail pose le sien. */}
      {tab !== 'workbench' && !detailLabel && <PageHeader title={current?.label} description={tab ? PAGE_LEADS[tab] : undefined} />}
      {tab === 'suppliers' && (
        <SuppliersTab
          onOpenOrders={id => openTab('purchase_orders', { supplierId: id })}
          onOpenInvoices={id => openTab('invoices', { supplierId: id })}
        />
      )}
      {tab === 'identification' && <ToOrderBoard />}
      {tab === 'purchase_requests' && <PurchaseRequestsPage />}
      {tab === 'approvals' && <ApprovalsPage />}
      {tab === 'rfq' && (rfqId
        ? <RfqPage key={rfqId} id={rfqId} onBack={closeDetail} onOpenOrder={() => openTab('purchase_orders')} />
        : <RfqTab onOpenOrder={() => openTab('purchase_orders')} />)}
      {tab === 'purchase_orders' && <PurchaseOrdersTab initialSupplierId={focus.supplierId} />}
      {tab === 'reception' && (receptionPoId
        ? <ReceptionForm key={receptionPoId} poId={receptionPoId} onDone={closeDetail} onCancel={closeDetail} />
        : <ReceptionsTab />)}
      {tab === 'price_variances' && <PriceVariancesTab />}
      {tab === 'invoices' && <InvoicesTab {...focus} />}
      {tab === 'landed' && <LandedCostTab />}
      {tab === 'scores' && <SupplierScoreTab />}
      {tab === 'workbench' && <PurchasingWorkbench onOpenTab={k => openTab(k as PurchasingTab)} onOpenInvoice={f => openTab('invoices', f)} />}
      {tab === 'pilotage' && <PurchasingPilotageTab onOpenInvoice={(f) => openTab('invoices', f)} />}
      </div>
      </ProcessBoardVariant.Provider>
      </PurHeaderSlot.Provider>
    </ModuleShell>
  );
}

/* ═══════════════════════ SUPPLIERS TAB ═══════════════════════ */
// Déplacé dans ./SuppliersTab.tsx (refonte Achats D1, mig 304).

/* ═══════════════════════ INVOICES TAB (factures reçues only) ═══════════════════════ */
type TabFocus = { supplierId?: string; search?: string; view?: 'open' | 'history' };

const MUTED: CSSProperties = { color: 'var(--ds-muted)' };

function InvoicesTab({ supplierId, search, view }: TabFocus) {
  return <ReceivedInvoicesSection initialSupplierId={supplierId} initialSearch={search} initialView={view} />;
}

/* ═══ Factures reçues (fournisseurs) ═══ */

function ReceivedInvoicesSection({ initialSupplierId = '', initialSearch = '', initialView = 'open' }: {
  initialSupplierId?: string; initialSearch?: string; initialView?: 'open' | 'history';
}) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  // editInvoice = facture en cours de modification (null = creation, sinon edit)
  const [editInvoice, setEditInvoice] = useState<Record<string, any> | null>(null);
  // editLinesInvoiceId = ouvre le modal d'edition des lignes (qty x prix) d'une facture
  const [editLinesInvoiceId, setEditLinesInvoiceId] = useState<string | null>(null);
  // paymentsInvoiceId = ouvre le panneau "Voir et gerer les paiements" d'une facture
  // (consulter les paiements existants + supprimer un paiement erroné)
  const [paymentsInvoiceId, setPaymentsInvoiceId] = useState<string | null>(null);
  const [showPayForm, setShowPayForm] = useState<Record<string, any> | null>(null);
  // Le pied commun de la fenêtre de paiement soumet ce formulaire (validation native conservée).
  const payFormRef = useRef<HTMLFormElement>(null);
  // scheduleInvoice = facture a echelonner en N echeances (materiel a credit) — mig 258
  const [scheduleInvoice, setScheduleInvoice] = useState<Record<string, any> | null>(null);
  // Mig 310 : payMethod porte désormais le mode TYPÉ (cash, cheque_barre, effet, virement…) ;
  // payLegacy est la méthode héritée (check / traite…) qui pilote le bloc chèque/effet.
  const [payMethod, setPayMethod] = useState('cash');
  const [payDate, setPayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payOverride, setPayOverride] = useState<CashOverride>(null);
  const { byCode: payModeByCode } = usePaymentModes();
  const payModeDef = payModeByCode(payMethod);
  const payLegacy = payModeDef?.legacy_method ?? payMethod;
  const [payAmount, setPayAmount] = useState('');
  // Facture en devise (mig 368) : montant réglé en devise et taux du jour du paiement.
  const [payForeign, setPayForeign] = useState('');
  const [payRate, setPayRate] = useState('');
  const payCurrency = String(showPayForm?.currency_code ?? BASE_CURRENCY).trim();
  const payIsForeign = !!showPayForm && payCurrency !== BASE_CURRENCY;
  const { data: payCurrencies = [] } = useQuery({ queryKey: ['currencies', 'at', payDate, 'all'], queryFn: () => currenciesApi.list({ date: payDate, all: true }), enabled: payIsForeign }); // devise désactivée : ses factures restent payables
  useEffect(() => {
    if (!payIsForeign) return;
    const r = payCurrencies.find(c => c.code === payCurrency)?.rate;
    if (r) setPayRate(String(Number(r)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payIsForeign, payCurrency, payCurrencies]);
  const [payAvoir, setPayAvoir] = useState('');
  // Vue processus : « À traiter » (non réglées, filtrables par étape) ou « Historique »
  // (réglées / annulées, par période). Filtrage, tri et pagination côté serveur.
  const [view, setView] = useState<'open' | 'history'>(initialView);
  // Style Apple (2026-11) : Colonnes (liste + fiche) / Liste / Kanban, comme les Ventes.
  const [layout, setLayout] = usePurLayout();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [supplierFilter, setSupplierFilter] = useState(initialSupplierId);
  const [categoryFilter, setCategoryFilter] = useState('');
  // Période sur la date de facture : « Toutes » par défaut à traiter, 3 mois en historique.
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  // 'urgency' = retards puis échéance la plus proche (défaut « À traiter »).
  const [sortBy, setSortBy] = useState<string>(initialView === 'history' ? 'invoice_date' : 'urgency');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [view, stage, statusFilter, period, customFrom, customTo, searchTerm, supplierFilter, categoryFilter, sortBy, sortDir]);

  const boardParams = useMemo(() => {
    // Kanban : toutes les factures de la vue en une page (pas de pagination dans les colonnes).
    const kanban = layout === 'kanban';
    const p: Record<string, string> = { view, page: kanban ? '1' : String(page), pageSize: String(kanban ? KANBAN_ALL : PAGE_SIZE), sort: sortBy, dir: sortDir };
    if (view === 'open' && stage) p.stage = stage;
    if (statusFilter) p.status = statusFilter;
    if (searchTerm) p.search = searchTerm;
    if (supplierFilter) p.supplierId = supplierFilter;
    if (categoryFilter) p.categoryId = categoryFilter;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [view, stage, statusFilter, searchTerm, supplierFilter, categoryFilter, period, customFrom, customTo, page, sortBy, sortDir, layout]);

  const { data: board, isLoading, isFetching, error: boardError, refetch: refetchBoard } = useQuery({
    queryKey: ['invoices', 'received-board', boardParams],
    queryFn: () => invoicesApi.receivedBoard(boardParams),
    placeholderData: (prev) => prev,
  });
  const { data: pipeline } = useQuery({
    queryKey: ['invoices', 'received-pipeline'],
    queryFn: invoicesApi.receivedPipeline,
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => invoicesApi.create({ ...data, invoiceType: 'received' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture ajoutée'); setShowForm(false); },
    onError: () => notify.error('Erreur'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => invoicesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      notify.success('Facture modifiée');
      setEditInvoice(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la modification');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => invoicesApi.remove(id, { force }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      notify.success('Facture supprimée');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la suppression');
    },
  });

  // Annulation motivée (mig 309) ; contrôle (blocages, rapprochement) dans une fenêtre dédiée.
  const [cancelFor, setCancelFor] = useState<Record<string, any> | null>(null);
  const [controlFor, setControlFor] = useState<string | null>(null);
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: { reasonCodeId: string; note?: string } }) => invoicesApi.cancel(id, reason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture annulée'); setCancelFor(null); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });

  // Confrontation d'une pré-facture (lot L1 P2P) : saisir la pièce du fournisseur puis valider.
  const [validateFor, setValidateFor] = useState<Record<string, any> | null>(null);
  const validateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof invoicesApi.validate>[1] }) => invoicesApi.validate(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture validée'); setValidateFor(null); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Validation impossible')),
  });

  /**
   * Suppression d'un brouillon, en deux temps :
   * une première confirmation ; si des paiements sont liés, une seconde pour les
   * supprimer aussi (force=true). Sans paiement : suppression directe.
   */
  const confirm = useConfirm();
  async function handleDelete(inv: Record<string, any>) {
    const paid = parseFloat(inv.paid_amount as string || '0');
    const hasPayments = paid > 0;
    const ok = await confirm(
      `Supprimer définitivement la facture « ${inv.invoice_number} » de ${inv.supplier_name} ?\n\nCette action est irréversible.`,
      { title: 'Supprimer le brouillon', confirmLabel: 'Supprimer', danger: true },
    );
    if (!ok) return;
    if (hasPayments) {
      const force = await confirm(
        `Cette facture porte ${money(parseFloat(String(inv.paid_amount || '0')))} de paiements enregistrés.\n\n` +
        `Les supprimer aussi fait perdre leur traçabilité comptable. Pour la conserver, abandonnez et utilisez « Annuler la facture ».`,
        { title: 'Supprimer aussi les paiements ?', confirmLabel: 'Supprimer les paiements', cancelLabel: 'Abandonner', danger: true },
      );
      if (!force) return;
      deleteMutation.mutate({ id: inv.id as string, force: true });
    } else {
      deleteMutation.mutate({ id: inv.id as string, force: false });
    }
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => invoicesApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success('Statut mis à jour');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Erreur lors du changement de statut')),
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success('Paiement enregistré');
      setShowPayForm(null);
    },
    onError: (err: unknown) => {
      // Affiche le message precis du backend (sur-paiement, doublon de cheque, etc.)
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement du paiement');
    },
  });

  const attachMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => invoicesApi.uploadAttachment(id, file),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture jointe avec succès'); },
    onError: () => notify.error('Erreur lors de l\'envoi du fichier'),
  });

  const removeAttachMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.removeAttachment(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Pièce jointe supprimée'); },
  });

  const handleAttachFile = (invoiceId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.webp';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) attachMutation.mutate({ id: invoiceId, file });
    };
    input.click();
  };

  const rows = board?.rows ?? [];
  const total = board?.total ?? 0;

  const stageStats = useMemo(() => {
    const m: Record<string, { count: number; amount: number; remaining: number; late: number }> = {};
    for (const s of pipeline?.stages ?? []) {
      m[s.stage] = { count: s.count, amount: parseFloat(s.amount) || 0, remaining: parseFloat(s.remaining) || 0, late: s.late_count };
    }
    return m;
  }, [pipeline]);
  const openStats = INV_OPEN_STAGES.reduce(
    (acc, k) => ({ count: acc.count + (stageStats[k]?.count ?? 0), remaining: acc.remaining + (stageStats[k]?.remaining ?? 0) }),
    { count: 0, remaining: 0 },
  );
  const historyCount = (stageStats.paid?.count ?? 0) + (stageStats.cancelled?.count ?? 0);
  const lateList = pipeline?.late ?? [];

  const supplierOptions = useMemo(
    () => (suppliers as Record<string, any>[])
      .map(s => ({ id: s.id as string, label: s.name as string }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [suppliers],
  );
  const categoryOptions = useMemo(
    () => (pipeline?.categories ?? []).map(c => ({ id: c.id, label: c.name, detail: `${c.count}` })),
    [pipeline],
  );

  const defaultPeriod = (v: 'open' | 'history'): PeriodKey => (v === 'history' ? '3m' : 'all');
  const switchView = (next: 'open' | 'history') => {
    if (next === view) return;
    setView(next);
    setActiveId(null);
    setStage('');
    setStatusFilter('');
    if (period !== 'custom') setPeriod(defaultPeriod(next));
    setSortBy(next === 'history' ? 'invoice_date' : 'urgency');
    setSortDir('desc');
  };
  const pickStage = (key: string) => {
    if (key === 'paid') { switchView('history'); return; }
    switchView('open');
    setStage(stage === key ? '' : key);
  };
  const hasFilters = !!(statusFilter || searchTerm || supplierFilter || categoryFilter || period !== defaultPeriod(view));
  const resetFilters = () => {
    setStatusFilter(''); setSearchInput(''); setSearchTerm(''); setSupplierFilter(''); setCategoryFilter('');
    setPeriod(defaultPeriod(view)); setCustomFrom(''); setCustomTo('');
  };
  const periodText = periodLabel(period, customFrom, customTo);

  const openPay = (inv: Record<string, any>) => {
    setShowPayForm(inv);
    setPayMethod(modeFromLegacy((inv.expected_payment_mode as string) || 'cash'));
    setPayDate(format(new Date(), 'yyyy-MM-dd'));
    setPayOverride(null);
    setPayAmount((parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string)).toFixed(2));
    setPayAvoir('');
    setPayForeign(inv.foreign_total_amount != null
      ? (parseFloat(inv.foreign_total_amount as string) - parseFloat((inv.foreign_paid_amount as string) || '0')).toFixed(2) : '');
    setPayRate('');
  };

  /** Prochaine action du processus pour une facture à traiter (bouton principal de la ligne). */
  const nextAction = (inv: Record<string, any>): { label: string; run: () => void; cls: string } | null => {
    switch (inv.stage as string) {
      case 'draft':
        return { label: 'Valider', run: () => setValidateFor(inv), cls: 'odoo-btn-primary' };
      case 'blocked':
        return {
          label: inv.status === 'disputed' ? 'Voir le litige' : 'Lever le blocage',
          run: () => setControlFor(inv.id as string), cls: 'odoo-btn-secondary',
        };
      case 'to_pay':
      case 'partial':
        return { label: inv.stage === 'partial' ? 'Payer le reste' : 'Payer', run: () => openPay(inv), cls: inv.is_late ? 'odoo-btn-danger' : 'odoo-btn-primary' };
      default:
        return null;
    }
  };

  const daysTo = (d: string) => differenceInCalendarDays(new Date(d), new Date());

  /** Sous-titre d'étape d'une ligne. */
  const stageDetail = (inv: Record<string, any>): string => {
    const remaining = parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string);
    switch (inv.stage as string) {
      case 'draft': return 'brouillon non validé';
      case 'blocked': return inv.status === 'disputed'
        ? 'en litige'
        : `${inv.blocking_holds} blocage${Number(inv.blocking_holds) > 1 ? 's' : ''} de paiement`;
      case 'to_pay': {
        if (!inv.due_date) return 'sans échéance';
        const d = daysTo(inv.due_date as string);
        return d < 0 ? `échue depuis ${-d} j` : d === 0 ? 'échéance aujourd\'hui' : `échéance dans ${d} j`;
      }
      case 'partial': return `reste ${money(remaining)}`;
      case 'paid': return 'réglée';
      default: return 'annulée';
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir(field === 'invoice_date' || field === 'total_amount' ? 'desc' : 'asc');
    }
  };

  const sortIcon = (field: string) => {
    if (sortBy !== field) return <ArrowUpDown size={10} style={{ opacity: 0.3, marginLeft: 4, verticalAlign: 'middle' }} />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
      : <ArrowDown size={10} style={{ marginLeft: 4, verticalAlign: 'middle' }} />;
  };
  const sortableTh = (field: string, label: string, cls?: string) => (
    <th className={cls} onClick={() => toggleSort(field)} aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ cursor: 'pointer', userSelect: 'none' }}>
      {label} {sortIcon(field)}
    </th>
  );
  const colCount = 9;

  /**
   * Menu « ⋯ » d'une ligne : toutes les actions secondaires, avec leurs conditions
   * d'origine ; les actions destructrices en dernier. L'action du circuit reste un bouton visible.
   */
  const rowMenu = (inv: Record<string, any>): RowMenuItem[] => {
    const id = inv.id as string;
    const st = inv.stage as string;
    const paid = parseFloat(inv.paid_amount as string);
    const remaining = parseFloat(inv.total_amount as string) - paid;
    const url = inv.attachment_url as string;
    const disputed = inv.status === 'disputed';
    const items: RowMenuItem[] = [];
    if (url) items.push({ label: 'Voir la pièce jointe', icon: Eye, onSelect: () => { window.open(url, '_blank', 'noopener,noreferrer'); } });
    else items.push({ label: 'Joindre un fichier', icon: Upload, onSelect: () => handleAttachFile(id) });
    // Échelonner : matériel acheté à crédit → N échéances (Compta → Dettes → Échéancier).
    if (st !== 'paid' && st !== 'cancelled' && remaining > 0) {
      items.push({ label: 'Échelonner en plusieurs échéances', icon: CalendarClock, onSelect: () => setScheduleInvoice(inv) });
    }
    // Modifier : disponible même après paiement (ajustement comptable).
    items.push({ label: 'Modifier la facture', icon: Pencil, onSelect: () => setEditInvoice(inv) });
    items.push({ label: 'Éditer les lignes', icon: ClipboardList, onSelect: () => setEditLinesInvoiceId(id) });
    if (paid > 0) items.push({ label: 'Voir les paiements', icon: Coins, onSelect: () => setPaymentsInvoiceId(id) });
    items.push({ label: 'Contrôle de la facture', icon: Number(inv.blocking_holds) > 0 ? ShieldAlert : ShieldCheck, onSelect: () => setControlFor(id) });
    // Litige (mig 309) : seul statut posé à la main, le règlement découle des paiements.
    if (st !== 'cancelled') {
      items.push({
        label: disputed ? 'Lever le litige' : 'Mettre en litige', icon: Scale, disabled: statusMutation.isPending,
        onSelect: async () => {
          const next = disputed ? 'pending' : 'disputed';
          const verb = next === 'disputed' ? 'Mettre en litige' : 'Lever le litige de';
          if (await confirm(`${verb} la facture ${inv.invoice_number} ?`, { title: disputed ? 'Lever le litige' : 'Mettre en litige', confirmLabel: disputed ? 'Lever le litige' : 'Mettre en litige' })) {
            statusMutation.mutate({ id, status: next });
          }
        },
      });
    }
    if (url) {
      items.push({
        label: 'Supprimer la pièce jointe', icon: Trash2, danger: true,
        onSelect: async () => {
          if (await confirm(`Supprimer la pièce jointe de la facture ${inv.invoice_number} ?`, { title: 'Supprimer la pièce jointe', confirmLabel: 'Supprimer', danger: true })) {
            removeAttachMutation.mutate(id);
          }
        },
      });
    }
    if (st !== 'cancelled' && st !== 'paid') items.push({ label: 'Annuler la facture', icon: X, danger: true, onSelect: () => setCancelFor(inv) });
    // Suppression : brouillon seulement (mig 309) ; une facture validée s'annule avec un motif.
    if (inv.validation_status === 'draft') {
      items.push({ label: 'Supprimer le brouillon', icon: Trash2, danger: true, disabled: deleteMutation.isPending, onSelect: () => { void handleDelete(inv); } });
    }
    return items;
  };

  return (
    <>
      {controlFor && <InvoiceControlModal invoiceId={controlFor} onClose={() => setControlFor(null)} />}
      {cancelFor && (
        <ReasonCodeDialog
          title={`Annuler la facture · ${(cancelFor.supplier_invoice_number ?? cancelFor.invoice_number) as string}`}
          scope="cancel_invoice"
          description="La facture reste conservée comme pièce, marquée annulée ; son écriture comptable est extournée. Impossible si un règlement existe."
          confirmLabel="Annuler la facture"
          danger
          pending={cancelMutation.isPending}
          onClose={() => setCancelFor(null)}
          onSubmit={(reason) => cancelMutation.mutate({ id: cancelFor.id as string, reason })}
        />
      )}
      {validateFor && (
        <ValidateInvoiceModal
          invoice={validateFor}
          pending={validateMutation.isPending}
          onClose={() => setValidateFor(null)}
          onSubmit={(data) => validateMutation.mutate({ id: validateFor.id as string, data })}
        />
      )}
      {/* Échéances dépassées : seule alerte de l'écran, avec accès direct au paiement */}
      {lateList.length > 0 && (
        <StatusBanner
          tone="danger"
          icon={AlertTriangle}
          title={`${lateList.length >= 5 ? '5+' : lateList.length} facture${lateList.length > 1 ? 's' : ''} à échéance dépassée`}
        >
          {lateList.slice(0, 3).map((l, i) => (
            <span key={l.id}>
              {i > 0 && ' · '}
              <span className="ds-ref">{l.invoice_number}</span>
              {' '}{l.supplier_name} — {money(parseFloat(l.remaining))}, échue le {pdate(l.due_date)} ({l.days_late} j)
            </span>
          ))}
          {lateList.length > 3 && <span> · et d'autres en tête de liste</span>}
        </StatusBanner>
      )}

      {/* 1. Indicateurs : reste dû, bloqué, échu, réglé (montants que les pastilles ne donnent pas). */}
      {layout !== 'split' && <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Reste à payer" value={`${money(openStats.remaining)}`} sub={`${openStats.count} facture${openStats.count > 1 ? 's' : ''} à traiter`} />
        <ListKpi label="Bloqué / litige" value={`${money(stageStats.blocked?.remaining ?? 0)}`} sub={`${stageStats.blocked?.count ?? 0} paiement(s) suspendu(s)`}
          tone={(stageStats.blocked?.count ?? 0) > 0 ? 'orange' : undefined} />
        <ListKpi label="Échéance dépassée" value={String(lateList.length >= 5 ? '5+' : lateList.length)}
          sub={lateList.length ? `${money(lateList.reduce((a, l) => a + (parseFloat(l.remaining) || 0), 0))} en tête de liste` : 'aucune facture échue'}
          tone={lateList.length ? 'red' : undefined} />
        <ListKpi label="Réglé" value={`${money(stageStats.paid?.amount ?? 0)}`} sub={`${stageStats.paid?.count ?? 0} facture(s) soldée(s)`} />
      </section>}

      {/* 2. Circuit de la facture : une pastille par étape, clic = filtre */}
      <StagePipeline
        title="Où en sont mes factures"
        summary={`${openStats.count} facture${openStats.count > 1 ? 's' : ''} à traiter · ${money(openStats.remaining)} restant dus`}
        stages={INV_STAGES}
        stats={Object.fromEntries(INV_STAGES.map(s => {
          const st = stageStats[s.key];
          if (!st) return [s.key, undefined];
          const amount = s.key === 'paid' ? st.amount : st.remaining;
          return [s.key, { count: st.count, sub: `${money(amount)}`, late: st.late }];
        }))}
        isActive={k => (k === 'paid' ? view === 'history' : view === 'open' && stage === k)}
        onPick={pickStage}
      />

      {/* 3. Barre d'outils : recherche, filtres, puis les bascules à droite */}
      <Toolbar>
        <SearchBar value={searchInput} onChange={setSearchInput} placeholder="N° facture, fournisseur, BC ou catégorie…"
          label="Rechercher une facture" busy={isFetching && !isLoading} />
        <SelectFilter label="Statut" icon={Filter} value={statusFilter} onChange={setStatusFilter} options={INV_VIEW_STATUSES[view]} />
        <PeriodFilter label="Facturé" title="Filtre sur la date de facture"
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <div style={{ minWidth: 190 }}><SearchSelect options={supplierOptions} value={supplierFilter} onChange={setSupplierFilter} placeholder="Tous les fournisseurs" /></div>
        <div style={{ minWidth: 190 }}><SearchSelect options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} placeholder="Toutes les catégories" /></div>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="ds-btn-ghost ds-btn-sm">
            <X size={13} aria-hidden="true" /> Effacer
          </button>
        )}
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`À traiter · ${openStats.count}`} historyLabel={`Historique · ${historyCount}`} />
        <LayoutSwitch value={layout} onChange={setLayout} />
      </Toolbar>
      <PurHeaderActions>
        <button type="button" onClick={() => setShowForm(true)} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Nouvelle facture
        </button>
      </PurHeaderActions>

      {/* 4. Liste */}
      {isLoading ? (
        <LoadingState label="Chargement des factures…" />
      ) : boardError && !board ? (
        <ErrorState error={boardError} onRetry={() => { void refetchBoard(); }} />
      ) : rows.length === 0 ? (
        hasFilters ? (
          <NoResultState onReset={resetFilters} text="Aucune facture ne correspond aux filtres." />
        ) : (
          <EmptyState icon={FileText}
            title={view === 'open' ? (stage ? 'Aucune facture à cette étape' : 'Aucune facture à traiter') : 'Aucune facture sur cette période'}
            text={view === 'open'
              ? 'Les factures saisies ou créées à la réception apparaissent ici jusqu\'à leur règlement.'
              : 'Les factures réglées ou annulées apparaissent ici.'}
            action={view === 'open' && !stage
              ? <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setShowForm(true)}>Nouvelle facture</button>
              : undefined} />
        )
      ) : layout === 'split' ? (
        <>
          <SplitView items={rows} getId={inv => inv.id as string} activeId={activeId} onPick={setActiveId} label="Factures reçues"
            row={inv => {
              const st = inv.stage as string;
              return {
                title: String(inv.supplier_name ?? '—'), when: pdate(inv.invoice_date, 'd MMM'),
                l2: <><span className="sal-num">{inv.invoice_number as string}</span> · <b>{pmoney(inv.total_amount)}</b></>,
                l3: <><InvoiceStageTag stage={st} late={!!inv.is_late} label={st === 'cancelled' ? 'Annulée' : INV_STAGES.find(x => x.key === st)?.label ?? st} /> {stageDetail(inv)}</>,
                dot: inv.is_late ? 'late' : '',
              };
            }}
            pane={inv => (
              <ReceivedInvoicePane inv={inv} detail={stageDetail(inv)} action={view === 'open' ? nextAction(inv) : null}
                onControl={() => setControlFor(inv.id as string)} onEdit={() => setEditInvoice(inv)} onLines={() => setEditLinesInvoiceId(inv.id as string)}
                onPayments={pn(inv.paid_amount) > 0 ? () => setPaymentsInvoiceId(inv.id as string) : undefined}
                onAttach={() => handleAttachFile(inv.id as string)} />
            )} />
          <Pager page={page} total={total} onPage={setPage} note={`${total} facture${total > 1 ? 's' : ''}`} />
        </>
      ) : layout === 'kanban' ? (
        <>
          <KanbanView items={rows} getId={inv => inv.id as string} empty="Aucune facture"
            onOpen={inv => { setActiveId(inv.id as string); setLayout('split'); }}
            sum={cards => pmoney(cards.reduce((a, inv) => a + (view === 'history' ? pn(inv.total_amount) : pn(inv.total_amount) - pn(inv.paid_amount)), 0))}
            lanes={view === 'open' ? [
              { key: 'draft', label: 'Brouillons', tone: 'grey', match: inv => inv.stage === 'draft' },
              { key: 'blocked', label: 'Bloquées / litige', tone: 'red', match: inv => inv.stage === 'blocked' },
              { key: 'late', label: 'Échues', tone: 'red', match: inv => (inv.stage === 'to_pay' || inv.stage === 'partial') && !!inv.is_late },
              { key: 'to_pay', label: 'À payer', tone: 'orange', match: inv => inv.stage === 'to_pay' && !inv.is_late },
              { key: 'partial', label: 'Partiellement réglées', tone: 'blue', match: inv => inv.stage === 'partial' && !inv.is_late },
            ] : [
              { key: 'paid', label: 'Réglées', tone: 'green', match: inv => inv.stage === 'paid' },
              { key: 'cancelled', label: 'Annulées', tone: 'grey', match: inv => inv.stage === 'cancelled' },
            ]}
            card={inv => ({ num: String(inv.invoice_number), title: String(inv.supplier_name ?? '—'),
              meta: inv.due_date ? `échéance ${pdate(inv.due_date, 'd MMM')}` : pdate(inv.invoice_date, 'd MMM'),
              amount: pmoney(view === 'history' ? pn(inv.total_amount) : pn(inv.total_amount) - pn(inv.paid_amount)) })} />
          <p className="prj-note">{total > rows.length ? `${rows.length} factures affichées sur ${total} — affinez les filtres (période, fournisseur) pour voir les autres.` : `${total} facture${total > 1 ? 's' : ''}`}</p>
        </>
      ) : (
        <DataPanel label="Factures reçues" footer={
          <TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage}
            note={<>reste dû <strong>{money(board?.sumRemaining ?? 0)}</strong> · {view === 'open'
              ? 'Seules les factures non réglées sont chargées ici — les autres sont dans l\'Historique.'
              : `Réglées et annulées · ${periodText}`}</>} />
        }>
          <table className="odoo-table ds-dense" style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
            <thead>
              <tr>
                {sortableTh('invoice_number', 'N° de facture')}
                {sortableTh('supplier_name', 'Fournisseur')}
                <th>Commande</th>
                {sortableTh('invoice_date', 'Facturé le')}
                {sortableTh('due_date', 'Échéance')}
                <th>Étape</th>
                {sortableTh('total_amount', `Montant TTC (${currencySymbol()})`, 'ds-num')}
                <th className="ds-num">Reste dû ({currencySymbol()})</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv, i) => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                const hasAttachment = !!(inv.attachment_url as string);
                const invStage = inv.stage as string;
                const stageLabel = invStage === 'cancelled' ? 'Annulée' : INV_STAGES.find(s => s.key === invStage)?.label ?? invStage;
                const dueDateStr = inv.due_date as string | null;
                const expectedMode = (inv.expected_payment_mode as string) || '';
                const action = view === 'open' ? nextAction(inv) : null;
                const toCheck = Number(inv.open_holds) > Number(inv.blocking_holds);
                const late = !!inv.is_late;
                // Historique trié par date : un intertitre par mois.
                const month = inv.invoice_date ? format(new Date(inv.invoice_date as string), 'MMMM yyyy', { locale: fr }) : '';
                const prevMonth = i > 0 && rows[i - 1].invoice_date ? format(new Date(rows[i - 1].invoice_date as string), 'MMMM yyyy', { locale: fr }) : null;
                return (
                  <Fragment key={inv.id as string}>
                    {view === 'history' && sortBy === 'invoice_date' && month !== prevMonth && (
                      <tr className="ds-group">
                        <td colSpan={colCount}>{month.charAt(0).toUpperCase() + month.slice(1)}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="ds-ref">{inv.invoice_number as string}</span>
                        {hasAttachment && <Paperclip size={12} style={{ color: 'var(--ds-accent)', marginLeft: 6, verticalAlign: 'middle' }} aria-label="Pièce jointe" />}
                      </td>
                      <td className="ds-strong" title={inv.category_name ? `Catégorie : ${inv.category_name as string}` : undefined}>{inv.supplier_name as string}</td>
                      <td>{inv.purchase_order_number ? <span className="ds-ref">{inv.purchase_order_number as string}</span> : <span style={MUTED}>—</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{pdate(inv.invoice_date)}</td>
                      <td style={{ whiteSpace: 'nowrap', ...(late ? { color: 'var(--ds-danger)', fontWeight: 600 } : null) }}>
                        {dueDateStr ? pdate(dueDateStr) : !expectedMode && <span style={MUTED}>—</span>}
                        {expectedMode && <small style={{ ...MUTED, fontWeight: 400 }}>{dueDateStr ? ' · ' : ''}{getPaymentLabel(expectedMode)}</small>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <InvoiceStageTag stage={invStage} late={late} label={stageLabel} />
                        {invStage !== 'paid' && invStage !== 'cancelled' && (
                          <small style={{ marginLeft: 6, color: late ? 'var(--ds-danger)' : 'var(--ds-muted)' }}>{stageDetail(inv)}</small>
                        )}
                        {invStage !== 'cancelled' && toCheck && (
                          <button type="button" onClick={() => setControlFor(inv.id as string)}
                            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', marginLeft: 6 }}
                            title="Points à régulariser : voir le contrôle" aria-label="Points à régulariser : voir le contrôle">
                            <StatusTag tone="todo" label="À vérifier" />
                          </button>
                        )}
                      </td>
                      <td className="ds-num">
                        <span className="ds-strong">{n(total)}</span>
                        {inv.foreign_total_amount != null && String(inv.currency_code).trim() !== BASE_CURRENCY && (
                          <div style={{ ...MUTED, fontSize: 12 }}>{n(parseFloat(inv.foreign_total_amount as string))} {String(inv.currency_code).trim()}</div>
                        )}
                      </td>
                      <td className="ds-num" style={late && remaining > 0.005 ? { color: 'var(--ds-danger)', fontWeight: 600 } : undefined}>
                        {invStage !== 'cancelled' && remaining > 0.005 ? n(remaining) : <span style={MUTED}>—</span>}
                      </td>
                      <td className="ds-actions">
                        {action && (
                          <button type="button" onClick={action.run} className={`${late ? 'odoo-btn-primary' : 'odoo-btn-secondary'} ds-btn-sm`}>
                            {action.label}
                          </button>
                        )}
                        <RowMenu items={rowMenu(inv)} label={`Plus d'actions pour la facture ${inv.invoice_number as string}`} />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Total du filtre</td>
                <td className="ds-num">{n(board?.sumTotal ?? 0)}</td>
                <td className="ds-num">{(board?.sumRemaining ?? 0) > 0.005 ? n(board?.sumRemaining ?? 0) : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </DataPanel>
      )}

      {/* Create / Edit invoice modal — un seul composant, mode determine par editInvoice */}
      {(showForm || editInvoice) && (
        <ReceivedInvoiceFormModal
          invoice={editInvoice}
          suppliers={suppliers as Record<string, any>[]}
          onClose={() => { setShowForm(false); setEditInvoice(null); }}
          onSubmit={(data) => {
            if (editInvoice) {
              updateMutation.mutate({ id: editInvoice.id as string, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Edition lignes facture (qty x prix). Modal dedie : recalcul auto du total */}
      {editLinesInvoiceId && (
        <InvoiceLinesEditorModal
          invoiceId={editLinesInvoiceId}
          onClose={() => setEditLinesInvoiceId(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
            queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
            notify.success('Lignes de facture mises a jour');
            setEditLinesInvoiceId(null);
          }}
        />
      )}

      {/* Voir et gerer les paiements d'une facture (annuler un paiement errone) */}
      {paymentsInvoiceId && (
        <InvoicePaymentsModal
          invoiceId={paymentsInvoiceId}
          onClose={() => setPaymentsInvoiceId(null)}
        />
      )}

      {/* Echelonner une facture en N echeances (mig 258) */}
      {scheduleInvoice && (
        <InvoiceScheduleModal
          invoice={scheduleInvoice}
          onClose={() => setScheduleInvoice(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['payment-schedules'] });
            queryClient.invalidateQueries({ queryKey: ['invoice-debts'] });
            queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
            setScheduleInvoice(null);
          }}
        />
      )}

      {/* Pay invoice modal */}
      {showPayForm && (
        <Modal title="Payer la facture" subtitle={<span className="ds-ref">{showPayForm.invoice_number as string}</span>} width={480}
          onClose={() => setShowPayForm(null)} locked={payMutation.isPending}
          aside={<StatusTag tone="todo" label={`Reste ${payIsForeign
            ? `${n(parseFloat(showPayForm.foreign_total_amount as string) - parseFloat((showPayForm.foreign_paid_amount as string) || '0'))} ${payCurrency}`
            : `${money(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string))}`}`} />}
          footer={<FormFooter onCancel={() => setShowPayForm(null)} submitLabel="Payer" busy={payMutation.isPending} onSubmit={() => payFormRef.current?.requestSubmit()} />}>
            <form ref={payFormRef} onSubmit={e => {
              e.preventDefault();
              if (payMutation.isPending) return;
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'invoice';
              fd.invoiceId = showPayForm.id;
              fd.supplierId = showPayForm.supplier_id;
              fd.categoryId = showPayForm.category_id || undefined;
              fd.description = `Paiement facture ${showPayForm.invoice_number}`;
              fd.paymentMode = payMethod;
              fd.paymentMethod = payLegacy;
              if (payOverride) fd.cashOverride = payOverride;
              if (payIsForeign) {
                // Le serveur recalcule le DH (devise × taux) ; l'avoir déduit n'existe pas en devise.
                fd.foreignAmount = parseFloat(payForeign);
                fd.exchangeRate = parseFloat(payRate);
                fd.amount = Math.round(fd.foreignAmount * fd.exchangeRate * 100) / 100;
                fd.avoirAmount = undefined;
              }
              if (payLegacy !== 'check' && payLegacy !== 'traite') {
                fd.checkNumber = undefined; fd.checkDate = undefined; fd.avoirAmount = undefined;
              } else {
                const av = parseFloat(fd.avoirAmount as string) || 0;
                fd.avoirAmount = av > 0 ? Math.round(av * 100) / 100 : undefined;
              }
              payMutation.mutate(fd);
            }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {payIsForeign ? (() => {
                  const foreign = parseFloat(payForeign) || 0; const rate = parseFloat(payRate) || 0;
                  const invRate = parseFloat(showPayForm.exchange_rate as string) || 0;
                  const remainingF = parseFloat(showPayForm.foreign_total_amount as string) - parseFloat((showPayForm.foreign_paid_amount as string) || '0');
                  const remainingDh = parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string);
                  const dh = Math.round(foreign * rate * 100) / 100;
                  const settled = foreign >= remainingF - 0.005 ? Math.round(remainingDh * 100) / 100 : Math.round(foreign * invRate * 100) / 100;
                  const diff = Math.round((dh - settled) * 100) / 100;
                  return (<>
                    <div className="ds-form-grid">
                      <FormField label={`Montant réglé (${payCurrency})`} htmlFor="pay-foreign" required>
                        <input id="pay-foreign" type="number" step="0.01" min="0.01" max={remainingF.toFixed(2)} required value={payForeign} onChange={e => setPayForeign(e.target.value)}
                          className="ds-input" />
                      </FormField>
                      <FormField label={`Taux du jour : 1 ${payCurrency} = … ${currencySymbol()}`} htmlFor="pay-rate" required>
                        <input id="pay-rate" type="number" step="0.0001" min="0.0001" required value={payRate} onChange={e => setPayRate(e.target.value)}
                          className="ds-input" />
                      </FormField>
                    </div>
                    <input type="hidden" name="amount" value={dh.toFixed(2)} />
                    <div className="odoo-alert" style={{ fontSize: '0.75rem', display: 'grid', gap: 2 }}>
                      <span>Sortie de trésorerie : <strong>{money(dh)}</strong> ({n(foreign)} {payCurrency} × {rate || '—'})</span>
                      <span>Dette soldée au taux de la facture ({invRate}) : <strong>{money(settled)}</strong></span>
                      {rate > 0 && Math.abs(diff) >= 0.01 && <span style={{ color: diff > 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>
                        {diff > 0 ? 'Perte' : 'Gain'} de change : <strong>{money(Math.abs(diff))}</strong> ({diff > 0 ? '6331' : '7331'})</span>}
                    </div>
                  </>);
                })() : (
                  <FormField htmlFor="pay-amount" required
                    label={(payLegacy === 'check' || payLegacy === 'traite') && parseFloat(payAvoir) > 0
                      ? `Montant ${payLegacy === 'traite' ? 'de la traite' : 'du chèque'}` : 'Montant'}>
                    <input id="pay-amount" name="amount" type="number" step="0.01" className="ds-input" required
                      value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                  </FormField>
                )}
                <div className="ds-form-grid">
                  <FormField label="Mode de règlement" htmlFor="pay-mode" required>
                    <PaymentModeSelect id="pay-mode" value={payMethod} onChange={setPayMethod} />
                  </FormField>
                  <FormField label="Date" htmlFor="pay-date" required>
                    <input id="pay-date" name="paymentDate" type="date" className="ds-input" value={payDate} onChange={e => setPayDate(e.target.value)} required />
                  </FormField>
                </div>
                <CashLimitGauge supplierId={showPayForm.supplier_id as string} date={payDate}
                  amount={payIsForeign ? Math.round((parseFloat(payForeign) || 0) * (parseFloat(payRate) || 0) * 100) / 100 : (parseFloat(payAmount) || 0)} modeCode={payMethod} override={payOverride} onOverrideChange={setPayOverride} />
                {(payLegacy === 'check' || payLegacy === 'traite') && (
                  <div className="odoo-alert" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h3 className="ds-subhead">Détails {payLegacy === 'traite' ? 'de la traite' : 'du chèque'}</h3>
                    <div className="ds-form-grid">
                      <FormField label={`N° ${payLegacy === 'traite' ? 'de traite' : 'de chèque'}`} htmlFor="pay-check-number" required>
                        <input id="pay-check-number" name="checkNumber" defaultValue={(showPayForm.check_number as string) || ''}
                          className="ds-input" required />
                      </FormField>
                      <FormField label={`Date ${payLegacy === 'traite' ? 'de la traite' : 'du chèque'}`} htmlFor="pay-check-date">
                        <input id="pay-check-date" name="checkDate" type="date" className="ds-input" defaultValue={(showPayForm.due_date as string)?.slice(0, 10) || format(new Date(), 'yyyy-MM-dd')} />
                      </FormField>
                    </div>
                    {!payIsForeign && (
                      <FormField label={`Avoir fournisseur (${currencySymbol()})`} htmlFor="pay-avoir"
                        hint={parseFloat(payAvoir) > 0
                          ? `Avoir ${n(parseFloat(payAvoir))} + ${payLegacy === 'traite' ? 'traite' : 'chèque'} ${n(parseFloat(payAmount))} = ${money(parseFloat(payAvoir) + parseFloat(payAmount))}`
                          : 'Déduit de la dette sans sortie de trésorerie'}>
                        <input id="pay-avoir" name="avoirAmount" type="number" step="0.01" min="0" placeholder="0.00"
                          value={payAvoir} onChange={e => {
                            const av = parseFloat(e.target.value) || 0;
                            setPayAvoir(e.target.value);
                            const remaining = parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string);
                            setPayAmount(Math.max(0, remaining - av).toFixed(2));
                          }}
                          className="ds-input" />
                      </FormField>
                    )}
                  </div>
                )}
                {(() => {
                  // Virement : la référence bancaire est obligatoire (mig 310) ; chèque/effet : c'est le N° ci-dessus.
                  const refRequired = !!payModeDef?.requires_reference && payLegacy !== 'check' && payLegacy !== 'traite';
                  return (
                    <FormField label={refRequired ? 'Référence du virement' : 'Référence / notes'} htmlFor="pay-reference" required={refRequired}>
                      <input id="pay-reference" name="reference" required={refRequired} className="ds-input"
                        placeholder={refRequired ? 'N° d\'ordre ou référence bancaire' : 'Optionnel'} />
                    </FormField>
                  );
                })()}
            </form>
        </Modal>
      )}
    </>
  );
}

/* EmittedInvoicesSection moved to ../sales/EmittedInvoicesTab.tsx */

/**
 * Confrontation d'une pré-facture reçue (lot L1 P2P).
 *
 * La facture auto-créée depuis la réception est un BROUILLON : le comptable la
 * confronte au papier du fournisseur (son n°, son total TTC imprimé) avant de la
 * valider. Le serveur refuse la validation sans ces deux éléments (mig 436) et
 * pose alors les quantités « facturées » sur les lignes de BC.
 */
function ValidateInvoiceModal({ invoice, pending, onClose, onSubmit }: {
  invoice: Record<string, any>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (data: { supplierInvoiceNumber?: string | null; invoiceDate?: string | null; declaredTtc?: number | null }) => void;
}) {
  const [number, setNumber] = useState<string>((invoice.supplier_invoice_number as string) ?? '');
  const [date, setDate] = useState<string>(invoice.invoice_date ? String(invoice.invoice_date).slice(0, 10) : '');
  const [ttc, setTtc] = useState<string>(
    invoice.declared_ttc != null ? String(invoice.declared_ttc)
      : (invoice.total_amount != null ? String(invoice.total_amount) : ''),
  );
  const computed = parseFloat(invoice.total_amount as string) || 0;
  const declared = parseFloat(ttc) || 0;
  const diff = declared - computed;
  const canSubmit = number.trim().length > 0 && declared > 0 && !pending;
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Modal title="Valider la facture" subtitle={(invoice.supplier_name as string) ?? ''} width={460} onClose={onClose} locked={pending}
      footer={<FormFooter onCancel={onClose} submitLabel={pending ? 'Validation…' : 'Valider'} busy={pending} disabled={!canSubmit} onSubmit={() => formRef.current?.requestSubmit()} />}>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit({ supplierInvoiceNumber: number.trim(), invoiceDate: date || null, declaredTtc: declared }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 14, color: 'var(--ds-muted)', margin: 0 }}>
              Confrontez la pré-facture au papier du fournisseur : saisissez son numéro et le total TTC imprimé, puis validez.
            </p>
            <FormField label="N° de facture du fournisseur" htmlFor="val-number" required>
              <input id="val-number" value={number} onChange={e => setNumber(e.target.value)} className="ds-input" placeholder="ex. FA-2026-0142" required />
            </FormField>
            <div className="ds-form-grid">
              <FormField label="Date de facture" htmlFor="val-date">
                <input id="val-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" />
              </FormField>
              <FormField label={`Total TTC déclaré (${currencySymbol()})`} htmlFor="val-ttc" required>
                <input id="val-ttc" type="number" step="0.01" min="0" value={ttc} onChange={e => setTtc(e.target.value)} className="ds-input" required />
              </FormField>
            </div>
            {declared > 0 && Math.abs(diff) > 0.01 && (
              <Alert tone={diff > 0 ? 'danger' : 'warning'} icon={AlertTriangle}>
                Écart avec le total calculé ({money(computed)}) : {money(diff, { signed: true })}
              </Alert>
            )}
        </form>
    </Modal>
  );
}

/**
 * Modal de creation / modification d'une facture recue.
 *
 * Le calcul HT / TVA / TTC est synchronise live : si l'utilisateur edite HT ou
 * TVA, le TTC est recalcule ; s'il edite le TTC, la TVA est deduite (HT - TTC).
 * Cela couvre les 2 cas d'usage usuels :
 *   1. La facture du fournisseur affiche un HT et un TVA explicites
 *   2. La facture n'affiche que le TTC (cas frequent au Maroc pour les PME)
 */
function ReceivedInvoiceFormModal({
  invoice, suppliers, onClose, onSubmit, isPending,
}: {
  invoice: Record<string, any> | null;
  suppliers: Record<string, any>[];
  onClose: () => void;
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
}) {
  const isEdit = !!invoice;
  const { entries: paymentMethods } = useReferentiel('payment_methods');

  const [invoiceNumber, setInvoiceNumber] = useState<string>(invoice?.invoice_number as string || '');
  const [invoiceDate, setInvoiceDate] = useState<string>(
    invoice?.invoice_date ? String(invoice.invoice_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd')
  );
  const [supplierId, setSupplierId] = useState<string>(invoice?.supplier_id as string || '');
  const [categoryId, setCategoryId] = useState<string>(invoice?.category_id as string || '');
  const [amountHT, setAmountHT] = useState<string>(
    invoice?.amount !== undefined ? String(invoice.amount) : ''
  );
  const [taxAmount, setTaxAmount] = useState<string>(
    invoice?.tax_amount !== undefined ? String(invoice.tax_amount) : '0'
  );
  const [totalTTC, setTotalTTC] = useState<string>(
    invoice?.total_amount !== undefined ? String(invoice.total_amount) : ''
  );
  // Champ source de derniere edition : evite les boucles infinies dans le calcul live.
  // 'ht_tva' : on a edite HT ou TVA -> TTC est derive
  // 'ttc' : on a edite TTC -> TVA est derive (HT garde sa valeur)
  const [lastEdit, setLastEdit] = useState<'ht_tva' | 'ttc'>('ht_tva');
  // Taux TVA selectionne (Maroc : 0/7/10/14/20%). '' = mode manuel (montant libre).
  // Quand un taux est selectionne, TVA = HT * taux/100 et TTC suit automatiquement.
  // Detecte a l'initialisation si le ratio TVA/HT correspond a un taux usuel.
  const [vatRate, setVatRate] = useState<string>(() => {
    const ht = parseFloat(invoice?.amount as string) || 0;
    const tva = parseFloat(invoice?.tax_amount as string) || 0;
    if (ht <= 0) return '';
    if (tva === 0) return '0';
    const rate = (tva / ht) * 100;
    for (const r of [7, 10, 14, 20]) {
      if (Math.abs(rate - r) < 0.05) return String(r);
    }
    return '';
  });
  const [dueDate, setDueDate] = useState<string>(
    invoice?.due_date ? String(invoice.due_date).slice(0, 10) : ''
  );
  const [receptionDate, setReceptionDate] = useState<string>(
    invoice?.reception_date ? String(invoice.reception_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd')
  );
  const [expectedPaymentMode, setExpectedPaymentMode] = useState<string>(
    invoice?.expected_payment_mode as string || ''
  );
  // N° cheque saisi des la creation/edition facture quand mode = cheque.
  // Servira de pre-remplissage du payment.check_number au moment du paiement.
  const [checkNumber, setCheckNumber] = useState<string>(
    invoice?.check_number as string || ''
  );
  const [notes, setNotes] = useState<string>(invoice?.notes as string || '');
  // Fournisseur manquant à l'envoi : le message s'affiche sous le champ.
  const [supplierMissing, setSupplierMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Quand un taux TVA est selectionne, on derive le montant TVA depuis HT.
  // Le useEffect HT+TVA=TTC en aval s'occupera de mettre a jour le TTC.
  useEffect(() => {
    if (vatRate === '') return;
    const ht = parseFloat(amountHT) || 0;
    const rate = parseFloat(vatRate);
    const newTVA = (ht * rate / 100).toFixed(2);
    if (newTVA !== taxAmount) {
      setTaxAmount(newTVA);
      setLastEdit('ht_tva');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vatRate, amountHT]);

  // Recalcul live : HT + TVA = TTC OU TTC - HT = TVA
  useEffect(() => {
    const ht = parseFloat(amountHT) || 0;
    if (lastEdit === 'ht_tva') {
      const tva = parseFloat(taxAmount) || 0;
      const newTTC = (ht + tva).toFixed(2);
      if (newTTC !== totalTTC) setTotalTTC(newTTC);
    } else {
      const ttc = parseFloat(totalTTC) || 0;
      const newTVA = (ttc - ht).toFixed(2);
      if (newTVA !== taxAmount) setTaxAmount(newTVA);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountHT, taxAmount, totalTTC, lastEdit]);

  // Pour les editions, paid_amount sert de borne basse — le user ne peut pas
  // baisser le total en dessous de ce qui a deja ete encaisse.
  const paidAmount = parseFloat(invoice?.paid_amount as string || '0');
  const ttcNum = parseFloat(totalTTC) || 0;
  const ttcBelowPaid = isEdit && paidAmount > 0 && ttcNum < paidAmount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    if (!supplierId) { setSupplierMissing(true); notify.error('Fournisseur obligatoire'); return; }
    const data: Record<string, any> = {
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceDate,
      supplierId: supplierId || null,
      categoryId: categoryId || null,
      amount: parseFloat(amountHT) || 0,
      taxAmount: parseFloat(taxAmount) || 0,
      totalAmount: parseFloat(totalTTC) || 0,
      notes: notes.trim() || null,
    };
    if (dueDate) data.dueDate = dueDate; else data.dueDate = null;
    if (receptionDate) data.receptionDate = receptionDate; else data.receptionDate = null;
    if (expectedPaymentMode) data.expectedPaymentMode = expectedPaymentMode;
    else data.expectedPaymentMode = null;
    // N° effet : seulement pour les modes a encaisser (cheque/traite), sinon on
    // neutralise pour eviter les valeurs orphelines apres un changement de mode
    data.checkNumber = (expectedPaymentMode === 'check' || expectedPaymentMode === 'traite')
      ? (checkNumber.trim() || null) : null;
    onSubmit(data);
  };

  return (
    <Modal title={isEdit ? `Modifier la facture ${invoice?.invoice_number as string}` : 'Nouvelle facture fournisseur'} subtitle="Facture fournisseur"
      width={600} onClose={onClose} locked={isPending}
      footer={<FormFooter onCancel={onClose} submitLabel={isEdit ? 'Enregistrer' : 'Créer la facture'} busy={isPending} disabled={ttcBelowPaid} onSubmit={() => formRef.current?.requestSubmit()} />}>
        <form ref={formRef} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="ds-form-grid">
              <FormField label="N° de facture" htmlFor="inv-number" required>
                <input id="inv-number" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="ds-input" required />
              </FormField>
              <FormField label="Date de facture" htmlFor="inv-date" required>
                <input id="inv-date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="ds-input" required />
              </FormField>
            </div>
            <div className="ds-form-grid">
              <FormField label="Fournisseur" required error={supplierMissing && !supplierId ? 'Choisissez un fournisseur.' : undefined}>
                <SearchSelect value={supplierId} onChange={setSupplierId} placeholder="Choisir un fournisseur…"
                  width="100%" size="md" ariaLabel="Fournisseur"
                  options={suppliers.filter(s => s.is_active || s.id === supplierId).map(s => ({ id: s.id as string, label: s.name as string }))} />
              </FormField>
              <FormField label="Catégorie">
                <CategoryCascadeSelector value={categoryId} onChange={setCategoryId} type="expense" />
              </FormField>
            </div>
            {/* HT / TVA / TTC : ligne dediee avec live sync */}
            <div className="grid grid-cols-3 gap-3" style={{ padding: 12, background: 'var(--ds-bg)', borderRadius: 'var(--ds-r-field)', border: '1px solid var(--ds-hair)' }}>
              <FormField label={`Montant HT (${currencySymbol()})`} htmlFor="inv-ht" required>
                <input id="inv-ht" type="number" step="0.01" value={amountHT}
                  onChange={e => { setAmountHT(e.target.value); setLastEdit('ht_tva'); }}
                  className="ds-input" required />
              </FormField>
              <FormField label="TVA" htmlFor="inv-tva">
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={vatRate} onChange={e => setVatRate(e.target.value)}
                    title="Taux de TVA : applique HT × taux / 100" aria-label="Taux de TVA"
                    className="ds-input" style={{ width: 76, flexShrink: 0, padding: '0 6px' }}>
                    <option value="">—</option>
                    <option value="0">0%</option>
                    <option value="7">7%</option>
                    <option value="10">10%</option>
                    <option value="14">14%</option>
                    <option value="20">20%</option>
                  </select>
                  <input id="inv-tva" type="number" step="0.01" value={taxAmount}
                    onChange={e => { setTaxAmount(e.target.value); setLastEdit('ht_tva'); setVatRate(''); }}
                    className="ds-input" style={{ flex: 1, minWidth: 0 }} />
                </div>
              </FormField>
              <FormField label={`Montant TTC (${currencySymbol()})`} htmlFor="inv-ttc"
                error={ttcBelowPaid ? `Inférieur au montant déjà payé (${money(paidAmount)}) : ajustez avant d'enregistrer.` : undefined}>
                <input id="inv-ttc" type="number" step="0.01" value={totalTTC}
                  onChange={e => { setTotalTTC(e.target.value); setLastEdit('ttc'); }}
                  className="ds-input" style={{ fontWeight: 600 }} aria-invalid={ttcBelowPaid || undefined} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Échéance" htmlFor="inv-due">
                <input id="inv-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="ds-input" />
              </FormField>
              <FormField label="Date de réception" htmlFor="inv-reception">
                <input id="inv-reception" type="date" value={receptionDate} onChange={e => setReceptionDate(e.target.value)} className="ds-input" />
              </FormField>
              <FormField label="Règlement prévu" htmlFor="inv-mode">
                <select id="inv-mode" value={expectedPaymentMode} onChange={e => setExpectedPaymentMode(e.target.value)} className="ds-input">
                  <option value="">— Non défini —</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.code} value={pm.code}>{pm.label}</option>
                  ))}
                </select>
              </FormField>
            </div>
            {/* N° effet : affiche uniquement pour les modes a encaisser (cheque/traite).
                Pre-remplira automatiquement le payment.check_number au moment du reglement. */}
            {(expectedPaymentMode === 'check' || expectedPaymentMode === 'traite') && (
              <div style={{ padding: 12, background: 'var(--ds-warning-bg)', borderRadius: 'var(--ds-r-field)' }}>
                <FormField label={`N° ${expectedPaymentMode === 'traite' ? 'de traite' : 'de chèque'}`} htmlFor="inv-check"
                  hint="Sera pré-rempli au moment du paiement.">
                  <input id="inv-check" type="text" value={checkNumber} onChange={e => setCheckNumber(e.target.value)}
                    placeholder="Ex. 1234567" className="ds-input" />
                </FormField>
              </div>
            )}
            <FormField label="Notes" htmlFor="inv-notes">
              <textarea id="inv-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="ds-input" />
            </FormField>
            {isEdit && paidAmount > 0 && (
              <Alert tone="info">
                Déjà payé : {money(paidAmount)}. Le statut sera recalculé automatiquement après modification.
              </Alert>
            )}
        </form>
    </Modal>
  );
}

/**
 * Modal d'edition des lignes d'une facture (admin/gerant).
 *
 * Cas d'usage principal : corriger les qty/prix d'une facture auto-generee
 * depuis un bon de reception ou rattraper une saisie erronee. Le total HT
 * de la facture est recalcule automatiquement (cf. backend replaceItems).
 *
 * Approche bulk : on charge toutes les lignes, l'admin edite/ajoute/supprime,
 * on envoie le tout en un seul PUT /:id/items. Pas de save par ligne pour
 * eviter les half-states et reduire les surprises de recalcul.
 */
type InvoiceLine = {
  // ID DB (present si ligne existante), sinon undefined pour les nouvelles
  id?: string;
  // Ligne de BC d'origine (reprise depuis le BC lié) : le serveur garde aussi celle d'une ligne existante.
  purchaseOrderItemId?: string | null;
  ingredientId: string | null;
  description: string;
  quantity: string;  // en string pour permettre input vide
  unitPrice: string;
  // Taux TVA de la ligne en % ('' = pas de taux explicite -> fallback en-tete).
  tvaRate: string;
};

// Taux TVA usuels au Maroc. '' = pas de TVA explicite sur la ligne.
const TVA_RATES = ['0', '7', '10', '14', '20'];

/**
 * Echelonnement d'une facture recue (migration 258).
 *
 * Cas d'usage : four, frigo, vitrine achetes a credit — la facture existe, mais
 * elle se regle en N mensualites. On decoupe le RESTE A PAYER en N echeances
 * datees, qui apparaissent ensuite dans Comptabilite -> Dettes -> Echeancier.
 *
 * Le solde continue d'etre porte par la facture (paid_amount) : les echeances
 * sont un calendrier, pas une seconde dette. Regler une echeance cree un
 * paiement normal rattache a la facture.
 */
function InvoiceScheduleModal({ invoice, onClose, onSuccess }: {
  invoice: Record<string, any>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { entries: paymentMethods } = useReferentiel('payment_methods');
  const reste = (parseFloat(invoice.total_amount as string) || 0)
    - (parseFloat(invoice.paid_amount as string) || 0);

  const [installments, setInstallments] = useState('3');
  const [intervalMonths, setIntervalMonths] = useState('1');
  const [firstDueDate, setFirstDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mode, setMode] = useState((invoice.expected_payment_mode as string) || '');
  const formRef = useRef<HTMLFormElement>(null);

  // Apercu des echeances : meme repartition que le serveur (dernier terme ajuste).
  const nbEch = Math.max(1, Math.floor(parseFloat(installments) || 1));
  const pas = Math.max(1, Math.floor(parseFloat(intervalMonths) || 1));
  const apercu = useMemo(() => {
    const base = Math.floor((reste / nbEch) * 100) / 100;
    const dernier = Math.round((reste - base * (nbEch - 1)) * 100) / 100;
    const [y, m, d] = firstDueDate.split('-').map(Number);
    if (!y || !m || !d) return [];
    return Array.from({ length: nbEch }, (_, k) => {
      const cible = new Date(Date.UTC(y, m - 1 + k * pas, 1));
      const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
      const jour = Math.min(d, dernierJour);
      return {
        date: pdate(`${cible.getUTCFullYear()}-${String(cible.getUTCMonth() + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`),
        montant: k === nbEch - 1 ? dernier : base,
      };
    });
  }, [reste, nbEch, pas, firstDueDate]);

  const create = useMutation({
    mutationFn: () => invoicesApi.createSchedule(invoice.id as string, {
      installments: nbEch,
      firstDueDate,
      intervalMonths: pas,
      expectedPaymentMode: mode || null,
    }),
    onSuccess: () => { notify.success(`Échéancier créé : ${nbEch} échéance${nbEch > 1 ? 's' : ''}`); onSuccess(); },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la création de l\'échéancier');
    },
  });

  return (
    <Modal title="Échelonner la facture" width={480} onClose={onClose} locked={create.isPending}
      subtitle={<><span className="ds-ref">{invoice.invoice_number as string}</span> · {(invoice.supplier_name as string) || 'Fournisseur'}</>}
      aside={<StatusTag tone="todo" label={`Reste ${money(reste)}`} />}
      footer={<FormFooter onCancel={onClose} submitLabel={create.isPending ? 'Création…' : 'Créer l\'échéancier'} busy={create.isPending} onSubmit={() => formRef.current?.requestSubmit()} />}>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); if (!create.isPending) create.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="ds-form-grid">
              <FormField label="Nombre d'échéances" htmlFor="sch-count" required>
                <input id="sch-count" type="number" min="1" max="120" value={installments}
                  onChange={(e) => setInstallments(e.target.value)} className="ds-input" required />
              </FormField>
              <FormField label="Intervalle (mois)" htmlFor="sch-interval">
                <input id="sch-interval" type="number" min="1" max="12" value={intervalMonths}
                  onChange={(e) => setIntervalMonths(e.target.value)} className="ds-input" />
              </FormField>
            </div>
            <div className="ds-form-grid">
              <FormField label="Première échéance" htmlFor="sch-first" required>
                <input id="sch-first" type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)}
                  className="ds-input" required />
              </FormField>
              <FormField label="Règlement prévu" htmlFor="sch-mode">
                <select id="sch-mode" value={mode} onChange={(e) => setMode(e.target.value)} className="ds-input">
                  <option value="">Non précisé</option>
                  {paymentMethods.map((m: { code: string; label: string }) => (
                    <option key={m.code} value={m.code}>{m.label}</option>
                  ))}
                </select>
              </FormField>
            </div>
            {apercu.length > 0 && (
              <div>
                <h3 className="ds-subhead" style={{ marginBottom: 6 }}>Aperçu</h3>
                <DataPanel label="Aperçu de l'échéancier" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  <table className="odoo-table ds-dense">
                    <thead><tr><th>Échéance</th><th>Date</th><th className="ds-num">Montant ({currencySymbol()})</th></tr></thead>
                    <tbody>
                      {apercu.map((e, i) => (
                        <tr key={i}>
                          <td>Échéance {i + 1}</td>
                          <td>{e.date}</td>
                          <td className="ds-num ds-strong">{n(e.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataPanel>
              </div>
            )}
            <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
              Les échéances apparaîtront dans <strong>Comptabilité → Créances &amp; dettes → Échéancier</strong>.
              Le reste à payer de la facture ne change pas : l'échéancier n'est qu'un calendrier.
            </p>
        </form>
    </Modal>
  );
}

function InvoiceLinesEditorModal({
  invoiceId, onClose, onSuccess,
}: {
  invoiceId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => invoicesApi.getById(invoiceId),
  });
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: ingredientsApi.list,
  });
  // Taux de TVA en vigueur à la date de la facture (codes datés du pack pays, mig 309).
  const { data: taxCodes = [] } = useQuery<Array<{ code: string; label: string; rate: string }>>({
    queryKey: ['tax-codes', invoice?.invoice_date],
    queryFn: () => invoicesApi.taxCodes(invoice?.invoice_date ? String(invoice.invoice_date).slice(0, 10) : undefined),
    enabled: !!invoice,
  });
  const tvaRates = Array.from(new Set((taxCodes.length ? taxCodes.map(t => String(Number(t.rate))) : TVA_RATES))).sort((a, b) => Number(a) - Number(b));

  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [initialized, setInitialized] = useState(false);
  // Quand le nouveau total est < deja paye, l'utilisateur doit gerer les
  // paiements d'abord. Ce flag ouvre le modal Paiements par-dessus.
  const [showPayments, setShowPayments] = useState(false);

  // Initialise les lignes depuis la facture une seule fois (sinon on ecrase l'edition)
  useEffect(() => {
    if (initialized || !invoice) return;
    const items = (invoice.items as Record<string, any>[]) || [];
    setLines(items.map(it => ({
      id: it.id as string,
      ingredientId: (it.ingredient_id as string) || null,
      description: (it.description as string) || (it.ingredient_name as string) || '',
      quantity: String(it.quantity ?? ''),
      unitPrice: String(it.unit_price ?? ''),
      tvaRate: it.tva_rate !== null && it.tva_rate !== undefined ? String(parseFloat(it.tva_rate as string)) : '',
    })));
    setInitialized(true);
  }, [invoice, initialized]);

  const mutation = useMutation({
    mutationFn: (items: Array<{ id?: string; purchaseOrderItemId?: string | null; ingredientId: string | null; description: string | null; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null }>) =>
      invoicesApi.replaceItems(invoiceId, items),
    // La fiche en cache doit être relue : sinon une réouverture montre les anciennes lignes
    // et un second enregistrement écraserait la correction.
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] }); onSuccess(); },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la mise a jour des lignes');
    },
  });

  // Recalcul live des totaux. La TVA est ventilee par ligne quand au moins une
  // ligne porte un taux ; sinon on conserve la TVA globale d'en-tete (fallback).
  const { newTotal, perLineTva, hasAnyRate, tvaByRate } = useMemo(() => {
    let ht = 0;
    let tva = 0;
    let anyRate = false;
    const byRate = new Map<string, number>();
    for (const l of lines) {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.unitPrice) || 0;
      const sub = q * p;
      ht += sub;
      if (l.tvaRate !== '') {
        anyRate = true;
        const rate = parseFloat(l.tvaRate) || 0;
        const lineTva = Math.round(sub * (rate / 100) * 100) / 100;
        tva += lineTva;
        byRate.set(l.tvaRate, (byRate.get(l.tvaRate) || 0) + lineTva);
      }
    }
    return {
      newTotal: ht,
      perLineTva: Math.round(tva * 100) / 100,
      hasAnyRate: anyRate,
      tvaByRate: byRate,
    };
  }, [lines]);

  const headerTax = parseFloat((invoice?.tax_amount as string) || '0');
  // TVA effective : somme des lignes si un taux est saisi, sinon TVA d'en-tete.
  const taxAmount = hasAnyRate ? perLineTva : headerTax;
  const paidAmount = parseFloat((invoice?.paid_amount as string) || '0');
  const newTtc = newTotal + taxAmount;
  const ttcBelowPaid = lines.length > 0 && paidAmount > 0 && newTtc < paidAmount - 0.005;

  const updateLine = (idx: number, patch: Partial<InvoiceLine>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };
  const addLine = () => {
    setLines(prev => [...prev, { ingredientId: null, description: '', quantity: '1', unitPrice: '0', tvaRate: '' }]);
  };

  // Facture saisie au total (aucune ligne en base) : on l'explique et on propose de partir
  // des lignes reçues du BC lié ou du montant HT global, au lieu d'un tableau vide à 0 DH.
  const savedItemsCount = ((invoice?.items as unknown[]) || []).length;
  const savedWithoutLines = !!invoice && savedItemsCount === 0;
  const currentHt = parseFloat((invoice?.amount as string) || '0');
  const currentTtc = parseFloat((invoice?.total_amount as string) || '0');
  const poId = (invoice?.purchase_order_id as string) || null;
  const [prefillLoading, setPrefillLoading] = useState(false);
  const prefillFromPo = async () => {
    if (!poId) return;
    setPrefillLoading(true);
    try {
      const po = await purchaseOrdersApi.getById(poId);
      const items = ((po?.items as Record<string, any>[]) || []);
      const anyDelivered = items.some(it => parseFloat(it.quantity_delivered) > 0);
      const next = items
        .map(it => {
          const q = parseFloat(anyDelivered ? it.quantity_delivered : it.quantity_ordered) || 0;
          return {
            purchaseOrderItemId: (it.id as string) || null,
            ingredientId: (it.ingredient_id as string) || null,
            description: (it.ingredient_name as string) || '',
            quantity: String(q),
            unitPrice: String(parseFloat(it.unit_price) || 0),
            tvaRate: it.tva_rate != null && it.tva_rate !== '' ? String(parseFloat(it.tva_rate)) : '',
          };
        })
        .filter(l => parseFloat(l.quantity) > 0);
      if (next.length === 0) { notify.error('Le BC lié n\'a aucune ligne reçue à reprendre'); return; }
      setLines(next);
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Impossible de charger le BC lié'));
    } finally {
      setPrefillLoading(false);
    }
  };
  const prefillFromTotal = () => setLines([{
    ingredientId: null,
    description: (invoice?.description as string) || 'Montant global de la facture',
    quantity: '1',
    unitPrice: currentHt.toFixed(2),
    tvaRate: '',
  }]);
  const htGap = newTotal - currentHt;

  const handleSave = () => {
    const payload = lines
      .filter(l => l.description.trim() || l.ingredientId)
      .map(l => {
        const q = parseFloat(l.quantity) || 0;
        const p = parseFloat(l.unitPrice) || 0;
        return {
          // Ligne existante : son id la fait mettre à jour sur place, liens BC/réception/
          // catégorie conservés (constat 81). Ligne reprise du BC : rattachée à sa ligne de BC.
          id: l.id,
          purchaseOrderItemId: l.purchaseOrderItemId ?? null,
          ingredientId: l.ingredientId,
          description: l.description.trim() || null,
          quantity: q,
          unitPrice: p,
          subtotal: q * p,
          tvaRate: l.tvaRate === '' ? null : (parseFloat(l.tvaRate) || 0),
        };
      });
    if (payload.length === 0) {
      notify.error('Au moins une ligne avec description ou ingredient est requise');
      return;
    }
    mutation.mutate(payload);
  };

  return (
    <Modal title="Lignes de facture" subtitle={<span className="ds-ref">{(invoice?.invoice_number as string) || '…'}</span>} width={900}
      onClose={onClose} locked={mutation.isPending || showPayments}
      footer={<FormFooter onCancel={onClose} onSubmit={handleSave} submitLabel="Enregistrer les lignes"
        busy={mutation.isPending} disabled={isLoading || ttcBelowPaid || lines.length === 0} />}>
          {isLoading ? (
            <LoadingState bare />
          ) : (
            <>
              {savedWithoutLines && (
                <div style={{ marginBottom: 12 }}>
                  <StatusBanner tone="info" icon={FileText}
                    title="Facture saisie au total, sans détail"
                    actions={lines.length === 0 ? (
                      <>
                        {poId && (
                          <button type="button" onClick={prefillFromPo} disabled={prefillLoading} className="odoo-btn-primary"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {prefillLoading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <ClipboardList size={12} aria-hidden="true" />}
                            Reprendre les lignes du BC {(invoice?.purchase_order_number as string) || ''}
                          </button>
                        )}
                        <button type="button" onClick={prefillFromTotal} className={poId ? 'odoo-btn-secondary' : 'odoo-btn-primary'}>
                          Partir du montant global
                        </button>
                      </>
                    ) : undefined}>
                    Montant enregistré : <strong>{money(currentHt)} HT</strong> · TVA {money(headerTax)} · <strong>{money(currentTtc)} TTC</strong>
                    {paidAmount > 0 && <> · déjà payé {money(paidAmount)}</>}.
                    {' '}Détaillez-la pour qu'elle entre dans le rapprochement avec les réceptions
                    {poId ? ' : partez des lignes reçues du BC, puis ajustez quantités et prix selon la facture papier.' : '.'}
                  </StatusBanner>
                </div>
              )}
              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ds-muted)' }}>
                Modifiez, ajoutez ou supprimez des lignes. Le <strong>total HT</strong> est recalculé comme la somme des sous-totaux. Choisissez un <strong>taux de TVA par ligne</strong> (les articles peuvent avoir des taux différents) : la TVA totale devient la somme des TVA par ligne. Laissez le taux vide (—) pour conserver la TVA d'en-tête actuelle.
              </p>

              <DataPanel label="Lignes de facture">
              <table className="odoo-table ds-dense">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>Article</th>
                    <th>Description</th>
                    <th className="ds-num" style={{ width: 90 }}>Quantité</th>
                    <th className="ds-num" style={{ width: 110 }}>Prix unitaire ({currencySymbol()})</th>
                    <th className="ds-num" style={{ width: 90 }}>TVA (%)</th>
                    <th className="ds-num" style={{ width: 110 }}>Sous-total ({currencySymbol()})</th>
                    <th className="ds-actions" style={{ width: 40 }}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: '18px 6px', textAlign: 'center', color: 'var(--ds-muted)' }}>
                        Aucune ligne pour l'instant{savedWithoutLines ? ' — utilisez un des boutons ci-dessus ou ajoutez les lignes une à une.' : '.'}
                      </td>
                    </tr>
                  )}
                  {lines.map((line, idx) => {
                    const q = parseFloat(line.quantity) || 0;
                    const p = parseFloat(line.unitPrice) || 0;
                    return (
                      <tr key={idx}>
                        <td>
                          <SearchSelect value={line.ingredientId || ''}
                            onChange={id => {
                              const ing = (ingredients as Record<string, any>[]).find(i => i.id === id);
                              updateLine(idx, {
                                ingredientId: id || null,
                                description: ing ? (ing.name as string) : line.description,
                              });
                            }}
                            placeholder="— Libre —" width="100%" ariaLabel="Article"
                            options={(ingredients as Record<string, any>[]).map(i => ({ id: i.id as string, label: i.name as string }))} />
                        </td>
                        <td>
                          <input type="text" value={line.description} aria-label={`Description, ligne ${idx + 1}`}
                            onChange={e => updateLine(idx, { description: e.target.value })}
                            className="ds-input sm" />
                        </td>
                        <td>
                          <input type="number" step="0.01" min={0} value={line.quantity} aria-label={`Quantité, ligne ${idx + 1}`}
                            onChange={e => updateLine(idx, { quantity: e.target.value })}
                            className="ds-input sm ds-num" />
                        </td>
                        <td>
                          <input type="number" step="0.01" min={0} value={line.unitPrice} aria-label={`Prix unitaire, ligne ${idx + 1}`}
                            onChange={e => updateLine(idx, { unitPrice: e.target.value })}
                            className="ds-input sm ds-num" />
                        </td>
                        <td>
                          <select value={line.tvaRate} aria-label={`Taux de TVA, ligne ${idx + 1}`}
                            onChange={e => updateLine(idx, { tvaRate: e.target.value })}
                            className="ds-input sm">
                            <option value="">—</option>
                            {tvaRates.map(r => (
                              <option key={r} value={r}>{r} %{r === '0' ? ' (exonéré / hors champ)' : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td className="ds-num ds-strong">{n(q * p)}</td>
                        <td className="ds-actions">
                          <button type="button" onClick={() => removeLine(idx)}
                            className="odoo-pager-btn" title="Supprimer cette ligne" aria-label={`Supprimer la ligne ${idx + 1}`} style={{ color: 'var(--ds-danger)' }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </DataPanel>

              <button type="button" onClick={addLine} className="ds-btn-ghost ds-btn-sm" style={{ marginTop: 10 }}>
                <Plus size={13} aria-hidden="true" /> Ajouter une ligne
              </button>

              <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--ds-bg)', borderRadius: 'var(--ds-r-field)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={MUTED}>Montant HT enregistré</span>
                  <span>{money(currentHt)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={MUTED}>Nouveau total HT (somme des lignes)</span>
                  <strong>{money(newTotal)}</strong>
                </div>
                {lines.length > 0 && Math.abs(htGap) >= 0.01 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ds-warning)' }}>
                    <span>Écart avec le montant enregistré</span>
                    <span>{money(htGap, { signed: true })}</span>
                  </div>
                )}
                {hasAnyRate ? (
                  <>
                    {[...tvaByRate.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([rate, amt]) => (
                      <div key={rate} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={MUTED}>TVA {rate} %</span>
                        <span>{money(amt)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={MUTED}>Total TVA</span>
                      <strong>{money(taxAmount)}</strong>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={MUTED}>TVA (en-tête, inchangée)</span>
                    <span>{money(taxAmount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--ds-sep)', paddingTop: 6, marginTop: 2 }}>
                  <strong>Nouveau total TTC</strong>
                  <strong style={{ color: 'var(--ds-accent-ink)' }}>{money(newTtc)}</strong>
                </div>
                {paidAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ds-muted)' }}>
                    <span>Déjà payé</span>
                    <span>{money(paidAmount)}</span>
                  </div>
                )}
                {ttcBelowPaid && (
                  <div role="alert" style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', borderRadius: 'var(--ds-r-field)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 250 }}>
                      Le nouveau total TTC ({money(newTtc)}) est inférieur au déjà payé ({money(paidAmount)}).
                      Annulez ou ajustez des paiements pour pouvoir baisser le total.
                    </span>
                    <button type="button" onClick={() => setShowPayments(true)} className="odoo-btn-secondary ds-btn-sm">
                      <Coins size={13} aria-hidden="true" /> Gérer les paiements
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

      {/* Modal Paiements ouvert au-dessus pour resoudre le blocage 'TTC < deja paye'.
          A la fermeture, la query 'invoice' est invalide et le paid_amount est
          rafraichi -> l'alerte disparait quand la condition n'est plus vraie. */}
      {showPayments && (
        <InvoicePaymentsModal
          invoiceId={invoiceId}
          onClose={() => setShowPayments(false)}
        />
      )}
    </Modal>
  );
}

/**
 * Modal "Voir et gerer les paiements d'une facture".
 *
 * Sert a :
 *   - Visualiser tous les paiements enregistres pour la facture (date, montant,
 *     methode, N° cheque, encaissement)
 *   - Supprimer un paiement saisi par erreur (mauvais montant, faux N° cheque,
 *     doublon). Le backend recalcule paid_amount + status automatiquement.
 *
 * Distinct de la modal "Editer lignes" (qui change le total HT/TTC) et de
 * "Modifier facture" (en-tete). Ici on touche aux REGLEMENTS, pas a la facture.
 *
 * Acces : ADMIN + MANAGER (cf. backend DELETE /payments/:id elargi).
 */
function InvoicePaymentsModal({
  invoiceId, onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { getLabel: getPaymentLabel, getColor: getPaymentColor } = useReferentiel('payment_methods');
  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => invoicesApi.getById(invoiceId),
  });

  // Mig 310 (G-D7-08) : un paiement ne se supprime plus. Il s'annule avec un motif
  // (contre-pièce négative + extourne comptable), puis peut être ré-émis.
  const { modes: payModes } = usePaymentModes();
  const [voidTarget, setVoidTarget] = useState<Record<string, any> | null>(null);
  const [reissueTarget, setReissueTarget] = useState<Record<string, any> | null>(null);
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
    queryClient.invalidateQueries({ queryKey: ['invoice-line-expenses'] });
    queryClient.invalidateQueries({ queryKey: ['payments-checks'] });
    queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
  };
  const voidMutation = useMutation({
    mutationFn: ({ id, reasonCodeId, note }: { id: string; reasonCodeId: string; note?: string }) =>
      paymentsApi.void(id, { reasonCodeId, note }),
    onSuccess: () => { invalidateAll(); setVoidTarget(null); notify.success('Paiement annulé — contre-pièce passée, facture mise à jour'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });
  const reissueMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => paymentsApi.reissue(id, data),
    onSuccess: () => { invalidateAll(); setReissueTarget(null); notify.success('Règlement ré-émis'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Ré-émission impossible')),
  });

  const payments = ((invoice?.payments as Record<string, any>[]) || []);
  const totalAmount = parseFloat((invoice?.total_amount as string) || '0');
  const paidAmount = parseFloat((invoice?.paid_amount as string) || '0');
  const remaining = totalAmount - paidAmount;

  const fmtDate = (iso: string | null | undefined) => pdate(iso ? String(iso).slice(0, 10) : null);
  const tile: CSSProperties = { padding: '8px 12px', borderRadius: 'var(--ds-r-field)', display: 'grid', gap: 2 };

  return (
    <Modal title="Paiements de la facture" subtitle={<span className="ds-ref">{(invoice?.invoice_number as string) || '…'}</span>} width={820}
      onClose={onClose} locked={!!voidTarget || !!reissueTarget}
      footer={<button type="button" onClick={onClose} className="odoo-btn-secondary">Fermer</button>}>
          {isLoading ? (
            <LoadingState bare />
          ) : (
            <>
              {/* Bandeau resume facture */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ ...tile, background: 'var(--ds-bg)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-muted)' }}>Total de la facture</span>
                  <strong style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(totalAmount)}</strong>
                </div>
                <div style={{ ...tile, background: 'var(--ds-success-bg)', color: 'var(--ds-success)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Déjà payé</span>
                  <strong style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(paidAmount)}</strong>
                </div>
                <div style={{ ...tile, background: remaining > 0 ? 'var(--ds-warning-bg)' : 'var(--ds-success-bg)', color: remaining > 0 ? 'var(--ds-warning)' : 'var(--ds-success)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Reste à payer</span>
                  <strong style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(Math.max(0, remaining))}</strong>
                </div>
              </div>

              <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ds-muted)' }}>
                Un paiement ne se supprime pas : « Annuler » passe une contre-pièce motivée et extourne l'écriture.
                La facture est recalculée automatiquement. Un chèque perdu ou rejeté peut ensuite être ré-émis.
              </p>

              {payments.length === 0 ? (
                <EmptyState bare icon={Coins} title="Aucun paiement" text="Aucun paiement n'est enregistré pour cette facture." />
              ) : (
                <DataPanel label="Paiements de la facture">
                <table className="odoo-table ds-dense">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Saisi le</th>
                      <th>Mode</th>
                      <th style={{ width: 120 }}>N° de chèque</th>
                      <th style={{ width: 110 }}>Encaissé le</th>
                      <th>Référence / note</th>
                      <th className="ds-num" style={{ width: 110 }}>Montant ({currencySymbol()})</th>
                      <th className="ds-actions" style={{ width: 50 }}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id as string} style={p.status === 'void' ? { opacity: 0.6, textDecoration: p.voids_payment_id ? undefined : 'line-through' } : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.payment_date as string)}</td>
                        <td>
                          <span className="odoo-tag"
                            style={getPaymentColor(p.payment_method as string)
                              ? { backgroundColor: getPaymentColor(p.payment_method as string) + '22', color: getPaymentColor(p.payment_method as string) }
                              : undefined}>
                            {paymentModeLabel(p, payModes) || getPaymentLabel(p.payment_method as string)}
                          </span>{' '}
                          <PaymentStatusTag p={p} />
                        </td>
                        <td>{p.check_number ? <span className="ds-ref">{p.check_number as string}</span> : <span style={MUTED}>—</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {p.check_number ? (
                            p.cashed_at ? (
                              <span style={{ color: 'var(--ds-success)' }}>{fmtDate(p.cashed_at as string)}</span>
                            ) : (
                              <span style={{ color: 'var(--ds-warning)' }}>En attente</span>
                            )
                          ) : (
                            <span style={MUTED}>—</span>
                          )}
                        </td>
                        <td style={MUTED}>
                          {(p.reference as string) || (p.description as string) || '—'}
                        </td>
                        <td className="ds-num ds-strong">{n(parseFloat(p.amount as string))}</td>
                        <td className="ds-actions">
                          {p.status !== 'void' && !p.voids_payment_id && p.payment_method !== 'avoir' && (
                            <button type="button" onClick={() => setVoidTarget(p)} disabled={voidMutation.isPending}
                              className="ds-icon-btn" title="Annuler ce paiement (motif obligatoire)" aria-label="Annuler ce paiement" style={{ color: 'var(--ds-danger)' }}>
                              <Ban size={13} />
                            </button>
                          )}
                          {p.status === 'void' && !p.voids_payment_id && p.payment_method !== 'avoir'
                            && !payments.some(x => x.replaces_payment_id === p.id && x.status !== 'void') && (
                            <button type="button" onClick={() => setReissueTarget(p)} className="ds-icon-btn" title="Ré-émettre ce règlement" aria-label="Ré-émettre ce règlement">
                              <RotateCcw size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </DataPanel>
              )}
            </>
          )}
      {voidTarget && (
        <ReasonCodeDialog title={`Annuler le paiement de ${money(parseFloat(voidTarget.amount as string))}`} scope="void_payment"
          description="Le paiement reste dans l'historique : une contre-pièce négative le neutralise et son écriture est extournée. Un chèque déjà encaissé ou un paiement rapproché en banque ne peut pas être annulé."
          confirmLabel="Annuler le paiement" danger pending={voidMutation.isPending}
          onClose={() => setVoidTarget(null)}
          onSubmit={(v) => voidMutation.mutate({ id: voidTarget.id as string, reasonCodeId: v.reasonCodeId, note: v.note })} />
      )}
      {reissueTarget && (
        <ReissuePaymentDialog payment={reissueTarget} pending={reissueMutation.isPending}
          onClose={() => setReissueTarget(null)}
          onSubmit={(data) => reissueMutation.mutate({ id: reissueTarget.id as string, data })} />
      )}
    </Modal>
  );
}


/* ═══ Factures reçues — fiche compacte (vue Colonnes, style Apple 2026-11) ═══ */
function ReceivedInvoicePane({ inv, detail, action, onControl, onEdit, onLines, onPayments, onAttach }: {
  inv: Record<string, any>; detail: string; action: { label: string; run: () => void; cls: string } | null;
  onControl: () => void; onEdit: () => void; onLines: () => void; onPayments?: () => void; onAttach: () => void;
}) {
  const { modes: payModes } = usePaymentModes();
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const { data: full, isLoading } = useQuery({ queryKey: ['invoice-detail', inv.id], queryFn: () => invoicesApi.getById(inv.id as string) as Promise<Record<string, any>> });
  const st = inv.stage as string;
  const total = pn(inv.total_amount); const paid = pn(inv.paid_amount); const remaining = Math.max(0, total - paid);
  const items: Record<string, any>[] = full?.items || [];
  const payments: Record<string, any>[] = full?.payments || [];
  const idx = INV_STAGES.findIndex(x => x.key === st);
  const late = !!inv.is_late;
  const steps = [
    { label: 'Reçue', sub: pdate(inv.invoice_date), tone: 'done' as const },
    { label: 'Validée', sub: st === 'draft' ? 'à valider' : 'oui', tone: (st === 'draft' ? 'current' : 'done') as 'current' | 'done' },
    { label: 'Échéance', sub: inv.due_date ? pdate(inv.due_date) : 'non fixée', tone: (st === 'paid' ? 'done' : late ? 'warn' : st === 'draft' ? '' : 'current') as 'done' | 'warn' | 'current' | '' },
    { label: 'Réglée', sub: st === 'paid' ? 'soldée' : paid > 0.004 ? `${money(paid)} payés` : 'rien payé', tone: (st === 'paid' ? 'done' : '') as 'done' | '' },
  ];
  return (
    <section className="ord-pane" aria-label={`Facture ${inv.invoice_number as string}`}>
      <PaneHead name={String(inv.supplier_name ?? '—')}
        sub={<><span className="sal-num">{inv.invoice_number as string}</span>{inv.supplier_invoice_number ? ` · réf. ${inv.supplier_invoice_number as string}` : ''}{inv.purchase_order_number ? ` · ${inv.purchase_order_number as string}` : ''}</>}
        amount={pmoney(total)} amountSub={st === 'cancelled' ? 'annulée' : remaining > 0.004 ? `reste à payer ${money(remaining)}` : 'réglée'} />
      <div className="ord-actions">
        {/* Une action principale visible (ou le contrôle à défaut), le reste dans le menu « ⋯ ». */}
        {action
          ? <button type="button" className={action.cls} onClick={action.run} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{(st === 'to_pay' || st === 'partial') && <Banknote size={14} aria-hidden="true" />}{action.label}</button>
          : <button type="button" className="odoo-btn-secondary" onClick={onControl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{Number(inv.blocking_holds) > 0 ? <ShieldAlert size={13} aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />} Contrôle</button>}
        <RowMenu label={`Plus d'actions sur ${inv.invoice_number as string}`} items={[
          ...(action ? [{ label: 'Contrôle', icon: Number(inv.blocking_holds) > 0 ? ShieldAlert : ShieldCheck, onSelect: onControl }] : []),
          { label: 'Modifier', icon: Pencil, onSelect: onEdit },
          { label: 'Lignes', icon: ClipboardList, onSelect: onLines },
          ...(onPayments ? [{ label: 'Paiements', icon: Coins, onSelect: onPayments }] : []),
          inv.attachment_url
            ? { label: 'Pièce jointe', icon: Eye, onSelect: () => { window.open(inv.attachment_url as string, '_blank', 'noopener,noreferrer'); } }
            : { label: 'Joindre une pièce', icon: Upload, onSelect: onAttach },
        ]} />
      </div>
      {st === 'cancelled' ? (
        <div className="kl-widget"><div className="ord-state">Facture annulée</div><div className="ord-state-sub">Conservée comme pièce ; son écriture est extournée.</div></div>
      ) : (
        <PaneState title={late ? 'Échéance dépassée' : INV_STAGES[idx]?.label ?? st} sub={detail} late={late || st === 'blocked'}
          pct={st === 'paid' ? 100 : total > 0 ? Math.max(st === 'draft' ? 6 : 14, paid / total * 100) : 10} steps={steps} />
      )}
      <section>
        <div className="kl-sec"><h2>Articles</h2><small>{items.length ? `${items.length} ligne${items.length > 1 ? 's' : ''}` : ''}</small></div>
        <div className="kl-group">
          {items.length ? items.map((it, i) => (
            <div key={i} className="ord-line">
              <span className="ord-qty">{pn(it.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ×</span>
              <span className="ord-pn">{(it.description as string) || (it.ingredient_name as string) || '—'}<small>{n(pn(it.unit_price))} HT{it.tva_rate != null ? ` · TVA ${pn(it.tva_rate)} %` : ''}</small></span>
              <span className="ord-pv">{n(pn(it.subtotal ?? pn(it.quantity) * pn(it.unit_price)))}</span>
            </div>
          )) : <div className="kl-empty">{isLoading ? 'Chargement…' : 'Aucune ligne.'}</div>}
          <div className="ord-kv"><span>Total HT</span><b>{money(pn(inv.amount ?? full?.amount))}</b></div>
          <div className="ord-kv"><span>TVA</span><b>{money(pn(inv.tax_amount ?? full?.tax_amount))}</b></div>
          <div className="ord-line tot"><span className="ord-pn">Total TTC</span><span className="ord-pv">{money(total)}</span></div>
        </div>
      </section>
      <section>
        <div className="kl-sec"><h2>Paiements</h2><small>{payments.length ? `${money(paid)} payés` : ''}</small></div>
        <div className="kl-group">
          {payments.length ? payments.map(p => (
            <div key={p.id as string} className="ord-kv" style={{ opacity: p.voided_at ? 0.5 : 1 }}>
              <span>{pdate(p.payment_date)} · {paymentModeLabel(p, payModes)}{p.reference ? ` · ${p.reference as string}` : ''}</span>
              <b style={{ textDecoration: p.voided_at ? 'line-through' : undefined }}>{money(pn(p.allocated_amount ?? p.amount))}</b>
            </div>
          )) : <div className="kl-empty">{isLoading ? 'Chargement…' : 'Aucun paiement.'}</div>}
        </div>
      </section>
      {(inv.category_name || inv.expected_payment_mode || inv.notes) && (
        <section>
          <div className="kl-sec"><h2>Informations</h2></div>
          <div className="kl-group">
            {inv.category_name && <div className="ord-kv"><span>Catégorie</span><b>{inv.category_name as string}</b></div>}
            {inv.expected_payment_mode && <div className="ord-kv"><span>Mode prévu</span><b>{getPaymentLabel(String(inv.expected_payment_mode))}</b></div>}
            {inv.notes && <div className="ord-kv"><span>Notes</span><b style={{ whiteSpace: 'pre-line', textAlign: 'right' }}>{inv.notes as string}</b></div>}
          </div>
        </section>
      )}
    </section>
  );
}
