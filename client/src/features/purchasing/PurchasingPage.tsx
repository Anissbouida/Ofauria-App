import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApprovalsCount } from '../../api/approvals.api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersApi, invoicesApi, paymentsApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { format, differenceInCalendarDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Truck, FileText, Banknote,
  X, Check, Download, AlertTriangle, ChevronRight,
  ClipboardList, ShoppingCart, Receipt, Paperclip, Eye, Trash2, Upload,
  Loader2, Search, Coins, Filter, ArrowUpDown, ArrowUp, ArrowDown,
  Clock, CheckCircle2, Scale, CalendarClock, Ban,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import PurchaseOrdersTab from '../accounting/PurchaseOrdersTab';
import SuppliersTab from './SuppliersTab';
import PurchasingPilotageTab from './PurchasingPilotageTab';
import InvoiceControlModal from '../../components/purchasing/InvoiceControlModal';
import ReasonCodeDialog from '../../components/purchasing/ReasonCodeDialog';
import { usePaymentModes, modeFromLegacy, PaymentModeSelect, CashLimitGauge, paymentModeLabel, PaymentStatusTag, ReissuePaymentDialog, type CashOverride } from '../../components/purchasing/PaymentModeFields';
import { apiErrorMessage } from '../../api/errors';
import { ShieldAlert, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { useReferentiel } from '../../hooks/useReferentiel';
import { RotateCcw, FilePenLine } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, StageProgress, ViewSwitch, PeriodFilter, SelectFilter, Pager,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';

type PurchasingTab = 'suppliers' | 'purchase_orders' | 'invoices' | 'pilotage';

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

export default function PurchasingPage() {
  // Onglet ouvrable par lien (?tab=purchase_orders), ex. depuis Stock › À commander après création des BC.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<PurchasingTab>(() => {
    const t = searchParams.get('tab') as PurchasingTab | null;
    return t && ['suppliers', 'purchase_orders', 'invoices', 'pilotage'].includes(t) ? t : 'suppliers';
  });
  // Ouverture d'un onglet pré-filtré sur un fournisseur (depuis l'onglet Fournisseurs).
  // Ouverture d'un onglet pré-filtré (fournisseur, recherche, vue) depuis Fournisseurs ou Pilotage.
  const [focus, setFocus] = useState<TabFocus>({});
  const openTab = (next: PurchasingTab, f: TabFocus = {}) => { setFocus(f); setTab(next); };

  const allTabs: { key: PurchasingTab; label: string; icon: typeof Truck }[] = [
    // « Liste d'attente » retirée : les besoins se traitent dans Stock › À commander (BC directs).
    { key: 'suppliers', label: 'Fournisseurs', icon: Truck },
    { key: 'purchase_orders', label: 'Bons de commande', icon: ClipboardList },
    { key: 'invoices', label: 'Factures reçues', icon: FileText },
    // Mig 312 (D9) : reçu non facturé, facturé non reçu, engagements, par ligne de BC.
    { key: 'pilotage', label: 'Pilotage', icon: Scale },
  ];

  const currentTab = allTabs.find(t => t.key === tab);
  const navigate = useNavigate();
  const approvalsCount = useApprovalsCount();

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ShoppingCart size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Achats</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{currentTab?.label}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="odoo-tabs">
        {allTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => openTab(t.key)}
              className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
        {/* Raccourci vers la boîte d'approbation (lot 8), sans passer par la cloche. */}
        <button onClick={() => navigate('/approvals')} className="odoo-tab"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Bons de commande et autres pièces qui attendent une décision">
          <ClipboardCheck size={13} /> À approuver
          {approvalsCount > 0 && (
            <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#dc3545', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {approvalsCount}
            </span>
          )}
        </button>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'suppliers' && (
          <SuppliersTab
            onOpenOrders={id => openTab('purchase_orders', { supplierId: id })}
            onOpenInvoices={id => openTab('invoices', { supplierId: id })}
          />
        )}
        {tab === 'purchase_orders' && <PurchaseOrdersTab initialSupplierId={focus.supplierId} />}
        {tab === 'invoices' && <InvoicesTab {...focus} />}
        {tab === 'pilotage' && <PurchasingPilotageTab onOpenInvoice={(f) => openTab('invoices', f)} />}
      </div>
    </div>
  );
}

/* ═══════════════════════ SUPPLIERS TAB ═══════════════════════ */
// Déplacé dans ./SuppliersTab.tsx (refonte Achats D1, mig 304).

