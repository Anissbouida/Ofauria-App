import { useState, useMemo, useEffect, useRef, Fragment, type CSSProperties } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi, newIdempotencyKey } from '../../api/purchase-orders.api';
import { suppliersApi, invoicesApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import { containerOf, roundUpToContainer, containerLabel, type ContainerDef } from '../../utils/container';
import { packagingApi } from '../../api/packaging.api';
import { useStockCategories } from '../stock/useStockCategories';
import {
  Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX,
  Truck, Search, ChevronDown, ChevronUp, ShoppingBag, Clock, CheckCircle2,
  Package, ArrowRight, FileText, Filter, Loader2, Download, Pencil, Receipt,
  Combine,
} from 'lucide-react';
import { format, differenceInCalendarDays, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import IngredientFormModal from '../stock/IngredientFormModal';
import { useReferentiel } from '../../hooks/useReferentiel';
import { useAuth } from '../../context/AuthContext';
import CategoryCascadeSelector, { STOCKABLE_ROOT_IDS, CONSUMABLE_ROOT_IDS } from '../../components/CategoryCascadeSelector';
import ReasonCodeDialog, { type ReasonScope } from '../../components/purchasing/ReasonCodeDialog';
import DocumentActionsTimeline from '../../components/purchasing/DocumentActionsTimeline';
import ChangeOrderModal from '../../components/purchasing/ChangeOrderModal';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, StageProgress, ViewSwitch, PeriodFilter, SelectFilter, Pager,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey,
} from '../../components/purchasing/ProcessBoard';
import { apiErrorMessage } from '../../api/errors';
import { Lock, PauseCircle, PlayCircle, Snowflake, FilePenLine, Scissors, Undo2 } from 'lucide-react';

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

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Normalise les valeurs du backend a 2 decimales (ex: "48.0000" -> "48.00", "25.8300" -> "25.83")
function trimNum(v: unknown): string {
  if (v == null || v === '') return '';
  const f = parseFloat(String(v));
  return Number.isFinite(f) ? f.toFixed(2) : '';
}

const STATUS_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  envoye: 'Envoyé',
  livre_complet: 'Livré',
  livre_partiel: 'Partiel',
  non_livre: 'Non livré',
  annule: 'Annulé',
  en_attente_facturation: 'Att. facturation',
};
const STATUS_COLORS: Record<string, string> = {
  en_attente: 'bg-amber-100 text-amber-800 border border-amber-200',
  envoye: 'bg-blue-100 text-blue-800 border border-blue-200',
  livre_complet: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  livre_partiel: 'bg-orange-100 text-orange-800 border border-orange-200',
  non_livre: 'bg-red-100 text-red-800 border border-red-200',
  annule: 'bg-gray-100 text-gray-500 border border-gray-200',
  en_attente_facturation: 'bg-purple-100 text-purple-800 border border-purple-200',
};
const STATUS_ICONS: Record<string, typeof Clock> = {
  en_attente: Clock,
  envoye: Send,
  livre_complet: CheckCircle2,
  livre_partiel: Package,
  non_livre: PackageX,
  annule: Ban,
  en_attente_facturation: FileText,
};

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


// Styles partagés pour les formulaires en style Odoo (cf. .odoo-scope dans index.css)
const odooLabelStyle: CSSProperties = {
  display: 'block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.03em', color: 'var(--odoo-text-muted)', marginBottom: 4,
};
const odooFieldStyle: CSSProperties = {
  width: '100%', padding: '0.375rem 0.5rem', border: '1px solid var(--odoo-border)',
  borderRadius: 4, fontSize: '0.8125rem', backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};
const odooNumFieldStyle: CSSProperties = { ...odooFieldStyle, textAlign: 'right' };
const odooModalPanelStyle: CSSProperties = {
  backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)',
  borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};
const odooModalHeaderStyle: CSSProperties = {
  backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem',
};

