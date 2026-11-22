import { useState, useMemo, useEffect, useRef, Fragment, type CSSProperties } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi, newIdempotencyKey } from '../../api/purchase-orders.api';
import { supplierScoreApi, STANDING_TAG } from '../../api/supplier-score.api';
import { usePurLayout, LayoutSwitch, SplitView, KanbanView, POPane, pdate, pmoney, KANBAN_ALL } from '../purchasing/PurLayouts';
import '../projects/projects.css';
import '../purchasing/purchasing.css';
import '../sales/sales.css';
import { ListKpi } from '../sales/ListTemplate';
import {
  Alert, BulkBar, DataPanel, EmptyState, ErrorState, FormField, FormFooter, FormSection, LoadingState, Modal, NoResultState,
  PageHeader, SearchBar, SectionHeader, TableFooter,
} from '../../components/ds';
import { useOpenReception } from '../purchasing/purchasingNav';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { PurHeaderActions } from '../purchasing/PurHeaderActions';
import { suppliersApi, invoicesApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import { containerOf, roundUpToContainer, containerLabel, type ContainerDef } from '../../utils/container';
import { packagingApi } from '../../api/packaging.api';
import { productsApi } from '../../api/products.api';
import { useStockCategories } from '../stock/useStockCategories';
import {
  Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX,
  Truck, Search, ChevronDown, ChevronUp, ShoppingBag, Clock, CheckCircle2,
  Package, ArrowRight, FileText, Filter, Loader2, Download, Pencil, Receipt,
  Combine, Boxes, Wrench, Landmark,
} from 'lucide-react';
import { format, differenceInCalendarDays, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import IngredientFormModal from '../stock/IngredientFormModal';
import { useReferentiel } from '../../hooks/useReferentiel';
import { useAuth } from '../../context/AuthContext';
import CategoryCascadeSelector, { STOCKABLE_ROOT_IDS, CONSUMABLE_ROOT_IDS, SERVICE_ROOT_IDS, ASSET_ROOT_IDS } from '../../components/CategoryCascadeSelector';
import ReasonCodeDialog, { type ReasonScope } from '../../components/purchasing/ReasonCodeDialog';
import DocumentActionsTimeline from '../../components/purchasing/DocumentActionsTimeline';
import ChangeOrderModal from '../../components/purchasing/ChangeOrderModal';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey,
} from '../../components/purchasing/ProcessBoard';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import type { BudgetControl } from '../../api/management.api';

const fmtDh = (v: number) => money(v);
import { currenciesApi, BASE_CURRENCY } from '../../api/currencies.api';
import { Lock, PauseCircle, PlayCircle, Snowflake, FilePenLine, Scissors, Undo2, Scale } from 'lucide-react';
import { money, currencySymbol } from '../../utils/money';

/** Actions motivées sur un BC (mig 306) : un code motif du référentiel est obligatoire. */
type PoReasonAction = { kind: 'cancel' | 'not_delivered' | 'hold'; poId: string; orderNumber: string };
const PO_REASON_UI: Record<PoReasonAction['kind'], { scope: ReasonScope; title: string; confirm: string; danger: boolean; description: string }> = {
  cancel: { scope: 'cancel', title: 'Annuler le bon de commande', confirm: 'Annuler le BC', danger: true,
    description: 'Le BC ne sera plus attendu. Les demandes d\'achat qu\'il couvrait redeviennent à commander.' },
  not_delivered: { scope: 'not_delivered', title: 'Déclarer non livré', confirm: 'Déclarer non livré', danger: true,
    description: 'Le fournisseur n\'a pas livré. Les demandes d\'achat couvertes redeviennent à commander.' },
  hold: { scope: 'hold', title: 'Bloquer le bon de commande', confirm: 'Bloquer', danger: false,
    description: 'Tant que le blocage n\'est pas levé, aucune réception ni facture ne peut être enregistrée sur ce BC.' },
};

// Racines proposees a la creation d'un article de BC : matieres premieres
// (ingredients) ET consommables (emballages/entretien/equipements). Le routage
// vers la bonne table est decide par la categorie choisie (kindOf).
const PURCHASABLE_ROOT_IDS = Array.from(new Set([...STOCKABLE_ROOT_IDS, ...CONSUMABLE_ROOT_IDS]));
// Frais annexes d'un BC de stock (transport, livraison, divers) : ligne service imputee
// en charge. Categorie proposee par defaut : Transport > Livraison > Livraison fournisseurs.
const FEE_ROOT_IDS = ['10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000009'];
const DEFAULT_FEE_CATEGORY_ID = '30000000-0000-0000-0000-000000000064';

/* Type de ligne de BC (mig 349) : les lignes service / immobilisation n'ont pas d'article. */
type PoLineKind = 'ingredient' | 'consumable' | 'product' | 'service' | 'asset';
const isFreeLine = (k: unknown) => k === 'service' || k === 'asset';
/* Nature d'un nouveau BC, choisie avant la saisie des lignes. */
const ORDER_TYPES = [
  { key: 'stock' as const, label: 'Articles stockés', icon: Boxes, color: 'var(--ds-success)', tint: 'var(--ds-success-bg)',
    examples: 'Matières premières, emballages, consommables d\'entretien, produits de revente (boissons)',
    effect: 'Entrée en stock (lots, DLC), coût moyen mis à jour' },
  { key: 'service' as const, label: 'Service / frais', icon: Wrench, color: 'var(--ds-info)', tint: 'var(--ds-info-bg)',
    examples: 'Réparation, maintenance, transport, énergie, loyer, prestations',
    effect: 'Pas de stock : réception = service rendu, charge (classe 6)' },
  { key: 'asset' as const, label: 'Immobilisation', icon: Landmark, color: 'var(--ds-warning)', tint: 'var(--ds-warning-bg)',
    examples: 'Four, pétrin, chambre froide, vitrine, caisse, véhicule',
    effect: 'Pas de stock : mise en service, actif (classe 2) et fiche d\'amortissement' },
];

function LineKindTag({ kind }: { kind: unknown }) {
  if (kind === 'consumable') return <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6, fontSize: '11px' }}>Consommable</span>;
  if (kind === 'product') return <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 6, fontSize: '11px' }}>Revente</span>;
  if (kind === 'service') return <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6, fontSize: '11px' }}>Service</span>;
  if (kind === 'asset') return <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: 6, fontSize: '11px' }}>Immobilisation</span>;
  return null;
}

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Normalise les valeurs du backend a 2 decimales (ex: "48.0000" -> "48.00", "25.8300" -> "25.83")
function trimNum(v: unknown): string {
  if (v == null || v === '') return '';
  const f = parseFloat(String(v));
  return Number.isFinite(f) ? f.toFixed(2) : '';
}

/**
 * Étapes du processus d'un BC (dérivées côté serveur, cf. purchaseOrderRepository._stagedCte).
 * « Annulé / non livré » sort du processus : visible seulement dans l'Historique.
 */
const PO_STAGES: Array<{ key: string; label: string; hint: string; icon: typeof Clock }> = [
  { key: 'draft', label: 'Brouillon', hint: 'à envoyer', icon: FilePenLine },
  { key: 'sent', label: 'Envoyé', hint: 'attente livraison', icon: Send },
  { key: 'partial', label: 'Réception partielle', hint: 'reliquat attendu', icon: Package },
  { key: 'invoice', label: 'À facturer', hint: 'facture à établir', icon: Receipt },
  { key: 'closed', label: 'Clôturé', hint: 'voir l\'historique', icon: CheckCircle2 },
];
const OPEN_STAGES = ['draft', 'sent', 'partial', 'invoice'];
/** Ton de l'étiquette commune par étape du BC (à facturer = action attendue → ambre). */
const PO_TONE: Record<string, StatusTone> = { draft: 'draft', sent: 'progress', partial: 'progress', invoice: 'todo', closed: 'done' };

// Filtre par statut : les choix dépendent de la vue (un BC annulé n'est jamais « en cours »).
const VIEW_STATUSES: Record<'open' | 'history', Array<{ key: string; label: string }>> = {
  open: [
    { key: 'en_attente', label: 'En attente (brouillon)' },
    { key: 'envoye', label: 'Envoyé' },
    { key: 'livre_partiel', label: 'Livré partiellement' },
    { key: 'en_attente_facturation', label: 'Attente facturation (prix manquants)' },
    { key: 'livre_complet', label: 'Livré, non facturé' },
  ],
  history: [
    { key: 'livre_complet', label: 'Livré' },
    { key: 'annule', label: 'Annulé' },
    { key: 'non_livre', label: 'Non livré' },
  ],
};


type POItem = {
  id: string;
  ingredient_id: string;
  packaging_id?: string | null;
  kind?: 'ingredient' | 'consumable' | 'product' | 'service' | 'asset';
  ingredient_name: string;
  ingredient_unit: string;
  quantity_ordered: string;
  quantity_delivered: string;
  unit_price: string;
  foreign_unit_price?: string | null;
  // Categorie de l'article (feuille expense_categories), pour affichage.
  item_category_id?: string | null;
  // Contenant par defaut de l'ingredient : permet de saisir la reception par contenant
  // (ex : 3 seaux de 5 kg = 15 kg).
  container_size?: string | null;
  container_type_label?: string | null;
  // Double unité figée sur la ligne et compteurs dérivés du journal de ligne (mig 307).
  qty_container?: string | null;
  qty_per_container?: string;
  line_container_label?: string | null;
  base_unit?: string | null;
  qty_received_base?: string;
  qty_cancelled_base?: string;
  qty_remaining_base?: string;
  requires_lot?: boolean;
  requires_dlc?: boolean;
  requires_qc?: boolean;
  default_shelf_life_days?: number | null;
  discount_pct?: string;
  tva_rate?: string | null;
};