/* ═══════════════════════ INVOICES TAB (factures reçues only) ═══════════════════════ */
type TabFocus = { supplierId?: string; search?: string; view?: 'open' | 'history' };

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
  const [payAvoir, setPayAvoir] = useState('');
  // Vue processus : « À traiter » (non réglées, filtrables par étape) ou « Historique »
  // (réglées / annulées, par période). Filtrage, tri et pagination côté serveur.
  const [view, setView] = useState<'open' | 'history'>(initialView);
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
    const p: Record<string, string> = { view, page: String(page), pageSize: String(PAGE_SIZE), sort: sortBy, dir: sortDir };
    if (view === 'open' && stage) p.stage = stage;
    if (statusFilter) p.status = statusFilter;
    if (searchTerm) p.search = searchTerm;
    if (supplierFilter) p.supplierId = supplierFilter;
    if (categoryFilter) p.categoryId = categoryFilter;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [view, stage, statusFilter, searchTerm, supplierFilter, categoryFilter, period, customFrom, customTo, page, sortBy, sortDir]);

  const { data: board, isLoading, isFetching } = useQuery({
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

  /**
   * Suppression facture avec strategie 2 niveaux :
   * 1er confirm : demande s'il faut supprimer
   * Si paiements lies : 2eme confirm pour cascade (force=true)
   * Si aucun paiement : suppression directe
   */
  function handleDelete(inv: Record<string, any>) {
    const paid = parseFloat(inv.paid_amount as string || '0');
    const hasPayments = paid > 0;
    const baseMsg = `Supprimer DEFINITIVEMENT la facture « ${inv.invoice_number} » de ${inv.supplier_name} ?\n\nCette action est irreversible.`;
    if (!confirm(baseMsg)) return;
    if (hasPayments) {
      const force = confirm(
        `Cette facture a ${parseFloat(String(inv.paid_amount || '0')).toFixed(2)} DH de paiements enregistres.\n\n` +
        `OK = supprimer AUSSI les paiements (perte de tracabilite comptable)\n` +
        `Annuler = abandonner la suppression (utilisez plutot "Annuler la facture")`
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
  };

  /** Prochaine action du processus pour une facture à traiter (bouton principal de la ligne). */
  const nextAction = (inv: Record<string, any>): { label: string; run: () => void; cls: string } | null => {
    switch (inv.stage as string) {
      case 'draft':
        return { label: 'Compléter', run: () => setEditInvoice(inv), cls: 'odoo-btn-primary' };
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

  const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'dd/MM/yyyy') : '');
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
      case 'partial': return `reste ${n(remaining)} DH`;
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
  const sortableTh = (field: string, label: string, align?: 'right') => (
    <th onClick={() => toggleSort(field)} aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align }}>
      {label} {sortIcon(field)}
    </th>
  );
  const colCount = 8;

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
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{l.invoice_number}</span>
              {' '}{l.supplier_name} — {n(parseFloat(l.remaining))} DH, échue le {fmtDate(l.due_date)} ({l.days_late} j)
            </span>
          ))}
          {lateList.length > 3 && <span> · et d'autres en tête de liste</span>}
        </StatusBanner>
      )}

      {/* Pipeline du processus : une carte par étape, clic = filtre */}
      <StagePipeline
        title="Où en sont mes factures"
        summary={`${openStats.count} facture${openStats.count > 1 ? 's' : ''} à traiter · ${n(openStats.remaining)} DH restant dus`}
        stages={INV_STAGES}
        stats={Object.fromEntries(INV_STAGES.map(s => {
          const st = stageStats[s.key];
          if (!st) return [s.key, undefined];
          const amount = s.key === 'paid' ? st.amount : st.remaining;
          return [s.key, { count: st.count, sub: `${n(amount)} DH`, late: st.late }];
        }))}
        isActive={k => (k === 'paid' ? view === 'history' : view === 'open' && stage === k)}
        onPick={pickStage}
      />

      {/* Barre de vue + nouvelle facture */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`À traiter · ${openStats.count}`} historyLabel={`Historique · ${historyCount}`} />
        {view === 'open' && stage && (
          <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Étape : {INV_STAGES.find(s => s.key === stage)?.label}
            <button type="button" onClick={() => setStage('')} aria-label="Retirer le filtre d'étape" style={{ display: 'inline-flex' }}>
              <X size={11} />
            </button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle facture
        </button>
      </div>

      {/* Recherche + filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par N° facture, fournisseur, BC ou catégorie..." aria-label="Rechercher une facture"
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        <SelectFilter label="Statut" icon={Filter} value={statusFilter} onChange={setStatusFilter} options={INV_VIEW_STATUSES[view]} />
        <PeriodFilter label="Facturé" title="Filtre sur la date de facture"
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <SearchSelect
          options={supplierOptions}
          value={supplierFilter}
          onChange={setSupplierFilter}
          placeholder="Tous les fournisseurs"
        />
        <SearchSelect
          options={categoryOptions}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="Toutes les catégories"
        />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </div>

      {/* Liste */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des factures...</p>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <FileText size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {view === 'open' ? (stage ? 'Aucune facture à cette étape' : 'Aucune facture à traiter') : 'Aucune facture sur cette période'}
          </p>
          {hasFilters && (
            <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>
              Aucun résultat pour ces filtres —{' '}
              <button type="button" onClick={resetFilters} style={{ textDecoration: 'underline', color: 'inherit' }}>les effacer</button>
            </p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                {sortableTh('invoice_number', 'N° Facture')}
                {sortableTh('supplier_name', 'Fournisseur')}
                {sortableTh('invoice_date', 'Date')}
                {sortableTh('due_date', 'Échéance / Mode')}
                <th style={{ minWidth: 190 }}>Étape</th>
                {sortableTh('total_amount', 'Montant', 'right')}
                <th style={{ textAlign: 'right' }}>{view === 'open' ? 'Prochaine action' : ''}</th>
                <th style={{ textAlign: 'right', width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv, i) => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                const hasAttachment = !!(inv.attachment_url as string);
                const invStage = inv.stage as string;
                const stageIdx = INV_STAGES.findIndex(s => s.key === invStage);
                const dueDateStr = inv.due_date as string | null;
                const expectedMode = (inv.expected_payment_mode as string) || '';
                const action = view === 'open' ? nextAction(inv) : null;
                const toCheck = Number(inv.open_holds) > Number(inv.blocking_holds);
                // Historique trié par date : un intertitre par mois.
                const month = inv.invoice_date ? format(new Date(inv.invoice_date as string), 'MMMM yyyy', { locale: fr }) : '';
                const prevMonth = i > 0 && rows[i - 1].invoice_date ? format(new Date(rows[i - 1].invoice_date as string), 'MMMM yyyy', { locale: fr }) : null;
                return (
                  <Fragment key={inv.id as string}>
                    {view === 'history' && sortBy === 'invoice_date' && month !== prevMonth && (
                      <tr>
                        <td colSpan={colCount} style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'capitalize', color: 'var(--odoo-text)' }}>
                          {month}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{inv.invoice_number as string}</span>
                          {hasAttachment && <Paperclip size={10} style={{ color: 'var(--theme-accent)' }} aria-label="Pièce jointe" />}
                        </span>
                        {inv.purchase_order_number ? (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                            {inv.purchase_order_number as string}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{inv.supplier_name as string}</div>
                        {inv.category_name ? (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{inv.category_name as string}</div>
                        ) : null}
                      </td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{fmtDate(inv.invoice_date as string)}</td>
                      <td style={{ color: inv.is_late ? '#dc3545' : 'var(--theme-text-muted)' }}>
                        {dueDateStr ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.2 }}>
                            <span style={{ fontWeight: inv.is_late ? 600 : 400 }}>{fmtDate(dueDateStr)}</span>
                            {expectedMode && <span style={{ fontSize: '0.6875rem' }}>{getPaymentLabel(expectedMode)}</span>}
                          </div>
                        ) : expectedMode ? (
                          <span style={{ fontSize: '0.6875rem' }}>{getPaymentLabel(expectedMode)}</span>
                        ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td>
                        {stageIdx >= 0 && (
                          <StageProgress count={INV_STAGES.length} current={stageIdx} done={invStage === 'paid'} late={!!inv.is_late} />
                        )}
                        <span style={{ fontSize: '0.75rem' }}>
                          {invStage === 'cancelled'
                            ? <span className="odoo-tag odoo-tag-grey">Annulée</span>
                            : <strong style={{ fontWeight: 600 }}>{INV_STAGES[stageIdx]?.label}</strong>}
                          <span style={{ color: inv.is_late ? '#dc3545' : 'var(--odoo-text-muted)' }}> · {stageDetail(inv)}</span>
                        </span>
                        {invStage !== 'cancelled' && toCheck && (
                          <button type="button" onClick={() => setControlFor(inv.id as string)}
                            className="odoo-tag odoo-tag-orange" style={{ border: 'none', cursor: 'pointer', marginLeft: 6 }}
                            title="Points à régulariser : voir le contrôle">
                            À vérifier
                          </button>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700 }}>{n(total)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                        {remaining > 0 && invStage !== 'cancelled' && paid > 0 && (
                          <div style={{ color: '#dc3545', fontSize: '0.6875rem', marginTop: 2 }}>Reste {n(remaining)}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {action && (
                          <button type="button" onClick={action.run} className={action.cls}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {(invStage === 'to_pay' || invStage === 'partial') && <Banknote size={12} />}
                            {action.label}
                          </button>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          {hasAttachment ? (
                            <>
                              <a href={inv.attachment_url as string} target="_blank" rel="noopener noreferrer"
                                className="odoo-pager-btn" title="Voir la pièce jointe" aria-label="Voir la pièce jointe">
                                <Eye size={13} />
                              </a>
                              <button onClick={() => removeAttachMutation.mutate(inv.id as string)}
                                className="odoo-pager-btn" title="Supprimer la pièce jointe" aria-label="Supprimer la pièce jointe" style={{ color: '#dc3545' }}>
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : (
                            <button onClick={() => handleAttachFile(inv.id as string)} className="odoo-pager-btn" title="Joindre" aria-label="Joindre un fichier">
                              <Upload size={13} />
                            </button>
                          )}
                          {/* Échelonner : matériel acheté à crédit → N échéances (Compta → Dettes → Échéancier). */}
                          {invStage !== 'paid' && invStage !== 'cancelled' && remaining > 0 && (
                            <button onClick={() => setScheduleInvoice(inv)}
                              className="odoo-pager-btn" title="Échelonner en plusieurs échéances" aria-label="Échelonner">
                              <CalendarClock size={13} />
                            </button>
                          )}
                          {/* Modifier : disponible même après paiement (ajustement comptable) */}
                          <button onClick={() => setEditInvoice(inv)}
                            className="odoo-pager-btn" title="Modifier la facture (en-tête)" aria-label="Modifier la facture">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setEditLinesInvoiceId(inv.id as string)}
                            className="odoo-pager-btn" title="Éditer les lignes (corrige qté/prix)" aria-label="Éditer les lignes">
                            <ClipboardList size={13} />
                          </button>
                          {paid > 0 && (
                            <button onClick={() => setPaymentsInvoiceId(inv.id as string)}
                              className="odoo-pager-btn" title="Voir / gérer les paiements" aria-label="Voir les paiements">
                              <Coins size={13} />
                            </button>
                          )}
                          {/* Litige (mig 309) : seul statut posé à la main, le règlement découle des paiements. */}
                          {invStage !== 'cancelled' && (
                            <button
                              onClick={() => {
                                const next = inv.status === 'disputed' ? 'pending' : 'disputed';
                                const verb = next === 'disputed' ? 'Mettre en litige' : 'Lever le litige de';
                                if (confirm(`${verb} la facture ${inv.invoice_number} ?`)) statusMutation.mutate({ id: inv.id as string, status: next });
                              }}
                              disabled={statusMutation.isPending}
                              className="odoo-pager-btn"
                              title={inv.status === 'disputed' ? 'Lever le litige' : 'Mettre en litige'}
                              aria-label={inv.status === 'disputed' ? 'Lever le litige' : 'Mettre en litige'}
                              style={inv.status === 'disputed' ? { color: '#b85d1a' } : undefined}>
                              <Scale size={13} />
                            </button>
                          )}
                          {invStage !== 'cancelled' && invStage !== 'paid' && (
                            <button onClick={() => setCancelFor(inv)}
                              className="odoo-pager-btn" title="Annuler la facture" aria-label="Annuler la facture" style={{ color: '#dc3545' }}>
                              <X size={13} />
                            </button>
                          )}
                          <button onClick={() => setControlFor(inv.id as string)} className="odoo-pager-btn"
                            title="Contrôle : blocages, mentions légales, rapprochement" aria-label="Contrôle de la facture">
                            {Number(inv.blocking_holds) > 0 ? <ShieldAlert size={13} style={{ color: '#dc3545' }} /> : <ShieldCheck size={13} />}
                          </button>
                          {/* Suppression : brouillon seulement (mig 309) ; une facture validée s'annule avec un motif. */}
                          {inv.validation_status === 'draft' && (
                            <button onClick={() => handleDelete(inv)} disabled={deleteMutation.isPending}
                              className="odoo-pager-btn" title="Supprimer le brouillon" aria-label="Supprimer le brouillon" style={{ color: '#b71c1c' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={5} style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>
                  Total du filtre — {total} facture{total > 1 ? 's' : ''}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700 }}>{n(board?.sumTotal ?? 0)}</span>
                  <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                  {(board?.sumRemaining ?? 0) > 0.005 && (
                    <div style={{ color: '#dc3545', fontSize: '0.6875rem', marginTop: 2 }}>Reste {n(board?.sumRemaining ?? 0)}</div>
                  )}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          <Pager page={page} total={total} onPage={setPage}
            note={view === 'open'
              ? 'Seules les factures non réglées sont chargées ici — les autres sont dans l\'Historique.'
              : `Réglées et annulées · ${periodText}`} />
        </div>
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
        <ModalBackdrop onClose={() => setShowPayForm(null)} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 480, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb">
                <Banknote size={14} style={{ color: 'var(--theme-accent)' }} />
                <span>Payer</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>{showPayForm.invoice_number as string}</span>
              </div>
              <div style={{ flex: 1 }} />
              <span className="odoo-tag odoo-tag-orange">Reste {n(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string))} DH</span>
              <button onClick={() => setShowPayForm(null)} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
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
              if (payLegacy !== 'check' && payLegacy !== 'traite') {
                fd.checkNumber = undefined; fd.checkDate = undefined; fd.avoirAmount = undefined;
              } else {
                const av = parseFloat(fd.avoirAmount as string) || 0;
                fd.avoirAmount = av > 0 ? Math.round(av * 100) / 100 : undefined;
              }
              payMutation.mutate(fd);
            }} className="flex-1 overflow-y-auto">
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
                    {(payLegacy === 'check' || payLegacy === 'traite') && parseFloat(payAvoir) > 0
                      ? `Montant ${payLegacy === 'traite' ? 'traite' : 'chèque'} *` : 'Montant *'}
                  </label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required
                    value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Mode de règlement *</label>
                    <PaymentModeSelect value={payMethod} onChange={setPayMethod} /></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date *</label>
                    <input name="paymentDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" value={payDate} onChange={e => setPayDate(e.target.value)} required /></div>
                </div>
                <CashLimitGauge supplierId={showPayForm.supplier_id as string} date={payDate}
                  amount={parseFloat(payAmount) || 0} modeCode={payMethod} override={payOverride} onOverrideChange={setPayOverride} />
                {(payLegacy === 'check' || payLegacy === 'traite') && (
                  <div className="odoo-alert" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <strong style={{ fontSize: '0.75rem' }}>Détails {payLegacy === 'traite' ? 'de la traite' : 'du chèque'}</strong>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginBottom: 4 }}>N° {payLegacy === 'traite' ? 'Traite' : 'Chèque'} *</label>
                        <input name="checkNumber" defaultValue={(showPayForm.check_number as string) || ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
                      <div><label style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date {payLegacy === 'traite' ? 'de la traite' : 'du chèque'}</label>
                        <input name="checkDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" defaultValue={(showPayForm.due_date as string)?.slice(0, 10) || format(new Date(), 'yyyy-MM-dd')} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3" style={{ marginTop: 4 }}>
                      <div><label style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Avoir fournisseur (DH)</label>
                        <input name="avoirAmount" type="number" step="0.01" min="0" placeholder="0.00"
                          value={payAvoir} onChange={e => {
                            const av = parseFloat(e.target.value) || 0;
                            setPayAvoir(e.target.value);
                            const remaining = parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string);
                            setPayAmount(Math.max(0, remaining - av).toFixed(2));
                          }}
                          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                      {parseFloat(payAvoir) > 0 && (
                        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                          <p style={{ fontSize: '0.6875rem', color: '#2563eb', fontWeight: 600, margin: 0, paddingBottom: 6 }}>
                            Avoir {n(parseFloat(payAvoir))} + {payLegacy === 'traite' ? 'traite' : 'chèque'} {n(parseFloat(payAmount))} = {n(parseFloat(payAvoir) + parseFloat(payAmount))} DH
                          </p>
                        </div>
                      )}
                      {!parseFloat(payAvoir) && (
                        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                          <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', margin: 0, paddingBottom: 6 }}>
                            Déduit de la dette sans sortie de trésorerie
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(() => {
                  // Virement : la référence bancaire est obligatoire (mig 310) ; chèque/effet : c'est le N° ci-dessus.
                  const refRequired = !!payModeDef?.requires_reference && payLegacy !== 'check' && payLegacy !== 'traite';
                  return (
                    <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>
                        {refRequired ? 'Référence du virement *' : 'Référence / Notes'}</label>
                      <input name="reference" required={refRequired} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder={refRequired ? 'N° d\'ordre ou référence bancaire' : 'Optionnel'} /></div>
                  );
                })()}
              </div>
              <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setShowPayForm(null)} className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={payMutation.isPending} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {payMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  <Check size={13} /> Payer
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}

/* EmittedInvoicesSection moved to ../sales/EmittedInvoicesTab.tsx */

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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <FileText size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Facture fournisseur</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">
              {isEdit ? `Modifier ${invoice?.invoice_number as string}` : 'Nouvelle'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>N° Facture *</label>
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date *</label>
                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Fournisseur *</label>
                <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required>
                  <option value="">Choisir...</option>
                  {suppliers.filter(s => s.is_active || s.id === supplierId).map(s => (
                    <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                  ))}
                </select></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Catégorie</label>
                <CategoryCascadeSelector value={categoryId} onChange={setCategoryId} type="expense" /></div>
            </div>
            {/* HT / TVA / TTC : ligne dediee avec live sync */}
            <div className="grid grid-cols-3 gap-3" style={{ padding: '8px 10px', backgroundColor: 'var(--theme-bg-page)', borderRadius: 4, border: '1px solid var(--theme-bg-separator)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Montant HT *</label>
                <input type="number" step="0.01" value={amountHT}
                  onChange={e => { setAmountHT(e.target.value); setLastEdit('ht_tva'); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>TVA</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={vatRate} onChange={e => setVatRate(e.target.value)}
                    title="Taux TVA — applique HT × taux/100"
                    className="px-2 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    style={{ width: 68, flexShrink: 0 }}>
                    <option value="">—</option>
                    <option value="0">0%</option>
                    <option value="7">7%</option>
                    <option value="10">10%</option>
                    <option value="14">14%</option>
                    <option value="20">20%</option>
                  </select>
                  <input type="number" step="0.01" value={taxAmount}
                    onChange={e => { setTaxAmount(e.target.value); setLastEdit('ht_tva'); setVatRate(''); }}
                    className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    style={{ flex: 1, minWidth: 0 }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-accent)', marginBottom: 4 }}>Montant TTC</label>
                <input type="number" step="0.01" value={totalTTC}
                  onChange={e => { setTotalTTC(e.target.value); setLastEdit('ttc'); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  style={{ fontWeight: 600 }} />
              </div>
            </div>
            {ttcBelowPaid && (
              <div style={{ padding: '6px 10px', fontSize: '0.75rem', color: '#b71c1c', backgroundColor: '#fff5f5', border: '1px solid #f5c6cb', borderRadius: 4 }}>
                ⚠ Le montant TTC ({n(ttcNum)} DH) est inférieur au montant déjà payé ({n(paidAmount)} DH). Ajustez avant d'enregistrer.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Échéance</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date de réception</label>
                <input type="date" value={receptionDate} onChange={e => setReceptionDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Règlement prévu</label>
                <select value={expectedPaymentMode} onChange={e => setExpectedPaymentMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">— Non défini —</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.code} value={pm.code}>{pm.label}</option>
                  ))}
                </select></div>
            </div>
            {/* N° effet : affiche uniquement pour les modes a encaisser (cheque/traite).
                Pre-remplira automatiquement le payment.check_number au moment du reglement. */}
            {(expectedPaymentMode === 'check' || expectedPaymentMode === 'traite') && (
              <div style={{ padding: '8px 10px', backgroundColor: '#fef3c7', borderRadius: 4, border: '1px solid #fde68a' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                  N° {expectedPaymentMode === 'traite' ? 'Traite' : 'Chèque'}
                </label>
                <input type="text" value={checkNumber} onChange={e => setCheckNumber(e.target.value)}
                  placeholder="Ex: 1234567"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                <p style={{ fontSize: '0.6875rem', color: '#92400e', marginTop: 4 }}>
                  💡 Sera pré-rempli au moment du paiement.
                </p>
              </div>
            )}
            <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
            {isEdit && paidAmount > 0 && (
              <div style={{ padding: '6px 10px', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', backgroundColor: 'var(--theme-bg-page)', borderRadius: 4 }}>
                💡 Déjà payé : <strong>{n(paidAmount)} DH</strong>. Le statut sera recalculé automatiquement après modification.
              </div>
            )}
          </div>
          <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isPending || ttcBelowPaid} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {isPending && <Loader2 size={12} className="animate-spin" />}
              {isEdit ? 'Enregistrer' : 'Créer la facture'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
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
        date: `${String(jour).padStart(2, '0')}/${String(cible.getUTCMonth() + 1).padStart(2, '0')}/${cible.getUTCFullYear()}`,
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="p-5 flex items-center justify-between bg-gradient-to-r from-violet-500 to-purple-600">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <CalendarClock size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Échelonner la facture</h2>
              <p className="text-xs text-white/80">
                {invoice.invoice_number as string} · {(invoice.supplier_name as string) || 'Fournisseur'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="p-5 space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 flex justify-between">
            <span>Reste à échelonner</span>
            <strong style={{ fontFamily: 'ui-monospace, monospace', color: '#b71c1c' }}>{n(reste)} DH</strong>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre d'échéances *</label>
              <input type="number" min="1" max="120" value={installments}
                onChange={(e) => setInstallments(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tous les (mois)</label>
              <input type="number" min="1" max="12" value={intervalMonths}
                onChange={(e) => setIntervalMonths(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">1ère échéance *</label>
              <input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Règlement prévu</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
                <option value="">Non précisé</option>
                {paymentMethods.map((m: { code: string; label: string }) => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          {apercu.length > 0 && (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-600">Aperçu</div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {apercu.map((e, i) => (
                  <div key={i} className="px-3 py-1.5 flex justify-between text-xs border-t border-gray-100">
                    <span className="text-gray-600">Échéance {i + 1} · {e.date}</span>
                    <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(e.montant)} DH</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500">
            Les échéances apparaîtront dans <strong>Comptabilité → Dettes → Échéancier</strong>.
            Le reste à payer de la facture ne change pas : l'échéancier n'est qu'un calendrier.
          </p>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="odoo-btn-secondary" style={{ flex: 1 }}>Annuler</button>
            <button type="submit" disabled={create.isPending} className="odoo-btn-primary" style={{ flex: 1 }}>
              {create.isPending ? 'Création...' : 'Créer l\'échéancier'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}

function InvoiceLinesEditorModal({
  invoiceId, onClose, onSuccess,
}: {
  invoiceId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
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
    mutationFn: (items: Array<{ ingredientId: string | null; description: string | null; quantity: number; unitPrice: number; subtotal: number; tvaRate: number | null }>) =>
      invoicesApi.replaceItems(invoiceId, items),
    onSuccess,
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 900, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <ClipboardList size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Lignes facture</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>
              {(invoice?.invoice_number as string) || '...'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--theme-text-muted)' }}>
              <Loader2 size={20} className="animate-spin" style={{ marginRight: 8 }} /> Chargement...
            </div>
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
                            {prefillLoading ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}
                            Reprendre les lignes du BC {(invoice?.purchase_order_number as string) || ''}
                          </button>
                        )}
                        <button type="button" onClick={prefillFromTotal} className={poId ? 'odoo-btn-secondary' : 'odoo-btn-primary'}>
                          Partir du montant global
                        </button>
                      </>
                    ) : undefined}>
                    Montant enregistré : <strong>{n(currentHt)} DH HT</strong> · TVA {n(headerTax)} DH · <strong>{n(currentTtc)} DH TTC</strong>
                    {paidAmount > 0 && <> · déjà payé {n(paidAmount)} DH</>}.
                    {' '}Détaillez-la pour qu'elle entre dans le rapprochement avec les réceptions
                    {poId ? ' : partez des lignes reçues du BC, puis ajustez quantités et prix selon la facture papier.' : '.'}
                  </StatusBanner>
                </div>
              )}
              <div style={{ marginBottom: 12, padding: '8px 12px', backgroundColor: 'var(--theme-bg-page)', borderRadius: 4, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                Edite, ajoute ou supprime des lignes. Le <strong>total HT</strong> est recalcule comme somme des sous-totaux. Choisis un <strong>taux de TVA par ligne</strong> (les articles peuvent avoir des taux differents) : la TVA totale devient la somme des TVA par ligne. Laisse le taux vide (—) pour conserver la TVA d'en-tete actuelle.
              </div>

              <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--theme-bg-separator)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 6px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', width: '30%' }}>Ingredient</th>
                    <th style={{ padding: '8px 6px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase' }}>Description</th>
                    <th style={{ padding: '8px 6px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', textAlign: 'right', width: 90 }}>Qte</th>
                    <th style={{ padding: '8px 6px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', textAlign: 'right', width: 110 }}>Prix U.</th>
                    <th style={{ padding: '8px 6px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', textAlign: 'right', width: 80 }}>TVA %</th>
                    <th style={{ padding: '8px 6px', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', textAlign: 'right', width: 110 }}>Sous-total</th>
                    <th style={{ padding: '8px 6px', width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: '18px 6px', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>
                        Aucune ligne pour l'instant{savedWithoutLines ? ' — utilisez un des boutons ci-dessus ou ajoutez les lignes une à une.' : '.'}
                      </td>
                    </tr>
                  )}
                  {lines.map((line, idx) => {
                    const q = parseFloat(line.quantity) || 0;
                    const p = parseFloat(line.unitPrice) || 0;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--theme-bg-separator)' }}>
                        <td style={{ padding: '4px 6px' }}>
                          <select value={line.ingredientId || ''}
                            onChange={e => {
                              const id = e.target.value || null;
                              const ing = (ingredients as Record<string, any>[]).find(i => i.id === id);
                              updateLine(idx, {
                                ingredientId: id,
                                description: ing ? (ing.name as string) : line.description,
                              });
                            }}
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.8125rem', background: 'white' }}>
                            <option value="">— Libre —</option>
                            {(ingredients as Record<string, any>[]).map(i => (
                              <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input type="text" value={line.description}
                            onChange={e => updateLine(idx, { description: e.target.value })}
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.8125rem' }} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input type="number" step="0.01" min={0} value={line.quantity}
                            onChange={e => updateLine(idx, { quantity: e.target.value })}
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.8125rem', textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <input type="number" step="0.01" min={0} value={line.unitPrice}
                            onChange={e => updateLine(idx, { unitPrice: e.target.value })}
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.8125rem', textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <select value={line.tvaRate}
                            onChange={e => updateLine(idx, { tvaRate: e.target.value })}
                            style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--theme-bg-separator)', borderRadius: 3, fontSize: '0.8125rem', textAlign: 'right', background: 'white' }}>
                            <option value="">—</option>
                            {tvaRates.map(r => (
                              <option key={r} value={r}>{r} %{r === '0' ? ' (exonéré / hors champ)' : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>
                          {n(q * p)}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                          <button type="button" onClick={() => removeLine(idx)}
                            className="odoo-pager-btn" title="Supprimer cette ligne" style={{ color: '#b71c1c' }}>
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button type="button" onClick={addLine}
                style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4, background: 'transparent', fontSize: '0.8125rem', cursor: 'pointer', color: 'var(--theme-text-muted)' }}>
                <Plus size={13} /> Ajouter une ligne
              </button>

              <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--theme-bg-page)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--theme-text-muted)' }}>Montant HT enregistré</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n(currentHt)} DH</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--theme-text-muted)' }}>Nouveau total HT (somme des lignes)</span>
                  <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(newTotal)} DH</strong>
                </div>
                {lines.length > 0 && Math.abs(htGap) >= 0.01 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#b85d1a' }}>
                    <span>Écart avec le montant enregistré</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{htGap > 0 ? '+' : ''}{n(htGap)} DH</span>
                  </div>
                )}
                {hasAnyRate ? (
                  <>
                    {[...tvaByRate.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([rate, amt]) => (
                      <div key={rate} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--theme-text-muted)' }}>TVA {rate} %</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n(amt)} DH</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--theme-text-muted)' }}>Total TVA</span>
                      <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{n(taxAmount)} DH</strong>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--theme-text-muted)' }}>TVA (en-tete, inchangee)</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n(taxAmount)} DH</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--theme-bg-separator)', paddingTop: 6, marginTop: 2 }}>
                  <strong>Nouveau total TTC</strong>
                  <strong style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--theme-accent)' }}>{n(newTtc)} DH</strong>
                </div>
                {paidAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                    <span>Deja paye</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{n(paidAmount)} DH</span>
                  </div>
                )}
                {ttcBelowPaid && (
                  <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: '#b71c1c', backgroundColor: '#fff5f5', border: '1px solid #f5c6cb', borderRadius: 4, marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 250 }}>
                      ⚠ Le nouveau total TTC ({n(newTtc)} DH) est inferieur au deja paye ({n(paidAmount)} DH).
                      Supprime ou ajuste les paiements pour pouvoir baisser le total.
                    </span>
                    <button type="button" onClick={() => setShowPayments(true)}
                      className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      <Coins size={11} /> Gerer les paiements
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button type="button" onClick={handleSave} disabled={isLoading || mutation.isPending || ttcBelowPaid || lines.length === 0}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {mutation.isPending && <Loader2 size={12} className="animate-spin" />}
            <Check size={13} /> Enregistrer les lignes
          </button>
        </div>
      </div>

      {/* Modal Paiements ouvert au-dessus pour resoudre le blocage 'TTC < deja paye'.
          A la fermeture, la query 'invoice' est invalide et le paid_amount est
          rafraichi -> l'alerte disparait quand la condition n'est plus vraie. */}
      {showPayments && (
        <InvoicePaymentsModal
          invoiceId={invoiceId}
          onClose={() => setShowPayments(false)}
        />
      )}
    </ModalBackdrop>
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

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try { return format(new Date(String(iso).slice(0, 10)), 'dd/MM/yyyy'); }
    catch { return String(iso); }
  };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 800, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Coins size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Paiements</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>
              {(invoice?.invoice_number as string) || '...'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--theme-text-muted)' }}>
              <Loader2 size={20} className="animate-spin" style={{ marginRight: 8 }} /> Chargement...
            </div>
          ) : (
            <>
              {/* Bandeau resume facture */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-card)' }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase' }}>Total facture</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{n(totalAmount)} DH</div>
                </div>
                <div style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid #d4edda', background: '#f0f9f4' }}>
                  <div style={{ fontSize: '0.6875rem', color: '#0e7c3a', textTransform: 'uppercase' }}>Deja paye</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0e7c3a', fontFamily: 'ui-monospace, monospace' }}>{n(paidAmount)} DH</div>
                </div>
                <div style={{ padding: '8px 12px', borderRadius: 4, border: remaining > 0 ? '1px solid #ffeaa7' : '1px solid #d4edda', background: remaining > 0 ? '#fff9e6' : '#f0f9f4' }}>
                  <div style={{ fontSize: '0.6875rem', color: remaining > 0 ? '#856404' : '#0e7c3a', textTransform: 'uppercase' }}>Reste a payer</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700, color: remaining > 0 ? '#856404' : '#0e7c3a', fontFamily: 'ui-monospace, monospace' }}>{n(Math.max(0, remaining))} DH</div>
                </div>
              </div>

              <div style={{ marginBottom: 8, padding: '8px 12px', backgroundColor: 'var(--theme-bg-page)', borderRadius: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                Un paiement ne se supprime pas : « Annuler » passe une contre-pièce motivée et extourne l'écriture.
                La facture est recalculée automatiquement. Un chèque perdu ou rejeté peut ensuite être ré-émis.
              </div>

              {payments.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--theme-text-muted)', border: '1px dashed var(--theme-bg-separator)', borderRadius: 4 }}>
                  Aucun paiement enregistre pour cette facture.
                </div>
              ) : (
                <table className="odoo-table" style={{ margin: 0, borderTop: '1px solid var(--theme-bg-separator)' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Date saisie</th>
                      <th style={{ width: 100 }}>Methode</th>
                      <th style={{ width: 120 }}>N° Cheque</th>
                      <th style={{ width: 110 }}>Encaisse le</th>
                      <th>Reference / Note</th>
                      <th style={{ width: 100, textAlign: 'right' }}>Montant</th>
                      <th style={{ width: 60, textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id as string} style={p.status === 'void' ? { opacity: 0.6, textDecoration: p.voids_payment_id ? undefined : 'line-through' } : undefined}>
                        <td>{fmtDate(p.payment_date as string)}</td>
                        <td>
                          <span className="odoo-tag"
                            style={getPaymentColor(p.payment_method as string)
                              ? { backgroundColor: getPaymentColor(p.payment_method as string) + '22', color: getPaymentColor(p.payment_method as string) }
                              : undefined}>
                            {paymentModeLabel(p, payModes) || getPaymentLabel(p.payment_method as string)}
                          </span>{' '}
                          <PaymentStatusTag p={p} />
                        </td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>
                          {(p.check_number as string) || '—'}
                        </td>
                        <td>
                          {p.check_number ? (
                            p.cashed_at ? (
                              <span style={{ color: '#0e7c3a', fontSize: '0.75rem' }}>{fmtDate(p.cashed_at as string)}</span>
                            ) : (
                              <span style={{ color: '#856404', fontSize: '0.75rem', fontStyle: 'italic' }}>En attente</span>
                            )
                          ) : (
                            <span style={{ color: 'var(--theme-text-muted)' }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                          {(p.reference as string) || (p.description as string) || '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                          {n(parseFloat(p.amount as string))}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {p.status !== 'void' && !p.voids_payment_id && p.payment_method !== 'avoir' && (
                            <button onClick={() => setVoidTarget(p)} disabled={voidMutation.isPending}
                              className="odoo-pager-btn" title="Annuler ce paiement (motif obligatoire)" style={{ color: '#b71c1c' }}>
                              <Ban size={11} />
                            </button>
                          )}
                          {p.status === 'void' && !p.voids_payment_id && p.payment_method !== 'avoir'
                            && !payments.some(x => x.replaces_payment_id === p.id && x.status !== 'void') && (
                            <button onClick={() => setReissueTarget(p)} className="odoo-pager-btn" title="Ré-émettre ce règlement">
                              <RotateCcw size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Fermer</button>
        </div>
      </div>
      {voidTarget && (
        <ReasonCodeDialog title={`Annuler le paiement de ${n(parseFloat(voidTarget.amount as string))} DH`} scope="void_payment"
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
    </ModalBackdrop>
  );
}