type POItem = {
  id: string;
  ingredient_id: string;
  packaging_id?: string | null;
  kind?: 'ingredient' | 'consumable';
  ingredient_name: string;
  ingredient_unit: string;
  quantity_ordered: string;
  quantity_delivered: string;
  unit_price: string;
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
  const [showDelivery, setShowDelivery] = useState<string | null>(null);
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
    setStage('');
    setStatusFilter('');
    if (period !== 'custom') setPeriod(next === 'history' ? '3m' : 'all');
  };

  const boardParams = useMemo(() => {
    const p: Record<string, string> = { view, page: String(page), pageSize: String(PAGE_SIZE) };
    if (view === 'open' && stage) p.stage = stage;
    if (statusFilter) p.status = statusFilter;
    if (searchTerm) p.search = searchTerm;
    if (supplierFilter) p.supplierId = supplierFilter;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [view, stage, statusFilter, period, customFrom, customTo, page, searchTerm, supplierFilter]);
  const hasFilters = !!(statusFilter || searchTerm || supplierFilter || period !== (view === 'history' ? '3m' : 'all'));
  const periodText = periodLabel(period, customFrom, customTo);
  const resetFilters = () => {
    setStatusFilter(''); setSearchInput(''); setSearchTerm(''); setSupplierFilter('');
    setPeriod(view === 'history' ? '3m' : 'all'); setCustomFrom(''); setCustomTo('');
  };

  const { data: board, isLoading, isFetching } = useQuery({
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

  const sendMutation = useMutation({
    mutationFn: purchaseOrdersApi.send,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success('BC envoyé au fournisseur'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Envoi impossible')),
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
        return { label: 'Envoyer', run: () => sendMutation.mutate(id), primary: true };
      case 'sent':
        return { label: 'Réceptionner', run: () => setShowDelivery(id), primary: true, danger: !!po.is_late };
      case 'partial':
        return { label: 'Réceptionner le reliquat', run: () => setShowDelivery(id), primary: true, danger: !!po.is_late };
      case 'invoice':
        if (po.status === 'en_attente_facturation') {
          return po.frozen ? null : { label: 'Compléter les prix', run: () => setEditPoId(id), primary: false };
        }
        return {
          label: 'Générer la facture', primary: false,
          run: () => { if (confirm(`Générer la facture pour le BC ${po.order_number} ?`)) generateInvoiceMutation.mutate(id); },
        };
      default:
        return null;
    }
  };

  const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), 'dd MMM yyyy', { locale: fr }) : null);

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

  const colCount = 8;

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
              <button type="button" onClick={() => setShowDelivery(l.id)}
                style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, textDecoration: 'underline', color: 'inherit' }}>
                {l.order_number}
              </button>
              {' '}{l.supplier_name} — prévue le {fmtDate(l.expected_delivery_date)} ({l.days_late} j)
            </span>
          ))}
          {lateList.length > 3 && <span> · et d'autres en tête de liste</span>}
        </StatusBanner>
      )}

      {/* Pipeline du processus : une carte par étape, clic = filtre */}
      <StagePipeline
        title="Où en sont mes commandes"
        summary={`${openStats.count} BC en cours · ${n(openStats.amount)} DH engagés`}
        stages={PO_STAGES}
        stats={Object.fromEntries(PO_STAGES.map(s => {
          const st = stageStats[s.key];
          return [s.key, st ? { count: st.count, sub: `${n(st.amount)} DH`, late: st.late } : undefined];
        }))}
        isActive={k => (k === 'closed' ? view === 'history' : view === 'open' && stage === k)}
        onPick={pickStage}
      />

      {/* Barre de vue + filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <ViewSwitch view={view} onChange={switchView}
          openLabel={`En cours · ${openStats.count}`} historyLabel={`Historique · ${historyCount}`} />
        {view === 'open' && stage && (
          <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Étape : {PO_STAGES.find(s => s.key === stage)?.label}
            <button type="button" onClick={() => setStage('')} aria-label="Retirer le filtre d'étape" style={{ display: 'inline-flex' }}>
              <X size={11} />
            </button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        {selectedPoIds.size > 0 && (
          <>
            <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {selectedPoIds.size} BC selectionne{selectedPoIds.size > 1 ? 's' : ''}
            </span>
            <button onClick={() => setSelectedRows(new Map())} className="odoo-btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              title="Tout deselectionner">
              <X size={13} />
            </button>
            <button onClick={() => setShowMergeModal(true)} disabled={!mergeReady}
              className="odoo-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: mergeReady ? 1 : 0.5 }}
              title={mergeReady ? 'Fusionner les factures liees' : mergeWarning}>
              <Combine size={13} /> Fusionner les factures
            </button>
          </>
        )}
        <button onClick={() => setShowCreate(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouveau BC
        </button>
      </div>
      {mergeWarning && (
        <div className="odoo-alert" style={{ fontSize: '0.75rem' }}>
          <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
          {mergeWarning}
        </div>
      )}

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par N° ou fournisseur..." aria-label="Rechercher un bon de commande"
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        <SelectFilter label="Statut" icon={Filter} value={statusFilter} onChange={setStatusFilter} options={VIEW_STATUSES[view]} />
        <PeriodFilter label="Commandé" title="Filtre sur la date de commande"
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <SearchSelect
          options={supplierOptions}
          value={supplierFilter}
          onChange={setSupplierFilter}
          placeholder="Tous les fournisseurs"
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
          <p style={{ fontSize: '0.8125rem' }}>Chargement des bons de commande...</p>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Truck size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {view === 'open' ? (stage ? 'Aucun bon de commande à cette étape' : 'Aucun bon de commande en cours') : 'Aucun bon de commande sur cette période'}
          </p>
          {hasFilters && (
            <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>
              Aucun résultat pour ces filtres —{' '}
              <button type="button" onClick={resetFilters} style={{ textDecoration: 'underline', color: 'inherit' }}>les effacer</button>
            </p>
          )}
          {view === 'open' && !stage && !hasFilters && (
            <button onClick={() => setShowCreate(true)} className="odoo-btn-primary"
              style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> Créer un BC
            </button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 28 }} title="Cocher pour fusionner les factures liees"></th>
                <th>N° BC</th>
                <th>Fournisseur</th>
                <th style={{ minWidth: 200 }}>Étape</th>
                <th>{view === 'open' ? 'Livraison' : 'Commande'}</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right' }}>{view === 'open' ? 'Prochaine action' : ''}</th>
                <th style={{ textAlign: 'right', width: 110 }}>Actions</th>
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
                const stageIdx = PO_STAGES.findIndex(s => s.key === poStage);
                const action = view === 'open' ? nextAction(po) : null;
                // Historique : un intertitre par mois (les lignes arrivent triées par date décroissante).
                const month = format(new Date(po.order_date as string), 'MMMM yyyy', { locale: fr });
                const prevMonth = i > 0 ? format(new Date(rows[i - 1].order_date as string), 'MMMM yyyy', { locale: fr }) : null;
                const due = po.expected_delivery_date as string | null;
                return (
                  <Fragment key={id}>
                    {view === 'history' && month !== prevMonth && (
                      <tr>
                        <td colSpan={colCount} style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'capitalize', color: 'var(--odoo-text)' }}>
                          {month}
                        </td>
                      </tr>
                    )}
                    <tr onClick={() => setExpandedRow(isExpanded ? null : id)} style={{ cursor: 'pointer' }}>
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
                                ? (po.has_invoice ? 'Selectionner pour fusion' : 'Selectionner — la facture sera generee a la fusion')
                                : 'Aucun article livre — fusion impossible'}
                              style={{ cursor: eligible ? 'pointer' : 'not-allowed' }} />
                          );
                        })()}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {isExpanded ? <ChevronUp size={13} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} />}
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{po.order_number as string}</span>
                        </span>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginLeft: 17 }}>
                          créé le {fmtDate(po.order_date as string)}
                        </div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Truck size={11} style={{ color: 'var(--theme-accent)' }} />
                          {po.supplier_name as string}
                        </span>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginLeft: 15 }}>
                          {po.item_count as number} article{Number(po.item_count) > 1 ? 's' : ''}
                        </div>
                      </td>
                      <td>
                        {stageIdx >= 0 && poStage !== 'cancelled' ? (
                          <StageProgress count={PO_STAGES.length} current={stageIdx} done={poStage === 'closed'} late={!!po.is_late} />
                        ) : null}
                        <span style={{ fontSize: '0.75rem' }}>
                          {poStage === 'cancelled'
                            ? <span className="odoo-tag odoo-tag-grey">{STATUS_LABELS[status] ?? status}</span>
                            : <strong style={{ fontWeight: 600 }}>{PO_STAGES[stageIdx]?.label}</strong>}
                          <span style={{ color: 'var(--odoo-text-muted)' }}> · {stageDetail(po)}</span>
                        </span>
                        {po.on_hold && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }} title="Bloqué : ni réception ni facture">bloqué</span>}
                      </td>
                      <td>
                        {view === 'open' ? (
                          due ? (
                            <>
                              <div style={{
                                fontSize: '0.8125rem',
                                color: po.is_late ? '#dc3545' : 'var(--odoo-text)',
                                fontWeight: po.is_late ? 600 : 400,
                              }}>
                                Prévue le {fmtDate(due)}
                              </div>
                              {po.is_late && (
                                <div style={{ fontSize: '0.6875rem', color: '#dc3545' }}>
                                  {differenceInCalendarDays(new Date(), new Date(due))} j de retard
                                </div>
                              )}
                            </>
                          ) : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>
                        ) : (
                          <span style={{ color: 'var(--odoo-text-muted)' }}>{fmtDate(po.order_date as string)}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700 }}>{n(totalAmount)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                        {poStage === 'partial' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                            <span style={{ width: 50, height: 3, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                              <span style={{ display: 'block', height: '100%', background: '#b85d1a', width: `${deliveryPct}%` }} />
                            </span>
                            <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{deliveryPct.toFixed(0)}% reçu</span>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        {action && (
                          <button type="button" onClick={action.run}
                            className={action.primary ? (action.danger ? 'odoo-btn-danger' : 'odoo-btn-primary') : 'odoo-btn-secondary'}
                            disabled={sendMutation.isPending || generateInvoiceMutation.isPending}>
                            {action.label}
                          </button>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          {status !== 'en_attente' && (
                            <button onClick={() => handleDownloadPoPdf(po)} title="Télécharger PDF" aria-label="Télécharger PDF" className="odoo-pager-btn">
                              <Download size={13} />
                            </button>
                          )}
                          <button onClick={() => setShowDetail(id)} title="Voir détails" aria-label="Voir détails" className="odoo-pager-btn">
                            <Eye size={13} />
                          </button>
                          {/* Extourne de réception (ADMIN) : reverse stock + facture + compta. */}
                          {isAdmin && ['livre_complet', 'livre_partiel', 'en_attente_facturation'].includes(status) && (
                            <button
                              onClick={() => setReverseFor({ id, orderNumber: po.order_number as string })}
                              title="Extourner la réception (admin)"
                              aria-label="Extourner la réception"
                              className="odoo-pager-btn"
                              disabled={cancelReceptionMutation.isPending}
                              style={{ color: '#b85d1a' }}
                            >
                              <PackageX size={13} />
                            </button>
                          )}
                          {/* Édition complète tant que le BC est en brouillon et non gelé (mig 306). */}
                          {status === 'en_attente' && !po.frozen && (
                            <button onClick={() => setEditPoId(id)} title="Modifier le BC (qté, prix, lignes)" aria-label="Modifier le BC" className="odoo-pager-btn">
                              <Pencil size={13} />
                            </button>
                          )}
                          {po.frozen && (
                            <span className="odoo-pager-btn" title="BC gelé" style={{ opacity: 0.45, cursor: 'default' }}>
                              <Lock size={13} />
                            </span>
                          )}
                          {/* Suppression : brouillon jamais engagé seulement ; un BC engagé s'annule (mig 307). */}
                          {status === 'en_attente' && !po.locked_at && (
                            <button
                              onClick={() => { if (confirm(`Supprimer definitivement le BC ${po.order_number} ?`)) deleteMutation.mutate(id); }}
                              title="Supprimer le BC"
                              aria-label="Supprimer le BC"
                              className="odoo-pager-btn"
                              style={{ color: '#dc3545' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={colCount} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
                          <ExpandedPORow poId={id} status={status} isAdmin={isAdmin}
                            onSend={() => sendMutation.mutate(id)}
                            onDelivery={() => setShowDelivery(id)}
                            onNotDelivered={() => setPoReason({ kind: 'not_delivered', poId: id, orderNumber: po.order_number as string })}
                            onCancel={() => setPoReason({ kind: 'cancel', poId: id, orderNumber: po.order_number as string })}
                            onHold={() => setPoReason({ kind: 'hold', poId: id, orderNumber: po.order_number as string })}
                            onStateAction={(kind) => poStateMutation.mutate({ kind, poId: id })}
                            onDelete={() => { if (confirm('Supprimer ce bon de commande ?')) deleteMutation.mutate(id); }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} total={total} onPage={setPage}
            note={view === 'open'
              ? 'Seuls les BC non clôturés sont chargés ici — les autres sont dans l\'Historique.'
              : `Clôturés et annulés · ${periodText}`} />
        </div>
      )}

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
      {showDetail && (
        <PODetailModal poId={showDetail} onClose={() => setShowDetail(null)}
          onSend={() => sendMutation.mutate(showDetail)}
          onDelivery={() => setShowDelivery(showDetail)}
          onCompletePrices={() => setEditPoId(showDetail)}
          onGenerateInvoice={() => { if (confirm('Générer la facture de ce BC ?')) generateInvoiceMutation.mutate(showDetail); }}
        />
      )}
      {showDelivery && <DeliveryModal poId={showDelivery} onClose={() => setShowDelivery(null)} />}
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

  if (isLoading) return <div className="py-4 text-center text-gray-400 text-sm">Chargement des articles...</div>;
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
    <div className="space-y-3">
      {po.on_hold && (
        <StatusBanner tone="danger" icon={PauseCircle} title="BC bloqué : réception et facturation suspendues"
          actions={<button className="odoo-btn-secondary" onClick={() => onStateAction('release')}>Lever le blocage</button>}>
          {po.hold_note ? `Précision : ${po.hold_note}` : 'Le motif figure dans l\'historique ci-dessous.'}
        </StatusBanner>
      )}
      {po.frozen && (
        <StatusBanner tone="info" icon={Snowflake} title="BC gelé : en-tête et lignes figés"
          actions={isAdmin ? <button className="odoo-btn-secondary" onClick={() => onStateAction('unfreeze')}>Dégeler</button> : undefined}>
          La réception et la facturation restent possibles.
        </StatusBanner>
      )}
      {/* Items table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-3 py-2">Ingrédient</th>
              <th className="text-left px-3 py-2">Catégorie</th>
              <th className="text-right px-3 py-2">Commandé</th>
              <th className="text-right px-3 py-2">Reçu</th>
              <th className="text-right px-3 py-2" title="Reliquat clôturé : quantité qui ne sera plus livrée">Clôturé</th>
              <th className="text-right px-3 py-2">Reste</th>
              <th className="text-right px-3 py-2">Prix unit.</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2 w-24">Progression</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map(item => {
              const ordered = parseFloat(item.quantity_ordered);
              const delivered = parseFloat(item.qty_received_base ?? item.quantity_delivered);
              const cancelled = parseFloat(item.qty_cancelled_base ?? '0');
              const remaining = parseFloat(item.qty_remaining_base ?? String(Math.max(ordered - delivered - cancelled, 0)));
              const pct = ordered > 0 ? Math.min(100, ((delivered + cancelled) / ordered) * 100) : 0;
              const price = item.unit_price != null ? parseFloat(item.unit_price) : null;
              return (
                <tr key={item.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {item.ingredient_name} <span className="text-gray-400 text-xs">({item.ingredient_unit})</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <CategoryQuickEdit
                      kind={(item.kind as 'ingredient' | 'consumable') || (item.packaging_id ? 'consumable' : 'ingredient')}
                      refId={item.packaging_id || item.ingredient_id}
                      categoryId={item.item_category_id ?? null}
                      itemName={item.ingredient_name}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{qtyLabel(ordered, item)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className={delivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{qtyLabel(delivered, item)}</span>
                    {delivered > 0 && ['livre_partiel', 'livre_complet', 'en_attente_facturation'].includes(status) && !po.has_invoice && (
                      <button className="odoo-pager-btn" title="Corriger la quantité reçue"
                        onClick={() => setCorrectFor({ lineId: item.id, label: item.ingredient_name, unit: item.base_unit || item.ingredient_unit })}><Pencil size={11} /></button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-gray-500">
                    {cancelled > 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {qtyLabel(cancelled, item)}
                        {!['annule', 'non_livre'].includes(status) && (
                          <button className="odoo-pager-btn" title="Rouvrir le reliquat" disabled={reopenMutation.isPending}
                            onClick={() => reopenMutation.mutate(item.id)}><Undo2 size={12} /></button>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {remaining > 0.0001 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span className="text-amber-600">{qtyLabel(remaining, item)}</span>
                        {canCloseRemainder && (
                          <button className="odoo-pager-btn" title="Clôturer le reliquat de cette ligne"
                            onClick={() => setLineReason({ lineId: item.id, label: item.ingredient_name })}><Scissors size={12} /></button>
                        )}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{price != null ? `${n(price)} DH` : <span className="text-amber-500 text-xs">À définir</span>}</td>
                  <td className="px-3 py-2 text-right font-medium">{price != null ? `${n(ordered * price)} DH` : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {po.notes && (
        <p className="text-sm text-gray-500 italic flex items-center gap-1.5">
          <FileText size={14} className="text-gray-400" /> {po.notes}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {status === 'en_attente' && (
          <button onClick={onSend}
            className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center gap-1.5 transition-colors">
            <Send size={14} /> Envoyer au fournisseur
          </button>
        )}
        {(status === 'envoye' || status === 'livre_partiel') && (
          <>
            <button onClick={onDelivery}
              className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 flex items-center gap-1.5 transition-colors">
              <PackageCheck size={14} /> Confirmer réception
            </button>
            <button onClick={onNotDelivered}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
              <PackageX size={14} /> Non livré
            </button>
          </>
        )}
        {canChange && (
          <button onClick={() => setShowChange(true)} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FilePenLine size={14} /> Demande de changement
          </button>
        )}
        {canCloseRemainder && items.some(i => parseFloat(i.qty_remaining_base ?? '0') > 0.0001) && (
          <button onClick={() => setLineReason({ lineId: null, label: 'toutes les lignes' })} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Scissors size={14} /> Clôturer le reliquat
          </button>
        )}
        {['en_attente', 'envoye'].includes(status) && (
          <button onClick={onCancel}
            className="px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-100 flex items-center gap-1.5 transition-colors">
            <Ban size={14} /> Annuler le BC
          </button>
        )}
        {!po.on_hold && !['annule', 'non_livre'].includes(status) && (
          <button onClick={onHold} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PauseCircle size={14} /> Bloquer
          </button>
        )}
        {po.on_hold && (
          <button onClick={() => onStateAction('release')} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PlayCircle size={14} /> Lever le blocage
          </button>
        )}
        {isAdmin && !po.frozen && !['annule', 'non_livre'].includes(status) && (
          <button onClick={() => onStateAction('freeze')} className="odoo-btn-secondary" title="Figer en-tête et lignes (admin)" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Snowflake size={14} /> Geler
          </button>
        )}
        {/* Suppression : brouillon jamais engagé seulement (mig 307). */}
        {status === 'en_attente' && !po.locked_at && (
          <button onClick={onDelete}
            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
            <Trash2 size={14} /> Supprimer
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
        if (!window.confirm(
          `Cette catégorie (${catName}) transforme l'article en CONSOMMABLE.\n\n` +
          `Le stock sera transféré vers les Consommables, et l'article sera retiré ` +
          `des ingrédients ainsi que des lignes de BC non facturées. Continuer ?`
        )) { setSaving(false); return; }
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
          <span className="flex items-center flex-wrap" style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', columnGap: 4, rowGap: 2 }}>
            {cat.path.split(' / ').slice(0, -1).map((seg, i) => (
              <Fragment key={i}>{seg} <span style={{ opacity: 0.6 }}>›</span> </Fragment>
            ))}
            <span className={`odoo-tag ${tagClass(categoryId)}`} style={{ fontSize: '0.6875rem' }}>{cat.typeName}</span>
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: '#b85d1a', fontWeight: 600 }}>Sans catégorie</span>
        )}
        <button onClick={(e) => { e.stopPropagation(); setSelectedId(categoryId || ''); setEditing(true); }}
          title="Corriger la catégorie de l'article"
          className="hover:bg-gray-100"
          style={{ padding: 3, borderRadius: 4, color: 'var(--odoo-text-muted)', flexShrink: 0 }}>
          <Pencil size={11} />
        </button>
      </div>

      {/* Mini-fenetre superposee : evite de deformer le tableau (le selecteur
          en cascade est trop haut pour une cellule). zIndex 60 > modal BC (50). */}
      {editing && (
        <ModalBackdrop onClose={() => !saving && setEditing(false)}
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4"
          style={{ zIndex: 60 }}>
          <div className="odoo-scope w-full" style={{ ...odooModalPanelStyle, maxWidth: 560 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={odooModalHeaderStyle}>
              <div className="flex items-center gap-3">
                <Pencil size={16} style={{ color: '#fff' }} />
                <div>
                  <h3 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Corriger la catégorie</h3>
                  {itemName && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>{itemName}</p>}
                </div>
              </div>
              <button onClick={() => !saving && setEditing(false)} className="hover:bg-white/20"
                style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
            </div>
            <div style={{ padding: '1.25rem' }} className="space-y-4">
              {cat && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 }}>
                  Catégorie actuelle : <span style={{ fontWeight: 600, color: 'var(--odoo-text)' }}>{cat.path}</span>
                </p>
              )}
              <CategoryCascadeSelector value={selectedId} onChange={setSelectedId} rootIds={PURCHASABLE_ROOT_IDS} />
              <p style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', margin: 0 }}>
                La correction s'applique à l'article dans le référentiel : Économat, prochains BC et charges en profitent aussitôt.
              </p>
            </div>
            <div className="flex justify-end gap-2"
              style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem' }}>
              <button onClick={() => setEditing(false)} disabled={saving} className="odoo-btn-secondary">Annuler</button>
              <button onClick={save} disabled={saving || !selectedId} className="odoo-btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}

/* ═══ Create PO Modal ═══ */
function CreatePOModal({ onClose }: { onClose: () => void }) {
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
  const [items, setItems] = useState<{ kind: 'ingredient' | 'consumable'; refId: string; name: string; unit: string; categoryId: string | null; quantityOrdered: number; unitPrice: number | null; container: ContainerDef | null; containerCount: number }[]>([]);
  const [showNewIngredient, setShowNewIngredient] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });
  const { data: consumables = [] } = useQuery({ queryKey: ['packaging-items'], queryFn: () => packagingApi.list({ activeOnly: true }) });
  const { kindOf, resolve } = useStockCategories();

  const supplierOptions = useMemo(() => (suppliers as Record<string, any>[])
    .filter(s => s.is_active !== false)
    .map(s => ({ id: String(s.id), label: String(s.name), sublabel: (s.city as string) || undefined })), [suppliers]);
  const supplierName = supplierOptions.find(o => o.id === supplierId)?.label || '';

  // Fermer un BC en cours de saisie fait perdre les lignes : on demande confirmation.
  const requestClose = () => {
    if (items.length > 0 && !window.confirm('Abandonner ce bon de commande ? Les articles saisis seront perdus.')) return;
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
      unitPrice: cost > 0 ? cost : null,
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
      kind: p._kind as 'ingredient' | 'consumable',
      refId: p.id as string,
      name: p.name as string,
      unit: p.unit as string,
      categoryId: (p.category_id as string) || null,
      quantityOrdered: container ? container.size : 1,
      unitPrice: cost > 0 ? cost : null,
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
    createMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDate || undefined,
      notes: notes || undefined,
      items: items.map(({ kind, refId, quantityOrdered, unitPrice }) => ({
        ingredientId: kind === 'ingredient' ? refId : null,
        packagingId: kind === 'consumable' ? refId : null,
        quantityOrdered,
        unitPrice: unitPrice != null && unitPrice > 0 ? unitPrice : null,
      })),
    });
  };

  return (
    <>
    <ModalBackdrop onClose={requestClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      {/* Quasi plein ecran : le BC est le flux de saisie principal, on lui donne
          toute la place (tableau articles + recherche). Corps scrollable entre
          en-tete et pied fixes. */}
      <div className="odoo-scope w-full flex flex-col" onClick={(e) => e.stopPropagation()}
        style={{ ...odooModalPanelStyle, maxWidth: '95vw', height: '92vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between shrink-0" style={odooModalHeaderStyle}>
          <div className="flex items-center gap-3">
            <ShoppingBag size={16} style={{ color: '#fff' }} />
            <div>
              <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Nouveau bon de commande</h2>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>
                {supplierName ? `Commande chez ${supplierName}` : '1. Choisissez le fournisseur · 2. Ajoutez les articles · 3. Créez le BC'}
              </p>
            </div>
          </div>
          <button type="button" onClick={requestClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-5 flex-1 overflow-y-auto min-h-0">
          {/* Fournisseur + livraison + notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label style={odooLabelStyle}>Fournisseur *</label>
              <SearchSelect options={supplierOptions} value={supplierId} width="100%"
                onChange={id => { setSupplierId(id); if (id) setTimeout(() => searchRef.current?.focus(), 0); }}
                placeholder="Rechercher un fournisseur…" />
            </div>
            <div>
              <label style={odooLabelStyle}>Livraison prévue</label>
              <div className="flex items-center gap-2">
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={{ ...odooFieldStyle, flex: 1, minWidth: 0 }} />
                {deliveryQuick.map(q => {
                  const active = expectedDate === format(addDays(new Date(), q.days), 'yyyy-MM-dd');
                  return (
                    <button key={q.days} type="button" onClick={() => setDeliveryIn(q.days)}
                      className={active ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
                      style={{ whiteSpace: 'nowrap', padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}>
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={odooLabelStyle}>Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} style={odooFieldStyle} placeholder="Optionnel…" />
            </div>
          </div>

          {/* Recherche d'articles (ingredients + consommables) */}
          <div>
            <label style={odooLabelStyle}>Ajouter des articles</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--odoo-text-muted)' }} />
                <input ref={searchRef} type="text" placeholder="Tapez le nom d'un article puis Entrée (↑ ↓ pour choisir)…"
                  value={searchIngredient}
                  onChange={e => { setSearchIngredient(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  onKeyDown={onSearchKeyDown}
                  style={{ ...odooFieldStyle, paddingLeft: 30 }} />
                {searchOpen && search && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 30, backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)', borderRadius: 4, maxHeight: 320, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                    {filteredProducts.map((p, i) => {
                      const catPath = resolve(p.category_id as string | null)?.path;
                      const cont = p._kind === 'ingredient' ? containerOf(p) : null;
                      return (
                        <button type="button" key={`${p._kind}:${p.id as string}`}
                          onMouseDown={e => { e.preventDefault(); addProduct(p); }}
                          onMouseEnter={() => setHighlighted(i)}
                          className="w-full text-left text-sm flex items-center justify-between gap-3"
                          style={{ padding: '0.5rem 0.75rem', backgroundColor: i === highlighted ? 'var(--odoo-bg-hover, #f3f4f6)' : 'transparent' }}>
                          <span style={{ minWidth: 0 }}>
                            <span className="font-medium">
                              {p.name as string} <span style={{ color: 'var(--odoo-text-muted)' }}>({p.unit as string})</span>
                              {p._kind === 'consumable' && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6, fontSize: '0.625rem' }}>Consommable</span>}
                              {isUsual(p) && <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 6, fontSize: '0.625rem' }}>Habituel</span>}
                            </span>
                            {/* Chemin de categorie : repere une erreur de classement avant l'achat */}
                            <span style={{ display: 'block', fontSize: '0.6875rem', color: catPath ? 'var(--odoo-text-muted)' : '#b85d1a' }}>
                              {catPath || 'Sans catégorie'}{cont ? ` · ${containerLabel(cont, p.unit as string)}` : ''}
                            </span>
                          </span>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', whiteSpace: 'nowrap' }}>{n(parseFloat(p.unit_cost as string) || 0)} DH/{p.unit as string}</span>
                        </button>
                      );
                    })}
                    <button type="button" onMouseDown={e => { e.preventDefault(); setShowNewIngredient(true); }}
                      className="w-full text-left text-sm flex items-center gap-2"
                      style={{ padding: '0.5rem 0.75rem', borderTop: filteredProducts.length ? '1px solid var(--odoo-border)' : 'none', color: 'var(--theme-accent)', fontWeight: 600,
                        backgroundColor: filteredProducts.length === 0 ? 'var(--odoo-bg-hover, #f3f4f6)' : 'transparent' }}>
                      <Plus size={14} /> Créer « {searchIngredient.trim()} »
                      {filteredProducts.length === 0 && <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>— aucun article trouvé (Entrée)</span>}
                    </button>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setShowNewIngredient(true)}
                className="odoo-btn-secondary whitespace-nowrap shrink-0" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={14} /> Nouvel article
              </button>
            </div>
            {usualProducts.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginBottom: 6 }}>
                  Articles habituels chez <strong>{supplierName}</strong> — un clic pour ajouter
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {usualProducts.map(p => (
                    <button type="button" key={`${p._kind}:${p.id as string}`} onClick={() => addProduct(p)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.25rem 0.65rem', borderRadius: 999, fontSize: '0.75rem',
                        border: '1px solid var(--odoo-border)', backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)', cursor: 'pointer' }}>
                      <Plus size={11} style={{ color: 'var(--theme-accent)' }} /> {p.name as string}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Catégorie</th>
                    <th style={{ textAlign: 'right', width: 128 }}>Quantité</th>
                    <th style={{ textAlign: 'right', width: 128 }}>Prix unit. (DH)</th>
                    <th style={{ textAlign: 'right', width: 112 }}>Sous-total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={`${item.kind}:${item.refId}`}>
                      <td>
                        <span className="font-medium">{item.name}</span>
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({item.unit})</span>
                        {item.kind === 'consumable' && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6, fontSize: '0.625rem' }}>Consommable</span>}
                      </td>
                      <td>
                        <CategoryQuickEdit
                          kind={item.kind} refId={item.refId} categoryId={item.categoryId}
                          itemName={item.name} allowConvert
                          onSaved={(catId, changed) => setItems(prev => prev.map((it, i) =>
                            i === idx ? { ...it, categoryId: catId, ...(changed ? { kind: changed.kind, refId: changed.refId } : {}) } : it
                          ))}
                        />
                      </td>
                      <td>
                        {item.container ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <input type="number" min={1} step="1" value={item.containerCount || ''}
                              onChange={(e) => {
                                const count = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
                                setItems(prev => prev.map((it, i) => i === idx ? { ...it, containerCount: count, quantityOrdered: count * (it.container as ContainerDef).size } : it));
                              }}
                              style={{ ...odooNumFieldStyle, width: 64 }} title={`${containerLabel(item.container, item.unit)} — commande par contenant entier`} />
                            <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', whiteSpace: 'nowrap' }}>
                              × {containerLabel(item.container, item.unit)} = <strong>{n(item.quantityOrdered)} {item.unit}</strong>
                            </span>
                          </div>
                        ) : (
                          <input type="number" min={0.01} step="0.01" value={item.quantityOrdered || ''}
                            onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                            style={odooNumFieldStyle} />
                        )}
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" value={item.unitPrice ?? ''}
                          onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          placeholder="Optionnel"
                          style={odooNumFieldStyle} />
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {item.unitPrice ? n(item.quantityOrdered * item.unitPrice) : <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>À définir</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={() => removeItem(idx)} className="odoo-btn-danger" title="Retirer" style={{ padding: '0.25rem 0.4rem' }}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between"
                style={{ backgroundColor: 'var(--theme-accent-light, rgba(0,0,0,0.04))', borderTop: '1px solid var(--odoo-border)', padding: '0.625rem 0.875rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--theme-accent)', fontWeight: 600 }}>
                  {items.length} article{items.length > 1 ? 's' : ''}
                  {hasMissingPrices && <span style={{ marginLeft: 8, color: '#b85d1a', fontSize: '0.6875rem' }}>(prix à définir par le fournisseur)</span>}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--theme-accent)' }}>{totalAmount > 0 ? `Total: ${n(totalAmount)} DH` : 'Prix à définir'}</span>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center"
              style={{ padding: '2.5rem 0', backgroundColor: 'var(--odoo-bg-alt)', borderRadius: 4, border: '1px dashed var(--odoo-border)' }}>
              <ShoppingBag size={24} style={{ color: 'var(--odoo-text-light)', marginBottom: 8 }} />
              <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
                {supplierId ? 'Aucun article pour l\'instant — recherchez-les ci-dessus ou cliquez un article habituel.' : 'Commencez par choisir le fournisseur.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center shrink-0"
          style={{ backgroundColor: 'var(--odoo-bg)', borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem' }}>
          <div>
            {items.length > 0 && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{items.length} article{items.length > 1 ? 's' : ''} — <span style={{ fontWeight: 700, color: 'var(--odoo-text)' }}>{n(totalAmount)} DH</span></p>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} className="odoo-btn-secondary">Annuler</button>
            <button type="button" onClick={handleSubmit} disabled={createMutation.isPending || items.length === 0 || !supplierId}
              title={!supplierId ? 'Choisissez un fournisseur' : items.length === 0 ? 'Ajoutez au moins un article' : undefined}
              className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
              {createMutation.isPending ? 'Création...' : 'Créer le bon de commande'}
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
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
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });
  const [downloading, setDownloading] = useState(false);

  const panel: CSSProperties = { width: '100%', maxWidth: 980, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' };

  if (isLoading || !po) {
    return (
      <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="odoo-scope" style={{ ...panel, maxWidth: 360, padding: '2rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          {isLoading ? <Loader2 className="animate-spin" size={24} style={{ color: 'var(--odoo-text-muted)' }} /> : <p style={{ fontSize: '0.8125rem' }}>Bon de commande introuvable.</p>}
        </div>
      </ModalBackdrop>
    );
  }

  const items = (po.items || []) as POItem[];
  const invoices = (po.invoices || []) as Array<{ id: string; invoice_number: string; supplier_invoice_number: string | null; invoice_date: string; status: string; total_amount: string; paid_amount: string }>;
  const num = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
  const price = (it: POItem) => (it.unit_price != null ? num(it.unit_price) : 0);
  const totalOrdered = items.reduce((s, it) => s + num(it.quantity_ordered) * price(it), 0);
  const totalReceived = items.reduce((s, it) => s + num(it.quantity_delivered) * price(it), 0);
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
  const d = (v?: string | null) => (v ? format(new Date(v), 'dd MMM yyyy', { locale: fr }) : null);
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

  const bar = (value: number, max: number) => (
    <span style={{ display: 'block', height: 6, borderRadius: 3, background: 'var(--odoo-border)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: 'var(--odoo-purple)' }} />
    </span>
  );
  const sectionTitle: CSSProperties = { margin: 0, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--odoo-text-muted)' };
  const card: CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--odoo-bg)' };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" role="dialog" aria-label={`Bon de commande ${po.order_number}`} style={panel} onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="odoo-control-bar" style={{ flexWrap: 'wrap', rowGap: 6 }}>
          <div className="odoo-breadcrumb">
            <FileText size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Bon de commande</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>{po.order_number}</span>
          </div>
          {po.frozen && <span className="odoo-tag odoo-tag-grey" title="En-tête et lignes figés"><Lock size={10} /> gelé</span>}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={downloadPdf} disabled={downloading || stage === 0} className="odoo-btn-secondary"
            title={stage === 0 ? 'PDF disponible une fois le BC envoyé' : 'Ouvrir le PDF'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} PDF
          </button>
          <button type="button" onClick={onClose} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* Identité */}
          <div style={{ padding: '12px 16px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', fontSize: '0.8125rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--odoo-text)' }}>{po.supplier_name}</span>
            <span style={{ color: 'var(--odoo-text-muted)' }}>
              {items.length} article{items.length > 1 ? 's' : ''} · <strong style={{ color: 'var(--odoo-text)' }}>{n(totalOrdered)} DH</strong>
              {po.created_by_name && <> · créé par {po.created_by_name}</>}
            </span>
          </div>

          {/* Frise du processus */}
          {!cancelled ? (
            <ol className="ui-timeline" aria-label="Avancement du bon de commande" style={{ marginTop: 12 }}>
              {steps.map((s, i) => {
                const done = i < stage || stage === 5;
                const current = i === stage;
                return (
                  <li key={s.label} className={`ui-timeline-step ${done ? 'is-done' : current ? 'is-current' : ''}`} aria-current={current ? 'step' : undefined}>
                    <span className="ui-timeline-dot">{done ? <CheckCircle2 size={14} /> : i + 1}</span>
                    <span className="ui-timeline-label">{s.label}</span>
                    <span className="ui-timeline-detail" style={current && isLate ? { color: '#dc3545', fontWeight: 600 } : undefined}>{s.detail}</span>
                  </li>
                );
              })}
            </ol>
          ) : <div style={{ height: 12 }} />}

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <StatusBanner tone={next.tone} icon={next.tone === 'success' ? CheckCircle2 : next.tone === 'neutral' ? Ban : next.tone === 'danger' ? AlertTriangle : Clock}
              title={next.title}
              actions={next.action ? (
                <button type="button" className="odoo-btn-primary" onClick={() => { next.action!.run(); onClose(); }}>{next.action.label}</button>
              ) : undefined}>
              {next.text}
            </StatusBanner>

            {po.notes && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', display: 'flex', gap: 6 }}>
                <FileText size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {po.notes}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              {/* Articles */}
              <div style={{ flex: '999 1 520px', minWidth: 0, border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th style={{ textAlign: 'right' }}>Commandé</th>
                      <th style={{ textAlign: 'right' }}>Reçu</th>
                      <th style={{ textAlign: 'right' }}>Reste</th>
                      <th style={{ textAlign: 'right' }}>Prix unit.</th>
                      <th style={{ textAlign: 'right' }}>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const ordered = num(it.quantity_ordered);
                      const received = num(it.quantity_delivered);
                      const remaining = it.qty_remaining_base != null ? num(it.qty_remaining_base) : Math.max(0, ordered - received);
                      const cancelledQty = num(it.qty_cancelled_base);
                      const unit = it.base_unit || it.ingredient_unit;
                      const dot = remaining <= 0 ? '#28a745' : received > 0 ? '#e6892b' : 'var(--odoo-border-strong, #adb5bd)';
                      return (
                        <tr key={it.id}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dot, flexShrink: 0 }} />
                              <span style={{ fontWeight: 500 }}>{it.ingredient_name}</span>
                            </span>
                            {cancelledQty > 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginLeft: 16 }}>{trimQty(cancelledQty)} {unit} soldé{cancelledQty > 1 ? 's' : ''} sans livraison</div>}
                          </td>
                          <td style={{ textAlign: 'right' }}>{trimQty(ordered)} <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>{unit}</span></td>
                          <td style={{ textAlign: 'right', color: received > 0 ? 'var(--odoo-text)' : 'var(--odoo-text-muted)' }}>{trimQty(received)}</td>
                          <td style={{ textAlign: 'right', color: remaining > 0 ? '#b85d1a' : 'var(--odoo-text-muted)', fontWeight: remaining > 0 ? 600 : 400 }}>{remaining > 0 ? trimQty(remaining) : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>
                            {it.unit_price != null ? n(num(it.unit_price)) : <span style={{ color: '#b85d1a', fontWeight: 600, fontSize: '0.75rem' }}>à définir</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{it.unit_price != null ? n(ordered * num(it.unit_price)) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: '2px solid var(--odoo-border)' }}>
                      <td colSpan={5}>Total</td>
                      <td style={{ textAlign: 'right' }}>{n(totalOrdered)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Colonne de droite */}
              <aside style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <section style={card} aria-label="Montants">
                  <h3 style={sectionTitle}>Montants</h3>
                  {[
                    { label: 'Commandé', value: totalOrdered },
                    { label: 'Reçu', value: totalReceived },
                    { label: 'Facturé', value: totalInvoiced },
                  ].map(m => (
                    <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                        <span style={{ color: 'var(--odoo-text-muted)' }}>{m.label}</span>
                        <strong>{n(m.value)} DH</strong>
                      </span>
                      {bar(m.value, totalOrdered)}
                    </div>
                  ))}
                </section>

                <section style={card} aria-label="Dates">
                  <h3 style={sectionTitle}>Dates</h3>
                  {[
                    { label: 'Commandé le', value: d(po.order_date) },
                    { label: 'Livraison prévue', value: d(po.expected_delivery_date), late: isLate },
                    { label: 'Livré le', value: d(po.delivery_date) },
                  ].map(x => (
                    <span key={x.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                      <span style={{ color: 'var(--odoo-text-muted)' }}>{x.label}</span>
                      <span style={{ color: x.late ? '#dc3545' : 'var(--odoo-text)', fontWeight: x.late ? 600 : 400 }}>{x.value ?? '—'}</span>
                    </span>
                  ))}
                </section>

                <section style={card} aria-label="Factures liées">
                  <h3 style={sectionTitle}>Factures</h3>
                  {invoices.length === 0 ? (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Aucune facture rattachée.</span>
                  ) : invoices.map(inv => (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8125rem' }}>
                      <span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{inv.supplier_invoice_number || inv.invoice_number}</span>
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}> · {d(inv.invoice_date)}</span>
                      </span>
                      <span style={{ color: num(inv.paid_amount) >= num(inv.total_amount) - 0.005 ? '#28a745' : '#b85d1a', fontSize: '0.75rem', fontWeight: 600 }}>
                        {num(inv.paid_amount) >= num(inv.total_amount) - 0.005 ? 'réglée' : `reste ${n(num(inv.total_amount) - num(inv.paid_amount))}`}
                      </span>
                    </div>
                  ))}
                </section>
              </aside>
            </div>

            <section aria-label="Historique">
              <h3 style={{ ...sectionTitle, marginBottom: 8 }}>Historique</h3>
              <DocumentActionsTimeline queryKey={['po-actions', poId]} fetcher={() => purchaseOrdersApi.actions(poId)} />
            </section>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function trimQty(v: number) {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

/* ═══ Delivery Confirmation Modal ═══ */
function DeliveryModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  // Une clé par réception ouverte : une validation rejouée ne réceptionne pas deux fois (mig 307).
  const [deliveryIdemKey] = useState(newIdempotencyKey);
  const queryClient = useQueryClient();
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  const [deliveries, setDeliveries] = useState<Record<string, number>>({});
  // Saisie par contenant : nb de contenants par ligne. Pilote la qty reçue en kg
  // (nb x container_size) quand l'ingrédient a une taille de contenant définie.
  const [containerCounts, setContainerCounts] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [lotInfo, setLotInfo] = useState<Record<string, { supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }>>({});
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState('');
  // forceComplete : le fournisseur ne livrera pas le reste. Le BC est cloture
  // sur ce qui a ete recu (qty_ordered alignee sur qty_delivered, lignes vides
  // supprimees).
  const [forceComplete, setForceComplete] = useState(false);

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
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la confirmation');
    },
  });

  if (isLoading) return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="odoo-scope text-center" style={{ ...odooModalPanelStyle, padding: '2rem' }} onClick={(e) => e.stopPropagation()}>
        <Loader2 className="animate-spin mx-auto mb-3" size={28} style={{ color: 'var(--odoo-text-muted)' }} />
        <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Chargement...</p>
      </div>
    </ModalBackdrop>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];

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

  const handleSubmit = () => {
    const deliveredItems = Object.entries(deliveries)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantityDelivered]) => ({
        itemId, quantityDelivered,
        ...(prices[itemId] != null && prices[itemId] > 0 ? { unitPrice: prices[itemId] } : {}),
        ...lotInfo[itemId],
      }));
    if (deliveredItems.length === 0) { notify.error('Saisissez au moins une quantité livrée'); return; }
    // Si cette reception va creer la facture (livraison complete), on conseille
    // fortement le N° de facture fournisseur — sinon le systeme retombera
    // sur un numero auto-genere (legacy, non recommande).
    if (willCompletePO && !supplierInvoiceNumber.trim()) {
      const proceed = confirm(
        'Aucun N° de facture fournisseur saisi.\n\n' +
        'Cette réception va clôturer le BC et créer automatiquement la facture. ' +
        'Sans N° de facture fournisseur, le système générera un numéro interne ' +
        '(non recommandé — il vaut mieux saisir celui imprimé sur la facture papier).\n\n' +
        'Continuer sans le numéro ?'
      );
      if (!proceed) return;
    }
    confirmMutation.mutate({
      items: deliveredItems,
      ...(supplierInvoiceNumber.trim() ? { supplierInvoiceNumber: supplierInvoiceNumber.trim() } : {}),
      ...(supplierInvoiceDate ? { supplierInvoiceDate } : {}),
      ...(forceComplete ? { forceComplete: true } : {}),
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

  return (
    <div className="fixed inset-0 bg-black/40 z-50">
      <div className="odoo-scope w-full h-full flex flex-col" style={{ backgroundColor: 'var(--odoo-bg)' }}>
        {/* Header */}
        <div className="shrink-0" style={odooModalHeaderStyle}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PackageCheck size={18} style={{ color: '#fff' }} />
              <div>
                <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Confirmer la réception</h2>
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>{po.order_number} — {po.supplier_name}</p>
              </div>
            </div>
            <button onClick={onClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-4 flex-1 overflow-y-auto">
          {/* Force-complete : le fournisseur ne livrera pas le reste, on
              cloture le BC sur ce qui est recu et la facture est emise sur ce
              perimetre. */}
          {!naturallyComplete && (
            <label className="flex items-start gap-3 cursor-pointer"
              style={{ borderRadius: 4, padding: '0.75rem', border: `1px solid ${forceComplete ? '#f0b27a' : 'var(--odoo-border)'}`, backgroundColor: forceComplete ? '#fff3e6' : 'var(--odoo-bg-alt)' }}>
              <input type="checkbox" checked={forceComplete}
                onChange={e => setForceComplete(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#e6892b' }} />
              <div className="flex-1">
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: forceComplete ? '#b85d1a' : 'var(--odoo-text)' }}>
                  Clôturer le BC : le fournisseur ne livrera pas le reste
                </div>
                <div style={{ fontSize: '0.6875rem', marginTop: 2, color: forceComplete ? '#b85d1a' : 'var(--odoo-text-muted)' }}>
                  Les lignes non livrées sont supprimées du BC, les lignes partielles sont alignées sur la quantité reçue. La facture est créée sur ce périmètre.
                </div>
              </div>
            </label>
          )}

          {/* Facture fournisseur — N° et date imprimes sur le document papier */}
          <div style={{ borderRadius: 4, padding: '1rem', border: `1px solid ${willCompletePO ? '#ffeeba' : 'var(--odoo-border)'}`, backgroundColor: willCompletePO ? '#fff8e8' : 'var(--odoo-bg-alt)' }}>
            <div className="flex items-start gap-2" style={{ marginBottom: 12 }}>
              <FileText size={16} style={{ marginTop: 2, color: willCompletePO ? '#b8860b' : 'var(--odoo-text-muted)' }} />
              <div className="flex-1">
                <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: willCompletePO ? '#856404' : 'var(--odoo-text)' }}>
                  Facture fournisseur
                </h3>
                <p style={{ fontSize: '0.6875rem', marginTop: 2, color: willCompletePO ? '#856404' : 'var(--odoo-text-muted)' }}>
                  {willCompletePO
                    ? 'Cette réception va clôturer le BC. Saisis le N° imprimé sur la facture papier du fournisseur (il sera utilisé tel quel, pas auto-généré).'
                    : 'Optionnel pour une livraison partielle. Tu pourras le saisir lors de la livraison finale.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label style={odooLabelStyle}>
                  N° facture fournisseur {willCompletePO && <span style={{ color: '#b8860b' }}>*</span>}
                </label>
                <input type="text" value={supplierInvoiceNumber}
                  onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  placeholder="Ex: FAC-2026-12345" style={odooFieldStyle} />
              </div>
              <div>
                <label style={odooLabelStyle}>Date de la facture</label>
                <input type="date" value={supplierInvoiceDate}
                  onChange={(e) => setSupplierInvoiceDate(e.target.value)} style={odooFieldStyle} />
              </div>
            </div>
          </div>

          {/* Fill all button */}
          <div className="flex justify-between items-center">
            <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Saisissez les quantités reçues pour chaque article</p>
            <button onClick={fillAll} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={14} /> Tout reçu
            </button>
          </div>

          {/* Items */}
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
            <table className="odoo-table" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  <th>Ingrédient</th>
                  <th style={{ textAlign: 'right' }}>Commandé</th>
                  <th style={{ textAlign: 'right' }}>Déjà reçu</th>
                  <th style={{ textAlign: 'right' }}>Restant</th>
                  <th style={{ textAlign: 'center', width: 170 }}>Contenants</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Qté reçue</th>
                  <th style={{ textAlign: 'right', width: 96 }}>Prix U.</th>
                  <th style={{ textAlign: 'right', width: 96 }}>Total</th>
                  <th style={{ textAlign: 'center', width: 96 }}>Ref. lot</th>
                  <th style={{ textAlign: 'center', width: 128 }}>DLC</th>
                  <th style={{ textAlign: 'center', width: 128 }}>Date prod.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const alreadyDelivered = parseFloat(item.quantity_delivered);
                  const remaining = ordered - alreadyDelivered;
                  const isComplete = remaining <= 0;
                  return (
                    <tr key={item.id} style={isComplete ? { backgroundColor: '#f0fbf3' } : undefined}>
                      <td>
                        <span style={{ fontWeight: 500, color: isComplete ? '#28a745' : 'var(--odoo-text)' }}>
                          {item.ingredient_name}
                        </span>
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({item.ingredient_unit})</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{ordered}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ color: alreadyDelivered > 0 ? '#28a745' : 'var(--odoo-text-muted)', fontWeight: alreadyDelivered > 0 ? 500 : 400 }}>{alreadyDelivered}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isComplete
                          ? <span style={{ color: '#28a745', fontWeight: 500 }} className="flex items-center justify-end gap-1"><CheckCircle2 size={14} /> Complet</span>
                          : <span style={{ fontWeight: 600 }}>{remaining}</span>}
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
                            <td style={{ textAlign: 'center' }}>
                              {isComplete ? (
                                <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>
                              ) : hasContainer ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                                  <input type="number" min={0} step={1}
                                    value={containerCounts[item.id] ?? ''}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      setContainerCounts({ ...containerCounts, [item.id]: raw });
                                      const c = parseInt(raw, 10);
                                      setDeliveries({ ...deliveries, [item.id]: Number.isFinite(c) && c > 0 ? c * size : 0 });
                                    }}
                                    style={{ ...odooNumFieldStyle, width: 56, backgroundColor: '#fff8e8', textAlign: 'center' }}
                                    placeholder="0" />
                                  <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', whiteSpace: 'nowrap' }}>
                                    {typeLabel} × {size} {unit}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>
                              )}
                            </td>
                            {/* Qté reçue : total en unité de base (auto depuis les contenants, ajustable). */}
                            <td>
                              {!isComplete ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                  <input type="number" min={0} max={remaining} step="0.01"
                                    value={deliveries[item.id] ?? ''}
                                    onChange={(e) => setDeliveries({ ...deliveries, [item.id]: parseFloat(e.target.value) || 0 })}
                                    style={{ ...odooNumFieldStyle, width: 80, backgroundColor: '#fff8e8' }}
                                    placeholder="0"
                                    title={hasContainer ? `Total en ${unit} (calculé depuis les contenants, ajustable si contenant entamé)` : undefined} />
                                  <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', minWidth: 16 }}>{unit}</span>
                                </div>
                              ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'right' }}>—</span>}
                            </td>
                          </>
                        );
                      })()}
                      <td>
                        {!isComplete ? (
                          <input type="number" min={0} step="0.01"
                            value={prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : '')}
                            onChange={(e) => setPrices({ ...prices, [item.id]: parseFloat(e.target.value) || 0 })}
                            style={odooNumFieldStyle} placeholder="Prix" />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'right' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {(() => {
                          const qty = deliveries[item.id] || 0;
                          const price = prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : 0);
                          const lineTotal = qty * price;
                          return lineTotal > 0
                            ? <span style={{ fontWeight: 600 }}>{n(lineTotal)}</span>
                            : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>;
                        })()}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="text"
                            value={lotInfo[item.id]?.supplierLotNumber ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], supplierLotNumber: e.target.value } })}
                            style={{ ...odooFieldStyle, fontSize: '0.75rem', ...(item.requires_lot && !lotInfo[item.id]?.supplierLotNumber ? { borderColor: '#d97706' } : {}) }}
                            placeholder={item.requires_lot ? 'Lot *' : 'Lot'} title={item.requires_lot ? 'Lot fournisseur exigé pour cet article' : undefined} />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'center' }}>—</span>}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.expirationDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], expirationDate: e.target.value } })}
                            min={new Date().toISOString().slice(0, 10)}
                            title={item.requires_dlc ? 'DLC exigée pour cet article' : undefined}
                            style={{ ...odooFieldStyle, fontSize: '0.75rem', ...(item.requires_dlc && !lotInfo[item.id]?.expirationDate ? { borderColor: '#d97706' } : {}) }} />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'center' }}>—</span>}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.manufacturedDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], manufacturedDate: e.target.value } })}
                            style={{ ...odooFieldStyle, fontSize: '0.75rem' }} />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'center' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary of what's being received */}
          {totalDelivering > 0 && (
            <div className="flex items-center justify-between"
              style={{ backgroundColor: 'var(--theme-accent-light, rgba(0,0,0,0.04))', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '0.625rem 0.875rem' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--theme-accent)', fontWeight: 600 }} className="flex items-center gap-1.5">
                <ArrowRight size={14} />
                Valeur de cette réception
              </span>
              <span style={{ fontWeight: 700, color: 'var(--theme-accent)' }}>{n(totalDelivering)} DH</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 shrink-0"
          style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem', backgroundColor: 'var(--odoo-bg)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={handleSubmit} disabled={confirmMutation.isPending}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {confirmMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={16} />}
            {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer la réception'}
          </button>
        </div>
      </div>
    </div>
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
  kind: 'ingredient' | 'consumable';
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
      kind: (it.packaging_id ? 'consumable' : 'ingredient') as 'ingredient' | 'consumable',
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
    // Validation : chaque ligne doit cibler un article (ingredient OU consommable) et qty > 0
    if (lines.some(l => !(l.ingredientId || l.packagingId) || (parseFloat(l.quantityOrdered) || 0) <= 0)) {
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
      notify.success('BC mis a jour');
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="odoo-scope flex flex-col" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1100, maxHeight: '92vh', backgroundColor: 'var(--odoo-bg)',
          border: '1px solid var(--odoo-border)', borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
        {/* Header */}
        <div className="flex items-center justify-between shrink-0"
          style={{ backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem' }}>
          <div className="flex items-center gap-3">
            <Pencil size={16} style={{ color: '#fff' }} />
            <div>
              <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Modifier le bon de commande</h2>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>{po?.order_number as string || '...'}</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20"
            style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: '1.25rem' }}>
          {isLoading ? (
            <div className="flex items-center justify-center" style={{ padding: '2.5rem 0', color: 'var(--odoo-text-muted)' }}>
              <Loader2 size={20} className="animate-spin" style={{ marginRight: 8 }} /> Chargement...
            </div>
          ) : (
            <>
              {/* En-tete */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label style={odooLabelStyle}>Fournisseur</label>
                  <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={odooFieldStyle}>
                    <option value="">—</option>
                    {(suppliers as Record<string, any>[]).filter(s => s.is_active || s.id === supplierId).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={odooLabelStyle}>Date livraison prévue</label>
                  <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={odooFieldStyle} />
                </div>
                <div>
                  <label style={odooLabelStyle}>Statut actuel</label>
                  <div style={{ ...odooFieldStyle, display: 'flex', alignItems: 'center', minHeight: 34 }}>
                    {po?.status ? (() => {
                      const Icon = STATUS_ICONS[po.status as string];
                      return (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${STATUS_COLORS[po.status as string] || 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                          {Icon && <Icon size={12} />}
                          {STATUS_LABELS[po.status as string] || (po.status as string)}
                        </span>
                      );
                    })() : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={odooLabelStyle}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  style={{ ...odooFieldStyle, resize: 'vertical' }} />
              </div>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.75rem',
                backgroundColor: '#fff8e8', color: '#856404', border: '1px solid #ffeeba' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Modifier la <strong>qté livrée</strong> ajuste automatiquement le stock (mouvement
                  d'inventaire tracé). Supprimer une ligne déjà référencée par un bon de réception
                  sera refusé — annule la réception d'abord.
                </span>
              </div>

              {/* Lignes */}
              <div style={{ marginTop: 12, border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
                <table className="odoo-table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Ingrédient</th>
                      <th style={{ textAlign: 'right' }}>Qté commandée</th>
                      <th style={{ textAlign: 'right' }}>Qté livrée</th>
                      <th style={{ textAlign: 'right' }}>Prix U.</th>
                      <th style={{ textAlign: 'right' }}>Sous-total</th>
                      <th style={{ width: 36 }}></th>
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
                              <span style={{ fontWeight: 500 }}>
                                {line.ingredientName} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>({line.ingredientUnit})</span>
                                {line.kind === 'consumable' && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6, fontSize: '0.625rem' }}>Consommable</span>}
                              </span>
                            ) : (
                              <select value={line.ingredientId}
                                onChange={e => {
                                  const ing = (ingredients as Record<string, any>[]).find(i => i.id === e.target.value);
                                  const container = containerOf(ing);
                                  updateLine(idx, {
                                    ingredientId: e.target.value,
                                    ingredientName: ing ? (ing.name as string) : '',
                                    ingredientUnit: ing ? (ing.unit as string) : '',
                                    container,
                                    quantityOrdered: container ? String(container.size) : line.quantityOrdered,
                                  });
                                }}
                                style={odooFieldStyle}>
                                <option value="">— Choisir —</option>
                                {(ingredients as Record<string, any>[]).map(i => (
                                  <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td>
                            {line.container ? (() => {
                              const count = roundUpToContainer(parseFloat(line.quantityOrdered) || 0, line.container.size).count;
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                  <input type="number" step="1" min={1} value={count || ''}
                                    onChange={e => {
                                      const c = Math.max(1, Math.floor(parseFloat(e.target.value) || 1));
                                      updateLine(idx, { quantityOrdered: String(c * (line.container as ContainerDef).size) });
                                    }}
                                    style={{ ...odooNumFieldStyle, width: 64 }} title={`${containerLabel(line.container, line.ingredientUnit)} — commande par contenant entier`} />
                                  <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', whiteSpace: 'nowrap' }}>
                                    × {containerLabel(line.container, line.ingredientUnit)} = <strong>{q} {line.ingredientUnit}</strong>
                                  </span>
                                </div>
                              );
                            })() : (
                              <input type="number" step="0.01" min={0} value={line.quantityOrdered}
                                onChange={e => updateLine(idx, { quantityOrdered: e.target.value })}
                                style={odooNumFieldStyle} />
                            )}
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.quantityDelivered}
                              onChange={e => updateLine(idx, { quantityDelivered: e.target.value })}
                              style={{ ...odooNumFieldStyle, backgroundColor: '#fff8e8' }} />
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.unitPrice}
                              onChange={e => updateLine(idx, { unitPrice: e.target.value })}
                              placeholder="—"
                              style={odooNumFieldStyle} />
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>
                            {n(q * p)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button type="button" onClick={() => removeLine(idx)}
                              className="odoo-btn-danger" title="Supprimer"
                              style={{ padding: '0.25rem 0.4rem' }}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button type="button" onClick={addLine} className="odoo-btn-secondary"
                style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={14} /> Ajouter une ligne
              </button>

              {/* Total */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.625rem 0.875rem', borderRadius: 4,
                backgroundColor: 'var(--theme-accent-light, rgba(0,0,0,0.04))', border: '1px solid var(--odoo-border)' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--theme-accent)' }}>Nouveau total BC (qté commandée × prix)</span>
                <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace', fontSize: '1.0625rem', color: 'var(--theme-accent)' }}>{n(newTotalOrdered)} DH</span>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 shrink-0"
          style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem', backgroundColor: 'var(--odoo-bg)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={handleSave} disabled={isPending || isLoading}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            <CheckCircle2 size={14} /> Enregistrer
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope w-full max-w-lg flex flex-col" style={odooModalPanelStyle} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={odooModalHeaderStyle}>
          <div className="flex items-center gap-2">
            <Combine size={16} style={{ color: '#fff' }} />
            <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Fusionner les factures</h2>
          </div>
          <button onClick={onClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-4">
          <div style={{ display: 'flex', gap: 8, padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.75rem', backgroundColor: '#fff8e8', color: '#856404', border: '1px solid #ffeeba' }}>
            <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 2 }} />
            <div>
              Cette action remplace plusieurs factures par une seule, en additionnant les lignes et les montants.
              Refus si l'une des factures a déjà un paiement enregistré.
            </div>
          </div>

          <div>
            <div style={odooLabelStyle}>Fournisseur</div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{supplierName}</div>
          </div>

          <div>
            <div style={odooLabelStyle}>BCs à fusionner ({selectedPOs.length})</div>
            <div style={{ backgroundColor: 'var(--odoo-bg-alt)', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '0.75rem', maxHeight: 192, overflow: 'auto' }} className="space-y-1">
              {selectedPOs.map(po => (
                <div key={po.id as string} className="flex justify-between" style={{ fontSize: '0.75rem' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{po.order_number as string}</span>
                  <span style={{ fontWeight: 600 }}>{n(parseFloat(po.total_amount as string))} DH</span>
                </div>
              ))}
              <div className="flex justify-between" style={{ fontSize: '0.8125rem', fontWeight: 700, paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--odoo-border)' }}>
                <span>Total fusionné</span>
                <span>{n(totalAmount)} DH</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={odooLabelStyle}>N° facture fournisseur</label>
              <input type="text" value={supplierInvoiceNumber}
                onChange={e => setSupplierInvoiceNumber(e.target.value)}
                placeholder="Optionnel" style={odooFieldStyle} />
            </div>
            <div>
              <label style={odooLabelStyle}>Date facture</label>
              <input type="date" value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)} style={odooFieldStyle} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2" style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem', backgroundColor: 'var(--odoo-bg)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => onConfirm({ supplierInvoiceNumber, invoiceDate })}
            disabled={isPending}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            <Combine size={14} /> Confirmer la fusion
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Corriger la réception · {target.label}</span></div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ delta: sign * q, reasonCodeId, note: note.trim() || undefined }); }}
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
            La correction s'ajoute au bon de réception (la ligne d'origine reste visible) et ajuste le lot. Une baisse ne peut pas dépasser ce qui reste à l'économat.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <select id="cr-sign" value={sign} onChange={e => setSign(Number(e.target.value) as 1 | -1)} className="px-3 py-2 border border-gray-200 rounded-md text-sm">
              <option value={-1}>Retirer</option>
              <option value={1}>Ajouter</option>
            </select>
            <input id="cr-qty" type="number" step="any" min="0" value={qty} onChange={e => setQty(e.target.value)} autoFocus
              className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm" placeholder={`Quantité en ${target.unit}`} />
          </div>
          <select id="cr-reason" value={reasonCodeId} onChange={e => setReasonCodeId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm">
            <option value="">— Motif * —</option>
            {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <textarea id="cr-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" placeholder={requiresNote ? 'Précision (obligatoire)' : 'Précision (facultatif)'} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Retour</button>
            <button type="submit" disabled={!valid || pending} className="odoo-btn-primary">Corriger {q > 0 ? `${sign > 0 ? '+' : '−'}${q} ${target.unit}` : ''}</button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