export default function PurchaseOrdersTab({ initialSupplierId = '' }: {
  /** Pré-filtre fournisseur (ouverture depuis l'onglet Fournisseurs). */
  initialSupplierId?: string;
} = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Annulation de reception reservee a l'admin (reverse stock + facture + compta).
  const isAdmin = user?.role === 'admin';
  // Vue processus : « En cours » (non clôturés, filtrables par étape) ou « Historique »
  // (clôturés/annulés, par période). Tout est filtré et paginé côté serveur.
  const [view, setView] = useState<'open' | 'history'>('open');
  // Style Apple (2026-11) : Colonnes (liste + fiche BC) / Liste / Kanban, comme les Ventes.
  const [layout, setLayout] = usePurLayout();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Période sur la date de commande : « Toutes » par défaut en cours, 3 mois en historique.
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState(initialSupplierId);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  // Réception : page dédiée du module Achats (?tab=reception&po=<id>).
  const openReception = useOpenReception();
  // Modal d'edition complete (admin) : qty/prix/ajout/suppression de lignes
  const [editPoId, setEditPoId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  // Selection multi-BC pour fusionner leurs factures fournisseurs en une seule.
  // Les lignes sélectionnées sont gardées (pas seulement leurs ids) : la sélection survit au changement de page.
  const [selectedRows, setSelectedRows] = useState<Map<string, Record<string, any>>>(new Map());
  const selectedPoIds = useMemo(() => new Set(selectedRows.keys()), [selectedRows]);
  const [showMergeModal, setShowMergeModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [view, stage, statusFilter, period, customFrom, customTo, searchTerm, supplierFilter]);

  const switchView = (next: 'open' | 'history') => {
    if (next === view) return;
    setView(next);
    setActiveId(null);
    setStage('');
    setStatusFilter('');
    if (period !== 'custom') setPeriod(next === 'history' ? '3m' : 'all');
  };

  const boardParams = useMemo(() => {
    // Kanban : toutes les pièces de la vue en une page (pas de pagination dans les colonnes).
    const kanban = layout === 'kanban';
    const p: Record<string, string> = { view, page: kanban ? '1' : String(page), pageSize: String(kanban ? KANBAN_ALL : PAGE_SIZE) };
    if (view === 'open' && stage) p.stage = stage;
    if (statusFilter) p.status = statusFilter;
    if (searchTerm) p.search = searchTerm;
    if (supplierFilter) p.supplierId = supplierFilter;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [view, stage, statusFilter, period, customFrom, customTo, page, searchTerm, supplierFilter, layout]);
  const hasFilters = !!(statusFilter || searchTerm || supplierFilter || period !== (view === 'history' ? '3m' : 'all'));
  const periodText = periodLabel(period, customFrom, customTo);
  const resetFilters = () => {
    setStatusFilter(''); setSearchInput(''); setSearchTerm(''); setSupplierFilter('');
    setPeriod(view === 'history' ? '3m' : 'all'); setCustomFrom(''); setCustomTo('');
  };

  const { data: board, isLoading, isFetching, error: boardError, refetch: refetchBoard } = useQuery({
    queryKey: ['purchase-orders', 'board', boardParams],
    queryFn: () => purchaseOrdersApi.board(boardParams),
    placeholderData: (prev) => prev,
  });
  const { data: pipeline } = useQuery({
    queryKey: ['purchase-orders', 'pipeline'],
    queryFn: purchaseOrdersApi.pipeline,
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { entries: unitEntries } = useReferentiel('units');

  const confirmDialog = useConfirm();
  const sendMutation = useMutation({
    mutationFn: (v: string | { id: string; ack: boolean }) => typeof v === 'string' ? purchaseOrdersApi.send(v) : purchaseOrdersApi.send(v.id, v.ack),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      // 202 : le BC dépasse un seuil (Paramètres › Approbations) et attend l'approbateur.
      if (res.approval) {
        const who = res.approval.steps?.[0]?.approver_name ?? res.approval.steps?.[0]?.approver_role ?? 'un approbateur';
        notify.warning(`BC soumis à approbation (${res.approval.rule_label}) : en attente de ${who}. Il partira au fournisseur dès son accord.`);
      } else {
        notify.success('BC envoyé au fournisseur');
      }
    },
    onError: async (e, v) => {
      // Contrôle budgétaire (mig 435) : dépassement du disponible → confirmation (alerte)
      // ou refus (blocage, que seul l'administrateur peut lever en confirmant).
      const body = (e as { response?: { data?: { error?: { code?: string }; budget?: BudgetControl } } }).response?.data;
      const code = body?.error?.code;
      if ((code === 'BUDGET_WARNING' || code === 'BUDGET_EXCEEDED') && body?.budget) {
        const id = typeof v === 'string' ? v : v.id;
        const detail = body.budget.lines.filter(l => l.exceeded > 0).map(l =>
          `${l.code} ${l.label} : demandé ${fmtDh(l.request)}, disponible ${fmtDh(l.available)} (budget ${fmtDh(l.budget)}, réel ${fmtDh(l.actual)}, engagé ${fmtDh(l.committed)})`).join('\n');
        const blocking = code === 'BUDGET_EXCEEDED';
        if (blocking && !isAdmin) { notify.error(`Budget dépassé : envoi refusé.\n${detail}`); return; }
        const ok = await confirmDialog(`${blocking ? 'Le budget bloque ce bon de commande.' : 'Ce bon de commande dépasse le disponible budgétaire.'}\n\n${detail}`,
          { title: blocking ? 'Budget dépassé' : 'Alerte budgétaire', confirmLabel: blocking ? 'Passer outre et envoyer' : 'Envoyer quand même', danger: blocking });
        if (ok) sendMutation.mutate({ id, ack: true });
        return;
      }
      notify.error(apiErrorMessage(e, 'Envoi impossible'));
    },
  });
  // Annuler / non livré / bloquer : motif codé obligatoire, action journalisée (mig 306).
  const [poReason, setPoReason] = useState<PoReasonAction | null>(null);
  const poReasonMutation = useMutation({
    mutationFn: ({ kind, poId, reason }: { kind: PoReasonAction['kind']; poId: string; reason: { reasonCodeId: string; note?: string } }) =>
      kind === 'cancel' ? purchaseOrdersApi.cancel(poId, reason)
        : kind === 'not_delivered' ? purchaseOrdersApi.markNotDelivered(poId, reason)
        : purchaseOrdersApi.hold(poId, reason),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['po-actions', v.poId] });
      notify.success(v.kind === 'cancel' ? 'BC annulé' : v.kind === 'not_delivered' ? 'Marqué non livré' : 'BC bloqué');
      setPoReason(null);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Action impossible')),
  });
  const poStateMutation = useMutation({
    mutationFn: ({ kind, poId }: { kind: 'release' | 'freeze' | 'unfreeze'; poId: string }) =>
      kind === 'release' ? purchaseOrdersApi.release(poId) : kind === 'freeze' ? purchaseOrdersApi.freeze(poId) : purchaseOrdersApi.unfreeze(poId),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['po-actions', v.poId] });
      notify.success(v.kind === 'release' ? 'Blocage levé' : v.kind === 'freeze' ? 'BC gelé' : 'BC dégelé');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Action impossible')),
  });
  const deleteMutation = useMutation({
    mutationFn: purchaseOrdersApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success('BC supprimé'); },
  });
  // Extourne de réception (admin) par contre-pièce, motif obligatoire (mig 308).
  const [reverseFor, setReverseFor] = useState<{ id: string; orderNumber: string } | null>(null);
  const cancelReceptionMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: { reasonCodeId: string; note?: string } }) => purchaseOrdersApi.cancelReception(id, reason),
    onSuccess: () => {
      setReverseFor(null);
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['eligible-pos'] });
      notify.success('Réception extournée : bon miroir créé, lots et facture annulés (rien n\'est supprimé)');
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message ?? 'Erreur lors de l\'annulation de la réception');
    },
  });
  // Generation manuelle de facture : rattrapage quand l'auto-creation au
  // moment de la reception n'a pas eu lieu (typiquement prix saisis a posteriori).
  const generateInvoiceMutation = useMutation({
    mutationFn: purchaseOrdersApi.generateInvoice,
    onSuccess: (inv: { invoice_number?: string } | null) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success(`Facture ${inv?.invoice_number ?? ''} générée`);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message ?? 'Erreur lors de la génération de la facture');
    },
  });

  const mergeInvoicesMutation = useMutation({
    mutationFn: invoicesApi.merge,
    onSuccess: (inv: { invoice_number?: string } | null) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['debts'] });
      notify.success(`Factures fusionnees en ${inv?.invoice_number ?? ''}`);
      setSelectedRows(new Map());
      setShowMergeModal(false);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message ?? 'Erreur lors de la fusion');
    },
  });

  // Stats
  const handleDownloadPoPdf = async (po: Record<string, any>) => {
    try {
      const response = await purchaseOrdersApi.downloadPdf(po.id as string);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      // Ouvrir le PDF directement — compatible web et mobile (Capacitor)
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify.error('Erreur lors du téléchargement du PDF');
    }
  };

  const rows = board?.rows ?? [];
  const total = board?.total ?? 0;

  const stageStats = useMemo(() => {
    const m: Record<string, { count: number; amount: number; late: number }> = {};
    for (const s of pipeline?.stages ?? []) {
      m[s.stage] = { count: s.count, amount: parseFloat(s.amount) || 0, late: s.late_count };
    }
    return m;
  }, [pipeline]);
  const openStats = OPEN_STAGES.reduce(
    (acc, k) => ({ count: acc.count + (stageStats[k]?.count ?? 0), amount: acc.amount + (stageStats[k]?.amount ?? 0) }),
    { count: 0, amount: 0 },
  );
  const historyCount = (stageStats.closed?.count ?? 0) + (stageStats.cancelled?.count ?? 0);
  const lateList = pipeline?.late ?? [];

  const supplierOptions = useMemo(
    () => (suppliers as Record<string, any>[])
      .map(s => ({ id: s.id as string, label: s.name as string }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [suppliers],
  );

  // Fusion de factures : un BC est éligible s'il a une facture liée OU des articles
  // déjà livrés (le backend crée la facture à la volée). Même fournisseur obligatoire.
  const selectedPOs = useMemo(() => Array.from(selectedRows.values()), [selectedRows]);
  const poIsEligible = (po: Record<string, any>) =>
    po.has_invoice || parseFloat((po.delivered_amount as string) || '0') > 0;
  const mergeSupplierIds = new Set(selectedPOs.map(po => po.supplier_id as string));
  const mergeReady = selectedPOs.length >= 2
    && mergeSupplierIds.size === 1
    && selectedPOs.every(poIsEligible);
  const mergeWarning = selectedPOs.length >= 2 && !mergeReady
    ? (mergeSupplierIds.size > 1
        ? 'Les BCs selectionnes doivent etre du meme fournisseur.'
        : 'Chaque BC selectionne doit avoir au moins une livraison partielle.')
    : '';

  const togglePoSelection = (po: Record<string, any>) => {
    const next = new Map(selectedRows);
    const id = po.id as string;
    if (next.has(id)) next.delete(id);
    else next.set(id, po);
    setSelectedRows(next);
  };

  const pickStage = (key: string) => {
    if (key === 'closed') { switchView('history'); return; }
    switchView('open');
    setStage(stage === key ? '' : key);
  };

  /** Prochaine action du processus pour un BC en cours (bouton principal de la ligne). */
  const nextAction = (po: Record<string, any>): { label: string; run: () => void; primary: boolean; danger?: boolean } | null => {
    if (po.on_hold) return null;
    const id = po.id as string;
    switch (po.stage as string) {
      case 'draft':
        // Soumis à approbation : rien à faire ici, l'approbateur décide depuis « À approuver ».
        if (po.approval_pending === true) return null;
        return { label: 'Envoyer', run: () => sendMutation.mutate(id), primary: true };
      case 'sent':
        // La réception s'ouvre en page dédiée (Achats › Réceptions › n° du BC).
        return { label: 'Réceptionner →', run: () => openReception(id), primary: false, danger: !!po.is_late };
      case 'partial':
        return { label: 'Réceptionner le reliquat →', run: () => openReception(id), primary: false, danger: !!po.is_late };
      case 'invoice':
        if (po.status === 'en_attente_facturation') {
          return po.frozen ? null : { label: 'Compléter les prix', run: () => setEditPoId(id), primary: false };
        }
        return {
          label: 'Générer la facture', primary: false,
          run: async () => { if (await confirmDialog(`Générer la facture pour le BC ${po.order_number} ?`, { title: 'Générer la facture', confirmLabel: 'Générer la facture' })) generateInvoiceMutation.mutate(id); },
        };
      default:
        return null;
    }
  };

  const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy', { locale: fr }) : null);

  /** Suppression d'un brouillon : action destructrice, toujours confirmée. */
  const askDelete = async (po: Record<string, any>) => {
    const ok = await confirmDialog(`Supprimer définitivement le bon de commande ${po.order_number} ?`,
      { title: 'Supprimer le bon de commande', confirmLabel: 'Supprimer', danger: true });
    if (ok) deleteMutation.mutate(po.id as string);
  };

  /** Sous-titre d'étape d'une ligne (ce qui s'est passé / ce qui manque). */
  const stageDetail = (po: Record<string, any>): string => {
    const items = Number(po.item_count) || 0;
    switch (po.stage as string) {
      case 'draft': return 'non envoyé au fournisseur';
      case 'sent': return 'en attente de livraison';
      case 'partial': return `${po.lines_done ?? 0}/${items} ligne${items > 1 ? 's' : ''} soldée${items > 1 ? 's' : ''}`;
      case 'invoice': return po.status === 'en_attente_facturation'
        ? `${po.items_without_price ?? 0} prix manquant${Number(po.items_without_price) > 1 ? 's' : ''}`
        : 'reçu, facture à générer';
      case 'closed': return 'reçu et facturé';
      default: return po.status === 'non_livre' ? 'non livré' : 'annulé';
    }
  };

  const colCount = 7;

  /** Étiquette d'étape d'un BC : bloqué et retard priment sur l'étape (même règle dans toutes les vues). */
  const stageTag = (po: Record<string, any>) => {
    const def = PO_STAGES.find(x => x.key === po.stage);
    const label = def?.label ?? (po.status === 'non_livre' ? 'Non livré' : 'Annulé');
    return (
      <StatusTag tone={po.on_hold ? 'blocked' : po.is_late ? 'late' : PO_TONE[po.stage as string] ?? 'cancelled'} icon={def?.icon}
        title={po.on_hold ? 'Bloqué : ni réception ni facture' : undefined}
        label={`${label}${po.on_hold ? ' · bloqué' : po.is_late ? ' · en retard' : ''}`} />
    );
  };

  /** Actions groupées sur les BC cochés (fusion des factures liées). */
  const bulkBar = (
    <BulkBar count={selectedPoIds.size} noun="commande" onClear={() => setSelectedRows(new Map())}>
      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setShowMergeModal(true)} disabled={!mergeReady}
        title={mergeReady ? 'Fusionner les factures liées' : mergeWarning}>
        <Combine size={13} aria-hidden="true" /> Fusionner les factures
      </button>
    </BulkBar>
  );

  return (
    <>
      {/* Retards de livraison : seule alerte de l'écran, avec accès direct à la réception */}
      {lateList.length > 0 && (
        <StatusBanner
          tone="danger"
          icon={AlertTriangle}
          title={`${lateList.length >= 5 ? '5+' : lateList.length} livraison${lateList.length > 1 ? 's' : ''} en retard`}
        >
          {lateList.slice(0, 3).map((l, i) => (
            <span key={l.id}>
              {i > 0 && ' · '}
              <button type="button" onClick={() => openReception(l.id)}
                style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, textDecoration: 'underline', color: 'inherit' }}>
                {l.order_number}
              </button>
              {' '}{l.supplier_name} — prévue le {fmtDate(l.expected_delivery_date)} ({l.days_late} j)
            </span>
          ))}
          {lateList.length > 3 && <span> · et d'autres en tête de liste</span>}
        </StatusBanner>
      )}

      {/* Tuiles : les montants que les pastilles ne donnent pas (engagé, à recevoir, à facturer, retards). */}
      {layout !== 'split' && <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Engagé en cours" value={`${money(openStats.amount)}`} sub={`${openStats.count} BC ouverts`} />
        <ListKpi label="À recevoir" value={`${money((stageStats.sent?.amount ?? 0) + (stageStats.partial?.amount ?? 0))}`}
          sub={`${(stageStats.sent?.count ?? 0) + (stageStats.partial?.count ?? 0)} BC envoyés ou en partie reçus`} />
        <ListKpi label="À facturer" value={`${money(stageStats.invoice?.amount ?? 0)}`} sub={`${stageStats.invoice?.count ?? 0} BC reçus sans facture`}
          tone={(stageStats.invoice?.count ?? 0) > 0 ? 'orange' : undefined} />
        <ListKpi label="Livraisons en retard" value={String(lateList.length >= 5 ? '5+' : lateList.length)} sub="date de livraison dépassée"
          tone={lateList.length ? 'red' : undefined} />
      </section>}

      <PurHeaderActions>
        <button type="button" onClick={() => setShowCreate(true)} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Nouveau bon de commande
        </button>
      </PurHeaderActions>

      {/* Circuit du BC : une pastille par étape, clic = filtre */}
      <StagePipeline
        title="Où en sont mes commandes"
        summary={`${openStats.count} BC en cours · ${money(openStats.amount)} engagés`}
        stages={PO_STAGES}
        stats={Object.fromEntries(PO_STAGES.map(s => {
          const st = stageStats[s.key];
          return [s.key, st ? { count: st.count, sub: `${money(st.amount)}`, late: st.late } : undefined];
        }))}
        isActive={k => (k === 'closed' ? view === 'history' : view === 'open' && stage === k)}
        onPick={pickStage}
      />

      {/* Barre d'outils : recherche, filtres, puis les bascules à droite */}
      <div className="prj-toolbar">
        <SearchBar value={searchInput} onChange={setSearchInput} placeholder="N° de commande ou fournisseur…"
          label="Rechercher un bon de commande" busy={isFetching && !isLoading} />
        <SelectFilter label="Statut" icon={Filter} value={statusFilter} onChange={setStatusFilter} options={VIEW_STATUSES[view]} />
        <PeriodFilter label="Commandé" title="Filtre sur la date de commande"
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <div style={{ minWidth: 200 }}>
          <SearchSelect options={supplierOptions} value={supplierFilter} onChange={setSupplierFilter} placeholder="Tous les fournisseurs" />
        </div>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="ds-btn-ghost ds-btn-sm">
            <X size={12} aria-hidden="true" /> Effacer
          </button>
        )}
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`En cours · ${openStats.count}`} historyLabel={`Historique · ${historyCount}`} />
        <LayoutSwitch value={layout} onChange={setLayout} />
      </div>

      {mergeWarning && <Alert tone="warning" icon={AlertTriangle}>{mergeWarning}</Alert>}
      {/* Hors vue Tableau, la sélection (gardée d'une vue à l'autre) reste actionnable au-dessus de la liste. */}
      {layout !== 'list' && bulkBar}

      {/* Liste */}
      {isLoading ? (
        <LoadingState label="Chargement des bons de commande…" />
      ) : boardError && !board ? (
        <ErrorState error={boardError} onRetry={() => { void refetchBoard(); }} />
      ) : rows.length === 0 ? (
        hasFilters ? (
          <NoResultState onReset={resetFilters} text="Aucun bon de commande ne correspond aux filtres." />
        ) : (
          <EmptyState icon={Truck}
            title={view === 'open' ? (stage ? 'Aucun bon de commande à cette étape' : 'Aucun bon de commande en cours') : 'Aucun bon de commande sur cette période'}
            text={view === 'open' && !stage ? 'Les commandes passées aux fournisseurs apparaissent ici, du brouillon jusqu\'à la facture.' : undefined}
            action={view === 'open' && !stage ? (
              <button type="button" onClick={() => setShowCreate(true)} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={13} aria-hidden="true" /> Nouveau bon de commande
              </button>
            ) : undefined} />
        )
      ) : layout === 'split' ? (
        <>
          <SplitView items={rows} getId={po => po.id as string} activeId={activeId} onPick={setActiveId} label="Bons de commande"
            row={po => {
              const st = po.stage as string;
              return {
                title: String(po.supplier_name ?? '—'),
                when: view === 'open' && po.expected_delivery_date ? pdate(po.expected_delivery_date, 'd MMM') : pdate(po.order_date, 'd MMM'),
                l2: <><span className="sal-num">{po.order_number as string}</span> · <b>{pmoney(po.total_amount)}</b></>,
                l3: <>{stageTag(po)} {stageDetail(po)}</>,
                dot: po.is_late || po.on_hold ? 'late' : '',
              };
            }}
            pane={po => {
              const action = view === 'open' ? nextAction(po) : null;
              return (
                <POPane poId={po.id as string} onFull={() => setShowDetail(po.id as string)}
                  actions={action ? <button type="button" className="odoo-btn-primary" onClick={action.run}>{action.label}</button> : undefined}
                  menu={[{ label: 'Télécharger le PDF', icon: Download, onSelect: () => { void handleDownloadPoPdf(po); } }]} />
              );
            }} />
          <TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} note="bons de commande" />
        </>
      ) : layout === 'kanban' ? (
        <>
          <KanbanView items={rows} getId={po => po.id as string} empty="Aucun BC"
            onOpen={po => { setActiveId(po.id as string); setLayout('split'); }}
            sum={cards => pmoney(cards.reduce((a, po) => a + (parseFloat(po.total_amount as string) || 0), 0))}
            lanes={view === 'open' ? [
              { key: 'draft', label: 'Brouillons', tone: 'grey', match: po => po.stage === 'draft' },
              { key: 'sent', label: 'Envoyés', tone: 'blue', match: po => po.stage === 'sent' && !po.is_late },
              { key: 'late', label: 'En retard', tone: 'red', match: po => (po.stage === 'sent' || po.stage === 'partial') && !!po.is_late },
              { key: 'partial', label: 'Réception partielle', tone: 'blue', match: po => po.stage === 'partial' && !po.is_late },
              { key: 'invoice', label: 'À facturer', tone: 'orange', match: po => po.stage === 'invoice' },
            ] : [
              { key: 'closed', label: 'Clôturés', tone: 'green', match: po => po.stage === 'closed' },
              { key: 'cancelled', label: 'Annulés / non livrés', tone: 'grey', match: po => po.stage !== 'closed' },
            ]}
            card={po => ({ num: String(po.order_number), title: String(po.supplier_name ?? '—'),
              meta: view === 'open' && po.expected_delivery_date ? `livraison ${pdate(po.expected_delivery_date, 'd MMM')}` : pdate(po.order_date, 'd MMM'),
              amount: pmoney(po.total_amount) })} />
          <p className="prj-note">{total > rows.length ? `${rows.length} BC affichés sur ${total} — affinez les filtres pour voir les autres.` : `${total} BC`}</p>
        </>
      ) : (
        <DataPanel label="Bons de commande" bulk={bulkBar}
          footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage}
            note={view === 'open'
              ? 'Seuls les bons de commande non clôturés sont chargés ici — les autres sont dans l\'Historique.'
              : `Clôturés et annulés · ${periodText}`} />}>
          <table className="odoo-table" style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
            <thead>
              <tr>
                <th style={{ width: 28 }} title="Cocher pour fusionner les factures liées"><span className="sr-only">Sélection</span></th>
                <th>N° de commande</th>
                <th>Fournisseur</th>
                <th>Étape</th>
                <th>{view === 'open' ? 'Livraison prévue' : 'Commandé le'}</th>
                <th className="ds-num">Montant HT ({currencySymbol()})</th>
                <th className="ds-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po, i) => {
                const id = po.id as string;
                const isExpanded = expandedRow === id;
                const status = po.status as string;
                const poStage = po.stage as string;
                const totalAmount = parseFloat(po.total_amount as string) || 0;
                const deliveredAmount = parseFloat(po.delivered_amount as string) || 0;
                const deliveryPct = totalAmount > 0 ? Math.min(100, (deliveredAmount / totalAmount) * 100) : 0;
                const action = view === 'open' ? nextAction(po) : null;
                // Historique : un intertitre par mois (les lignes arrivent triées par date décroissante).
                const month = format(new Date(po.order_date as string), 'MMMM yyyy', { locale: fr });
                const prevMonth = i > 0 ? format(new Date(rows[i - 1].order_date as string), 'MMMM yyyy', { locale: fr }) : null;
                const due = po.expected_delivery_date as string | null;
                // Une action visible ; le reste dans le menu de ligne.
                const menu: RowMenuItem[] = [
                  ...(action ? [{ label: 'Ouvrir la fiche', icon: Eye, onSelect: () => setShowDetail(id) }] : []),
                  ...(status !== 'en_attente' ? [{ label: 'Télécharger le PDF', icon: Download, onSelect: () => { void handleDownloadPoPdf(po); } }] : []),
                  // Édition complète tant que le BC est en brouillon et non gelé (mig 306).
                  ...(status === 'en_attente' && !po.frozen ? [{ label: 'Modifier', icon: Pencil, onSelect: () => setEditPoId(id) }] : []),
                  // Extourne de réception (ADMIN) : reverse stock + facture + compta.
                  ...(isAdmin && ['livre_complet', 'livre_partiel', 'en_attente_facturation'].includes(status)
                    ? [{ label: 'Extourner la réception', icon: PackageX, disabled: cancelReceptionMutation.isPending,
                        onSelect: () => setReverseFor({ id, orderNumber: po.order_number as string }) }] : []),
                  // Suppression : brouillon jamais engagé seulement ; un BC engagé s'annule (mig 307).
                  ...(status === 'en_attente' && !po.locked_at ? [{ label: 'Supprimer', icon: Trash2, danger: true, onSelect: () => { void askDelete(po); } }] : []),
                ];
                return (
                  <Fragment key={id}>
                    {view === 'history' && month !== prevMonth && (
                      <tr className="ds-group">
                        <td colSpan={colCount}>{month.charAt(0).toUpperCase() + month.slice(1)}</td>
                      </tr>
                    )}
                    <tr onClick={() => setExpandedRow(isExpanded ? null : id)} style={{ cursor: 'pointer' }} className={selectedPoIds.has(id) ? 'ds-selected' : undefined}>
                      <td onClick={e => e.stopPropagation()}>
                        {(() => {
                          const eligible = poIsEligible(po);
                          return (
                            <input type="checkbox"
                              checked={selectedPoIds.has(id)}
                              onChange={() => togglePoSelection(po)}
                              disabled={!eligible}
                              aria-label={`Sélectionner ${po.order_number}`}
                              title={eligible
                                ? (po.has_invoice ? 'Sélectionner pour la fusion' : 'Sélectionner — la facture sera générée à la fusion')
                                : 'Aucun article livré — fusion impossible'}
                              style={{ cursor: eligible ? 'pointer' : 'not-allowed' }} />
                          );
                        })()}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {isExpanded
                            ? <ChevronUp size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
                            : <ChevronDown size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
                          <span className="ds-ref">{po.order_number as string}</span>
                          {po.currency_code && String(po.currency_code).trim() !== BASE_CURRENCY && <span className="odoo-tag odoo-tag-blue" title={`Négocié en ${String(po.currency_code).trim()} · taux ${po.exchange_rate}`}>{String(po.currency_code).trim()}</span>}
                          {po.frozen && <span title="Bon de commande gelé" style={{ display: 'inline-flex', color: 'var(--ds-muted)' }}><Lock size={12} aria-label="Bon de commande gelé" /></span>}
                        </span>
                        {view === 'open' && (
                          <div style={{ fontSize: 12, color: 'var(--ds-muted)', marginLeft: 17 }}>
                            créé le {fmtDate(po.order_date as string)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="ds-strong">{po.supplier_name as string}</span>
                        <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                          {po.item_count as number} article{Number(po.item_count) > 1 ? 's' : ''}
                        </div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {stageTag(po)}
                          {po.approval_pending === true && <StatusTag tone="todo" label="À approuver" title="En attente d'approbation : partira au fournisseur dès l'accord" />}
                        </span>
                        <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{stageDetail(po)}</div>
                      </td>
                      <td>
                        {view === 'open' ? (
                          due ? (
                            <>
                              <span style={po.is_late ? { color: 'var(--ds-danger)', fontWeight: 600 } : undefined}>{fmtDate(due)}</span>
                              {po.is_late && (
                                <div style={{ fontSize: 12, color: 'var(--ds-danger)' }}>
                                  {differenceInCalendarDays(new Date(), new Date(due))} j de retard
                                </div>
                              )}
                            </>
                          ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>
                        ) : fmtDate(po.order_date as string)}
                      </td>
                      <td className="ds-num">
                        <span className="ds-strong">{n(totalAmount)}</span>
                        {poStage === 'partial' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                            <span style={{ width: 50, height: 3, background: 'var(--ds-hair)', borderRadius: 2, overflow: 'hidden' }}>
                              <span style={{ display: 'block', height: '100%', background: 'var(--ds-warning)', width: `${deliveryPct}%` }} />
                            </span>
                            <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{deliveryPct.toFixed(0)} % reçu</span>
                          </div>
                        )}
                      </td>
                      <td className="ds-actions" onClick={e => e.stopPropagation()}>
                        {action ? (
                          <button type="button" onClick={action.run} className="odoo-btn-secondary ds-btn-sm"
                            disabled={sendMutation.isPending || generateInvoiceMutation.isPending}>
                            {action.label}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setShowDetail(id)} className="odoo-btn-secondary ds-btn-sm">Ouvrir</button>
                        )}
                        <RowMenu items={menu} label={`Plus d'actions sur ${po.order_number}`} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={colCount} style={{ background: 'var(--ds-bg)', padding: '12px 16px' }}>
                          <ExpandedPORow poId={id} status={status} isAdmin={isAdmin}
                            onSend={() => sendMutation.mutate(id)}
                            onDelivery={() => openReception(id)}
                            onNotDelivered={() => setPoReason({ kind: 'not_delivered', poId: id, orderNumber: po.order_number as string })}
                            onCancel={() => setPoReason({ kind: 'cancel', poId: id, orderNumber: po.order_number as string })}
                            onHold={() => setPoReason({ kind: 'hold', poId: id, orderNumber: po.order_number as string })}
                            onStateAction={(kind) => poStateMutation.mutate({ kind, poId: id })}
                            onDelete={() => askDelete(po)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
      {showDetail && (
        <PODetailModal poId={showDetail} onClose={() => setShowDetail(null)}
          onSend={() => sendMutation.mutate(showDetail)}
          onDelivery={() => openReception(showDetail)}
          onCompletePrices={() => setEditPoId(showDetail)}
          onGenerateInvoice={async () => { if (await confirmDialog('Générer la facture de ce BC ?', { title: 'Générer la facture', confirmLabel: 'Générer la facture' })) generateInvoiceMutation.mutate(showDetail); }}
        />
      )}
      {editPoId && <EditPOModal poId={editPoId} onClose={() => setEditPoId(null)} />}
      {reverseFor && (
        <ReasonCodeDialog
          title={`Extourner la réception · ${reverseFor.orderNumber}`}
          scope="reverse"
          description="Un bon de réception miroir reprend chaque ligne en sens inverse : les lots passent « extournés », le stock est retiré, la facture automatique est annulée et son écriture contre-passée. Rien n'est supprimé. Impossible si un lot a déjà été consommé : corrigez alors la ligne."
          confirmLabel="Extourner"
          danger
          pending={cancelReceptionMutation.isPending}
          onClose={() => setReverseFor(null)}
          onSubmit={(reason) => cancelReceptionMutation.mutate({ id: reverseFor.id, reason })}
        />
      )}
      {poReason && (
        <ReasonCodeDialog
          title={`${PO_REASON_UI[poReason.kind].title} · ${poReason.orderNumber}`}
          scope={PO_REASON_UI[poReason.kind].scope}
          description={PO_REASON_UI[poReason.kind].description}
          confirmLabel={PO_REASON_UI[poReason.kind].confirm}
          danger={PO_REASON_UI[poReason.kind].danger}
          pending={poReasonMutation.isPending}
          onClose={() => setPoReason(null)}
          onSubmit={(reason) => poReasonMutation.mutate({ kind: poReason.kind, poId: poReason.poId, reason })}
        />
      )}
      {showMergeModal && (
        <MergeInvoicesModal
          selectedPOs={selectedPOs}
          isPending={mergeInvoicesMutation.isPending}
          onClose={() => setShowMergeModal(false)}
          onConfirm={(data) => mergeInvoicesMutation.mutate({
            purchaseOrderIds: Array.from(selectedPoIds),
            supplierInvoiceNumber: data.supplierInvoiceNumber || undefined,
            invoiceDate: data.invoiceDate || undefined,
          })}
        />
      )}
    </>
  );
}

/* ═══ Expanded Row — shows items inline ═══ */
function ExpandedPORow({ poId, status, isAdmin, onSend, onDelivery, onNotDelivered, onCancel, onHold, onStateAction, onDelete }: {
  poId: string; status: string; isAdmin: boolean;
  onSend: () => void; onDelivery: () => void; onNotDelivered: () => void;
  onCancel: () => void; onHold: () => void; onStateAction: (kind: 'release' | 'freeze' | 'unfreeze') => void;
  onDelete: () => void;
}) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  const queryClient = useQueryClient();
  const [lineReason, setLineReason] = useState<{ lineId: string | null; label: string } | null>(null);
  const { resolve: resolveCat } = useStockCategories();
  const [correctFor, setCorrectFor] = useState<{ lineId: string; label: string; unit: string } | null>(null);
  const correctMutation = useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: { delta: number; reasonCodeId: string; note?: string } }) =>
      purchaseOrdersApi.correctReceipt(poId, lineId, data),
    onSuccess: () => { refresh(); queryClient.invalidateQueries({ queryKey: ['inventory'] }); notify.success('Réception corrigée'); setCorrectFor(null); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Correction impossible')),
  });
  const [showChange, setShowChange] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['po-actions', poId] });
    queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
  };
  const closeRemainderMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string | null; reason: { reasonCodeId: string; note?: string } }) =>
      purchaseOrdersApi.closeRemainder(poId, reason, lineId ?? undefined),
    onSuccess: () => { refresh(); notify.success('Reliquat clôturé'); setLineReason(null); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Clôture impossible')),
  });
  const reopenMutation = useMutation({
    mutationFn: (lineId: string) => purchaseOrdersApi.reopenRemainder(poId, lineId),
    onSuccess: () => { refresh(); notify.success('Reliquat rouvert'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Réouverture impossible')),
  });

  if (isLoading) return <LoadingState bare label="Chargement des articles…" />;
  if (!po) return null;

  const items = (po.items || []) as POItem[];
  const canCloseRemainder = ['envoye', 'livre_partiel'].includes(status);
  const canChange = ['envoye', 'livre_partiel', 'livre_complet', 'en_attente_facturation'].includes(status) && !po.frozen;
  const qtyLabel = (base: number, item: POItem) => {
    const per = Number(item.qty_per_container ?? 1);
    const unit = item.base_unit || item.ingredient_unit;
    if (per === 1) return `${Number(base.toFixed(3))} ${unit}`;
    return `${Number((base / per).toFixed(3))} ${item.line_container_label ?? 'cont.'} (${Number(base.toFixed(3))} ${unit})`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {po.on_hold && (
        <StatusBanner tone="danger" icon={PauseCircle} title="BC bloqué : réception et facturation suspendues"
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => onStateAction('release')}>Lever le blocage</button>}>
          {po.hold_note ? `Précision : ${po.hold_note}` : 'Le motif figure dans l\'historique ci-dessous.'}
        </StatusBanner>
      )}
      {po.frozen && (
        <StatusBanner tone="info" icon={Snowflake} title="BC gelé : en-tête et lignes figés"
          actions={isAdmin ? <button type="button" className="odoo-btn-secondary" onClick={() => onStateAction('unfreeze')}>Dégeler</button> : undefined}>
          La réception et la facturation restent possibles.
        </StatusBanner>
      )}
      {/* Items table */}
      <DataPanel label="Articles du bon de commande">
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Article</th>
              <th>Catégorie</th>
              <th className="ds-num">Commandé</th>
              <th className="ds-num">Reçu</th>
              <th className="ds-num" title="Reliquat clôturé : quantité qui ne sera plus livrée">Clôturé</th>
              <th className="ds-num">Reste</th>
              <th className="ds-num">Prix unitaire ({currencySymbol()})</th>
              <th className="ds-num">Total HT ({currencySymbol()})</th>
              <th className="ds-num" style={{ width: 110 }}>Progression</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const ordered = parseFloat(item.quantity_ordered);
              const delivered = parseFloat(item.qty_received_base ?? item.quantity_delivered);
              const cancelled = parseFloat(item.qty_cancelled_base ?? '0');
              const remaining = parseFloat(item.qty_remaining_base ?? String(Math.max(ordered - delivered - cancelled, 0)));
              const pct = ordered > 0 ? Math.min(100, ((delivered + cancelled) / ordered) * 100) : 0;
              const price = item.unit_price != null ? parseFloat(item.unit_price) : null;
              return (
                <tr key={item.id}>
                  <td>
                    <span className="ds-strong">{item.ingredient_name}</span> <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}>({item.ingredient_unit})</span>
                    <LineKindTag kind={item.kind} />
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {isFreeLine(item.kind) ? (
                      <span style={{ color: 'var(--ds-muted)' }}>{resolveCat(item.item_category_id)?.path || '—'}</span>
                    ) : item.kind === 'product' ? (
                      <span style={{ color: 'var(--ds-muted)' }}>{resolveCat(item.item_category_id)?.path || 'Achats de marchandises'}</span>
                    ) : (
                    <CategoryQuickEdit
                      kind={(item.kind as 'ingredient' | 'consumable') || (item.packaging_id ? 'consumable' : 'ingredient')}
                      refId={item.packaging_id || item.ingredient_id}
                      categoryId={item.item_category_id ?? null}
                      itemName={item.ingredient_name}
                    />
                    )}
                  </td>
                  <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{qtyLabel(ordered, item)}</td>
                  <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>
                    <span style={delivered > 0 ? { color: 'var(--ds-success)', fontWeight: 600 } : { color: 'var(--ds-muted)' }}>{qtyLabel(delivered, item)}</span>
                    {delivered > 0 && ['livre_partiel', 'livre_complet', 'en_attente_facturation'].includes(status) && !po.has_invoice && (
                      <button type="button" className="ds-icon-btn" title="Corriger la quantité reçue" aria-label={`Corriger la quantité reçue de ${item.ingredient_name}`}
                        onClick={() => setCorrectFor({ lineId: item.id, label: item.ingredient_name, unit: item.base_unit || item.ingredient_unit })}><Pencil size={13} /></button>
                    )}
                  </td>
                  <td className="ds-num" style={{ whiteSpace: 'nowrap', color: 'var(--ds-muted)' }}>
                    {cancelled > 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {qtyLabel(cancelled, item)}
                        {!['annule', 'non_livre'].includes(status) && (
                          <button type="button" className="ds-icon-btn" title="Rouvrir le reliquat" aria-label={`Rouvrir le reliquat de ${item.ingredient_name}`} disabled={reopenMutation.isPending}
                            onClick={() => reopenMutation.mutate(item.id)}><Undo2 size={13} /></button>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>
                    {remaining > 0.0001 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: 'var(--ds-warning)', fontWeight: 600 }}>{qtyLabel(remaining, item)}</span>
                        {canCloseRemainder && (
                          <button type="button" className="ds-icon-btn" title="Clôturer le reliquat de cette ligne" aria-label={`Clôturer le reliquat de ${item.ingredient_name}`}
                            onClick={() => setLineReason({ lineId: item.id, label: item.ingredient_name })}><Scissors size={13} /></button>
                        )}
                      </span>
                    ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                  </td>
                  <td className="ds-num">{price != null ? n(price) : <span style={{ color: 'var(--ds-warning)', fontWeight: 600, fontSize: 12 }}>à définir</span>}</td>
                  <td className="ds-num ds-strong">{price != null ? n(ordered * price) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                  <td className="ds-num">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 64, height: 6, background: 'var(--ds-hair)', borderRadius: 999, overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', borderRadius: 999, width: `${pct}%`, background: pct >= 100 ? 'var(--ds-success)' : pct > 0 ? 'var(--ds-warning)' : 'var(--ds-line)' }} />
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--ds-muted)', minWidth: 36 }}>{pct.toFixed(0)} %</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>

      {/* Notes */}
      {po.notes && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={14} aria-hidden="true" /> {po.notes}
        </p>
      )}

      {/* Actions du BC : l'action d'avancement en premier, les actions destructrices à la fin. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {status === 'en_attente' && (
          <button type="button" onClick={onSend} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Send size={14} aria-hidden="true" /> Envoyer au fournisseur
          </button>
        )}
        {(status === 'envoye' || status === 'livre_partiel') && (
          <button type="button" onClick={onDelivery} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PackageCheck size={14} aria-hidden="true" /> Confirmer la réception
          </button>
        )}
        {canChange && (
          <button type="button" onClick={() => setShowChange(true)} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FilePenLine size={14} aria-hidden="true" /> Demande de changement
          </button>
        )}
        {canCloseRemainder && items.some(i => parseFloat(i.qty_remaining_base ?? '0') > 0.0001) && (
          <button type="button" onClick={() => setLineReason({ lineId: null, label: 'toutes les lignes' })} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Scissors size={14} aria-hidden="true" /> Clôturer le reliquat
          </button>
        )}
        {!po.on_hold && !['annule', 'non_livre'].includes(status) && (
          <button type="button" onClick={onHold} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PauseCircle size={14} aria-hidden="true" /> Bloquer
          </button>
        )}
        {po.on_hold && (
          <button type="button" onClick={() => onStateAction('release')} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PlayCircle size={14} aria-hidden="true" /> Lever le blocage
          </button>
        )}
        {isAdmin && !po.frozen && !['annule', 'non_livre'].includes(status) && (
          <button type="button" onClick={() => onStateAction('freeze')} className="odoo-btn-secondary" title="Figer en-tête et lignes (admin)" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Snowflake size={14} aria-hidden="true" /> Geler
          </button>
        )}
        <span className="ds-grow" />
        {/* Actions destructrices : toutes confirmées (motif codé, ou confirmation pour la suppression). */}
        {(status === 'envoye' || status === 'livre_partiel') && (
          <button type="button" onClick={onNotDelivered} className="ds-btn-danger">
            <PackageX size={14} aria-hidden="true" /> Non livré
          </button>
        )}
        {['en_attente', 'envoye'].includes(status) && (
          <button type="button" onClick={onCancel} className="ds-btn-danger">
            <Ban size={14} aria-hidden="true" /> Annuler le BC
          </button>
        )}
        {/* Suppression : brouillon jamais engagé seulement (mig 307). */}
        {status === 'en_attente' && !po.locked_at && (
          <button type="button" onClick={onDelete} className="ds-btn-danger">
            <Trash2 size={14} aria-hidden="true" /> Supprimer
          </button>
        )}
      </div>

      <DocumentActionsTimeline queryKey={['po-actions', poId]} fetcher={() => purchaseOrdersApi.actions(poId)} />

      {lineReason && (
        <ReasonCodeDialog
          title={`Clôturer le reliquat · ${lineReason.label}`}
          scope="force_close"
          description="La part non reçue ne sera plus attendue. La quantité commandée d'origine est conservée ; le reliquat clôturé reste visible et peut être rouvert tant que le BC n'est pas facturé."
          confirmLabel="Clôturer le reliquat"
          pending={closeRemainderMutation.isPending}
          onClose={() => setLineReason(null)}
          onSubmit={(reason) => closeRemainderMutation.mutate({ lineId: lineReason.lineId, reason })}
        />
      )}
      {showChange && <ChangeOrderModal po={po} onClose={() => setShowChange(false)} />}
      {correctFor && (
        <CorrectReceiptDialog target={correctFor} pending={correctMutation.isPending}
          onClose={() => setCorrectFor(null)}
          onSubmit={(data) => correctMutation.mutate({ lineId: correctFor.lineId, data })} />
      )}
    </div>
  );
}

/* ═══ Category quick-edit — corrige la categorie d'un article depuis le BC ═══ */
/**
 * Affiche la categorie d'un article (tag + racine) avec un crayon pour la
 * corriger sans quitter le BC. La correction met a jour le REFERENTIEL
 * (ingredients.category_id / packaging_items.category_id), pas seulement la
 * ligne : c'est la source des categories de charges.
 *
 * Changement de type (ingredient <-> consommable) :
 *  - ingredient -> consommable : possible si allowConvert (creation BC), via
 *    la conversion Economat existante (transfert stock + suppression des
 *    lignes BC non facturees) — confirmation explicite demandee.
 *  - consommable -> ingredient : pas de conversion inverse, renvoi Economat.
 */
function CategoryQuickEdit({ kind, refId, categoryId, itemName, allowConvert, onSaved }: {
  kind: 'ingredient' | 'consumable';
  refId: string;
  categoryId: string | null;
  /** Nom de l'article, affiche dans l'en-tete de la mini-fenetre de correction. */
  itemName?: string;
  allowConvert?: boolean;
  onSaved?: (categoryId: string, changed?: { kind: 'consumable'; refId: string }) => void;
}) {
  const confirmConvert = useConfirm();
  const queryClient = useQueryClient();
  const { resolve, tagClass, kindOf } = useStockCategories();
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  const cat = resolve(categoryId);

  const save = async () => {
    if (!selectedId) { notify.error('Choisissez une catégorie'); return; }
    const newKind = kindOf(selectedId);
    setSaving(true);
    try {
      let changed: { kind: 'consumable'; refId: string } | undefined;
      if (newKind === kind) {
        if (kind === 'ingredient') await ingredientsApi.update(refId, { categoryId: selectedId });
        else await packagingApi.update(refId, { category_id: selectedId });
        notify.success('Catégorie de l\'article corrigée');
      } else if (kind === 'ingredient' && allowConvert) {
        const catName = resolve(selectedId)?.path || 'consommable';
        if (!(await confirmConvert(
          `Cette catégorie (${catName}) transforme l'article en consommable.\n\n` +
          `Le stock sera transféré vers les Consommables, et l'article sera retiré ` +
          `des ingrédients ainsi que des lignes de BC non facturées.`,
          { title: 'Convertir en consommable', confirmLabel: 'Convertir', danger: true },
        ))) { setSaving(false); return; }
        const resp = await ingredientsApi.convertToConsumable(refId, selectedId);
        changed = { kind: 'consumable', refId: resp.packagingId as string };
        notify.success('Article converti en consommable');
      } else {
        notify.error(kind === 'consumable'
          ? 'Reclasser un consommable en ingrédient se fait depuis l\'Économat (Consommables)'
          : 'Cette catégorie change le type de l\'article : faites la conversion depuis l\'Économat');
        setSaving(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onSaved?.(selectedId, changed);
      setEditing(false);
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la correction de la catégorie');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        {cat ? (
          // Chemin hierarchique complet : "Racine › Sous-categorie › " en
          // texte attenue, feuille en tag colore (meme palette que l'Economat).
          <span className="flex items-center flex-wrap" style={{ fontSize: '12px', color: 'var(--ds-muted)', columnGap: 4, rowGap: 2 }}>
            {cat.path.split(' / ').slice(0, -1).map((seg, i) => (
              <Fragment key={i}>{seg} <span style={{ opacity: 0.6 }}>›</span> </Fragment>
            ))}
            <span className={`odoo-tag ${tagClass(categoryId)}`} style={{ fontSize: '12px' }}>{cat.typeName}</span>
          </span>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--ds-warning)', fontWeight: 600 }}>Sans catégorie</span>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(categoryId || ''); setEditing(true); }}
          title="Corriger la catégorie de l'article" aria-label={`Corriger la catégorie${itemName ? ` de ${itemName}` : ''}`}
          className="ds-icon-btn" style={{ flexShrink: 0 }}>
          <Pencil size={12} />
        </button>
      </div>

      {/* Mini-fenêtre superposée : évite de déformer le tableau (le sélecteur en cascade est trop haut pour une cellule). */}
      {editing && (
        <Modal title="Corriger la catégorie" subtitle={itemName} width={560} locked={saving} onClose={() => !saving && setEditing(false)}
          footer={<FormFooter onCancel={() => setEditing(false)} onSubmit={() => { void save(); }} busy={saving} disabled={!selectedId}
            submitLabel={saving ? 'Enregistrement…' : 'Enregistrer'} />}>
          {cat && (
            <p style={{ fontSize: 14, color: 'var(--ds-muted)', margin: 0 }}>
              Catégorie actuelle : <span style={{ fontWeight: 600, color: 'var(--ds-ink)' }}>{cat.path}</span>
            </p>
          )}
          <FormField label="Nouvelle catégorie" required>
            <CategoryCascadeSelector value={selectedId} onChange={setSelectedId} rootIds={PURCHASABLE_ROOT_IDS} />
          </FormField>
          <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: 0 }}>
            La correction s'applique à l'article dans le référentiel : Économat, prochains BC et charges en profitent aussitôt.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ═══ Create PO Modal ═══ */
function CreatePOModal({ onClose }: { onClose: () => void }) {
  const confirmLeave = useConfirm();
  const [createIdemKey] = useState(newIdempotencyKey);
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [searchIngredient, setSearchIngredient] = useState('');
  // Une ligne porte SOIT un ingredient (matiere premiere) SOIT un consommable
  // (packaging_items). kind decide la table cible cote serveur. categoryId =
  // categorie de l'article, affichee pour reperer les erreurs de classement
  // AVANT l'achat (elle sera figee sur la ligne de facture cote serveur).
  // container : regle « contenant entier » — la quantite se saisit en nombre de
  // contenants (minimum 1), quantityOrdered = nb x taille.
  // Ligne service / immobilisation : refId = cle locale, name = designation libre.
  const [items, setItems] = useState<{ kind: PoLineKind; refId: string; name: string; unit: string; categoryId: string | null; quantityOrdered: number; unitPrice: number | null; container: ContainerDef | null; containerCount: number }[]>([]);
  // fee : frais annexes ajoutes a un BC d'articles stockes (formulaire ponctuel, refermable).
  const [freeLine, setFreeLine] = useState<{ kind: 'service' | 'asset'; fee?: boolean; description: string; categoryId: string; quantity: string; unitPrice: string } | null>(null);
  // Nature de l'achat, choisie avant toute saisie : elle decide de la facon d'ajouter
  // les lignes (recherche d'articles stockes, ou saisie libre service / immobilisation).
  const [orderType, setOrderType] = useState<'stock' | 'service' | 'asset' | null>(null);
  const emptyFreeLine = (kind: 'service' | 'asset') => ({ kind, description: '', categoryId: '', quantity: '1', unitPrice: '' });
  const chooseOrderType = (t: 'stock' | 'service' | 'asset') => {
    setOrderType(t);
    setFreeLine(t === 'stock' ? null : emptyFreeLine(t));
  };
  const changeOrderType = async () => {
    if (items.length > 0 && !(await confirmLeave('Changer de type d\'achat retire les lignes déjà saisies.', { title: 'Changer de type d\'achat', confirmLabel: 'Changer', danger: true }))) return;
    setItems([]);
    setOrderType(null);
    setFreeLine(null);
  };
  const [showNewIngredient, setShowNewIngredient] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  // Devise du BC (mig 363) : les prix des lignes se saisissent dans cette devise ; le taux
  // (DH pour 1 unité) est figé à la création et le serveur garde les deux prix.
  const { data: currencies = [] } = useQuery({ queryKey: ['currencies'], queryFn: () => currenciesApi.list(), staleTime: 60_000 });
  const [currency, setCurrency] = useState(BASE_CURRENCY);
  const [rateInput, setRateInput] = useState('1');
  const rate = currency === BASE_CURRENCY ? 1 : (parseFloat(rateInput) || 0);
  const curLabel = currency === BASE_CURRENCY ? currencySymbol() : currency;
  /** Change la devise : les prix déjà saisis sont convertis au taux du jour (prix en DH inchangé). */
  const changeCurrency = (code: string) => {
    if (code === currency) return;
    const next = code === BASE_CURRENCY ? 1 : parseFloat(String(currencies.find(c => c.code === code)?.rate ?? '')) || 0;
    if (code !== BASE_CURRENCY && !next) notify.error(`Aucun taux saisi pour ${code} : renseignez-le ici ou dans Paramètres › Devises.`);
    if (rate > 0 && next > 0) {
      setItems(prev => prev.map(it => it.unitPrice ? { ...it, unitPrice: Math.round(it.unitPrice * rate / next * 10000) / 10000 } : it));
    }
    setCurrency(code);
    setRateInput(next ? String(next) : '');
  };
  /** Coût standard (DH) converti dans la devise du BC pour préremplir une ligne. */
  const toCur = (dh: number) => (dh > 0 && rate > 0 ? Math.round(dh / rate * 10000) / 10000 : null);
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });
  const { data: consumables = [] } = useQuery({ queryKey: ['packaging-items'], queryFn: () => packagingApi.list({ activeOnly: true }) });
  // Produits de revente (mig 619) : achetés en l'état, ils entrent en stock produit à la réception.
  const { data: resaleProducts = [] } = useQuery({
    queryKey: ['products', 'resale-purchasable'],
    queryFn: async () => ((await productsApi.list({ limit: '500' }))?.data as Record<string, any>[] ?? [])
      .filter(pr => pr.item_kind === 'resale'),
  });
  const { kindOf, resolve, byId, leavesUnder } = useStockCategories();
  // Categories proposees pour une ligne sans article, selon son type.
  const freeCategoryOptions = useMemo(() => {
    if (!freeLine) return [];
    const roots = freeLine.kind === 'asset' ? ASSET_ROOT_IDS : freeLine.fee ? FEE_ROOT_IDS : SERVICE_ROOT_IDS;
    return roots.filter(r => byId.has(r)).flatMap(r => leavesUnder(r)).map(leaf => {
      const path = resolve(leaf.id)?.path.split(' / ') || [];
      const years = (byId.get(String(leaf.id)) as any)?.asset_duration_years;
      return { id: String(leaf.id), label: leaf.name, sublabel: path.slice(0, -1).join(' › '), detail: years ? `${years} ans` : undefined };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeLine?.kind, freeLine?.fee, byId]);

  const supplierOptions = useMemo(() => (suppliers as Record<string, any>[])
    .filter(s => s.is_active !== false)
    .map(s => ({ id: String(s.id), label: String(s.name), sublabel: (s.city as string) || undefined })), [suppliers]);
  const supplierName = supplierOptions.find(o => o.id === supplierId)?.label || '';

  // Fermer un BC en cours de saisie fait perdre les lignes : on demande confirmation.
  const requestClose = async () => {
    if (items.length > 0 && !(await confirmLeave('Les articles saisis seront perdus.', { title: 'Abandonner ce bon de commande ?', confirmLabel: 'Abandonner', cancelLabel: 'Continuer la saisie', danger: true }))) return;
    onClose();
  };

  const createMutation = useMutation({
    // Une clé par formulaire ouvert : un double clic ne crée pas deux BC (mig 307).
    mutationFn: (data: Record<string, any>) => purchaseOrdersApi.create(data, createIdemKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      notify.success('Bon de commande créé');
      onClose();
    },
    onError: () => notify.error('Erreur lors de la création'),
  });

  const onProductCreated = (kind: 'ingredient' | 'consumable') => (created: Record<string, any>) => {
    queryClient.invalidateQueries({ queryKey: [kind === 'consumable' ? 'packaging-items' : 'ingredients'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    const cost = parseFloat(created.unit_cost as string) || 0;
    const container = kind === 'ingredient' ? containerOf(created) : null;
    setItems(prev => [...prev, {
      kind,
      refId: created.id as string,
      name: created.name as string,
      unit: created.unit as string,
      categoryId: (created.category_id as string) || null,
      quantityOrdered: container ? container.size : 1,
      unitPrice: toCur(cost),
      container, containerCount: 1,
    }]);
    setShowNewIngredient(false);
    setSearchIngredient('');
    notify.success(`${kind === 'consumable' ? 'Consommable' : 'Ingrédient'} "${created.name}" créé et ajouté`);
  };

  const createIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: onProductCreated('ingredient'),
    onError: () => notify.error('Erreur lors de la création de l\'ingrédient'),
  });
  const createConsumableMutation = useMutation({
    mutationFn: packagingApi.create,
    onSuccess: onProductCreated('consumable'),
    onError: () => notify.error('Erreur lors de la création du consommable'),
  });
  const isCreatingProduct = createIngredientMutation.isPending || createConsumableMutation.isPending;

  const handleCreateProduct = (data: Record<string, any>) => {
    // Routage par categorie : consommable -> packaging_items, sinon ingredients.
    // ATTENTION aux conventions de payload : l'API packaging attend du
    // snake_case (category_id/unit_cost), l'API ingredients du camelCase.
    if (kindOf(data.categoryId) === 'consumable') {
      createConsumableMutation.mutate({
        name: data.name, unit: data.unit,
        category_id: data.categoryId || null,
        unit_cost: data.unitCost,
      });
    } else {
      createIngredientMutation.mutate(data);
    }
  };

  // Articles deja ajoutes (cle composite kind:id pour ne pas confondre les tables).
  const addedKeys = new Set(items.map(it => `${it.kind}:${it.refId}`));
  const norm = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const search = norm(searchIngredient);
  const isUsual = (p: Record<string, any>) => !!supplierName && norm(p.supplier) === norm(supplierName);
  const available: Record<string, any>[] = [
    ...(ingredients as Record<string, any>[])
      .filter(ing => !addedKeys.has(`ingredient:${ing.id}`))
      .map(ing => ({ ...ing, _kind: 'ingredient' }) as Record<string, any>),
    ...(consumables as Record<string, any>[])
      .filter(c => !addedKeys.has(`consumable:${c.id}`))
      .map(c => ({ ...c, _kind: 'consumable' }) as Record<string, any>),
    ...(resaleProducts as Record<string, any>[])
      .filter(pr => !addedKeys.has(`product:${pr.id}`))
      .map(pr => ({ ...pr, unit: 'unit', unit_cost: pr.cost_price, category_id: null, _kind: 'product' }) as Record<string, any>),
  ];
  // Recherche insensible aux accents ; les articles habituels du fournisseur remontent en tete.
  const filteredProducts = available
    .filter(p => search && norm(p.name).includes(search))
    .sort((a, b) => Number(isUsual(b)) - Number(isUsual(a)))
    .slice(0, 12);
  // Raccourcis : articles dont la fiche indique ce fournisseur, ajoutables en un clic.
  const usualProducts = available.filter(isUsual).slice(0, 16);
  useEffect(() => { setHighlighted(0); }, [searchIngredient]);

  const addProduct = (p: Record<string, any>) => {
    const cost = parseFloat(p.unit_cost as string) || 0;
    const container = p._kind === 'ingredient' ? containerOf(p) : null;
    setItems([...items, {
      kind: p._kind as 'ingredient' | 'consumable' | 'product',
      refId: p.id as string,
      name: p.name as string,
      unit: p.unit as string,
      categoryId: (p.category_id as string) || null,
      quantityOrdered: container ? container.size : 1,
      unitPrice: toCur(cost),
      container, containerCount: 1,
    }]);
    setSearchIngredient('');
    searchRef.current?.focus();
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchOpen(true); setHighlighted(h => Math.min(h + 1, filteredProducts.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredProducts[highlighted]) addProduct(filteredProducts[highlighted]);
      else if (searchIngredient.trim()) setShowNewIngredient(true);
    } else if (e.key === 'Escape') { e.stopPropagation(); setSearchIngredient(''); setSearchOpen(false); }
  };

  const setDeliveryIn = (days: number) => setExpectedDate(format(addDays(new Date(), days), 'yyyy-MM-dd'));
  const deliveryQuick = [{ label: 'Demain', days: 1 }, { label: 'Dans 2 j', days: 2 }, { label: 'Dans 1 sem.', days: 7 }];

  const addFreeLine = () => {
    if (!freeLine) return;
    const qty = parseFloat(freeLine.quantity) || 0;
    if (!freeLine.description.trim()) { notify.error('Saisissez la désignation'); return; }
    if (!freeLine.categoryId) { notify.error('Choisissez la catégorie de dépense'); return; }
    if (!(qty > 0)) { notify.error('La quantité doit être supérieure à 0'); return; }
    const price = parseFloat(freeLine.unitPrice);
    setItems(prev => [...prev, {
      kind: freeLine.kind, refId: `free-${Date.now()}`, name: freeLine.description.trim(), unit: 'unit',
      categoryId: freeLine.categoryId, quantityOrdered: qty, unitPrice: price > 0 ? price : null,
      container: null, containerCount: 1,
    }]);
    // Le formulaire reste ouvert, vide, pour la ligne suivante.
    setFreeLine(freeLine.fee ? null : emptyFreeLine(freeLine.kind));
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: number) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const totalAmount = items.reduce((sum, it) => sum + it.quantityOrdered * (it.unitPrice || 0), 0);
  const hasMissingPrices = items.some(it => it.unitPrice == null || it.unitPrice === 0);

  const handleSubmit = () => {
    if (!supplierId) { notify.error('Sélectionnez un fournisseur'); return; }
    if (items.length === 0) { notify.error('Ajoutez au moins un article'); return; }
    const invalidItems = items.filter(it => it.quantityOrdered <= 0);
    if (invalidItems.length > 0) { notify.error('Les quantités doivent être supérieures à 0'); return; }
    if (!(rate > 0)) { notify.error(`Saisissez le taux de change ${currency}`); return; }
    createMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDate || undefined,
      notes: notes || undefined,
      ...(currency !== BASE_CURRENCY ? { currencyCode: currency, exchangeRate: rate } : {}),
      items: items.map(({ kind, refId, name, categoryId, quantityOrdered, unitPrice }) => ({
        ingredientId: kind === 'ingredient' ? refId : null,
        packagingId: kind === 'consumable' ? refId : null,
        productId: kind === 'product' ? refId : null,
        ...(isFreeLine(kind) ? { lineType: kind, description: name, categoryId, unit: 'unit' } : {}),
        quantityOrdered,
        unitPrice: unitPrice != null && unitPrice > 0 ? Math.round(unitPrice * rate * 10000) / 10000 : null,
        ...(currency !== BASE_CURRENCY && unitPrice != null && unitPrice > 0 ? { foreignUnitPrice: unitPrice } : {}),
      })),
    });
  };

  return (
    <>
    {/* Quasi plein écran : le BC est le flux de saisie principal (tableau articles + recherche). */}
    <Modal title="Nouveau bon de commande" width={1600} onClose={() => { void requestClose(); }}
      locked={createMutation.isPending || showNewIngredient}
      subtitle={!orderType ? 'Quel type d\'achat ?'
        : `${ORDER_TYPES.find(t => t.key === orderType)!.label}${supplierName ? ` · chez ${supplierName}` : ''}`}
      aside={orderType ? (
        <button type="button" onClick={changeOrderType} className="ds-btn-ghost ds-btn-sm">Changer de type</button>
      ) : undefined}
      footer={
        <FormFooter onCancel={() => { void requestClose(); }} onSubmit={handleSubmit} busy={createMutation.isPending}
          disabled={items.length === 0 || !supplierId} dirty={items.length > 0}
          submitLabel={createMutation.isPending ? 'Création…' : 'Créer le bon de commande'}>
          {items.length > 0 && (
            <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>{items.length} article{items.length > 1 ? 's' : ''} — <span style={{ fontWeight: 700, color: 'var(--ds-ink)' }}>{n(totalAmount)} {curLabel}</span>{currency !== BASE_CURRENCY && rate > 0 && <> ≈ {money(totalAmount * rate)}</>}</span>
          )}
          {items.length > 0 && !supplierId && <span style={{ fontSize: 12, color: 'var(--ds-danger)' }}>Choisissez un fournisseur.</span>}
        </FormFooter>
      }>
          {/* Étape 0 : nature de l'achat (comme le « type de commande » des ERP). */}
          {!orderType && (
            <div style={{ maxWidth: 920, margin: '2rem auto 0' }}>
              <h3 className="ds-subhead" style={{ marginBottom: 4 }}>Que voulez-vous commander ?</h3>
              <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: '0 0 16px' }}>
                Le type décide de la réception et de la comptabilisation. Il ne change plus une fois des lignes saisies.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {ORDER_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => chooseOrderType(t.key)}
                    className="ds-panel text-left hover:shadow-md transition-shadow"
                    style={{ border: 0, padding: '16px 20px', cursor: 'pointer', font: 'inherit' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, backgroundColor: t.tint, color: t.color, marginBottom: 10 }}>
                      <t.icon size={18} />
                    </span>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 15, color: 'var(--ds-ink)' }}>{t.label}</span>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--ds-muted)', marginTop: 4 }}>{t.examples}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ds-hair)' }}>{t.effect}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {orderType && (<>
          {/* Fournisseur + livraison + notes */}
          <FormSection title="Commande">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Fournisseur" required error={items.length > 0 && !supplierId ? 'Choisissez le fournisseur de ce bon de commande.' : undefined}>
              <SearchSelect options={supplierOptions} value={supplierId} width="100%"
                onChange={id => {
                  setSupplierId(id);
                  const sc = String((suppliers as Record<string, any>[]).find(s => String(s.id) === id)?.currency_code ?? BASE_CURRENCY).trim();
                  if (id && currencies.some(c => c.code === sc)) changeCurrency(sc);
                  if (id && orderType === 'stock') setTimeout(() => searchRef.current?.focus(), 0); }}
                placeholder="Rechercher un fournisseur…" />
            </FormField>
            <FormField label="Livraison prévue" htmlFor="po-new-expected">
              <div className="flex items-center gap-2">
                <input id="po-new-expected" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="ds-input" style={{ flex: 1, minWidth: 0 }} />
                {deliveryQuick.map(q => {
                  const active = expectedDate === format(addDays(new Date(), q.days), 'yyyy-MM-dd');
                  return (
                    <button key={q.days} type="button" onClick={() => setDeliveryIn(q.days)}
                      className={`${active ? 'odoo-btn-primary' : 'odoo-btn-secondary'} ds-btn-sm`} aria-pressed={active}
                      style={{ whiteSpace: 'nowrap' }}>
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </FormField>
            <FormField label="Notes" htmlFor="po-new-notes">
              <input id="po-new-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="ds-input" placeholder="Optionnel…" />
            </FormField>
          </div>

          {currencies.length > 1 && (
            <div className="flex items-end gap-3 flex-wrap">
              <div style={{ width: 200 }}>
                <FormField label="Devise du bon">
                  <SearchSelect value={currency} onChange={changeCurrency} clearable={false}
                    placeholder="Devise" width="100%" size="md" ariaLabel="Devise du bon"
                    options={currencies.map(c => ({ id: c.code, label: `${c.code} — ${c.label}` }))} />
                </FormField>
              </div>
              {currency !== BASE_CURRENCY && (<>
                <div style={{ width: 180 }}>
                  <FormField label={`Taux : 1 ${currency} = … ${currencySymbol()}`} htmlFor="po-new-rate" required error={rate > 0 ? undefined : 'Saisissez le taux de change.'}>
                    <input id="po-new-rate" type="number" min={0} step="0.0001" value={rateInput} onChange={e => setRateInput(e.target.value)} className="ds-input ds-num" aria-required="true" />
                  </FormField>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: 0, flex: '1 1 260px' }}>
                  Prix saisis en {currency}. Le taux est figé sur le bon ; stock, coût matière et facture restent en {currencySymbol()}.
                </p>
              </>)}
            </div>
          )}
          </FormSection>

          {/* Recherche d'articles (ingredients + consommables) */}
          <FormSection title="Articles">
          <div>
            {orderType === 'stock' && (<>
            <label htmlFor="po-new-search" className="ds-field-label" style={{ display: 'block', marginBottom: 6 }}>Ajouter des articles</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ds-muted)' }} />
                <input id="po-new-search" ref={searchRef} type="text" placeholder="Tapez le nom d'un article puis Entrée (↑ ↓ pour choisir)…"
                  value={searchIngredient}
                  onChange={e => { setSearchIngredient(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  onKeyDown={onSearchKeyDown}
                  className="ds-input" style={{ paddingLeft: 30 }} />
                {searchOpen && search && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 30, backgroundColor: 'var(--ds-card)', border: '1px solid var(--ds-sep)', borderRadius: 4, maxHeight: 320, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                    {filteredProducts.map((p, i) => {
                      const catPath = resolve(p.category_id as string | null)?.path;
                      const cont = p._kind === 'ingredient' ? containerOf(p) : null;
                      return (
                        <button type="button" key={`${p._kind}:${p.id as string}`}
                          onMouseDown={e => { e.preventDefault(); addProduct(p); }}
                          onMouseEnter={() => setHighlighted(i)}
                          className="w-full text-left text-sm flex items-center justify-between gap-3"
                          style={{ padding: '0.5rem 0.75rem', backgroundColor: i === highlighted ? 'var(--ds-tint)' : 'transparent' }}>
                          <span style={{ minWidth: 0 }}>
                            <span className="font-medium">
                              {p.name as string} <span style={{ color: 'var(--ds-muted)' }}>({p.unit as string})</span>
                              {p._kind === 'consumable' && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6, fontSize: '11px' }}>Consommable</span>}
                              {p._kind === 'product' && <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 6, fontSize: '11px' }}>Revente</span>}
                              {isUsual(p) && <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 6, fontSize: '11px' }}>Habituel</span>}
                            </span>
                            {/* Chemin de categorie : repere une erreur de classement avant l'achat */}
                            <span style={{ display: 'block', fontSize: '12px', color: catPath || p._kind === 'product' ? 'var(--ds-muted)' : 'var(--ds-warning)' }}>
                              {p._kind === 'product' ? 'Produit de revente · Achats de marchandises' : (catPath || 'Sans catégorie')}{cont ? ` · ${containerLabel(cont, p.unit as string)}` : ''}
                            </span>
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>{n(parseFloat(p.unit_cost as string) || 0)} {currencySymbol()}/{p.unit as string}</span>
                        </button>
                      );
                    })}
                    <button type="button" onMouseDown={e => { e.preventDefault(); setShowNewIngredient(true); }}
                      className="w-full text-left text-sm flex items-center gap-2"
                      style={{ padding: '0.5rem 0.75rem', borderTop: filteredProducts.length ? '1px solid var(--ds-sep)' : 'none', color: 'var(--ds-accent)', fontWeight: 600,
                        backgroundColor: filteredProducts.length === 0 ? 'var(--ds-tint)' : 'transparent' }}>
                      <Plus size={14} /> Créer « {searchIngredient.trim()} »
                      {filteredProducts.length === 0 && <span style={{ fontWeight: 400, color: 'var(--ds-muted)', fontSize: '12px' }}>— aucun article trouvé (Entrée)</span>}
                    </button>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setShowNewIngredient(true)}
                className="odoo-btn-secondary whitespace-nowrap shrink-0" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={14} /> Nouvel article
              </button>
            </div>
            {/* Frais annexes facturés avec la marchandise : ligne de charge, sans stock. */}
            {!freeLine && (
              <button type="button"
                onClick={() => setFreeLine({ kind: 'service', fee: true, description: 'Transport', categoryId: byId.has(DEFAULT_FEE_CATEGORY_ID) ? DEFAULT_FEE_CATEGORY_ID : '', quantity: '1', unitPrice: '' })}
                className="ds-btn-ghost ds-btn-sm" style={{ marginTop: 8, color: 'var(--ds-accent-ink)' }}>
                <Plus size={12} aria-hidden="true" /> Frais annexes <span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>(transport, livraison… facturés avec la marchandise)</span>
              </button>
            )}
            </>)}
            {freeLine && (
              <div style={{ marginTop: 10, border: '1px solid var(--ds-hair)', borderRadius: 12, padding: '12px 16px', backgroundColor: 'var(--ds-bg)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <strong className="ds-subhead">
                    {freeLine.fee ? 'Ajouter des frais annexes' : freeLine.kind === 'asset' ? 'Ajouter une immobilisation' : 'Ajouter un service / des frais'}
                  </strong>
                  {freeLine.fee && (
                    <button type="button" onClick={() => setFreeLine(null)} title="Fermer" aria-label="Fermer les frais annexes" className="ds-icon-btn"><X size={14} /></button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-4">
                    <FormField label="Désignation" htmlFor="po-free-desc" required>
                    <input id="po-free-desc" type="text" autoFocus key={`desc-${items.length}`} value={freeLine.description} className="ds-input"
                      placeholder={freeLine.fee ? 'Ex : Transport, frais de livraison' : freeLine.kind === 'asset' ? 'Ex : Pétrin spirale 60 L' : 'Ex : Réparation four à sole'}
                      onChange={e => setFreeLine({ ...freeLine, description: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFreeLine(); } }} />
                    </FormField>
                  </div>
                  <div className="md:col-span-4">
                    <FormField label="Catégorie" required>
                    <SearchSelect options={freeCategoryOptions} value={freeLine.categoryId} width="100%"
                      onChange={id => setFreeLine({ ...freeLine, categoryId: id })}
                      placeholder={freeLine.kind === 'asset' ? 'Matériel, mobilier, informatique…' : 'Réparations, transport, énergie…'} />
                    </FormField>
                  </div>
                  <div className="md:col-span-1">
                    <FormField label="Qté" htmlFor="po-free-qty" required>
                    <input id="po-free-qty" type="number" min={0} step="1" value={freeLine.quantity} className="ds-input ds-num"
                      onChange={e => setFreeLine({ ...freeLine, quantity: e.target.value })} />
                    </FormField>
                  </div>
                  <div className="md:col-span-2">
                    <FormField label={`Prix unit. HT (${curLabel})`} htmlFor="po-free-price">
                    <input id="po-free-price" type="number" min={0} step="0.01" value={freeLine.unitPrice} className="ds-input ds-num"
                      onChange={e => setFreeLine({ ...freeLine, unitPrice: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFreeLine(); } }} />
                    </FormField>
                  </div>
                  <div className="md:col-span-1">
                    <button type="button" onClick={addFreeLine} className="odoo-btn-primary w-full" style={{ justifyContent: 'center' }}>Ajouter</button>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: '8px 0 0' }}>
                  {freeLine.kind === 'asset'
                    ? <>Pas de stock : à la réception (mise en service), le bien est porté en immobilisation (compte 23xx) et sa fiche d'amortissement est créée automatiquement{(() => { const y = (byId.get(freeLine.categoryId) as any)?.asset_duration_years; return y ? `, amortie sur ${y} ans` : ''; })()}.</>
                    : freeLine.fee
                      ? <>Imputés en charge selon la catégorie (ex. 6142 transport), sans entrer dans le coût des articles. Ils se réceptionnent avec la marchandise et figurent sur la même facture.</>
                      : <>Pas de stock : la réception vaut « service rendu », la dépense est imputée en charge selon la catégorie.</>}
                </p>
              </div>
            )}
            {orderType === 'stock' && usualProducts.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: '0 0 6px' }}>
                  Articles habituels chez <strong>{supplierName}</strong> — un clic pour ajouter
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {usualProducts.map(p => (
                    <button type="button" key={`${p._kind}:${p.id as string}`} onClick={() => addProduct(p)} className="prj-chip">
                      <Plus size={11} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /> {p.name as string}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Lignes du BC */}
          {items.length > 0 && (
            <DataPanel label="Lignes du bon de commande"
              footer={
                <TableFooter note={<>{items.length} article{items.length > 1 ? 's' : ''}{hasMissingPrices && <span style={{ marginLeft: 8, color: 'var(--ds-warning)' }}>(prix à définir par le fournisseur)</span>}</>}>
                  <strong style={{ color: 'var(--ds-ink)' }}>{totalAmount > 0 ? `Total : ${n(totalAmount)} ${curLabel}${currency !== BASE_CURRENCY && rate > 0 ? ` ≈ ${money(totalAmount * rate)}` : ''}` : 'Prix à définir'}</strong>
                </TableFooter>
              }>
              <table className="odoo-table ds-dense">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Catégorie</th>
                    <th className="ds-num" style={{ width: 128 }}>Quantité</th>
                    <th className="ds-num" style={{ width: 128 }}>Prix unit. ({curLabel})</th>
                    <th className="ds-num" style={{ width: 112 }}>Sous-total ({curLabel})</th>
                    <th className="ds-actions" style={{ width: 40 }}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={`${item.kind}:${item.refId}`}>
                      <td>
                        <span className="ds-strong">{item.name}</span>
                        {!isFreeLine(item.kind) && <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 4 }}>({item.unit})</span>}
                        <LineKindTag kind={item.kind} />
                      </td>
                      <td>
                        {item.kind === 'service' || item.kind === 'asset' ? (
                          <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{resolve(item.categoryId)?.path || '—'}</span>
                        ) : item.kind === 'product' ? (
                          // Produit de revente (mig 619) : imputé en Achats de marchandises (6111) côté serveur.
                          <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>Achats de marchandises</span>
                        ) : (
                        <CategoryQuickEdit
                          kind={item.kind} refId={item.refId} categoryId={item.categoryId}
                          itemName={item.name} allowConvert
                          onSaved={(catId, changed) => setItems(prev => prev.map((it, i) =>
                            i === idx ? { ...it, categoryId: catId, ...(changed ? { kind: changed.kind, refId: changed.refId } : {}) } : it
                          ))}
                        />
                        )}
                      </td>
                      <td>
                        {item.container ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <input type="number" min={1} step="1" value={item.containerCount || ''} className="ds-input sm ds-num"
                              aria-label={`Nombre de contenants — ${item.name}`}
                              onChange={(e) => {
                                const count = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
                                setItems(prev => prev.map((it, i) => i === idx ? { ...it, containerCount: count, quantityOrdered: count * (it.container as ContainerDef).size } : it));
                              }}
                              style={{ width: 64 }} title={`${containerLabel(item.container, item.unit)} — commande par contenant entier`} />
                            <span style={{ fontSize: '12px', color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>
                              × {containerLabel(item.container, item.unit)} = <strong>{n(item.quantityOrdered)} {item.unit}</strong>
                            </span>
                          </div>
                        ) : (
                          <input type="number" min={0.01} step="0.01" value={item.quantityOrdered || ''} className="ds-input sm ds-num"
                            aria-label={`Quantité — ${item.name}`} aria-invalid={item.quantityOrdered <= 0 || undefined}
                            onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)} />
                        )}
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" value={item.unitPrice ?? ''} className="ds-input sm ds-num"
                          aria-label={`Prix unitaire — ${item.name}`}
                          onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          placeholder="Optionnel" />
                      </td>
                      <td className="ds-num ds-strong">
                        {item.unitPrice ? n(item.quantityOrdered * item.unitPrice) : <span style={{ color: 'var(--ds-muted)', fontSize: 12, fontWeight: 400 }}>À définir</span>}
                      </td>
                      <td className="ds-actions">
                        <button type="button" onClick={() => removeItem(idx)} className="ds-icon-btn" title="Retirer" aria-label={`Retirer ${item.name}`}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          )}

          {items.length === 0 && (
            <EmptyState icon={ShoppingBag} title="Aucune ligne pour l'instant"
              text={!supplierId ? 'Commencez par choisir le fournisseur.'
                : orderType === 'stock' ? 'Recherchez un article ou cliquez un article habituel.'
                : 'Remplissez le formulaire ci-dessus puis « Ajouter ».'} />
          )}
          </FormSection>
          </>)}
    </Modal>
    {showNewIngredient && (
      <IngredientFormModal mode="create" title="Nouvel article" initialName={searchIngredient.trim()} initialSupplier={supplierName}
        rootIds={PURCHASABLE_ROOT_IDS} isConsumable={id => kindOf(id) === 'consumable'}
        onClose={() => setShowNewIngredient(false)} onSave={handleCreateProduct} isLoading={isCreatingProduct} />
    )}
    </>
  );
}

/* ═══ PO Detail Modal ═══ */
/**
 * Fiche d'un BC, présentée comme un processus : frise des étapes (brouillon → envoyé →
 * réception → facture → clôturé), prochaine étape avec son action, lignes commandé /
 * reçu / reste, montants, factures liées et historique.
 * Les actions sont optionnelles : sans elles (ex. depuis le Pilotage) la fiche est en lecture.
 */
export function PODetailModal({ poId, onClose, onSend, onDelivery, onCompletePrices, onGenerateInvoice }: {
  poId: string;
  onClose: () => void;
  onSend?: () => void;
  onDelivery?: () => void;
  onCompletePrices?: () => void;
  onGenerateInvoice?: () => void;
}) {
  const { data: po, isLoading, error } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });
  const [downloading, setDownloading] = useState(false);
  // Note fournisseur (mig 362) pour la carte fournisseur ; absente = pas encore évalué.
  const { data: standings = [] } = useQuery({ queryKey: ['supplier-scores', 'latest'], queryFn: supplierScoreApi.latest, retry: false, staleTime: 300_000 });

  if (isLoading || !po) {
    return (
      <Modal title="Bon de commande" width={420} onClose={onClose}>
        {isLoading ? <LoadingState bare label="Chargement du bon de commande…" />
          : error ? <ErrorState bare error={error} title="Le bon de commande n'a pas pu être chargé" />
          : <EmptyState bare icon={FileText} title="Bon de commande introuvable" />}
      </Modal>
    );
  }

  const items = (po.items || []) as POItem[];
  const invoices = (po.invoices || []) as Array<{ id: string; invoice_number: string; supplier_invoice_number: string | null; invoice_date: string; status: string; total_amount: string; paid_amount: string }>;
  const num = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
  const price = (it: POItem) => (it.unit_price != null ? num(it.unit_price) : 0);
  const totalOrdered = items.reduce((s, it) => s + num(it.quantity_ordered) * price(it), 0);
  const totalReceived = items.reduce((s, it) => s + num(it.quantity_delivered) * price(it), 0);
  // Devise du BC (mig 363) : prix DH = référence ; prix devise affiché en regard.
  const poCur = String(po.currency_code ?? BASE_CURRENCY).trim();
  const totalForeign = items.reduce((s, it) => s + num(it.quantity_ordered) * (it.foreign_unit_price != null ? num(it.foreign_unit_price) : price(it) / (num(po.exchange_rate) || 1)), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + num(i.total_amount), 0);
  const linesDone = items.filter(it => num(it.qty_remaining_base ?? Math.max(0, num(it.quantity_ordered) - num(it.quantity_delivered))) <= 0).length;
  const missingPrices = items.filter(it => it.unit_price == null).length;
  const remainingLines = items.filter(it => num(it.qty_remaining_base) > 0);

  const status = po.status as string;
  const cancelled = status === 'annule' || status === 'non_livre';
  // Même dérivation que le serveur (purchaseOrderRepository._stagedCte).
  const stage = status === 'en_attente' ? 0
    : status === 'envoye' ? 1
    : status === 'livre_partiel' ? 2
    : status === 'en_attente_facturation' || (status === 'livre_complet' && invoices.length === 0) ? 3
    : status === 'livre_complet' ? 5 : -1;
  const d = (v?: string | null) => (v ? format(new Date(v), 'd MMM yyyy', { locale: fr }) : null);
  const isLate = [0, 1, 2].includes(stage) && po.expected_delivery_date && new Date(po.expected_delivery_date) < new Date(new Date().toDateString());

  const steps = [
    { label: 'Brouillon', detail: `créé le ${d(po.order_date)}` },
    { label: 'Envoyé', detail: stage >= 1 ? (d(po.locked_at) ? `le ${d(po.locked_at)}` : 'au fournisseur') : 'à envoyer' },
    { label: 'Réception', detail: stage >= 2 ? `${linesDone}/${items.length} ligne${items.length > 1 ? 's' : ''}` : po.expected_delivery_date ? `prévue le ${d(po.expected_delivery_date)}` : 'à venir' },
    { label: 'Facture', detail: invoices.length ? invoices.map(i => i.supplier_invoice_number || i.invoice_number).join(', ') : stage >= 3 ? 'en attente' : '—' },
    { label: 'Clôturé', detail: stage === 5 ? 'reçu et facturé' : '—' },
  ];

  // Prochaine étape : ce qu'il reste à faire, et le bouton qui le fait.
  const next: { tone: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; title: string; text: string; action?: { label: string; run: () => void } } =
    cancelled ? { tone: 'neutral', title: status === 'annule' ? 'Bon de commande annulé' : 'Déclaré non livré', text: [po.cancel_note, d(po.cancelled_at) && `le ${d(po.cancelled_at)}`].filter(Boolean).join(' · ') || 'Ce BC ne sera plus livré.' }
    : po.on_hold ? { tone: 'danger', title: 'BC bloqué', text: po.hold_note || 'Ni réception ni facture tant que le blocage n\'est pas levé.' }
    : stage === 0 ? { tone: 'info', title: 'Prochaine étape : envoyer au fournisseur', text: missingPrices ? `${missingPrices} article${missingPrices > 1 ? 's' : ''} sans prix : vérifiez avant l'envoi.` : 'Le BC est prêt : il sera verrouillé une fois envoyé.', action: onSend && { label: 'Envoyer', run: onSend } }
    : stage === 1 ? { tone: isLate ? 'danger' : 'info', title: isLate ? 'Livraison en retard' : 'Prochaine étape : réceptionner', text: po.expected_delivery_date ? `Livraison prévue le ${d(po.expected_delivery_date)}.` : 'Aucune date de livraison prévue.', action: onDelivery && { label: 'Réceptionner', run: onDelivery } }
    : stage === 2 ? { tone: 'warning', title: 'Prochaine étape : réceptionner le reliquat', text: `${remainingLines.length} article${remainingLines.length > 1 ? 's' : ''} restent attendus (${remainingLines.slice(0, 3).map(it => it.ingredient_name).join(', ')}${remainingLines.length > 3 ? '…' : ''}). Si le fournisseur ne livrera pas, soldez le reste depuis la ligne du BC.`, action: onDelivery && { label: 'Réceptionner le reliquat', run: onDelivery } }
    : stage === 3 ? (status === 'en_attente_facturation'
        ? { tone: 'warning', title: 'Prochaine étape : compléter les prix', text: `${missingPrices} article${missingPrices > 1 ? 's' : ''} reçu${missingPrices > 1 ? 's' : ''} sans prix : la facture ne peut pas être établie.`, action: onCompletePrices && { label: 'Compléter les prix', run: onCompletePrices } }
        : { tone: 'warning', title: 'Prochaine étape : facturer', text: 'Tout est reçu mais aucune facture n\'est rattachée.', action: onGenerateInvoice && { label: 'Générer la facture', run: onGenerateInvoice } })
    : { tone: 'success', title: 'Bon de commande clôturé', text: 'Reçu et facturé.' };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const response = await purchaseOrdersApi.downloadPdf(poId);
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify.error('Erreur lors du téléchargement du PDF');
    } finally {
      setDownloading(false);
    }
  };

  // Chaîne des pièces (refonte 2026-11) : demandes → demande de prix → BC → réceptions → factures → paiement.
  const receptions = (po.receptions || []) as Array<{ id: string; voucher_number: string; created_at: string }>;
  const rfqDoc = po.rfq as { id: string; number: string; title: string } | null;
  const requestCount = num(po.request_count);
  const totalPaid = invoices.reduce((s, i) => s + num(i.paid_amount), 0);
  const allPaid = invoices.length > 0 && invoices.every(i => num(i.paid_amount) >= num(i.total_amount) - 0.005);
  const chain: Array<{ kind: string; ref: string; sub: string; state: 'done' | 'current' | 'warn' | 'todo' }> = [
    ...(requestCount > 0 ? [{ kind: 'Demande', ref: `${requestCount} DA`, sub: 'couverte(s)', state: 'done' as const }] : []),
    ...(rfqDoc ? [{ kind: 'Demande de prix', ref: rfqDoc.number, sub: 'devis retenu', state: 'done' as const }] : []),
    { kind: 'Commande', ref: po.order_number, sub: cancelled ? (status === 'annule' ? 'annulée' : 'non livrée') : stage === 0 ? 'brouillon' : `envoyée${d(po.locked_at) ? ` le ${d(po.locked_at)}` : ''}`, state: 'current' },
    { kind: 'Réception', ref: receptions.length ? receptions[receptions.length - 1].voucher_number : '—', sub: receptions.length ? (stage === 2 ? `partielle · ${receptions.length} bon(s)` : `${receptions.length} bon(s)`) : isLate ? 'en retard' : 'à venir', state: receptions.length ? (stage === 2 ? 'warn' : 'done') : isLate ? 'warn' : 'todo' },
    { kind: 'Facture', ref: invoices.length ? (invoices[0].supplier_invoice_number || invoices[0].invoice_number) : '—', sub: invoices.length ? `${invoices.length} facture(s)` : stage >= 3 ? 'attendue' : 'à venir', state: invoices.length ? 'done' : stage >= 3 ? 'warn' : 'todo' },
    { kind: 'Paiement', ref: invoices.length ? `${money(totalPaid)}` : '—', sub: allPaid ? 'réglé' : invoices.length ? `reste ${n(totalInvoiced - totalPaid)}` : 'à venir', state: allPaid ? 'done' : 'todo' },
  ];
  const receivedPct = totalOrdered > 0 ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0;
  const invoicedPct = totalOrdered > 0 ? Math.min(100, (totalInvoiced / totalOrdered) * 100) : 0;
  const lineCheck = (it: POItem): { cls: 'ok' | 'wait' | 'gap'; label: string } => {
    const ordered = num(it.quantity_ordered); const received = num(it.quantity_delivered);
    const remaining = it.qty_remaining_base != null ? num(it.qty_remaining_base) : Math.max(0, ordered - received);
    if (it.unit_price == null) return { cls: 'gap', label: 'Prix à définir' };
    if (received > ordered + 1e-9) return { cls: 'gap', label: 'Surlivré' };
    if (remaining > 0) return { cls: 'wait', label: received > 0 ? 'Reliquat' : 'À recevoir' };
    return { cls: 'ok', label: 'Reçu' };
  };
  const lineGaps = items.filter(it => lineCheck(it).cls === 'gap').length;
  const standing = standings.find(x => x.supplier_id === po.supplier_id);
  const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

  // Étiquette d'étape de la fiche (mêmes tons que la liste).
  const stageKey = cancelled ? null : ['draft', 'sent', 'partial', 'invoice', 'closed', 'closed'][stage] ?? null;
  const stageDef = PO_STAGES.find(x => x.key === stageKey);
  // Fond gris de feuille, cartes blanches sans bordure, titres en casse normale.
  const card: CSSProperties = { borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--ds-card)', boxShadow: 'var(--ds-shadow)' };

  return (
    <Modal title={`Bon de commande ${po.order_number}`} subtitle="Bons de commande" width={1120} onClose={onClose} label={`Bon de commande ${po.order_number}`}
      aside={
        <button type="button" onClick={downloadPdf} disabled={downloading || stage === 0} className="odoo-btn-secondary ds-btn-sm"
          title={stage === 0 ? 'PDF disponible une fois le BC envoyé' : 'Ouvrir le PDF'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {downloading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />} PDF
        </button>
      }>
        {/* Fond gris de feuille sous les cartes blanches (le corps de la fenêtre est blanc). */}
        <div className="kl-po-body pur-scope" style={{ margin: -20, background: 'var(--ds-bg)' }}>
          {/* Identité */}
          <div style={{ padding: '16px 20px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', fontSize: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 21, letterSpacing: '-.02em', color: 'var(--ds-ink)' }}>{po.supplier_name}</span>
            <StatusTag
              tone={cancelled ? 'cancelled' : po.on_hold ? 'blocked' : isLate ? 'late' : PO_TONE[stageKey ?? ''] ?? 'cancelled'}
              icon={stageDef?.icon}
              label={`${stageDef?.label ?? (status === 'non_livre' ? 'Non livré' : 'Annulé')}${cancelled ? '' : po.on_hold ? ' · bloqué' : isLate ? ' · en retard' : ''}`} />
            {po.frozen && <StatusTag tone="draft" icon={Lock} label="Gelé" title="En-tête et lignes figés" />}
            <span style={{ color: 'var(--ds-muted)' }}>
              {items.length} article{items.length > 1 ? 's' : ''} · <strong style={{ color: 'var(--ds-ink)' }}>{money(totalOrdered)}</strong>
              {poCur !== BASE_CURRENCY && <> · <strong style={{ color: 'var(--ds-ink)' }}>{n(totalForeign)} {poCur}</strong> <span className="odoo-tag odoo-tag-blue">1 {poCur} = {num(po.exchange_rate).toLocaleString('fr-FR', { maximumFractionDigits: 6 })} {currencySymbol()}</span></>}
              {po.created_by_name && <> · créé par {po.created_by_name}</>}
            </span>
          </div>

          {/* Chaîne des pièces liées */}
          <div className="pur-chain" aria-label="Pièces liées" style={{ padding: '14px 20px 0' }}>
            {chain.map((c, i) => (
              <Fragment key={c.kind}>
                {i > 0 && <ArrowRight size={14} className="pur-chain-arrow" aria-hidden="true" />}
                <span className={`pur-doc ${c.state}`}><small>{c.kind}</small><strong>{c.ref}</strong><span>{c.sub}</span></span>
              </Fragment>
            ))}
          </div>

          {/* Frise du processus */}
          {!cancelled ? (
            <ol className="ui-timeline kl-po-timeline" aria-label="Avancement du bon de commande" style={{ margin: '14px 20px 0' }}>
              {steps.map((s, i) => {
                const done = i < stage || stage === 5;
                const current = i === stage;
                return (
                  <li key={s.label} className={`ui-timeline-step ${done ? 'is-done' : current ? 'is-current' : ''}`} aria-current={current ? 'step' : undefined}>
                    <span className="ui-timeline-dot">{done ? <CheckCircle2 size={14} /> : null}</span>
                    <span className="ui-timeline-label">{s.label}</span>
                    <span className="ui-timeline-detail" style={current && isLate ? { color: 'var(--ds-danger)', fontWeight: 600 } : undefined}>{s.detail}</span>
                  </li>
                );
              })}
            </ol>
          ) : <div style={{ height: 12 }} />}

          <div style={{ padding: '16px 20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="prj-kpis" aria-label="Avancement">
              <div className="prj-kpi"><div className="prj-kpi-head"><span>Reçu</span><span>{linesDone} / {items.length} lignes</span></div>
                <div className="prj-kpi-value">{Math.round(receivedPct)} %</div><div className="prj-bar"><span style={{ width: `${receivedPct}%` }} /></div></div>
              <div className="prj-kpi"><div className="prj-kpi-head"><span>Facturé</span><span>{invoices.length} facture(s)</span></div>
                <div className="prj-kpi-value">{money(totalInvoiced)}</div><div className="prj-bar green"><span style={{ width: `${invoicedPct}%` }} /></div></div>
              <div className="prj-kpi"><div className="prj-kpi-head"><span>Contrôle des lignes</span><span>prix · quantités</span></div>
                <div className="prj-kpi-value" style={{ color: lineGaps ? 'var(--prj-orange)' : 'var(--prj-green)' }}>{lineGaps ? `${lineGaps} écart${lineGaps > 1 ? 's' : ''}` : 'Aucun écart'}</div>
                <div className="prj-kpi-sub">{missingPrices ? `${missingPrices} prix à définir` : 'prix renseignés'}</div></div>
              <div className="prj-kpi"><div className="prj-kpi-head"><span>Total commandé HT</span><span>{poCur !== BASE_CURRENCY ? poCur : currencySymbol()}</span></div>
                <div className="prj-kpi-value">{money(totalOrdered)}</div><div className="prj-kpi-sub">réglé {money(totalPaid)}</div></div>
            </div>

            <StatusBanner tone={next.tone} icon={next.tone === 'success' ? CheckCircle2 : next.tone === 'neutral' ? Ban : next.tone === 'danger' ? AlertTriangle : Clock}
              title={next.title}
              actions={next.action ? (
                <button type="button" className="odoo-btn-primary" onClick={() => { next.action!.run(); onClose(); }}>{next.action.label}</button>
              ) : undefined}>
              {next.text}
            </StatusBanner>

            {po.notes && (
              <div style={{ fontSize: 14, color: 'var(--ds-muted)', display: 'flex', gap: 6 }}>
                <FileText size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} /> {po.notes}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              {/* Articles */}
              <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionHeader title="Articles" note={`${items.length} ligne${items.length > 1 ? 's' : ''}`} />
                <DataPanel label="Articles du bon de commande">
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th className="ds-num">Commandé</th>
                      <th className="ds-num">Reçu</th>
                      <th className="ds-num">Reste</th>
                      <th className="ds-num">Prix unitaire ({currencySymbol()})</th>
                      <th className="ds-num">Montant HT ({currencySymbol()})</th>
                      <th>Contrôle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const ordered = num(it.quantity_ordered);
                      const received = num(it.quantity_delivered);
                      const remaining = it.qty_remaining_base != null ? num(it.qty_remaining_base) : Math.max(0, ordered - received);
                      const cancelledQty = num(it.qty_cancelled_base);
                      const unit = it.base_unit || it.ingredient_unit;
                      const dot = remaining <= 0 ? 'var(--ds-success)' : received > 0 ? 'var(--ds-warning)' : 'var(--ds-line)';
                      return (
                        <tr key={it.id}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dot, flexShrink: 0 }} />
                              <span className="ds-strong">{it.ingredient_name}</span>
                            </span>
                            {cancelledQty > 0 && <div style={{ fontSize: 12, color: 'var(--ds-muted)', marginLeft: 16 }}>{trimQty(cancelledQty)} {unit} soldé{cancelledQty > 1 ? 's' : ''} sans livraison</div>}
                          </td>
                          {/* L'unité varie d'une ligne à l'autre : elle reste dans la cellule « Commandé ». */}
                          <td className="ds-num">{trimQty(ordered)} <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{unit}</span></td>
                          <td className="ds-num" style={received > 0 ? undefined : { color: 'var(--ds-muted)' }}>{trimQty(received)}</td>
                          <td className="ds-num" style={remaining > 0 ? { color: 'var(--ds-warning)', fontWeight: 600 } : { color: 'var(--ds-muted)' }}>{remaining > 0 ? trimQty(remaining) : '—'}</td>
                          <td className="ds-num">
                            {it.unit_price != null ? n(num(it.unit_price)) : <span style={{ color: 'var(--ds-warning)', fontWeight: 600, fontSize: 12 }}>à définir</span>}
                            {poCur !== BASE_CURRENCY && it.foreign_unit_price != null && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{n(num(it.foreign_unit_price))} {poCur}</div>}
                          </td>
                          <td className="ds-num ds-strong">{it.unit_price != null ? n(ordered * num(it.unit_price)) : '—'}</td>
                          <td>{(() => { const c = lineCheck(it); return <span className={`pur-check ${c.cls}`}>{c.label}</span>; })()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td colSpan={5}>Total</td>
                      <td className="ds-num">{n(totalOrdered)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                </DataPanel>
              </div>

              {/* Colonne de droite */}
              <aside style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <section style={card} aria-label="Fournisseur">
                  <div className="pur-supplier">
                    <span className="pur-supplier-logo">{initialsOf(String(po.supplier_name ?? '?'))}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong className="ds-strong" style={{ display: 'block', fontSize: 15 }}>{po.supplier_name}</strong>
                      <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{[po.supplier_contact, po.supplier_phone].filter(Boolean).join(' · ') || 'contact non renseigné'}</span>
                    </span>
                    {standing && standing.standing !== 'new' && (
                      <span className={`kl-pill ${standing.standing === 'A' ? 'g' : standing.standing === 'B' ? 'b' : standing.standing === 'C' ? 'o' : 'r'}`} title={`Évaluation au ${standing.period_to}`}>{standing.standing}{standing.score != null ? ` · ${Math.round(Number(standing.score))}/100` : ''}</span>
                    )}
                  </div>
                </section>

                <section style={card} aria-label="Dates">
                  <h3 className="ds-subhead">Dates</h3>
                  {[
                    { label: 'Commandé le', value: d(po.order_date) },
                    { label: 'Livraison prévue', value: d(po.expected_delivery_date), late: isLate },
                    { label: 'Livré le', value: d(po.delivery_date) },
                  ].map(x => (
                    <span key={x.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span style={{ color: 'var(--ds-muted)' }}>{x.label}</span>
                      <span style={x.late ? { color: 'var(--ds-danger)', fontWeight: 600 } : { color: 'var(--ds-ink)' }}>{x.value ?? '—'}</span>
                    </span>
                  ))}
                </section>

                <section style={card} aria-label="Factures liées">
                  <h3 className="ds-subhead">Factures</h3>
                  {invoices.length === 0 ? (
                    <span style={{ fontSize: 14, color: 'var(--ds-muted)' }}>Aucune facture rattachée.</span>
                  ) : invoices.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <span>
                        <span className="ds-ref">{inv.supplier_invoice_number || inv.invoice_number}</span>
                        <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}> · {d(inv.invoice_date)}</span>
                      </span>
                      {num(inv.paid_amount) >= num(inv.total_amount) - 0.005
                        ? <StatusTag tone="done" label="Réglée" />
                        : <StatusTag tone="todo" label={`Reste ${n(num(inv.total_amount) - num(inv.paid_amount))}`} />}
                    </div>
                  ))}
                </section>
              </aside>
            </div>

            <section aria-label="Historique" style={card}>
              <h3 className="ds-subhead">Historique</h3>
              <DocumentActionsTimeline queryKey={['po-actions', poId]} fetcher={() => purchaseOrdersApi.actions(poId)} />
            </section>
          </div>
        </div>
    </Modal>
  );
}

function trimQty(v: number) {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

/* ═══ Réception d'un bon de commande ═══
 * Page du module Achats (?tab=reception&po=<id>, fil d'Ariane « Achats › Réceptions › n° du BC »),
 * ouverte depuis la liste des BC, la fiche du BC et la liste des Réceptions. Ex-DeliveryModal :
 * mêmes champs, mêmes contrôles, même appel (confirmDelivery).
 */
const RCPT_CARD: CSSProperties = { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 };
const LINK_BTN: CSSProperties = { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--ds-accent-ink)', cursor: 'pointer', textDecoration: 'underline' };

/** Étiquette d'étape d'un BC chargé par getById (même dérivation que la fiche du BC et le serveur). */
function poStageTagOf(po: Record<string, any>) {
  const status = po.status as string;
  const invoices = (po.invoices || []) as unknown[];
  const cancelled = status === 'annule' || status === 'non_livre';
  const key = cancelled ? null
    : status === 'en_attente' ? 'draft'
    : status === 'envoye' ? 'sent'
    : status === 'livre_partiel' ? 'partial'
    : status === 'en_attente_facturation' || (status === 'livre_complet' && invoices.length === 0) ? 'invoice'
    : status === 'livre_complet' ? 'closed' : null;
  const def = PO_STAGES.find(x => x.key === key);
  const isLate = (key === 'draft' || key === 'sent' || key === 'partial') && !!po.expected_delivery_date
    && new Date(po.expected_delivery_date) < new Date(new Date().toDateString());
  return (
    <StatusTag tone={cancelled ? 'cancelled' : po.on_hold ? 'blocked' : isLate ? 'late' : PO_TONE[key ?? ''] ?? 'cancelled'} icon={def?.icon}
      label={`${def?.label ?? (status === 'non_livre' ? 'Non livré' : 'Annulé')}${cancelled ? '' : po.on_hold ? ' · bloqué' : isLate ? ' · en retard' : ''}`} />
  );
}

export function ReceptionForm({ poId, onDone, onCancel }: {
  poId: string;
  /** Après une réception enregistrée (la notification est déjà affichée). */
  onDone: () => void;
  /** Annuler : retour à la page précédente. */
  onCancel: () => void;
}) {
  // Une clé par réception ouverte : une validation rejouée ne réceptionne pas deux fois (mig 307).
  const [deliveryIdemKey] = useState(newIdempotencyKey);
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();
  const { data: po, isLoading, error } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });
  // Fiche du BC consultée depuis la page (lien « ouvrir le bon de commande »).
  const [showOrder, setShowOrder] = useState(false);

  const [deliveries, setDeliveries] = useState<Record<string, number>>({});
  // Saisie par contenant : nb de contenants par ligne. Pilote la qty reçue en kg
  // (nb x container_size) quand l'ingrédient a une taille de contenant définie.
  const [containerCounts, setContainerCounts] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [lotInfo, setLotInfo] = useState<Record<string, { supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }>>({});
  // Pesée de contrôle (L5 P2P, mig 462) : brut/tare par ligne, net = brut − tare, saisie
  // manuelle (balance connectée à venir). Pertinente SEULEMENT pour les marchandises au
  // poids (kg/g), et ouverte À LA DEMANDE par ligne (pas de sous-ligne permanente partout).
  // Pesée ouverte dans une petite fenêtre (une ligne à la fois), pas de sous-ligne.
  const [weighFor, setWeighFor] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, { gross?: string; tare?: string }>>({});
  // Article au poids : unité de masse/volume mesurable (pas une unité comptée à la pièce).
  const isWeighable = (unit?: string | null) => {
    const u = (unit || '').trim().toLowerCase();
    return !!u && !['unit', 'unité', 'u', 'pièce', 'piece', 'pc', 'pcs', 'pce'].includes(u);
  };
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState('');
  // forceComplete : le fournisseur ne livrera pas le reste. Le BC est cloture
  // sur ce qui a ete recu (qty_ordered alignee sur qty_delivered, lignes vides
  // supprimees).
  const [forceComplete, setForceComplete] = useState(false);
  // Frais annexes saisis à la réception (transport, douane, manutention) : frais d'approche
  // (mig 361) créés et appliqués sur la réception, au prorata de la valeur reçue.
  const [fees, setFees] = useState<{ key: number; label: string; amount: string; categoryId: string }[]>([]);
  const { byId: feeById, leavesUnder: feeLeavesUnder, resolve: feeResolve } = useStockCategories();
  const feeCategoryOptions = useMemo(() => FEE_ROOT_IDS.filter(r => feeById.has(r)).flatMap(r => feeLeavesUnder(r)).map(leaf => ({
    id: String(leaf.id), label: leaf.name, sublabel: (feeResolve(leaf.id)?.path.split(' / ') || []).slice(0, -1).join(' › '),
  })), [feeById, feeLeavesUnder, feeResolve]);
  const feesTotal = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const addFee = () => setFees(f => [...f, { key: Date.now(), label: f.length ? '' : 'Transport', amount: '', categoryId: feeById.has(DEFAULT_FEE_CATEGORY_ID) ? DEFAULT_FEE_CATEGORY_ID : '' }]);

  const confirmMutation = useMutation({
    mutationFn: (data: { items: { itemId: string; quantityDelivered: number; unitPrice?: number; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[]; supplierInvoiceNumber?: string; supplierInvoiceDate?: string; forceComplete?: boolean }) =>
      purchaseOrdersApi.confirmDelivery(poId, data, deliveryIdemKey),
    onSuccess: (r: { warnings?: string[]; lotNumbers?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['eligible-pos'] });
      notify.success(`Réception confirmée${r?.lotNumbers?.length ? ` — lots ${r.lotNumbers.join(', ')}` : ''}`);
      // Exigences lot / DLC non satisfaites (mode « warn », mig 308) : signalées sans bloquer.
      if (r?.warnings?.length) notify.warning(`Traçabilité incomplète : ${r.warnings.join(' ; ')}`, { duration: 12000 });
      onDone();
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la confirmation');
    },
  });

  if (isLoading) return <LoadingState label="Chargement du bon de commande…" />;
  if (error) return <ErrorState error={error} title="Le bon de commande n'a pas pu être chargé" />;
  if (!po) {
    return (
      <EmptyState icon={FileText} title="Bon de commande introuvable"
        action={<button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={onCancel}>Retour</button>} />
    );
  }

  const items = (po.items || []) as POItem[];
  const pending = confirmMutation.isPending;

  // Cette reception va-t-elle completer entierement le BC ?
  // (impacte la creation automatique de la facture cote backend)
  // forceComplete : on cloture meme si la couverture n'est pas totale.
  const naturallyComplete = items.every((item) => {
    const ordered = parseFloat(item.quantity_ordered);
    const alreadyDelivered = parseFloat(item.quantity_delivered);
    const beingDelivered = deliveries[item.id] || 0;
    return alreadyDelivered + beingDelivered >= ordered;
  });
  const willCompletePO = naturallyComplete || forceComplete;

  const handleSubmit = async () => {
    // Anti double envoi : une réception en cours d'enregistrement n'est pas relancée.
    if (confirmMutation.isPending) return;
    const deliveredItems = Object.entries(deliveries)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantityDelivered]) => {
        // Pesée de contrôle : on envoie brut/tare/net seulement si un poids a été saisi.
        const w = weights[itemId];
        const gross = w?.gross != null && w.gross !== '' ? Number(w.gross) : null;
        const tare = w?.tare != null && w.tare !== '' ? Number(w.tare) : null;
        const net = gross != null ? Math.max(0, gross - (tare ?? 0)) : null;
        return {
          itemId, quantityDelivered,
          ...(prices[itemId] != null && prices[itemId] > 0 ? { unitPrice: prices[itemId] } : {}),
          ...lotInfo[itemId],
          ...(gross != null ? { grossWeight: gross, tareWeight: tare, netWeight: net } : {}),
        };
      });
    if (deliveredItems.length === 0) { notify.error('Saisissez au moins une quantité livrée'); return; }
    // Article sous contrôle qualité (L5) : n° de lot fournisseur obligatoire avant réception.
    const qcNoLot = deliveredItems
      .map(d => items.find(it => it.id === d.itemId))
      .find(it => it?.requires_qc && !lotInfo[it.id]?.supplierLotNumber?.trim());
    if (qcNoLot) { notify.error(`${qcNoLot.ingredient_name} : n° de lot fournisseur obligatoire (article sous contrôle qualité)`); return; }
    // Si cette reception va creer la facture (livraison complete), on conseille
    // fortement le N° de facture fournisseur — sinon le systeme retombera
    // sur un numero auto-genere (legacy, non recommande).
    if (willCompletePO && !supplierInvoiceNumber.trim()) {
      const proceed = await confirmDialog(
        'Aucun N° de facture fournisseur saisi.\n\n' +
        'Cette réception va clôturer le BC et créer automatiquement la facture. ' +
        'Sans N° de facture fournisseur, le système générera un numéro interne ' +
        '(non recommandé — il vaut mieux saisir celui imprimé sur la facture papier).\n\n' +
        'Continuer sans le numéro ?',
        { title: 'N° de facture fournisseur manquant', confirmLabel: 'Continuer sans le numéro' },
      );
      if (!proceed) return;
    }
    confirmMutation.mutate({
      items: deliveredItems,
      ...(supplierInvoiceNumber.trim() ? { supplierInvoiceNumber: supplierInvoiceNumber.trim() } : {}),
      ...(supplierInvoiceDate ? { supplierInvoiceDate } : {}),
      ...(forceComplete ? { forceComplete: true } : {}),
      ...(fees.some(f => f.label.trim() && Number(f.amount)) ? { extraFees: fees.filter(f => f.label.trim() && Number(f.amount)).map(f => ({ label: f.label.trim(), amount: Number(f.amount), categoryId: f.categoryId || null })) } : {}),
    });
  };

  const fillAll = () => {
    const filled: Record<string, number> = {};
    const filledPrices: Record<string, number> = {};
    items.forEach((item) => {
      const remaining = parseFloat(item.quantity_ordered) - parseFloat(item.quantity_delivered);
      if (remaining > 0) {
        filled[item.id] = remaining;
        if (item.unit_price != null) filledPrices[item.id] = parseFloat(item.unit_price);
      }
    });
    setDeliveries(filled);
    setPrices(prev => ({ ...prev, ...filledPrices }));
  };

  const totalDelivering = Object.entries(deliveries).reduce((sum, [itemId, qty]) => {
    const price = prices[itemId] ?? (() => { const item = items.find(it => it.id === itemId); return item?.unit_price != null ? parseFloat(item.unit_price) : 0; })();
    return sum + qty * price;
  }, 0);

  const submitLabel = pending ? 'Confirmation…' : 'Confirmer la réception';
  const expected = po.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'd MMM yyyy', { locale: fr }) : null;

  return (
    <>
      {/* Actions de la page, à droite du fil d'Ariane : Annuler puis l'action principale. */}
      <PurHeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={onCancel} disabled={pending}>Annuler</button>
        <button type="button" className="odoo-btn-primary" onClick={() => { void handleSubmit(); }} disabled={pending} aria-busy={pending || undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {pending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <PackageCheck size={14} aria-hidden="true" />} {submitLabel}
        </button>
      </PurHeaderActions>

      <PageHeader title={`Réception · ${po.order_number}`} aside={poStageTagOf(po)}
        description={<>
          {po.supplier_name} · {items.length} article{items.length > 1 ? 's' : ''}
          {' · '}{expected ? `livraison prévue le ${expected}` : 'livraison sans date prévue'}
          {' · '}<button type="button" style={LINK_BTN} onClick={() => setShowOrder(true)}>ouvrir le bon de commande</button>
        </>} />

      {/* Bon de livraison : facture fournisseur (N° et date imprimés sur le document papier) et frais annexes. */}
      <section className="ds-panel" style={RCPT_CARD} aria-label="Bon de livraison">
        <SectionHeader title="Bon de livraison"
          note={willCompletePO ? 'cette réception clôture le BC et crée la facture' : 'facture optionnelle pour une livraison partielle'} />
        <Alert tone={willCompletePO ? 'warning' : 'info'} icon={FileText}>
          {willCompletePO
            ? 'Cette réception va clôturer le BC. Saisis le N° imprimé sur la facture papier du fournisseur (il sera utilisé tel quel, pas auto-généré).'
            : 'Optionnel pour une livraison partielle. Tu pourras le saisir lors de la livraison finale.'}
        </Alert>
        <div className="ds-form-grid cols-4">
          <FormField label="N° de facture fournisseur" htmlFor="po-rcpt-inv-number" required={willCompletePO}>
            <input id="po-rcpt-inv-number" type="text" className="ds-input" value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="Ex: FAC-2026-12345" />
          </FormField>
          <FormField label="Date de la facture" htmlFor="po-rcpt-inv-date">
            <input id="po-rcpt-inv-date" type="date" className="ds-input" value={supplierInvoiceDate}
              onChange={(e) => setSupplierInvoiceDate(e.target.value)} />
          </FormField>
        </div>
        {/* Frais annexes à la réception : intégrés au coût des articles reçus (frais d'approche, mig 361). */}
        {fees.length === 0 ? (
          <div>
            <button type="button" onClick={addFee} className="ds-btn-ghost ds-btn-sm" style={{ color: 'var(--ds-accent-ink)' }}>
              <Plus size={12} aria-hidden="true" /> Frais annexes <span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>(transport, douane, manutention… répartis sur les articles reçus)</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--ds-hair)', paddingTop: 12 }}>
            <div className="flex items-center justify-between">
              <h3 className="ds-subhead">Frais annexes de cette réception</h3>
              <span style={{ fontSize: 14 }}>Total <strong>{feesTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencySymbol()}</strong></span>
            </div>
            {fees.map((f, fi) => (
              <div key={f.key} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-5">
                  <FormField label="Désignation" htmlFor={`po-rcpt-fee-label-${f.key}`} required>
                    <input id={`po-rcpt-fee-label-${f.key}`} type="text" className="ds-input" value={f.label} placeholder="Ex : Transport, droits de douane"
                      onChange={e => setFees(fs => fs.map(x => x.key === f.key ? { ...x, label: e.target.value } : x))} />
                  </FormField>
                </div>
                <div className="md:col-span-4">
                  <FormField label="Catégorie de charge">
                    <SearchSelect options={feeCategoryOptions} value={f.categoryId} width="100%"
                      onChange={id => setFees(fs => fs.map(x => x.key === f.key ? { ...x, categoryId: id } : x))} placeholder="Transport, livraison…" />
                  </FormField>
                </div>
                <div className="md:col-span-2">
                  <FormField label={`Montant HT (${currencySymbol()})`} htmlFor={`po-rcpt-fee-amount-${f.key}`}>
                    <input id={`po-rcpt-fee-amount-${f.key}`} type="number" min={0} step="0.01" className="ds-input ds-num" value={f.amount}
                      onChange={e => setFees(fs => fs.map(x => x.key === f.key ? { ...x, amount: e.target.value } : x))} />
                  </FormField>
                </div>
                <div className="md:col-span-1" style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 4 }}>
                  <button type="button" onClick={() => setFees(fs => fs.filter(x => x.key !== f.key))} className="ds-icon-btn"
                    title="Retirer ce frais" aria-label={`Retirer le frais ${f.label.trim() || fi + 1}`}><X size={16} /></button>
                </div>
              </div>
            ))}
            <div>
              <button type="button" onClick={addFee} className="ds-btn-ghost ds-btn-sm" style={{ color: 'var(--ds-accent-ink)' }}><Plus size={12} aria-hidden="true" /> Autre frais</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: 0 }}>
              Répartis au prorata de la valeur sur les articles reçus et ajoutés à leur coût (lot et coût standard) dès la réception : c'est le coût rendu.
              La facture du transporteur se saisit à part dans Factures reçues ; elle reste une charge en comptabilité. Détail dans Achats › Frais d'approche.
            </p>
          </div>
        )}
      </section>

      {/* Articles à réceptionner */}
      <SectionHeader title="Articles reçus"
        note={<>Saisissez les quantités reçues pour chaque article · pour les articles au poids, <Scale size={11} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-1px' }} /> ajoute une pesée de contrôle.</>}>
        <button type="button" onClick={fillAll} className="odoo-btn-secondary ds-btn-sm">
          <CheckCircle2 size={14} aria-hidden="true" /> Tout reçu
        </button>
      </SectionHeader>

      <DataPanel label="Articles à réceptionner"
        footer={totalDelivering > 0 ? (
          <TableFooter note={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowRight size={14} aria-hidden="true" /> Valeur de cette réception</span>}>
            <strong style={{ color: 'var(--ds-ink)' }}>{money(totalDelivering)}</strong>
          </TableFooter>
        ) : undefined}>
        <table className="odoo-table" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th>Article</th>
              <th className="ds-num">Commandé</th>
              <th className="ds-num">Déjà reçu</th>
              <th className="ds-num">Restant</th>
              <th style={{ width: 190 }}>Contenants</th>
              <th className="ds-num" style={{ width: 130 }}>Quantité reçue</th>
              <th className="ds-num" style={{ width: 120 }}>Prix unitaire ({currencySymbol()})</th>
              <th className="ds-num" style={{ width: 110 }}>Total HT ({currencySymbol()})</th>
              <th style={{ width: 110 }}>Réf. lot</th>
              <th style={{ width: 140 }}>DLC</th>
              <th style={{ width: 140 }}>Date de production</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const ordered = parseFloat(item.quantity_ordered);
              const alreadyDelivered = parseFloat(item.quantity_delivered);
              const remaining = ordered - alreadyDelivered;
              const isComplete = remaining <= 0;
              return (
                <tr key={item.id} style={isComplete ? { backgroundColor: 'var(--ds-success-bg)' } : undefined}>
                  <td>
                    <span className="ds-strong" style={isComplete ? { color: 'var(--ds-success)' } : undefined}>
                      {item.ingredient_name}
                    </span>
                    {!isFreeLine(item.kind) && <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 4 }}>({item.ingredient_unit})</span>}
                    {!isComplete && !isFreeLine(item.kind) && isWeighable(item.ingredient_unit) && (() => {
                      const w = weights[item.id]; const hasW = !!(w?.gross || w?.tare);
                      return (
                        <button type="button" onClick={() => setWeighFor(item.id)}
                          title="Pesée de contrôle (brut / tare / net)"
                          aria-label={`Pesée de contrôle de ${item.ingredient_name}${hasW ? ' (saisie)' : ''}`}
                          className="ds-icon-btn"
                          style={{ marginLeft: 4, ...(hasW ? { color: 'var(--ds-accent-ink)', background: 'var(--ds-tint)' } : {}) }}>
                          <Scale size={14} />
                        </button>
                      );
                    })()}
                    <LineKindTag kind={item.kind} />
                    {isFreeLine(item.kind) && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)' }}>
                        {item.kind === 'asset' ? 'Réception = mise en service · fiche d\'immobilisation créée' : 'Réception = service rendu · pas de stock'}
                      </span>
                    )}
                  </td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{ordered}</td>
                  <td className="ds-num">
                    <span style={alreadyDelivered > 0 ? { color: 'var(--ds-success)', fontWeight: 600 } : { color: 'var(--ds-muted)' }}>{alreadyDelivered}</span>
                  </td>
                  <td className="ds-num">
                    {isComplete
                      ? <StatusTag tone="done" label="Complet" />
                      : <span className="ds-strong">{remaining}</span>}
                  </td>
                  {(() => {
                    const size = item.container_size != null ? parseFloat(item.container_size) : 0;
                    // Un contenant n'est "defini" que si le TYPE ET la quantite/contenant sont
                    // renseignes sur l'ingredient. Une simple container_size heritee (sans type)
                    // ne compte pas -> saisie kg classique.
                    const hasContainer = size > 0 && !!item.container_type_label;
                    const unit = item.ingredient_unit || 'kg';
                    const count = parseInt(containerCounts[item.id] ?? '', 10);
                    const typeName = (item.container_type_label || 'contenant').toLowerCase();
                    const typeLabel = Number.isFinite(count) && count > 1 ? `${typeName}s` : typeName;
                    return (
                      <>
                        {/* Contenants : nombre saisi + rappel de la contenance unitaire. */}
                        <td>
                          {isComplete ? (
                            <span style={{ color: 'var(--ds-muted)' }}>—</span>
                          ) : hasContainer ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type="number" min={0} step={1} className="ds-input sm ds-num"
                                aria-label={`Nombre de contenants reçus — ${item.ingredient_name}`}
                                value={containerCounts[item.id] ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setContainerCounts({ ...containerCounts, [item.id]: raw });
                                  const c = parseInt(raw, 10);
                                  setDeliveries({ ...deliveries, [item.id]: Number.isFinite(c) && c > 0 ? c * size : 0 });
                                }}
                                style={{ width: 64 }}
                                placeholder="0" />
                              <span style={{ fontSize: 12, color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>
                                {typeLabel} × {size} {unit}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--ds-muted)' }}>—</span>
                          )}
                        </td>
                        {/* Qté reçue : total en unité de base (auto depuis les contenants, ajustable). */}
                        <td className="ds-num">
                          {!isComplete ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                              <input type="number" min={0} max={remaining} step="0.01" className="ds-input sm ds-num"
                                aria-label={`Quantité reçue — ${item.ingredient_name}`}
                                value={deliveries[item.id] ?? ''}
                                onChange={(e) => setDeliveries({ ...deliveries, [item.id]: parseFloat(e.target.value) || 0 })}
                                style={{ width: 88 }}
                                placeholder="0"
                                title={hasContainer ? `Total en ${unit} (calculé depuis les contenants, ajustable si contenant entamé)` : undefined} />
                              <span style={{ fontSize: 12, color: 'var(--ds-muted)', minWidth: 16 }}>{unit}</span>
                            </div>
                          ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                        </td>
                      </>
                    );
                  })()}
                  <td className="ds-num">
                    {!isComplete ? (
                      <input type="number" min={0} step="0.01" className="ds-input sm ds-num"
                        aria-label={`Prix unitaire — ${item.ingredient_name}`}
                        value={prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : '')}
                        onChange={(e) => setPrices({ ...prices, [item.id]: parseFloat(e.target.value) || 0 })}
                        placeholder="Prix" />
                    ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                  </td>
                  <td className="ds-num">
                    {(() => {
                      const qty = deliveries[item.id] || 0;
                      const price = prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : 0);
                      const lineTotal = qty * price;
                      return lineTotal > 0
                        ? <span className="ds-strong">{n(lineTotal)}</span>
                        : <span style={{ color: 'var(--ds-muted)' }}>—</span>;
                    })()}
                  </td>
                  <td>
                    {!isComplete && !isFreeLine(item.kind) ? (
                      <input type="text" className="ds-input sm"
                        aria-label={`Référence du lot fournisseur — ${item.ingredient_name}`}
                        value={lotInfo[item.id]?.supplierLotNumber ?? ''}
                        onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], supplierLotNumber: e.target.value } })}
                        style={(item.requires_lot || item.requires_qc) && !lotInfo[item.id]?.supplierLotNumber ? { borderColor: 'var(--ds-warning)' } : undefined}
                        placeholder={(item.requires_lot || item.requires_qc) ? 'Lot *' : 'Lot'} title={item.requires_qc ? 'Lot fournisseur OBLIGATOIRE (article sous contrôle qualité)' : item.requires_lot ? 'Lot fournisseur exigé pour cet article' : undefined} />
                    ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                  </td>
                  <td>
                    {!isComplete && !isFreeLine(item.kind) ? (
                      <input type="date" className="ds-input sm"
                        aria-label={`DLC — ${item.ingredient_name}`}
                        value={lotInfo[item.id]?.expirationDate ?? ''}
                        onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], expirationDate: e.target.value } })}
                        min={new Date().toISOString().slice(0, 10)}
                        title={item.requires_dlc ? 'DLC exigée pour cet article' : undefined}
                        style={item.requires_dlc && !lotInfo[item.id]?.expirationDate ? { borderColor: 'var(--ds-warning)' } : undefined} />
                    ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                  </td>
                  <td>
                    {!isComplete && !isFreeLine(item.kind) ? (
                      <input type="date" className="ds-input sm"
                        aria-label={`Date de production — ${item.ingredient_name}`}
                        value={lotInfo[item.id]?.manufacturedDate ?? ''}
                        onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], manufacturedDate: e.target.value } })} />
                    ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataPanel>

      {/* Reliquat : le fournisseur ne livrera pas le reste, on clôture le BC sur ce qui est reçu
          et la facture est émise sur ce périmètre. */}
      {!naturallyComplete && (
        <section className="ds-panel" style={RCPT_CARD} aria-label="Reliquat">
          <SectionHeader title="Reliquat" note="articles commandés non couverts par cette réception" />
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={forceComplete}
              onChange={e => setForceComplete(e.target.checked)}
              style={{ marginTop: 3, accentColor: 'var(--ds-warning)' }} />
            <span className="flex-1">
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: forceComplete ? 'var(--ds-warning)' : 'var(--ds-ink)' }}>
                Clôturer le BC : le fournisseur ne livrera pas le reste
              </span>
              <span style={{ display: 'block', fontSize: 12, marginTop: 2, color: 'var(--ds-muted)' }}>
                Les lignes non livrées sont supprimées du BC, les lignes partielles sont alignées sur la quantité reçue. La facture est créée sur ce périmètre.
              </span>
            </span>
          </label>
        </section>
      )}

      {/* Notes du bon de commande (lecture seule). */}
      {po.notes && (
        <section className="ds-panel" style={RCPT_CARD} aria-label="Notes du bon de commande">
          <SectionHeader title="Notes" note="saisies sur le bon de commande" />
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-line', color: 'var(--ds-body)' }}>{po.notes}</p>
        </section>
      )}

      {/* Pied : Annuler puis l'action principale, désactivés pendant l'envoi */}
      <section className="ds-panel">
        <FormFooter onCancel={onCancel} onSubmit={() => { void handleSubmit(); }} busy={pending} submitLabel={submitLabel} />
      </section>

      {/* Pesée de contrôle d'une ligne : petite fenêtre, indépendante de la position de la ligne. */}
      {weighFor && (() => {
        const id = weighFor;
        const item = items.find(i => i.id === id);
        if (!item) return null;
        const w = weights[id] || {};
        const g = w.gross != null && w.gross !== '' ? Number(w.gross) : null;
        const t = w.tare != null && w.tare !== '' ? Number(w.tare) : 0;
        const net = g != null ? Math.max(0, g - t) : null;
        const qty = deliveries[id] || 0;
        const ecart = net != null && qty > 0 ? net - qty : null;
        const bad = ecart != null && Math.abs(ecart) > Math.max(0.01, 0.02 * qty);
        const setW = (patch: { gross?: string; tare?: string }) => setWeights(s => ({ ...s, [id]: { ...s[id], ...patch } }));
        const u = item.ingredient_unit;
        return (
          <Modal title="Pesée de contrôle" subtitle={item.ingredient_name} width={420} onClose={() => setWeighFor(null)}
            footer={<>
              <span className="ds-grow" />
              <button type="button" className="odoo-btn-secondary" onClick={() => { setWeights(s => { const n = { ...s }; delete n[id]; return n; }); setWeighFor(null); }}>Effacer</button>
              <button type="button" className="odoo-btn-primary" onClick={() => setWeighFor(null)}>OK</button>
            </>}>
            <div className="ds-form-grid">
              <FormField label={`Brut (${u})`} htmlFor="po-rcpt-weigh-gross">
                <input id="po-rcpt-weigh-gross" type="number" min={0} step="0.001" className="ds-input ds-num" value={w.gross ?? ''} onChange={e => setW({ gross: e.target.value })} autoFocus />
              </FormField>
              <FormField label={`Tare (${u})`} htmlFor="po-rcpt-weigh-tare">
                <input id="po-rcpt-weigh-tare" type="number" min={0} step="0.001" className="ds-input ds-num" value={w.tare ?? ''} onChange={e => setW({ tare: e.target.value })} />
              </FormField>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14, flexWrap: 'wrap', gap: 6 }}>
              <span>Net <strong>{net != null ? net.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) : '—'}</strong> {u} <span style={{ color: 'var(--ds-muted)' }}>· reçu {qty.toLocaleString('fr-FR')} {u}</span></span>
              {ecart != null && <span style={{ color: bad ? 'var(--ds-danger)' : 'var(--ds-success)', fontWeight: 600 }}>Écart {ecart > 0 ? '+' : ''}{ecart.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {u}</span>}
            </div>
            {bad && <Alert tone="danger" icon={AlertTriangle}>Écart significatif (&gt; 2 %) — à vérifier avec le fournisseur.</Alert>}
          </Modal>
        );
      })()}

      {showOrder && <PODetailModal poId={poId} onClose={() => setShowOrder(false)} />}
    </>
  );
}

/* ═══ Edit PO Modal (admin) ═══
 *
 * Edition complete d'un BC : en-tete (notes, date prevue) + lignes (qty
 * ordonnees, qty livrees, prix unitaires, ajout/suppression de lignes).
 *
 * - Save en-tete : appelle purchaseOrdersApi.updateHeader
 * - Save lignes : appelle purchaseOrdersApi.replaceItems (bulk save)
 * - Modifier qty_delivered ajuste automatiquement le stock (cf. backend
 *   replaceItems._adjustInventory) avec trace inventory_transactions type='adjustment'
 * - Suppression d'une ligne deja referencee par un bon de reception est refusee
 *   par le backend (erreur affichee). Il faut annuler la reception d'abord.
 */
type POLine = {
  id?: string;
  kind: PoLineKind;       // service / asset : ligne existante sans article (mig 349)
  ingredientId: string;   // rempli si kind === 'ingredient'
  packagingId: string;    // rempli si kind === 'consumable'
  ingredientName: string;
  ingredientUnit: string;
  quantityOrdered: string;
  quantityDelivered: string;
  unitPrice: string;
  container: ContainerDef | null;
};

function EditPOModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });

  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<POLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || !po) return;
    setSupplierId((po.supplier_id as string) || '');
    setExpectedDate(po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : '');
    setNotes((po.notes as string) || '');
    const items = (po.items as Record<string, any>[]) || [];
    setLines(items.map(it => ({
      id: it.id as string,
      kind: ((it.kind as PoLineKind) || (it.packaging_id ? 'consumable' : 'ingredient')),
      ingredientId: (it.ingredient_id as string) || '',
      packagingId: (it.packaging_id as string) || '',
      ingredientName: (it.ingredient_name as string) || '',
      ingredientUnit: (it.ingredient_unit as string) || '',
      quantityOrdered: trimNum(it.quantity_ordered),
      quantityDelivered: trimNum(it.quantity_delivered),
      unitPrice: it.unit_price != null ? trimNum(it.unit_price) : '',
      container: it.packaging_id ? null : containerOf(it),
    })));
    setInitialized(true);
  }, [po, initialized]);

  const headerMutation = useMutation({
    mutationFn: (data: { supplierId?: string; expectedDeliveryDate?: string | null; notes?: string | null }) =>
      purchaseOrdersApi.updateHeader(poId, data),
  });
  const itemsMutation = useMutation({
    mutationFn: (items: Array<{ id?: string; ingredientId: string | null; packagingId: string | null; quantityOrdered: number; quantityDelivered?: number; unitPrice?: number | null }>) =>
      purchaseOrdersApi.replaceItems(poId, items),
  });

  const newTotalOrdered = useMemo(() => {
    return lines.reduce((sum, l) => {
      const q = parseFloat(l.quantityOrdered) || 0;
      const p = parseFloat(l.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<POLine>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const addLine = () => {
    setLines(prev => [...prev, {
      kind: 'ingredient', ingredientId: '', packagingId: '', ingredientName: '', ingredientUnit: '',
      quantityOrdered: '1', quantityDelivered: '0', unitPrice: '', container: null,
    }]);
  };

  const handleSave = async () => {
    // Validation : chaque nouvelle ligne cible un article (ingredient OU consommable) ;
    // une ligne existante service / immobilisation garde sa designation. qty > 0.
    if (lines.some(l => (!(l.ingredientId || l.packagingId) && !(l.id && isFreeLine(l.kind))) || (parseFloat(l.quantityOrdered) || 0) <= 0)) {
      notify.error('Chaque ligne doit avoir un article et une quantité commandée > 0');
      return;
    }
    try {
      // 1. En-tete
      await headerMutation.mutateAsync({
        supplierId: supplierId || undefined,
        expectedDeliveryDate: expectedDate || null,
        notes: notes.trim() || null,
      });
      // 2. Lignes (bulk replace). Status BC + stock recalcules cote backend.
      await itemsMutation.mutateAsync(lines.map(l => ({
        id: l.id,
        ingredientId: l.kind === 'ingredient' ? l.ingredientId : null,
        packagingId: l.kind === 'consumable' ? l.packagingId : null,
        quantityOrdered: parseFloat(l.quantityOrdered) || 0,
        quantityDelivered: parseFloat(l.quantityDelivered) || 0,
        unitPrice: l.unitPrice === '' ? null : (parseFloat(l.unitPrice) || 0),
      })));
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success('BC mis à jour');
      onClose();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    }
  };

  const isPending = headerMutation.isPending || itemsMutation.isPending;

  return (
    <Modal title="Modifier le bon de commande" subtitle={po?.order_number as string || '…'} width={1100} onClose={onClose} locked={isPending}
      aside={po?.status ? poStageTagOf(po) : undefined}
      footer={<FormFooter onCancel={onClose} onSubmit={() => { void handleSave(); }} busy={isPending} disabled={isLoading} />}>
          {isLoading ? (
            <LoadingState bare label="Chargement…" />
          ) : (
            <>
              {/* En-tete */}
              <FormSection title="En-tête">
              <div className="ds-form-grid">
                <FormField label="Fournisseur">
                  <SearchSelect
                    ariaLabel="Fournisseur"
                    placeholder="—"
                    width="100%"
                    size="md"
                    value={supplierId}
                    onChange={setSupplierId}
                    options={(suppliers as Record<string, any>[]).filter(s => s.is_active || s.id === supplierId).map(s => ({ id: s.id as string, label: s.name as string }))}
                  />
                </FormField>
                <FormField label="Date livraison prévue" htmlFor="po-edit-expected">
                  <input id="po-edit-expected" type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className="ds-input" />
                </FormField>
              </div>
              <FormField label="Notes" htmlFor="po-edit-notes">
                <textarea id="po-edit-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="ds-input" style={{ resize: 'vertical', minHeight: 64 }} />
              </FormField>
              </FormSection>

              <Alert tone="warning" icon={AlertTriangle}>
                Modifier la <strong>qté livrée</strong> ajuste automatiquement le stock (mouvement
                d'inventaire tracé). Supprimer une ligne déjà référencée par un bon de réception
                sera refusé — annule la réception d'abord.
              </Alert>

              {/* Lignes */}
              <FormSection title="Lignes">
              <DataPanel label="Lignes du bon de commande"
                footer={<TableFooter note="Nouveau total BC (qté commandée × prix)"><strong style={{ color: 'var(--ds-ink)' }}>{money(newTotalOrdered)}</strong></TableFooter>}>
                <table className="odoo-table ds-dense" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Article</th>
                      <th className="ds-num">Qté commandée</th>
                      <th className="ds-num">Qté livrée</th>
                      <th className="ds-num">Prix U. ({currencySymbol()})</th>
                      <th className="ds-num">Sous-total ({currencySymbol()})</th>
                      <th className="ds-actions" style={{ width: 36 }}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const q = parseFloat(line.quantityOrdered) || 0;
                      const p = parseFloat(line.unitPrice) || 0;
                      const isExisting = !!line.id;
                      return (
                        <tr key={idx}>
                          <td>
                            {isExisting ? (
                              <span className="ds-strong">
                                {line.ingredientName} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ds-muted)' }}>({line.ingredientUnit})</span>
                                <LineKindTag kind={line.kind} />
                              </span>
                            ) : (
                              <SearchSelect
                                ariaLabel="Ingrédient"
                                placeholder="— Choisir —"
                                width="100%"
                                size="md"
                                value={line.ingredientId}
                                onChange={id => {
                                  const ing = (ingredients as Record<string, any>[]).find(i => i.id === id);
                                  const container = containerOf(ing);
                                  updateLine(idx, {
                                    ingredientId: id,
                                    ingredientName: ing ? (ing.name as string) : '',
                                    ingredientUnit: ing ? (ing.unit as string) : '',
                                    container,
                                    quantityOrdered: container ? String(container.size) : line.quantityOrdered,
                                  });
                                }}
                                options={(ingredients as Record<string, any>[]).map(i => ({ id: i.id as string, label: i.name as string }))}
                              />
                            )}
                          </td>
                          <td>
                            {line.container ? (() => {
                              const count = roundUpToContainer(parseFloat(line.quantityOrdered) || 0, line.container.size).count;
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                  <input type="number" step="1" min={1} value={count || ''} className="ds-input sm ds-num"
                                    aria-label={`Nombre de contenants — ${line.ingredientName}`}
                                    onChange={e => {
                                      const c = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
                                      updateLine(idx, { quantityOrdered: String(c * (line.container as ContainerDef).size) });
                                    }}
                                    style={{ width: 64 }} title={`${containerLabel(line.container, line.ingredientUnit)} — commande par contenant entier`} />
                                  <span style={{ fontSize: 12, color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>
                                    × {containerLabel(line.container, line.ingredientUnit)} = <strong>{q} {line.ingredientUnit}</strong>
                                  </span>
                                </div>
                              );
                            })() : (
                              <input type="number" step="0.01" min={0} value={line.quantityOrdered} className="ds-input sm ds-num"
                                aria-label={`Quantité commandée — ${line.ingredientName || `ligne ${idx + 1}`}`}
                                onChange={e => updateLine(idx, { quantityOrdered: e.target.value })} />
                            )}
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.quantityDelivered} className="ds-input sm ds-num"
                              aria-label={`Quantité livrée — ${line.ingredientName || `ligne ${idx + 1}`} (ajuste le stock)`}
                              title="Ajuste le stock (mouvement tracé)"
                              onChange={e => updateLine(idx, { quantityDelivered: e.target.value })}
                              style={{ backgroundColor: 'var(--ds-warning-bg)' }} />
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.unitPrice} className="ds-input sm ds-num"
                              aria-label={`Prix unitaire — ${line.ingredientName || `ligne ${idx + 1}`}`}
                              onChange={e => updateLine(idx, { unitPrice: e.target.value })}
                              placeholder="—" />
                          </td>
                          <td className="ds-num ds-strong">
                            {n(q * p)}
                          </td>
                          <td className="ds-actions">
                            <button type="button" onClick={() => removeLine(idx)}
                              className="ds-icon-btn" title="Supprimer" aria-label={`Supprimer la ligne ${line.ingredientName || idx + 1}`}
                              style={{ color: 'var(--ds-danger)' }}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataPanel>

              <div>
                <button type="button" onClick={addLine} className="odoo-btn-secondary ds-btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} aria-hidden="true" /> Ajouter une ligne
                </button>
              </div>
              </FormSection>
            </>
          )}
    </Modal>
  );
}

/* ═══ Merge Invoices Modal ═══
   Confirme la fusion des factures liees aux BCs selectionnes. L'utilisateur
   peut fournir le N° facture fournisseur consolide et la date.
*/
function MergeInvoicesModal({
  selectedPOs, isPending, onClose, onConfirm,
}: {
  selectedPOs: Record<string, any>[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (data: { supplierInvoiceNumber: string; invoiceDate: string }) => void;
}) {
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const totalAmount = selectedPOs.reduce((s, po) => s + (parseFloat(po.total_amount as string) || 0), 0);
  const supplierName = selectedPOs[0]?.supplier_name as string || '';

  return (
    <Modal title="Fusionner les factures" subtitle={supplierName} width={560} onClose={onClose} locked={isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => { if (!isPending) onConfirm({ supplierInvoiceNumber, invoiceDate }); }} busy={isPending}
        submitLabel="Confirmer la fusion" />}>
      <Alert tone="warning" icon={AlertTriangle}>
        Cette action remplace plusieurs factures par une seule, en additionnant les lignes et les montants.
        Refus si l'une des factures a déjà un paiement enregistré.
      </Alert>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 className="ds-subhead">Bons de commande à fusionner ({selectedPOs.length})</h3>
        <DataPanel label="Bons de commande à fusionner">
          <table className="odoo-table ds-dense">
            <thead><tr><th>N° de commande</th><th className="ds-num">Montant HT ({currencySymbol()})</th></tr></thead>
            <tbody>
              {selectedPOs.map(po => (
                <tr key={po.id as string}>
                  <td className="ds-ref">{po.order_number as string}</td>
                  <td className="ds-num">{n(parseFloat(po.total_amount as string) || 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total fusionné</td><td className="ds-num">{n(totalAmount)}</td></tr></tfoot>
          </table>
        </DataPanel>
      </section>

      <div className="ds-form-grid">
        <FormField label="N° facture fournisseur" htmlFor="merge-inv-number" hint="Optionnel">
          <input id="merge-inv-number" type="text" value={supplierInvoiceNumber} className="ds-input"
            onChange={e => setSupplierInvoiceNumber(e.target.value)} placeholder="Optionnel" />
        </FormField>
        <FormField label="Date facture" htmlFor="merge-inv-date">
          <input id="merge-inv-date" type="date" value={invoiceDate} className="ds-input"
            onChange={e => setInvoiceDate(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

/** Correction d'une ligne de réception (mig 308) : quantité à ajouter ou retirer, motif codé. */
function CorrectReceiptDialog({ target, pending, onClose, onSubmit }: {
  target: { lineId: string; label: string; unit: string }; pending: boolean;
  onClose: () => void; onSubmit: (d: { delta: number; reasonCodeId: string; note?: string }) => void;
}) {
  const { entries } = useReferentiel('purchase_reason_codes');
  const reasons = entries.filter(e => Array.isArray(e.metadata?.scope) && (e.metadata!.scope as string[]).includes('correct'));
  const [sign, setSign] = useState<1 | -1>(-1);
  const [qty, setQty] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const requiresNote = !!reasons.find(r => r.id === reasonCodeId)?.metadata?.requires_note;
  const q = Number(qty);
  const valid = q > 0 && !!reasonCodeId && (!requiresNote || note.trim().length >= 3);
  const formId = 'po-correct-receipt';
  const submit = () => { if (valid && !pending) onSubmit({ delta: sign * q, reasonCodeId, note: note.trim() || undefined }); };
  return (
    <Modal title="Corriger la réception" subtitle={target.label} width={460} onClose={onClose} locked={pending}
      footer={
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" disabled={pending}>Retour</button>
          <button type="submit" form={formId} disabled={!valid || pending} aria-busy={pending || undefined} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {pending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            Corriger {q > 0 ? `${sign > 0 ? '+' : '−'}${q} ${target.unit}` : ''}
          </button>
        </div>
      }>
      <form id={formId} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ds-muted)' }}>
          La correction s'ajoute au bon de réception (la ligne d'origine reste visible) et ajuste le lot. Une baisse ne peut pas dépasser ce qui reste à l'économat.
        </p>
        <div className="ds-form-grid">
          <FormField label="Sens" htmlFor="cr-sign" required>
            <select id="cr-sign" value={sign} onChange={e => setSign(Number(e.target.value) as 1 | -1)} className="ds-input">
              <option value={-1}>Retirer</option>
              <option value={1}>Ajouter</option>
            </select>
          </FormField>
          <FormField label={`Quantité (${target.unit})`} htmlFor="cr-qty" required error={qty !== '' && !(q > 0) ? 'Saisissez une quantité supérieure à zéro.' : undefined}>
            <input id="cr-qty" type="number" step="any" min="0" value={qty} onChange={e => setQty(e.target.value)} autoFocus
              className="ds-input ds-num" aria-required="true" placeholder={`Quantité en ${target.unit}`} />
          </FormField>
        </div>
        <FormField label="Motif" htmlFor="cr-reason" required>
          <select id="cr-reason" value={reasonCodeId} onChange={e => setReasonCodeId(e.target.value)} className="ds-input" aria-required="true">
            <option value="">— Choisir un motif —</option>
            {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </FormField>
        <FormField label="Précision" htmlFor="cr-note" required={requiresNote}
          hint={requiresNote ? 'Obligatoire pour ce motif (3 caractères au moins).' : 'Facultatif'}>
          <textarea id="cr-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
            className="ds-input" style={{ minHeight: 64 }} />
        </FormField>
      </form>
    </Modal>
  );
}
