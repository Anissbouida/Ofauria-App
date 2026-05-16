import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { BonSortiePanel } from './BonSortiePanel';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { PRODUCTION_STATUS_LABELS, getRoleCategorySlugs } from '@ofauria/shared';
import { usePermissions } from '../../context/PermissionsContext';
import {
  ArrowLeft, CheckCircle, CheckCircle2, Play, AlertTriangle, Factory, Printer, Filter, Package,
  User, Phone, Calendar, Banknote, Box, Clock, RotateCcw, XCircle, ChefHat,
  ClipboardList, Hash, FileText, Loader2, PackageOpen, Layers, Beaker, TrendingUp, Flame,
  ShoppingCart, Truck, Eye, Lock, RefreshCw, AlertCircle, BookOpen, Scale,
  MessageSquare, Send, Droplets, Info, Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { smartFormatQuantity, formatQty } from '../../utils/units';
import ProductionLaunchModal from './ProductionLaunchModal';
import LossDeclarationModal from '../pos/LossDeclarationModal';
import PrintOverlay from '../../components/PrintOverlay';
import PrintModeSelectorModal from './PrintModeSelectorModal';
import type { LotLabelData } from '../../lib/niimbot';
import EtapesPanel from './EtapesPanel';
import RendementPanel from './RendementPanel';
import CoutReelPanel from './CoutReelPanel';

const statusConfig: Record<string, { bg: string; text: string; dot: string; gradient: string; label: string; icon: React.ReactNode }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400', gradient: 'from-gray-500 to-gray-600', label: 'Brouillon', icon: <FileText size={14} /> },
  confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', gradient: 'from-blue-500 to-blue-600', label: 'Confirme', icon: <CheckCircle size={14} /> },
  in_progress: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', gradient: 'from-amber-500 to-orange-600', label: 'En cours', icon: <Play size={14} /> },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', gradient: 'from-emerald-500 to-emerald-600', label: 'Termine', icon: <CheckCircle size={14} /> },
};

const roleConfig: Record<string, { label: string; bg: string; text: string; avatar: string }> = {
  baker: { label: 'Boulanger', bg: 'bg-amber-100', text: 'text-amber-800', avatar: 'bg-amber-500' },
  pastry_chef: { label: 'Patissier', bg: 'bg-pink-100', text: 'text-pink-800', avatar: 'bg-pink-500' },
  viennoiserie: { label: 'Viennoiserie', bg: 'bg-orange-100', text: 'text-orange-800', avatar: 'bg-orange-500' },
  beldi_sale: { label: 'Beldi & Sale', bg: 'bg-green-100', text: 'text-green-800', avatar: 'bg-green-500' },
};

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showProductionLaunch, setShowProductionLaunch] = useState(false);
  const [launchTargetItemId, setLaunchTargetItemId] = useState<string | null>(null);
  const [timerStepName, setTimerStepName] = useState<string | null>(null);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [printChoiceItem, setPrintChoiceItem] = useState<Record<string, any> | null>(null);
  const { settings } = useSettings();
  const isChef = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || '');
  // Admin/manager ont aussi le privilege magasinier (peuvent prendre en charge la preparation BSI).
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');

  const { data: plan, isLoading } = useQuery({
    queryKey: ['production', id],
    queryFn: () => productionApi.getById(id!),
    enabled: !!id,
    // Auto-refresh every 30s when plan has pending semi-finished dependencies
    refetchInterval: (query) => {
      const p = query.state.data as Record<string, any> | undefined;
      if (!p?.dependencies) return false;
      const deps = p.dependencies as Record<string, any>[];
      const hasPending = deps.some(d => d.status !== 'fulfilled' && d.status !== 'cancelled');
      return hasPending ? 30000 : false;
    },
  });

  const replenishmentId = plan?.replenishment_request_id as string | undefined;
  const { data: linkedReplenishment } = useQuery({
    queryKey: ['replenishment', replenishmentId],
    queryFn: () => replenishmentApi.getById(replenishmentId!),
    enabled: !!replenishmentId,
  });

  // Reverse traceability: which ingredient lots were used in this production
  const { data: productionLotUsage = [] } = useQuery({
    queryKey: ['production-lots', id],
    queryFn: () => ingredientLotsApi.productionLots(id!),
    enabled: !!id && (plan?.status === 'completed' || plan?.status === 'in_progress'),
  });

  // FEFO preview: which lots will be used (read-only preview before production)
  const { data: fefoPreview = [] } = useQuery({
    queryKey: ['fefo-preview', id],
    queryFn: () => ingredientLotsApi.fefoPreview(id!),
    enabled: !!id && ['confirmed', 'in_progress'].includes(plan?.status),
  });

  // Activity feed
  const { data: activities = [], refetch: refetchActivities } = useQuery({
    queryKey: ['production-activities', id],
    queryFn: () => productionApi.getActivities(id!),
    enabled: !!id,
  });
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const handleAddNote = async () => {
    if (!newNote.trim() || addingNote) return;
    setAddingNote(true);
    try {
      await productionApi.addActivity(id!, newNote.trim());
      setNewNote('');
      refetchActivities();
    } catch { /* ignore */ }
    setAddingNote(false);
  };

  // Bon de sortie for this plan — fetche des que le plan existe pour le wizard.
  // Avant: query activee seulement apres 'confirmed'. Desormais on charge aussi en 'draft' pour
  // savoir si le BSI a deja ete prepare (etape 2 du wizard).
  const { data: bonsSortie = [] } = useQuery({
    queryKey: ['bons-sortie', id],
    queryFn: () => bonSortieApi.getByPlan(id!),
    enabled: !!id && !!plan,
  });
  const activeBon = (bonsSortie as Record<string, any>[]).find((b: Record<string, any>) => b.status !== 'annule') as Record<string, any> | undefined;

  // Semi-fini plans don't need their own bon de sortie — ingredients are in the parent plan's BSI
  const isSemiFini = plan?.dependency_of && (plan.dependency_of as Record<string, any>[]).length > 0;

  // Preparation BSI explicite (wizard etape 2) — l'utilisateur clique "Preparer le bon de sortie".
  // Le backend ne genere plus automatiquement lors de la confirmation, pour forcer la revue
  // des besoins ingredient avant de s'engager a produire.
  // Si generate() renvoie data=null avec un reason (plan sans recette -> rien a prelever),
  // on memorise le motif pour remplacer la banniere "Preparer le bon de sortie" par un
  // message explicatif, au lieu d'inciter l'utilisateur a recliquer en boucle.
  const [bonNotNeededReason, setBonNotNeededReason] = useState<string | null>(null);
  // Modal de declaration de perte (rebut de production : brule, rate, machine en panne, etc.)
  const [showLossModal, setShowLossModal] = useState(false);
  const [restockNeed, setRestockNeed] = useState<Record<string, any> | null>(null);

  // Onglets de la page : 'preparation' (BSI + ingredients) | 'production' (items + execution).
  // L'onglet Production n'apparait qu'une fois le BSI cloture (ou inutile, ou deja en cours).
  const [activePlanTab, setActivePlanTab] = useState<'preparation' | 'production'>('preparation');
  // Sous-onglets dans Preparation :
  //   - 'needs'  : Besoins en ingredients (en haut) + Apercu FEFO (en bas) — info read-only
  //   - 'bsi'    : Gestion inline du bon de sortie (prelevement/validation)
  const [prepSubTab, setPrepSubTab] = useState<'needs' | 'bsi'>('needs');
  // Auto-bascule sur 'production' quand le plan est deja demarre/termine a l'ouverture
  useEffect(() => {
    if (plan && (plan.status === 'in_progress' || plan.status === 'completed')) {
      setActivePlanTab('production');
    }
  }, [plan?.status]);
  // Auto-bascule sur le sous-onglet "Bon de sortie" quand un BSI est genere
  // (l'operateur vient de cliquer "Preparer le bon de sortie", on l'emmene directement
  // sur l'interface de prelevement sans changer de page).
  useEffect(() => {
    if (activeBon && activeBon.status !== 'cloture' && activeBon.status !== 'annule') {
      setPrepSubTab('bsi');
    }
  }, [activeBon?.id, activeBon?.status]);

  const prepareBonMutation = useMutation({
    mutationFn: () => bonSortieApi.generate(id!, plan!.store_id as string),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', id] });
      if (result?.data) {
        setBonNotNeededReason(null);
        notify.success('Bon de sortie genere — procedez au prelevement des ingredients');
      } else {
        const reason = result?.reason || 'Aucun ingredient a prelever pour ce plan (produits sans recette).';
        setBonNotNeededReason(reason);
        notify(reason, { icon: '\u2139\ufe0f', duration: 6000 });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        || 'Erreur lors de la generation du bon de sortie';
      notify.error(msg);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => productionApi.confirm(id!),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success('Plan confirme avec succes');
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => notify(w, { icon: '\u26a0\ufe0f', duration: 5000 }));
      }
      // Auto-detect semi-finished needs after confirmation
      try {
        const sfResult = await productionApi.detectSemiFinished(id!);
        queryClient.invalidateQueries({ queryKey: ['production', id] });
        if (sfResult.semiFinishedPlanIds?.length > 0) {
          notify(`${sfResult.semiFinishedPlanIds.length} plan(s) semi-fini(s) cree(s) automatiquement`, { icon: '🧪', duration: 6000 });
        }
      } catch { /* non-blocking */ }
    },
  });

  const getPlanLotPrefix = (planData?: Record<string, any>) => {
    const p = planData || plan;
    if (!p) return '';
    const d = new Date(p.plan_date as string);
    const dateStr = `${String(d.getFullYear() % 100).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const firstLot = ((p.items || items || []) as Record<string, any>[]).find(it => it.lot_number);
    if (firstLot) {
      const ln = firstLot.lot_number as string;
      return ln.substring(0, ln.lastIndexOf('-'));
    }
    return `LOT-${dateStr}`;
  };

  const buildLotLabelData = (item: Record<string, any>): LotLabelData | null => {
    if (!plan) return null;
    const prodTs = item.production_timestamp || item.produced_at;
    const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date as string);
    const sld = item.shelf_life_days as number;
    const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
    const planDate = new Date(plan.plan_date as string);
    const lotNumber = (item.lot_number as string) || `LOT-${format(planDate, 'yyMMdd')}-001`;
    const isReexposable = item.is_reexposable as boolean;
    const isRecyclable = item.is_recyclable as boolean;
    const cycleLabel = isReexposable ? 'DLV — Conservable' : isRecyclable ? 'Recyclable' : 'Vente du jour';
    return {
      productName: String(item.product_name || ''),
      lotNumber,
      quantity: String(item.actual_quantity ?? item.planned_quantity ?? ''),
      productionDate: format(prodDate, 'dd/MM HH:mm'),
      expirationDate: dlcDate ? format(dlcDate, 'dd/MM/yyyy') : null,
      cycleLabel,
      companyName: settings.companyName,
    };
  };

  const printProductionTicket = (item: Record<string, any>) => {
    if (!plan) return;
    const prodTs = item.production_timestamp || item.produced_at;
    const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date);
    const sld = item.shelf_life_days as number;
    const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
    const prodBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : '—';
    const planDate = new Date(plan.plan_date as string);
    const lotNumber = (item.lot_number as string) || `LOT-${format(planDate, 'yyMMdd')}-${String(1).padStart(3, '0')}`;
    const isReexposable = item.is_reexposable as boolean;
    const isRecyclable = item.is_recyclable as boolean;
    const cycleVie = isReexposable ? 'DLV — Conservable' : isRecyclable ? 'Recyclable' : 'Vente du jour';
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');

    setPrintHtml(`<!DOCTYPE html><html><head><title>Ticket - ${item.product_name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 15px; color: #333; font-size: 12px; }
  .ticket { border: 2px solid #333; padding: 12px; border-radius: 6px; max-width: 80mm; margin: 0 auto; }
  .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 10px; }
  .header h1 { font-size: 14px; margin-bottom: 2px; }
  .header h2 { font-size: 11px; font-weight: normal; color: #666; }
  .header .lot { font-size: 13px; font-weight: bold; margin-top: 6px; letter-spacing: 0.5px; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; }
  .product-name { text-align: center; font-size: 16px; font-weight: bold; padding: 10px 0; border-bottom: 1px dashed #ccc; margin-bottom: 8px; text-transform: uppercase; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #eee; }
  .row .label { font-size: 11px; color: #666; text-transform: uppercase; }
  .row .value { font-weight: bold; font-size: 12px; }
  .cycle { text-align: center; margin-top: 10px; padding: 6px; border: 1px solid #333; border-radius: 4px; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .cycle.dlv { background: #f0fdf4; color: #15803d; border-color: #15803d; }
  .cycle.recyclable { background: #ecfeff; color: #0e7490; border-color: #0e7490; }
  .cycle.vdj { background: #fff7ed; color: #c2410c; border-color: #c2410c; }
  .barcode { text-align: center; margin-top: 10px; font-family: 'Courier New', monospace; font-size: 14px; letter-spacing: 2px; font-weight: bold; }
  .footer { text-align: center; margin-top: 10px; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 6px; }
</style></head><body>
<div class="ticket">
  <div class="header">
    <h1>${settings.companyName}</h1>
    <h2>${settings.subtitle || ''}</h2>
    <div class="lot">${lotNumber}</div>
  </div>

  <div class="product-name">${item.product_name}</div>

  <div class="row">
    <span class="label">Quantite produite</span>
    <span class="value">${item.actual_quantity ?? item.planned_quantity}</span>
  </div>
  <div class="row">
    <span class="label">Date de production</span>
    <span class="value">${format(prodDate, 'dd/MM/yyyy HH:mm')}</span>
  </div>
  <div class="row">
    <span class="label">Produit par</span>
    <span class="value">${prodBy}</span>
  </div>
  <div class="row">
    <span class="label">Date d'expiration</span>
    <span class="value">${dlcDate ? format(dlcDate, 'dd/MM/yyyy') : 'Vente du jour'}</span>
  </div>
  <div class="row">
    <span class="label">N° Plan</span>
    <span class="value">${plan.is_semi_finished_plan && (plan.dependency_of as Record<string, any>[])?.length > 0
      ? ((plan.dependency_of as Record<string, any>[])[0].parent_short_id as string || '').toUpperCase()
      : (plan.id as string).slice(0, 8).toUpperCase()}</span>
  </div>
  <div class="row">
    <span class="label">Role</span>
    <span class="value">${plan.target_role === 'baker' ? 'Boulanger' : plan.target_role === 'pastry_chef' ? 'Patissier' : plan.target_role === 'viennoiserie' ? 'Viennoiserie' : plan.target_role === 'beldi_sale' ? 'Beldi & Sale' : '—'}</span>
  </div>

  <div class="cycle ${isReexposable ? 'dlv' : isRecyclable ? 'recyclable' : 'vdj'}">
    ${cycleVie}
  </div>

  <div class="barcode">${lotNumber}</div>

  <div class="footer">
    Imprime le ${now}<br/>
    Conservez ce ticket pour la tracabilite
  </div>
</div>
</body></html>`);
  };


  const printBonSortieIngredients = () => {
    if (!plan) return;
    const dateStr = format(new Date(plan.plan_date as string), 'dd/MM/yyyy');
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');
    const planDate = new Date(plan.plan_date as string);
    const bsiDateStr = `${String(planDate.getFullYear() % 100).padStart(2, '0')}${String(planDate.getMonth() + 1).padStart(2, '0')}${String(planDate.getDate()).padStart(2, '0')}`;
    const hour = new Date().getHours();
    const shift = hour < 14 ? 'Matin' : 'Apres-midi';

    // Build ingredient rows from fefoPreview data (FEFO lot allocation)
    const fefoItems = (fefoPreview as Record<string, any>[]) || [];

    // Aggregate needs (same as the needs variable) for ingredients without FEFO lots
    const needsForPrint = needs;

    // Build rows: one row per ingredient, with FEFO lot info when available
    type BsiRow = {
      ingredientName: string;
      neededQty: number;
      unit: string;
      lotNumber: string;
      expirationDate: string;
      daysUntilExpiry: number | null;
      urgency: 'urgent' | 'priority' | 'normal';
    };

    const rows: BsiRow[] = [];

    for (const need of needsForPrint) {
      const ingredientId = need.ingredient_id as string;
      const ingredientName = need.ingredient_name as string;
      const neededQty = parseFloat(need.needed_quantity as string);
      const unit = (need.unit as string) || '';

      // Find matching FEFO preview entry
      const fefoEntry = fefoItems.find((f) => (f.ingredientId as string) === ingredientId);
      const lots = fefoEntry ? (fefoEntry.lots as Record<string, any>[]) || [] : [];

      if (lots.length > 0) {
        // One row per lot used for this ingredient
        for (const lot of lots) {
          const expDate = lot.expirationDate as string | null;
          const daysLeft = lot.daysUntilExpiry as number | null;
          let urgency: 'urgent' | 'priority' | 'normal' = 'normal';
          if (daysLeft !== null && daysLeft < 3) urgency = 'urgent';
          else if (daysLeft !== null && daysLeft < 7) urgency = 'priority';

          rows.push({
            ingredientName,
            neededQty: parseFloat((lot.quantityToUse as number).toFixed(2)),
            unit,
            lotNumber: (lot.supplierLotNumber as string) || '—',
            expirationDate: expDate ? format(new Date(expDate), 'dd/MM/yyyy') : '—',
            daysUntilExpiry: daysLeft,
            urgency,
          });
        }
      } else {
        // No FEFO lot data — show ingredient without lot info
        rows.push({
          ingredientName,
          neededQty,
          unit,
          lotNumber: '—',
          expirationDate: '—',
          daysUntilExpiry: null,
          urgency: 'normal',
        });
      }
    }

    // Generate BSI number
    const bsiNumber = `BSI-${bsiDateStr}-${String(1).padStart(3, '0')}`;

    const roleLabel = plan.target_role === 'baker' ? 'Boulanger' : plan.target_role === 'pastry_chef' ? 'Patissier' : plan.target_role === 'viennoiserie' ? 'Viennoiserie' : plan.target_role === 'beldi_sale' ? 'Beldi & Sale' : (plan.created_by_name || '—');

    setPrintHtml(`<!DOCTYPE html><html><head><title>BSI - ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 25px; color: #333; font-size: 12px; }
  .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { font-size: 20px; margin-bottom: 3px; }
  .header h2 { font-size: 14px; font-weight: normal; color: #666; }
  .header .doc-title { font-size: 16px; font-weight: bold; margin-top: 10px; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; }
  .header .doc-number { font-size: 13px; font-weight: bold; margin-top: 4px; font-family: 'Courier New', monospace; color: #444; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11px; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; background: #fafafa; }
  .meta div { line-height: 1.8; }
  .meta strong { color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; }
  thead th { background: #2d2d2d; color: white; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th:first-child { border-radius: 4px 0 0 0; }
  thead th:last-child { border-radius: 0 4px 0 0; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #e5e5e5; font-size: 11px; }
  tbody tr:nth-child(even) { background: #f9f9f9; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: bold; }
  .row-urgent { background: #fff5f5 !important; }
  .row-urgent td { color: #c53030; font-weight: 600; }
  .row-priority { background: #fffaf0 !important; }
  .row-priority td { color: #c05621; }
  .urgency-tag { font-size: 9px; font-weight: bold; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; display: inline-block; margin-left: 6px; }
  .urgency-tag.urgent { background: #fed7d7; color: #c53030; }
  .urgency-tag.priority { background: #feebc8; color: #c05621; }
  .checkbox { width: 16px; height: 16px; border: 2px solid #666; display: inline-block; border-radius: 2px; }
  .lot-badge { font-family: 'Courier New', monospace; font-size: 10px; background: #edf2f7; padding: 2px 6px; border-radius: 3px; color: #2d3748; }
  .signatures { display: flex; justify-content: space-between; margin-top: 30px; padding-top: 15px; }
  .sig-block { text-align: center; width: 220px; }
  .sig-block .title { font-size: 11px; font-weight: bold; color: #333; margin-bottom: 5px; text-transform: uppercase; }
  .sig-block .line { border-bottom: 1px solid #333; height: 45px; margin-bottom: 5px; }
  .sig-block .sub { font-size: 10px; color: #666; }
  .observations { margin-top: 20px; border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
  .observations .title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 8px; }
  .observations .lines { min-height: 60px; border-top: 1px dotted #ccc; padding-top: 8px; }
  .observations .line-row { border-bottom: 1px dotted #ddd; height: 22px; }
  .footer { text-align: center; margin-top: 25px; font-size: 9px; color: #999; border-top: 1px dashed #ccc; padding-top: 8px; }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #2d8a4e; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; z-index: 10; }
  .print-btn:hover { background: #276e3e; }
  .back-btn { position: fixed; top: 10px; left: 10px; background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; z-index: 10; }
  @media print { .print-btn, .back-btn { display: none; } body { padding: 15px; } }
</style></head><body>

<div class="header">
  <h1>${settings.companyName}</h1>
  <h2>${settings.subtitle || ''}</h2>
  <div class="doc-title">Bon de Sortie Ingredients</div>
  <div class="doc-number">${bsiNumber}</div>
</div>

<div class="meta">
  <div>
    <strong>Date de production :</strong> ${dateStr}<br/>
    <strong>Shift :</strong> ${shift}<br/>
    <strong>N\u00b0 Plan :</strong> ${getPlanLotPrefix()}
  </div>
  <div style="text-align:right">
    <strong>Chef de production :</strong> ${roleLabel}<br/>
    <strong>Magasinier :</strong> ___________________<br/>
    <strong>Emis le :</strong> ${now}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:28px">#</th>
      <th style="width:200px">Ingredient</th>
      <th class="text-right" style="width:75px">Qte requise</th>
      <th class="text-center" style="width:50px">Unite</th>
      <th style="width:140px">Lot a utiliser</th>
      <th class="text-center" style="width:95px">Date d'exp.</th>
      <th class="text-center" style="width:45px">Servi</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map((row, idx) => {
      const rowClass = row.urgency === 'urgent' ? 'row-urgent' : row.urgency === 'priority' ? 'row-priority' : '';
      const urgencyTag = row.urgency === 'urgent'
        ? '<span class="urgency-tag urgent">URGENT — utiliser en priorite</span>'
        : row.urgency === 'priority'
          ? '<span class="urgency-tag priority">Prioritaire</span>'
          : '';
      return `
      <tr class="${rowClass}">
        <td class="text-center bold">${idx + 1}</td>
        <td>${row.ingredientName}${urgencyTag}</td>
        <td class="text-right bold">${row.neededQty.toFixed(2)}</td>
        <td class="text-center">${row.unit}</td>
        <td><span class="lot-badge">${row.lotNumber}</span></td>
        <td class="text-center">${row.expirationDate}${row.daysUntilExpiry !== null && row.daysUntilExpiry <= 7 ? ' <small>(' + row.daysUntilExpiry + 'j)</small>' : ''}</td>
        <td class="text-center"><span class="checkbox"></span></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>

<div class="observations">
  <div class="title">Observations / Ecarts / Substitutions</div>
  <div class="lines">
    <div class="line-row"></div>
    <div class="line-row"></div>
    <div class="line-row"></div>
  </div>
</div>

<div class="signatures">
  <div class="sig-block">
    <div class="title">Chef de production</div>
    <div class="line"></div>
    <div class="sub">Nom : ${roleLabel}<br/>Signature</div>
  </div>
  <div class="sig-block">
    <div class="title">Magasinier</div>
    <div class="line"></div>
    <div class="sub">Nom : ___________________<br/>Signature & date de remise</div>
  </div>
</div>

<div class="footer">
  ${settings.companyName} — Bon de Sortie Ingredients — ${bsiNumber} — Imprime le ${now}
</div>

</body></html>`);
  };

  const printFicheProduction = (planData?: Record<string, any>) => {
    const p = planData || plan;
    if (!p) return;
    const allPlanNeeds = (p.ingredient_needs || []) as Record<string, any>[];
    const filteredPrintNeeds = allowedSlugs
      ? allPlanNeeds.filter((n) => allowedSlugs.includes(n.category_slug as string))
      : allPlanNeeds;
    const printNeedsMap = new Map<string, Record<string, any>>();
    for (const n of filteredPrintNeeds) {
      const ingId = n.ingredient_id as string;
      const existing = printNeedsMap.get(ingId);
      if (existing) {
        existing.needed_quantity = (parseFloat(existing.needed_quantity as string) + parseFloat(n.needed_quantity as string)).toString();
      } else {
        printNeedsMap.set(ingId, { ...n });
      }
    }
    const ingredientNeeds = [...printNeedsMap.values()];
    const allPrintItems = (p.items || []) as Record<string, any>[];
    const planItems = allowedSlugs
      ? allPrintItems.filter((it) => allowedSlugs.includes(it.category_slug as string))
      : allPrintItems;
    const dateStr = format(new Date(p.plan_date as string), 'dd/MM/yyyy');
    const now = format(new Date(), 'dd/MM/yyyy HH:mm');

    let totalPlanned = 0, totalProduced = 0;
    planItems.forEach((it) => {
      totalPlanned += (it.planned_quantity as number) || 0;
      totalProduced += (it.actual_quantity as number) || 0;
    });
    const globalRate = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;

    setPrintHtml(`<!DOCTYPE html><html><head><title>Fiche de production - ${dateStr}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 13px; }
  .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { font-size: 22px; margin-bottom: 4px; }
  .header h2 { font-size: 16px; font-weight: normal; color: #666; }
  .header .subtitle { font-size: 11px; color: #999; margin-top: 4px; }
  .info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; }
  .info div { line-height: 1.8; }
  .section { margin-bottom: 20px; }
  .section h3 { font-size: 14px; background: #f5f5f5; padding: 6px 10px; margin-bottom: 8px; border-left: 4px solid #2f855a; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f5f5; text-align: left; padding: 6px 10px; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #ddd; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: bold; }
  .ok { color: #2f855a; font-weight: bold; }
  .warning { color: #c53030; font-weight: bold; }
  .over { color: #2b6cb0; font-weight: bold; }
  .summary-box { display: flex; gap: 20px; margin-bottom: 20px; }
  .summary-card { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
  .summary-card .value { font-size: 24px; font-weight: bold; margin: 4px 0; }
  .summary-card .label { font-size: 11px; color: #666; text-transform: uppercase; }
  .summary-card.green { border-color: #c6f6d5; background: #f0fff4; }
  .summary-card.green .value { color: #2f855a; }
  .summary-card.amber { border-color: #fefcbf; background: #fffff0; }
  .summary-card.amber .value { color: #b7791f; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; }
  .sig-block { text-align: center; width: 200px; }
  .sig-block .line { border-bottom: 1px solid #333; height: 50px; margin-bottom: 5px; }
  .sig-block p { font-size: 11px; color: #666; }
  .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #999; border-top: 1px dashed #ccc; padding-top: 10px; }
  .rate-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-top: 4px; }
  .rate-bar .fill { height: 100%; border-radius: 4px; }
  @media print { body { padding: 10px; } .print-btn, .back-btn { display: none; } }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #2f855a; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
  .back-btn { position: fixed; top: 10px; left: 10px; background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
</style></head><body>

<div class="header">
  <h1>${settings.companyName}</h1>
  <h2>${settings.subtitle}</h2>
  <div class="subtitle">Fiche de production</div>
</div>

<div class="info">
  <div>
    <strong>N\u00b0 Lot :</strong> ${getPlanLotPrefix(p)}<br/>
    <strong>Date de production :</strong> ${dateStr}<br/>
    <strong>Type :</strong> ${p.type === 'daily' ? 'Quotidien' : 'Hebdomadaire'}
  </div>
  <div style="text-align:right">
    <strong>Chef de production :</strong> ${p.created_by_name || '-'}<br/>
    <strong>Date d'impression :</strong> ${now}<br/>
    <strong>Statut :</strong> Terminee
  </div>
</div>

<div class="summary-box">
  <div class="summary-card">
    <div class="label">Produits planifies</div>
    <div class="value">${totalPlanned}</div>
  </div>
  <div class="summary-card green">
    <div class="label">Produits realises</div>
    <div class="value">${totalProduced}</div>
  </div>
  <div class="summary-card ${globalRate >= 100 ? 'green' : 'amber'}">
    <div class="label">Taux de realisation</div>
    <div class="value">${globalRate}%</div>
  </div>
</div>

<div class="section">
  <h3>Detail de la production — Tracabilite</h3>
  <table>
    <thead><tr>
      <th>Produit</th>
      <th class="text-right">Planifie</th>
      <th class="text-right">Produit</th>
      <th class="text-right">Ecart</th>
      <th class="text-center">Produit par</th>
      <th class="text-center">Date production</th>
      <th class="text-center">Date expiration</th>
      <th class="text-center">Statut</th>
    </tr></thead>
    <tbody>
      ${planItems.map((it: Record<string, any>) => {
        const planned = (it.planned_quantity as number) || 0;
        const actual = (it.actual_quantity as number) || 0;
        const diff = actual - planned;
        const statusClass = actual >= planned ? 'ok' : 'warning';
        const statusLabel = actual >= planned ? 'Complet' : actual > 0 ? 'Partiel' : 'Non produit';
        const prodTs = it.production_timestamp || it.produced_at;
        const prodDateStr = prodTs ? format(new Date(prodTs as string), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-';
        const producedByStr = it.produced_by_first_name ? `${it.produced_by_first_name} ${it.produced_by_last_name}` : '-';
        const slDays = it.shelf_life_days as number;
        const prodD = prodTs ? new Date(prodTs as string) : new Date(p.plan_date);
        const dlcD = it.expires_at ? new Date(it.expires_at as string) : slDays ? new Date(prodD.getTime() + slDays * 86400000) : null;
        const dlcStr = dlcD ? format(dlcD, 'dd/MM/yyyy', { locale: fr }) : '-';
        return `
        <tr>
          <td class="bold">${it.product_name}${(it.is_reexposable as boolean) === false ? ' <span style="color:#c05621;font-size:10px">(Non reexp.)</span>' : ''}</td>
          <td class="text-right">${planned}</td>
          <td class="text-right bold">${actual}</td>
          <td class="text-right ${diff > 0 ? 'over' : diff < 0 ? 'warning' : ''}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="text-center" style="font-size:11px">${producedByStr}</td>
          <td class="text-center" style="font-size:11px">${prodDateStr}</td>
          <td class="text-center" style="font-size:11px">${dlcStr}</td>
          <td class="text-center"><span class="${statusClass}">${statusLabel}</span></td>
        </tr>`;
      }).join('')}
      <tr style="border-top:2px solid #333; font-weight:bold; background:#f7fafc">
        <td>TOTAL</td>
        <td class="text-right">${totalPlanned}</td>
        <td class="text-right">${totalProduced}</td>
        <td class="text-right ${totalProduced - totalPlanned >= 0 ? 'ok' : 'warning'}">${totalProduced - totalPlanned > 0 ? '+' : ''}${totalProduced - totalPlanned}</td>
        <td colspan="3" class="text-center">Taux: ${globalRate}%</td>
        <td></td>
      </tr>
    </tbody>
  </table>
</div>

${p.notes ? `<div class="section"><h3>Observations</h3><p style="padding:5px 10px">${p.notes}</p></div>` : ''}

<div class="signatures">
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Chef de production</strong><br/>Signature</p>
  </div>
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Responsable qualite</strong><br/>Signature</p>
  </div>
  <div class="sig-block">
    <div class="line"></div>
    <p><strong>Direction</strong><br/>Visa</p>
  </div>
</div>

<div class="footer">
  ${settings.companyName} - Fiche de production - Imprime le ${now}
</div>

</body></html>`);
  };

  const startMutation = useMutation({
    mutationFn: () => productionApi.start(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success('Production demarree');
    },
    onError: (e: unknown) => {
      const resp = (e as Record<string, any>)?.response as Record<string, any> | undefined;
      const data = resp?.data as Record<string, any> | undefined;
      const err = data?.error as Record<string, any> | undefined;
      notify.error((err?.message as string) || 'Impossible de demarrer la production');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (itemIds: string[]) => productionApi.restoreItems(id!, itemIds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      queryClient.invalidateQueries({ queryKey: ['bon-sortie'] });
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => notify(w, { icon: '\u26a0\ufe0f', duration: 5000 }));
      } else {
        notify.success('Article(s) restaure(s) avec succes');
      }
      // Feedback BSI : completed (re-FEFO partiel) OU generated (creation initiale)
      if (result.bsi?.generated) {
        notify.success(result.bsi.message || 'Bon de sortie genere');
      } else if (result.bsi?.completed) {
        notify.success(result.bsi.message || 'Bon de sortie complete');
      } else if (result.bsi?.message) {
        notify(result.bsi.message, { icon: '\u2139\ufe0f' });
      }
    },
    onError: (error: any) => {
      notify.error(error?.response?.data?.error?.message || 'Erreur lors de la restauration');
    },
  });

  const cancelItemsMutation = useMutation({
    mutationFn: ({ itemIds, reason }: { itemIds: string[]; reason?: string }) => productionApi.cancelItems(id!, itemIds, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success('Article(s) annule(s)');
    },
    onError: (error: any) => {
      notify.error(error?.response?.data?.error?.message || 'Erreur lors de l\'annulation');
    },
  });

  // Demande de verification stock : envoie une notification au magasinier/economat
  // pour qu'il verifie physiquement la dispo et marque OK (ou approvisionne).
  // Le chef voit ensuite une badge "Demande envoyee" sur la ligne.
  const [requestedVerifications, setRequestedVerifications] = useState<Set<string>>(new Set());
  const requestVerificationMutation = useMutation({
    mutationFn: (data: { ingredientId: string; note?: string }) =>
      productionApi.requestStockVerification(id!, data.ingredientId, data.note),
    onSuccess: (_d, vars) => {
      setRequestedVerifications(prev => new Set(prev).add(vars.ingredientId));
      notify.success('Demande envoyee au responsable stock');
      setRestockNeed(null);
    },
    onError: (error: any) => {
      notify.error(error?.response?.data?.error?.message || 'Erreur lors de la demande');
    },
  });

  // ═══ Bon de sortie mutations ═══
  // Start item: pending → in_progress
  const handleStartItem = async (itemId: string) => {
    try {
      await productionApi.startItems(id!, [itemId]);
      await queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success('Production lancee');
    } catch (error: any) {
      notify.error(error?.response?.data?.error?.message || 'Erreur lors du lancement');
    }
  };

  const { getModuleConfig } = usePermissions();
  const prodConfig = getModuleConfig('production');
  const userRole = user?.role || '';
  const isChefRole = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(userRole);
  const allowedSlugs = plan?.is_semi_finished_plan
    ? null
    : plan?.order_id
      ? null
      : isChefRole
        ? getRoleCategorySlugs(userRole)
        : plan?.target_role
          ? getRoleCategorySlugs(plan.target_role as string)
          : (prodConfig.category_slugs as string[] | undefined) || null;

  // Auto-open modal from timer notification URL params (?launchItem=xxx&step=yyy)
  const planItems = (plan?.items || []) as Record<string, any>[];
  useEffect(() => {
    const itemParam = searchParams.get('launchItem');
    const stepParam = searchParams.get('step');
    if (itemParam && planItems.length > 0) {
      setLaunchTargetItemId(itemParam);
      setTimerStepName(stepParam || null);
      setShowProductionLaunch(true);
      // Clean URL params
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, planItems.length]);

  // Loading state
  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={32} className="animate-spin text-amber-500" />
        <span className="text-gray-500 text-sm">Chargement du plan...</span>
      </div>
    </div>
  );

  if (!plan) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <PackageOpen size={32} className="text-gray-400" />
      </div>
      <p className="text-gray-500">Plan non trouve</p>
      <button onClick={() => navigate('/production')} className="text-amber-600 hover:text-amber-700 text-sm font-medium flex items-center gap-1">
        <ArrowLeft size={16} /> Retour a la production
      </button>
    </div>
  );

  const allItems = plan.items || [];
  const items = allowedSlugs
    ? allItems.filter((it: Record<string, any>) => allowedSlugs.includes(it.category_slug as string))
    : allItems;
  const allNeeds = (plan.ingredient_needs || []) as Record<string, any>[];
  const filteredNeeds = allowedSlugs
    ? allNeeds.filter((n) => allowedSlugs.includes(n.category_slug as string))
    : allNeeds;
  const needsMap = new Map<string, Record<string, any>>();
  for (const n of filteredNeeds) {
    const ingId = n.ingredient_id as string;
    const existing = needsMap.get(ingId);
    if (existing) {
      existing.needed_quantity = (parseFloat(existing.needed_quantity as string) + parseFloat(n.needed_quantity as string)).toString();
    } else {
      needsMap.set(ingId, { ...n });
    }
  }
  // Recalculate is_sufficient after aggregation (needed_quantity was summed)
  for (const n of needsMap.values()) {
    n.is_sufficient = parseFloat(n.available_quantity as string) >= parseFloat(n.needed_quantity as string);
  }
  const needs = [...needsMap.values()];
  const insufficientNeeds = needs.filter((n) => parseFloat(n.available_quantity as string) < parseFloat(n.needed_quantity as string));

  const sc = statusConfig[plan.status] || statusConfig.draft;
  const rc = roleConfig[plan.target_role as string];

  // Progress stats
  const producedCount = items.filter((it: Record<string, any>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received').length;
  const inProgressCount = items.filter((it: Record<string, any>) => it.status === 'in_progress').length;
  const cancelledCount = items.filter((it: Record<string, any>) => it.status === 'cancelled').length;
  const waitingCount = items.filter((it: Record<string, any>) => it.waiting_status === 'waiting').length;
  const pendingCount = items.filter((it: Record<string, any>) => it.status === 'pending' && it.waiting_status !== 'waiting').length;
  const totalActive = items.length - cancelledCount;
  const progressPct = totalActive > 0 ? Math.round((producedCount / totalActive) * 100) : 0;

  // Calcul inverse / frigo stats
  const frigoItems = items.filter((it: Record<string, any>) => it.nb_contenants);
  const totalFrigoIn = frigoItems.reduce((s: number, it: Record<string, any>) => s + ((it.qty_from_frigo as number) || 0), 0);
  const totalSurplus = frigoItems.reduce((s: number, it: Record<string, any>) => s + ((it.surplus_frigo as number) || 0), 0);
  const totalContenants = frigoItems.reduce((s: number, it: Record<string, any>) => s + ((it.nb_contenants as number) || 0), 0);

  // Gating des onglets :
  //   - Plan semi-fini : tout est affiche (UI dediee, pas de tabs)
  //   - Plan en 'draft' : tout est affiche (pas encore de workflow BSI/production)
  //   - Sinon : sections filtrees par activePlanTab
  const showPrep = isSemiFini || plan.status === 'draft' || activePlanTab === 'preparation';
  const showProd = isSemiFini || plan.status === 'draft' || activePlanTab === 'production';
  // Sous-gating onglet Preparation :
  const showPrepNeeds = showPrep && (isSemiFini || plan.status === 'draft' || prepSubTab === 'needs');
  const showPrepBsi = showPrep && (isSemiFini || plan.status === 'draft' || prepSubTab === 'bsi');

  // Bloc Besoins en ingredients extrait en JSX pour pouvoir le placer au-dessus de
  // l'apercu FEFO (demande UX : besoins en haut, FEFO en bas dans le sous-onglet "Besoins").
  // Option B : visible des deux cotes, mais le chef voit UNIQUEMENT la liste des
  // ingredients + qty necessaire (pas de DISPO, pas de "insuffisant", pas de
  // "Demander au stock" / "Restaurer & relancer"). La gestion stock est au magasinier.
  const ingredientNeedsBlock = (showPrepNeeds && plan.status !== 'draft' && needs.length > 0) ? (
    <div className="odoo-section">
      <div className="odoo-section-header">
        <Beaker size={12} /> {isMagasinier ? 'Besoins en ingrédients' : 'Ingrédients nécessaires'}
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400 }}>{needs.length} ingrédient(s)</span>
        {isMagasinier && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            {insufficientNeeds.length > 0 && (
              <span className="odoo-tag odoo-tag-red">
                <AlertTriangle size={10} /> {insufficientNeeds.length} insuffisant(s)
              </span>
            )}
            {(() => {
              const waiting = (plan.items as Record<string, any>[] || [])
                .filter(it => it.waiting_status === 'waiting');
              if (waiting.length === 0) return null;
              return (
                <button onClick={() => restoreMutation.mutate(waiting.map(it => it.id as string))}
                  disabled={restoreMutation.isPending} className="odoo-btn-primary"
                  style={{ padding: '2px 8px', fontSize: '0.6875rem', backgroundColor: '#28a745', borderColor: '#28a745' }}
                  title="Re-verifier la dispo et relancer les articles en attente.">
                  <RotateCcw size={11} /> Restaurer ({waiting.length}) &amp; relancer
                </button>
              );
            })()}
          </span>
        )}
      </div>
      <table className="odoo-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Ingrédient</th>
            {isMagasinier && <th>Disponibilité</th>}
            <th style={{ textAlign: 'right' }}>Besoin</th>
            {isMagasinier && <th style={{ textAlign: 'right' }}>Dispo</th>}
            {isMagasinier && <th>Statut</th>}
            {isMagasinier && <th></th>}
          </tr>
        </thead>
        <tbody>
          {needs.map((need: Record<string, any>) => {
            const needed = parseFloat(need.needed_quantity as string);
            const available = parseFloat(need.available_quantity as string);
            const sufficient = need.is_sufficient as boolean;
            const pct = needed > 0 ? Math.min(Math.round((available / needed) * 100), 100) : 100;
            const dotClass = !isMagasinier ? 'neutral' : sufficient ? 'ok' : 'danger';
            return (
              <tr key={need.id as string} style={{ cursor: 'default' }}>
                <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                <td>
                  <span style={{ fontWeight: 500 }}>{need.ingredient_name as string}</span>
                </td>
                {isMagasinier && (
                  <td>
                    <div style={{ width: 80, height: 4, backgroundColor: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        backgroundColor: sufficient ? '#28a745' : '#dc3545',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)' }}>{pct}%</span>
                  </td>
                )}
                <td style={{ textAlign: 'right' }}>
                  {(() => {
                    const f = smartFormatQuantity(needed, need.unit as string);
                    const digits = f.unit === 'g' || f.unit === 'ml' ? 0 : 2;
                    return <>
                      <span style={{ fontWeight: 600 }}>{f.value.toFixed(digits)}</span>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{f.unit}</span>
                    </>;
                  })()}
                </td>
                {isMagasinier && (
                  <td style={{ textAlign: 'right' }}>
                    {(() => {
                      const f = smartFormatQuantity(available, need.unit as string);
                      const digits = f.unit === 'g' || f.unit === 'ml' ? 0 : 2;
                      return <>
                        <span style={{ fontWeight: 500 }}>{f.value.toFixed(digits)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{f.unit}</span>
                      </>;
                    })()}
                  </td>
                )}
                {isMagasinier && (
                  <td>
                    {sufficient ? (
                      <span className="odoo-tag odoo-tag-green"><CheckCircle size={10} /> OK</span>
                    ) : (
                      <span className="odoo-tag odoo-tag-red"><AlertTriangle size={10} /> -{(needed - available).toFixed(2)}</span>
                    )}
                  </td>
                )}
                {isMagasinier && (
                  <td style={{ textAlign: 'right' }}>
                    {!sufficient && (
                      requestedVerifications.has(need.ingredient_id as string) ? (
                        <span className="odoo-tag odoo-tag-green" title="Demande envoyée">
                          <CheckCircle size={10} /> Envoyée
                        </span>
                      ) : (
                        <button onClick={() => setRestockNeed(need)} className="odoo-btn-primary"
                          style={{ padding: '2px 8px', fontSize: '0.6875rem', backgroundColor: '#1f6391', borderColor: '#1f6391' }}
                          title="Demander au responsable stock de vérifier la dispo">
                          <Send size={11} /> Demander
                        </button>
                      )
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : null;

  // Bloc "Semi-finis requis" (etape pre-production) — rendu dans l'onglet Production.
  const semiFinishedDepsBlock = (showProd && plan.dependencies && (plan.dependencies as Record<string, any>[]).length > 0) ? (() => {
    const deps = plan.dependencies as Record<string, any>[];
    const fulfilledCount = deps.filter((d) => d.status === 'fulfilled').length;
    const totalDeps = deps.length;
    const allFulfilled = fulfilledCount === totalDeps;
    const progressPct = totalDeps > 0 ? Math.round((fulfilledCount / totalDeps) * 100) : 0;
    return (
      <div className={`bg-white rounded-xl border ${allFulfilled ? 'border-green-200' : 'border-amber-200'} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <Beaker size={18} className={allFulfilled ? 'text-green-600' : 'text-amber-600'} />
          <h3 className="font-bold text-gray-800 text-sm">Semi-finis requis</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
            allFulfilled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {fulfilledCount}/{totalDeps}
          </span>
          {!allFulfilled && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ml-auto">
              <Lock size={10} /> BLOQUE
            </span>
          )}
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full mb-3 overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${allFulfilled ? 'bg-green-500' : 'bg-amber-500'}`}
            style={{ width: `${progressPct}%` }} />
        </div>
        <div className="space-y-2">
          {deps.map((dep: Record<string, any>) => {
            const status = dep.status as string;
            const isFulfilled = status === 'fulfilled';
            const depPlanId = dep.dependency_plan_id as string | null;
            const depPlanStatus = dep.dep_plan_status as string | null;
            const needed = parseFloat(dep.quantity_needed as string);
            const fromStock = parseFloat(dep.quantity_from_stock as string);
            const toProduce = parseFloat(dep.quantity_to_produce as string);
            const itemPct = needed > 0 ? Math.round(((isFulfilled ? needed : fromStock) / needed) * 100) : 0;
            return (
              <div key={dep.id as string}
                className={`px-4 py-3 rounded-lg border ${
                  isFulfilled ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                }`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {isFulfilled
                      ? <CheckCircle size={16} className="text-green-500" />
                      : <Clock size={16} className="text-amber-500 animate-pulse" />}
                    <span className="font-semibold text-gray-800 text-sm">{dep.sub_recipe_name as string}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isFulfilled && depPlanStatus && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        depPlanStatus === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                        depPlanStatus === 'confirmed' ? 'bg-indigo-100 text-indigo-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {depPlanStatus === 'in_progress' ? 'En production' : depPlanStatus === 'confirmed' ? 'Confirme' : depPlanStatus}
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      isFulfilled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {isFulfilled ? 'Disponible' : 'En attente'}
                    </span>
                    {depPlanId && (
                      <button onClick={() => navigate(`/production/${depPlanId}`)}
                        className="text-xs text-blue-600 hover:text-blue-800 underline font-medium">
                        Voir
                      </button>
                    )}
                  </div>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full mb-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${isFulfilled ? 'bg-green-400' : 'bg-amber-400'}`}
                    style={{ width: `${itemPct}%` }} />
                </div>
                <div className="text-xs text-gray-500 flex gap-3">
                  <span>Besoin: <strong>{needed.toFixed(1)}</strong></span>
                  {fromStock > 0 && <span className="text-green-600">{fromStock.toFixed(1)} en stock</span>}
                  {toProduce > 0 && <span className="text-amber-600">{toProduce.toFixed(1)} a produire</span>}
                </div>
              </div>
            );
          })}
        </div>
        {!allFulfilled && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
            <AlertTriangle size={14} />
            <span>La production ne peut pas demarrer tant que les semi-finis sont en attente.</span>
          </div>
        )}
      </div>
    );
  })() : null;

  const planStatusBadge = plan.status === 'completed' && plan.completion_type === 'partial'
    ? 'Termine partiel'
    : plan.status === 'completed' && plan.completion_type === 'complete'
    ? 'Termine complet'
    : PRODUCTION_STATUS_LABELS[plan.status as keyof typeof PRODUCTION_STATUS_LABELS];
  const statusTagClass = plan.status === 'completed' ? 'odoo-tag-green'
    : plan.status === 'in_progress' ? 'odoo-tag-yellow'
    : plan.status === 'confirmed' ? 'odoo-tag-blue'
    : 'odoo-tag-grey';

  return (
    <div className="odoo-scope">
      {/* ══════════════ CONTROL BAR ══════════════ */}
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/production')} className="odoo-pager-btn" title="Retour">
          <ArrowLeft size={14} />
        </button>
        <div className="odoo-breadcrumb">
          <Factory size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/production')}>Production</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">
            Plan du {format(new Date(plan.plan_date), 'dd MMM yyyy', { locale: fr })}
          </span>
        </div>
        <span className={`odoo-tag ${statusTagClass}`}>{sc.icon}{planStatusBadge}</span>
      </div>

      {/* ══════════════ STAT TILES (sober, comme la liste) ══════════════ */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label"><Package size={11} style={{ display: 'inline', marginRight: 4 }} />Articles</div>
          <div className="odoo-stat-card-value">{items.length}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label"><CheckCircle2 size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Produits</div>
          <div className="odoo-stat-card-value" style={{ color: producedCount > 0 ? '#28a745' : undefined }}>{producedCount}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label"><Layers size={11} style={{ display: 'inline', marginRight: 4 }} />Ingrédients</div>
          <div className="odoo-stat-card-value">{needs.length}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">Progression</div>
          <div className="odoo-stat-card-value" style={{ color: progressPct >= 100 ? '#28a745' : progressPct >= 50 ? '#b85d1a' : undefined }}>
            {progressPct}%
          </div>
        </div>
      </div>

      {/* ══════════════ METADATA STRIP (compact, sans h1) ══════════════ */}
      <div style={{
        padding: '0.5rem 1rem',
        borderBottom: '1px solid var(--theme-bg-separator)',
        backgroundColor: 'var(--theme-bg-card)',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        fontSize: '0.75rem', color: 'var(--theme-text-muted)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <User size={11} /> {isSemiFini
            ? (plan.dependency_of as Record<string, any>[])[0]?.parent_created_by_name as string || plan.created_by_name
            : plan.created_by_name}
        </span>
        {rc && <span className="odoo-tag odoo-tag-purple"><ChefHat size={9} /> {rc.label}</span>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Hash size={11} /> <span style={{ fontFamily: 'monospace' }}>
            {isSemiFini
              ? ((plan.dependency_of as Record<string, any>[])[0]?.parent_short_id as string || '').toUpperCase()
              : (plan.id as string).slice(0, 8).toUpperCase()}
          </span>
        </span>
        {plan.type && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Calendar size={11} /> {plan.type === 'daily' ? 'Quotidien' : 'Hebdomadaire'}
          </span>
        )}
        {plan.notes ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FileText size={11} /> {plan.notes}
          </span>
        ) : null}

        {/* Progress bar inline */}
        {(plan.status === 'in_progress' || plan.status === 'completed') && totalActive > 0 && (
          <div style={{ flex: 1, minWidth: 200, marginLeft: 'auto' }}>
            <div style={{ height: 4, backgroundColor: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${progressPct}%`,
                backgroundColor: progressPct >= 100 ? '#28a745' : 'var(--theme-accent)',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Bloc "Semi-finis requis" retire de cet emplacement — desormais rendu dans la zone Production
          via la variable semiFinishedDepsBlock pour qu'il apparaisse sous les onglets. */}

      {/* ══════════════ SEMI-FINI DEDICATED INTERFACE ══════════════ */}
      {isSemiFini && (() => {
        const deps = plan.dependency_of as Record<string, any>[];
        const dep = deps[0]; // Primary dependency
        const recipeName = dep.sub_recipe_name as string;
        const qtyNeeded = parseFloat(dep.quantity_needed as string || dep.quantity_to_produce as string || '0');
        const yieldQty = parseFloat(dep.yield_quantity as string || '1');
        const yieldUnit = dep.yield_unit as string || 'kg';
        const instructions = dep.instructions as string || '';
        const parentPlanId = dep.parent_plan_id as string;
        const parentShortId = dep.parent_short_id as string || parentPlanId.slice(0, 8);
        const parentNotes = dep.parent_notes as string || '';
        const recipeIngredients = (plan.recipe_ingredients || []) as Record<string, any>[];
        const multiplier = yieldQty > 0 ? qtyNeeded / yieldQty : 1;

        // Find the corresponding item for this semi-fini
        const sfItem = (plan.items as Record<string, any>[] || []).find(
          (it: Record<string, any>) => it.status === 'pending' || it.status === 'in_progress' || it.status === 'completed'
        );
        const actualQty = sfItem ? parseFloat(sfItem.actual_quantity as string || '0') : 0;
        const itemStatus = sfItem?.status as string || 'pending';

        return (
          <>
            {/* ── Parent plan section ── */}
            <div className="odoo-section">
              <div className="odoo-section-header" style={{ justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={12} /> Plan parent · #{parentShortId.toUpperCase()} — {format(new Date(dep.parent_plan_date as string), 'dd MMM yyyy', { locale: fr })}
                </span>
                <button onClick={() => navigate(`/production/${parentPlanId}`)} className="odoo-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.6875rem' }}>
                  <Eye size={11} /> Voir
                </button>
              </div>
              <div style={{ padding: '0.625rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', backgroundColor: 'var(--theme-bg-card)', fontSize: '0.75rem' }}>
                <span className={`odoo-tag ${
                  dep.parent_status === 'confirmed' ? 'odoo-tag-blue' :
                  dep.parent_status === 'in_progress' ? 'odoo-tag-yellow' :
                  dep.parent_status === 'completed' ? 'odoo-tag-green' : 'odoo-tag-grey'
                }`}>
                  {dep.parent_status === 'confirmed' ? 'Confirmé' : dep.parent_status === 'in_progress' ? 'En cours' : dep.parent_status === 'completed' ? 'Terminé' : dep.parent_status as string}
                </span>
                {parentNotes && <span style={{ color: 'var(--theme-text-muted)' }}>{parentNotes}</span>}
              </div>
            </div>

            {/* ── Semi-fini production section ── */}
            <div className="odoo-section">
              <div className="odoo-section-header">
                <Beaker size={12} /> {recipeName} — Préparation de base
              </div>
              <div className="odoo-smart-button-row" style={{ borderBottom: '1px solid var(--theme-bg-separator)' }}>
                <div className="odoo-smart-button">
                  <div className="odoo-smart-button-value">{qtyNeeded.toFixed(2)}</div>
                  <div className="odoo-smart-button-label">À produire ({yieldUnit})</div>
                </div>
                <div className="odoo-smart-button">
                  <div className="odoo-smart-button-value" style={{ color: actualQty > 0 ? '#28a745' : undefined }}>{actualQty.toFixed(2)}</div>
                  <div className="odoo-smart-button-label">Produit ({yieldUnit})</div>
                </div>
                <div className="odoo-smart-button">
                  <div className="odoo-smart-button-value" style={{
                    color: itemStatus === 'completed' ? '#28a745' : actualQty > 0 ? '#b85d1a' : undefined
                  }}>
                    {itemStatus === 'completed' ? '100%' : qtyNeeded > 0 ? `${Math.round(actualQty / qtyNeeded * 100)}%` : '0%'}
                  </div>
                  <div className="odoo-smart-button-label">Progression</div>
                </div>
              </div>

              {/* Recipe instructions */}
              {instructions && (
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: 'var(--theme-bg-card)' }}>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <BookOpen size={11} /> Instructions
                  </div>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-strong)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{instructions}</p>
                </div>
              )}

              {/* Recipe ingredients */}
              {recipeIngredients.length > 0 && (
                <div style={{ padding: '0.75rem 1rem', backgroundColor: 'var(--theme-bg-card)' }}>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Scale size={11} /> Ingrédients (×{multiplier.toFixed(1)} pour {qtyNeeded.toFixed(2)} {yieldUnit})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {recipeIngredients.map((ri, idx) => {
                      const baseQty = parseFloat(ri.quantity as string || '0');
                      const scaledQty = baseQty * multiplier;
                      const unit = ri.unit as string || ri.base_unit as string || '';
                      return (
                        <div key={idx} style={{
                          display: 'flex', justifyContent: 'space-between',
                          padding: '0.25rem 0.5rem', borderRadius: 3,
                          backgroundColor: 'var(--theme-bg-secondary)', fontSize: '0.8125rem',
                        }}>
                          <span style={{ fontWeight: 500 }}>{ri.ingredient_name as string}</span>
                          <span style={{ fontWeight: 600, color: 'var(--theme-accent)' }}>{scaledQty.toFixed(3)} {unit}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* ══════════════ TABS (Preparation / Production) ══════════════ */}
      {/* Les onglets ne s'affichent pas :
            - en 'draft' (rien a montrer encore)
            - pour un plan semi-fini (UI dediee au-dessus)
          L'onglet Production n'est cliquable qu'une fois le BSI pret (cloture),
          inutile (pas de recette), ou si la production est deja demarree/terminee. */}
      {!isSemiFini && plan.status !== 'draft' && (() => {
        const productionReady =
          plan.status === 'in_progress' ||
          plan.status === 'completed' ||
          !!bonNotNeededReason ||
          (activeBon?.status === 'cloture');
        const prepBadgeTag = productionReady ? 'odoo-tag-green' : 'odoo-tag-yellow';
        const prepBadgeLabel = productionReady ? '\u2713 Pret' : 'En cours';
        return (
          <div className="odoo-tabs">
            <button type="button" onClick={() => setActivePlanTab('preparation')}
              className={`odoo-tab ${activePlanTab === 'preparation' ? 'active' : ''}`}>
              <Truck size={13} />
              <span>1. Preparation</span>
              <span className={`odoo-tag ${prepBadgeTag}`} style={{ marginLeft: 4 }}>{prepBadgeLabel}</span>
            </button>
            <button type="button" onClick={() => productionReady && setActivePlanTab('production')}
              disabled={!productionReady}
              title={productionReady ? undefined : 'Disponible apres la cloture du bon de sortie'}
              className={`odoo-tab ${activePlanTab === 'production' ? 'active' : ''}`}
              style={{ opacity: productionReady ? 1 : 0.5, cursor: productionReady ? 'pointer' : 'not-allowed' }}>
              {productionReady ? <Factory size={13} /> : <Lock size={13} />}
              <span>2. Production</span>
            </button>
          </div>
        );
      })()}

      {/* ══════════════ SOUS-ONGLETS de l'onglet Preparation ══════════════ */}
      {!isSemiFini && plan.status !== 'draft' && activePlanTab === 'preparation' && (
        <div className="odoo-tabs" style={{ paddingLeft: '2.5rem' }}>
          <button type="button" onClick={() => setPrepSubTab('needs')}
            className={`odoo-tab ${prepSubTab === 'needs' ? 'active' : ''}`}>
            <Beaker size={13} />
            <span>Besoins en ingredients &amp; FEFO</span>
          </button>
          <button type="button" onClick={() => setPrepSubTab('bsi')}
            className={`odoo-tab ${prepSubTab === 'bsi' ? 'active' : ''}`}>
            <Truck size={13} />
            <span>Gestion du bon de sortie</span>
            {activeBon && activeBon.status !== 'cloture' && activeBon.status !== 'annule' && (
              <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 4 }}>En cours</span>
            )}
            {activeBon && activeBon.status === 'cloture' && (
              <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 4 }}>&#10003;</span>
            )}
          </button>
        </div>
      )}

      {/* ══════════════ ACTION BUTTONS ══════════════ */}
      <div className="flex flex-wrap gap-3">
        {plan.status === 'draft' && isChef && (
          <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}
            className="odoo-btn-primary">
            {confirmMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer le plan'}
          </button>
        )}
        {showPrepBsi && ['confirmed', 'in_progress'].includes(plan.status) && !isSemiFini && (
          <button onClick={() => printBonSortieIngredients()} className="px-5 py-2.5 bg-white border border-emerald-200 text-emerald-700 rounded-xl font-medium hover:bg-emerald-50 transition-all flex items-center gap-2 text-sm shadow-sm">
            <Printer size={16} className="text-emerald-600" /> Bon de sortie ingredients
          </button>
        )}
        {showProd && plan.status === 'confirmed' && (() => {
          const deps = (plan.dependencies || []) as Record<string, any>[];
          const hasPendingDeps = deps.some(d => d.status !== 'fulfilled' && d.status !== 'cancelled');
          // Wizard etape 3 : production bloquee tant que le BSI n'est pas cloture.
          // Les plans semi-finis sont exemptes (leur BSI est celui du plan parent).
          // Cas "plan sans recette" (bonNotNeededReason) : aucun BSI necessaire, on debloque.
          const bsiBlocked = !isSemiFini && !bonNotNeededReason && (!activeBon || activeBon.status !== 'cloture');
          const bsiBlockReason = !activeBon
            ? 'Preparez d\'abord le bon de sortie'
            : activeBon.status !== 'cloture'
              ? 'Cloturer le bon de sortie (livraison des ingredients) avant de demarrer'
              : '';
          const disabled = startMutation.isPending || hasPendingDeps || bsiBlocked;
          const blockLabel = hasPendingDeps
            ? 'Semi-finis en attente'
            : bsiBlocked
              ? 'BSI non cloture'
              : startMutation.isPending ? 'Demarrage...' : 'Demarrer la production';
          const tooltip = hasPendingDeps
            ? 'Semi-finis en attente — production impossible'
            : bsiBlocked ? bsiBlockReason : undefined;
          return (
            <>
              {isChef && (
                <button onClick={() => startMutation.mutate()}
                  disabled={disabled}
                  title={tooltip}
                  className={`px-5 py-2.5 text-white rounded-xl font-medium shadow-md transition-all flex items-center gap-2 text-sm ${
                    hasPendingDeps || bsiBlocked
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}>
                  {(hasPendingDeps || bsiBlocked) ? <Lock size={16} /> : startMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  {blockLabel}
                </button>
              )}
            </>
          );
        })()}
        {showProd && plan.status === 'in_progress' && isChef && (() => {
          const pendingItems = items.filter((it: Record<string, any>) => it.status === 'pending' && (it.waiting_status !== 'waiting'));
          const inProgressItems = items.filter((it: Record<string, any>) => it.status === 'in_progress');
          const allProduced = pendingItems.length === 0 && inProgressItems.length === 0 && items.some((it: Record<string, any>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received');
          return (
            <>
              {pendingItems.length > 0 && (
                <button onClick={async () => {
                  const ids = pendingItems.map((it: Record<string, any>) => it.id as string);
                  try {
                    await productionApi.startItems(id!, ids);
                    await queryClient.invalidateQueries({ queryKey: ['production', id] });
                    notify.success(`${ids.length} production(s) lancee(s)`);
                  } catch (e: any) { notify.error(e?.response?.data?.error?.message || 'Erreur'); }
                }} className="odoo-btn-primary" style={{ backgroundColor: "#1f6391", borderColor: "#1f6391" }}>
                  <Play size={16} /> Lancer tout ({pendingItems.length})
                </button>
              )}
              {inProgressItems.length > 0 && (
                <button onClick={() => { setLaunchTargetItemId(null); setShowProductionLaunch(true); }} className="odoo-btn-primary" style={{ backgroundColor: "#28a745", borderColor: "#28a745" }}>
                  <Factory size={16} /> Enregistrer tout ({inProgressItems.length})
                </button>
              )}
              {waitingCount > 0 && allProduced && (
                <button
                  onClick={() => {
                    if (confirm(`Cloture partielle : ${waitingCount} article(s) en attente seront annules. Continuer ?`)) {
                      productionApi.complete(id!, [], 'partial').then(() => {
                        queryClient.invalidateQueries({ queryKey: ['production', id] });
                        notify.success('Plan cloture partiellement');
                      }).catch((err: any) => {
                        notify.error(err?.response?.data?.error?.message || 'Erreur');
                      });
                    }
                  }}
                  className="odoo-btn-primary" style={{ backgroundColor: "#b85d1a", borderColor: "#b85d1a" }}
                >
                  <CheckCircle size={16} /> Cloture partielle
                </button>
              )}
            </>
          );
        })()}
        {showProd && plan.status === 'completed' && isChef && (
          <button onClick={() => printFicheProduction()} className="odoo-btn-secondary">
            <Printer size={13} /> Fiche de production
          </button>
        )}
        {/* Declarer une perte de production : visible pendant la production et a la cloture
            (cas brule, rate, panne machine, matiere defectueuse). Tracabilite via productionPlanId. */}
        {showProd && ['in_progress', 'completed'].includes(plan.status) && isChef && !isSemiFini && (
          <button onClick={() => setShowLossModal(true)} className="odoo-btn-danger">
            <Trash2 size={13} /> Declarer une perte
          </button>
        )}
      </div>

      {/* ══════════════ WIZARD ETAPE 2 : BON DE SORTIE (sous-onglet Gestion BSI) ══════════════ */}
      {showPrepBsi && !isSemiFini && !activeBon && bonNotNeededReason && ['confirmed', 'in_progress'].includes(plan.status) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
            <Info size={18} className="text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-800 text-sm">Pas de bon de sortie a preparer</h3>
            <p className="text-xs text-gray-600 mt-0.5">{bonNotNeededReason}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              Ajoutez des recettes aux produits de ce plan pour activer le prelevement d'ingredients.
            </p>
          </div>
        </div>
      )}

      {/* Cas normal : BSI pas encore visible cote UI (vient juste d'etre auto-genere, ou echec silencieux).
          Le BSI est desormais genere AUTOMATIQUEMENT a la confirmation du plan par le backend, qui envoie
          une notification au magasinier. Cette banniere sert de filet de securite si l'auto-gen a echoue
          ou si la query n'a pas encore ramene le BSI (courte fenetre de rafraichissement). */}
      {showPrepBsi && !isSemiFini && !activeBon && !bonNotNeededReason && ['confirmed', 'in_progress'].includes(plan.status) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
            <Loader2 size={18} className="text-gray-500 animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">Bon de sortie en cours de generation...</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Le magasinier sera notifie automatiquement des qu'il est pret a etre prepare.
              Si rien ne s'affiche apres quelques secondes, utilisez le bouton ci-dessous.
            </p>
            {isChef && (
              <button
                onClick={() => prepareBonMutation.mutate()}
                disabled={prepareBonMutation.isPending}
                className="mt-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-100 transition-all flex items-center gap-1.5 text-xs disabled:opacity-60">
                {prepareBonMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {prepareBonMutation.isPending ? 'Generation...' : 'Relancer la generation'}
              </button>
            )}
          </div>
        </div>
      )}
      {showPrepBsi && !isSemiFini && activeBon && (() => {
        const bon = activeBon;
        const bonStatusConfig: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
          genere: { label: 'Genere', bg: 'bg-blue-100', text: 'text-blue-700', icon: <ClipboardList size={14} /> },
          prelevement: { label: 'En prelevement', bg: 'bg-amber-100', text: 'text-amber-700', icon: <ShoppingCart size={14} /> },
          prelevement_partielle: { label: 'Prelevement partiel', bg: 'bg-orange-100', text: 'text-orange-700', icon: <AlertTriangle size={14} /> },
          preparation: { label: 'En preparation', bg: 'bg-amber-100', text: 'text-amber-700', icon: <Package size={14} /> },
          preparation_partielle: { label: 'Preparation partielle', bg: 'bg-orange-100', text: 'text-orange-700', icon: <AlertTriangle size={14} /> },
          pret: { label: 'Pret a remettre', bg: 'bg-emerald-100', text: 'text-emerald-700', icon: <CheckCircle size={14} /> },
          verifie: { label: 'Verifie', bg: 'bg-emerald-100', text: 'text-emerald-700', icon: <Eye size={14} /> },
          cloture: { label: 'Livre', bg: 'bg-emerald-100', text: 'text-emerald-700', icon: <CheckCircle size={14} /> },
          annule: { label: 'Annule', bg: 'bg-red-100', text: 'text-red-700', icon: <XCircle size={14} /> },
        };
        const bsc = bonStatusConfig[bon.status as string] || bonStatusConfig.genere;
        const isCloture = bon.status === 'cloture';
        return (
          <>
            {/* En-tete BSI compact (banniere Odoo style) */}
            <div className={`odoo-alert ${isCloture ? 'warning' : 'warning'}`}
              style={isCloture
                ? { backgroundColor: '#e8f5e9', color: '#155724', borderBottomColor: '#c5e1a5' }
                : undefined}>
              <Truck size={14} style={{ color: isCloture ? '#28a745' : '#856404', marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="odoo-alert-title">Bon de sortie</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', opacity: 0.85 }}>{bon.numero as string}</span>
                  <span className={`odoo-tag ${isCloture ? 'odoo-tag-green' : 'odoo-tag-yellow'}`}>
                    {bsc.icon} {bsc.label}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', marginTop: 2, opacity: 0.9 }}>
                  {isCloture
                    ? 'Ingrédients livrés — vous pouvez passer à l\'onglet Production'
                    : 'Prélèvement des ingrédients — gérez les lignes ci-dessous'}
                </div>
              </div>
            </div>

            {/* Panneau de prelevement inline */}
            <BonSortiePanel planId={id!} isChef={isChef} isMagasinier={isMagasinier} variant="inline" />
          </>
        );
      })()}

      {/* ══════════════ LINKED ORDER CARD ══════════════ */}
      {plan.order_number && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center">
              <Package size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-900">Commande liee</h3>
              <span className="text-xs text-blue-600">{plan.order_number}</span>
            </div>
            <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium ${
              plan.order_status === 'in_production' ? 'bg-amber-100 text-amber-700' :
              plan.order_status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
              plan.order_status === 'completed' ? 'bg-gray-100 text-gray-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {plan.order_status === 'pending' ? 'En attente' :
               plan.order_status === 'confirmed' ? 'Confirmee' :
               plan.order_status === 'in_production' ? 'En production' :
               plan.order_status === 'ready' ? 'Prete' :
               plan.order_status === 'completed' ? 'Livree' :
               plan.order_status === 'cancelled' ? 'Annulee' : plan.order_status}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {plan.order_customer_first_name && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <User size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Client</div>
                  <div className="text-sm font-medium text-gray-800">{plan.order_customer_first_name} {plan.order_customer_last_name || ''}</div>
                </div>
              </div>
            )}
            {plan.order_customer_phone && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Phone size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Telephone</div>
                  <div className="text-sm font-medium text-gray-800">{plan.order_customer_phone}</div>
                </div>
              </div>
            )}
            {plan.order_pickup_date && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Calendar size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Retrait</div>
                  <div className="text-sm font-medium text-gray-800">{format(new Date(plan.order_pickup_date), 'dd/MM/yyyy', { locale: fr })}</div>
                </div>
              </div>
            )}
            {plan.order_total && (
              <div className="bg-white/70 rounded-xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Banknote size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">Total</div>
                  <div className="text-sm font-medium text-gray-800">
                    {parseFloat(plan.order_total).toFixed(2)} DH
                    {parseFloat(plan.order_advance_amount) > 0 && (
                      <span className="text-blue-500 text-xs ml-1">(Av. {parseFloat(plan.order_advance_amount).toFixed(2)})</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ WARNINGS BANNER (onglet Preparation) ══════════════
          Option B : visible uniquement par le magasinier — les warnings concernent
          principalement la dispo des ingredients (mise en liste d'attente faute de
          stock), info hors champ du chef. */}
      {showPrep && isMagasinier && plan.warnings && (plan.warnings as string[]).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-amber-800">
              Alertes ({(plan.warnings as string[]).length})
            </span>
          </div>
          <ul className="space-y-1.5">
            {[...new Set(plan.warnings as string[])].map((w: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Besoins en ingredients — rendu en premier dans le sous-onglet "Besoins & FEFO" */}
      {ingredientNeedsBlock}

      {/* ══════════════ FEFO LOT PREVIEW (sous-onglet Besoins) ══════════════
          Option B : visible uniquement par le magasinier — c'est lui qui pilote l'allocation
          FEFO et la dispo des lots. Le chef voit uniquement la liste des ingredients via
          le BSI, sans aucune info de lot/dispo. */}
      {showPrepNeeds && fefoPreview.length > 0 && ['confirmed', 'in_progress'].includes(plan.status) && isMagasinier && (
        <div className="bg-white rounded-xl border border-cyan-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Droplets size={18} className="text-cyan-600" />
            <h3 className="font-bold text-gray-800 text-sm">Apercu lots ingredients (FEFO)</h3>
            <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full font-semibold">
              {fefoPreview.length} ingredient(s)
            </span>
          </div>
          <div className="space-y-3">
            {(fefoPreview as Record<string, any>[]).map((item: Record<string, any>) => {
              const lots = (item.lots || []) as Record<string, any>[];
              const shortfall = parseFloat(item.shortfall as string) || 0;
              return (
                <div key={item.ingredientId as string} className="border border-gray-100 rounded-lg overflow-hidden">
                  <div className={`px-3 py-2 flex items-center justify-between ${shortfall > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <span className="font-semibold text-sm text-gray-800">{item.ingredientName as string}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        Besoin: <strong>{parseFloat(item.neededQuantity as string).toFixed(2)}</strong> {item.ingredientUnit as string}
                      </span>
                      {shortfall > 0 && (
                        <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle size={10} /> Manque {shortfall.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  {lots.length > 0 && (
                    <div className="divide-y divide-gray-50">
                      {lots.map((lot: Record<string, any>, idx: number) => {
                        const daysLeft = lot.daysUntilExpiry as number | null;
                        const isExpiringSoon = lot.isExpiringSoon as boolean;
                        const isExpired = daysLeft !== null && daysLeft < 0;
                        return (
                          <div key={idx} className="px-3 py-1.5 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-gray-600">{lot.lotNumber as string}</span>
                              {lot.supplierLotNumber && (
                                <span className="text-gray-400">({lot.supplierLotNumber as string})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-gray-600">
                                {parseFloat(lot.quantityToUse as string).toFixed(2)} / {parseFloat(lot.quantityAvailable as string).toFixed(2)}
                              </span>
                              {lot.expirationDate && (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  isExpired ? 'bg-red-100 text-red-700' :
                                  isExpiringSoon ? 'bg-orange-100 text-orange-700' :
                                  daysLeft !== null && daysLeft < 7 ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-green-100 text-green-700'
                                }`}>
                                  {isExpired ? 'EXPIRE' :
                                   daysLeft !== null ? `J-${daysLeft}` :
                                   format(new Date(lot.expirationDate as string), 'dd/MM')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ ACTIVITY FEED ══════════════ */}
      <div className="odoo-section">
        <div className="odoo-section-header">
          <MessageSquare size={12} /> Notes de production
          {(activities as Record<string, any>[]).length > 0 && (
            <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>
              {(activities as Record<string, any>[]).length}
            </span>
          )}
        </div>
        <div style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--theme-bg-card)' }}>
          {/* New note input */}
          <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.5rem' }}>
            <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
              placeholder="Ajouter une note..."
              className="input" style={{ flex: 1 }}
              disabled={addingNote} />
            <button onClick={handleAddNote} disabled={!newNote.trim() || addingNote}
              className="odoo-btn-primary" style={{ padding: '4px 10px' }}>
              <Send size={13} />
            </button>
          </div>
          {/* Activity list */}
          {(activities as Record<string, any>[]).length > 0 ? (
            <div style={{ maxHeight: '16rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(activities as Record<string, any>[]).map((act: Record<string, any>, i: number) => (
                <div key={act.id as string} style={{
                  display: 'flex', gap: '0.5rem', padding: '0.375rem 0',
                  borderTop: i > 0 ? '1px solid var(--theme-bg-separator)' : 'none',
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    backgroundColor: 'var(--theme-accent-light)',
                    color: 'var(--theme-accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                  }}>
                    {act.activity_type === 'note_added' ? <MessageSquare size={11} /> : <Play size={11} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-strong)' }}>{act.message as string}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: 1, fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                      {act.first_name && <span style={{ fontWeight: 500 }}>{act.first_name as string} {act.last_name as string}</span>}
                      <span>{format(new Date(act.created_at as string), 'dd/MM HH:mm', { locale: fr })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', textAlign: 'center', padding: '0.5rem' }}>Aucune note pour le moment</p>
          )}
        </div>
      </div>

      {/* Semi-finis requis — rendu en tete de l'onglet Production (etape pre-production) */}
      {semiFinishedDepsBlock}

      {/* ══════════════ ITEMS SECTION (onglet Production) ══════════════ */}
      {showProd && <>{linkedReplenishment ? (() => {
        const repItems = (linkedReplenishment.items || []) as Record<string, any>[];
        const planRoleSlugs = plan?.target_role ? getRoleCategorySlugs(plan.target_role as string) : null;
        const effectiveSlugs = allowedSlugs || planRoleSlugs;
        const filteredRepItems = effectiveSlugs
          ? repItems.filter((ri) => effectiveSlugs.includes(ri.category_slug as string))
          : repItems;
        const stockItems = filteredRepItems.filter((ri) => {
          const fromStock = (ri.fulfilled_from_stock as number) || 0;
          const status = ri.status as string;
          return fromStock > 0 || status === 'fulfilled' || status === 'from_stock';
        });
        const hasStock = stockItems.length > 0;
        const hasProduction = items.length > 0;

        return (
          <div className={`grid gap-5 ${hasStock && hasProduction ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
            {/* Stock items */}
            {hasStock && (
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 overflow-hidden self-start">
                <div className="bg-emerald-50 px-5 py-4 border-b border-emerald-200 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center">
                    <Box size={18} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-emerald-800">Preleves du stock</h3>
                    <span className="text-xs text-emerald-600">{stockItems.length} article(s)</span>
                  </div>
                </div>
                <div className="divide-y divide-emerald-50">
                  {stockItems.map((ri) => (
                    <div key={ri.id as string} className="px-5 py-3.5 flex items-center gap-3 hover:bg-emerald-50/30 transition-colors">
                      {ri.product_image ? (
                        <img src={ri.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <Package size={16} className="text-emerald-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{ri.product_name as string}</div>
                        <div className="text-xs text-gray-400">{ri.category_name as string}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="font-bold text-emerald-700">{(ri.fulfilled_from_stock as number) || 0}</span>
                        <span className="text-xs text-gray-400 ml-0.5">/ {(ri.requested_quantity as number) || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-emerald-50 px-5 py-2.5 border-t border-emerald-200">
                  <span className="text-xs text-emerald-600 flex items-center gap-1.5">
                    <TrendingUp size={12} /> Transfert auto — Demande {linkedReplenishment.request_number as string}
                  </span>
                </div>
              </div>
            )}

            {/* Production items — simple table */}
            {hasProduction && (
              <div className="odoo-section">
                <div className="odoo-section-header">
                  <Factory size={12} /> À produire
                  <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400 }}>{items.length} article(s)</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th style={{ textAlign: 'right' }}>Qté</th>
                      <th style={{ textAlign: 'right' }}>Fait</th>
                      <th>N° Lot</th>
                      <th>Date de production</th>
                      <th>Produit par</th>
                      <th>Date d'expiration</th>
                      <th>Cycle de vie</th>
                      <th>Statut</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: Record<string, any>, idx: number) => {
                      const itemStatus = (item.status as string) || 'pending';
                      const isPending = itemStatus === 'pending';
                      const isInProgress = itemStatus === 'in_progress';
                      const isItemWaiting = item.waiting_status === 'waiting';
                      const isProduced = itemStatus === 'produced' || itemStatus === 'transferred' || itemStatus === 'received';
                      const isCancelled = itemStatus === 'cancelled';
                      const prodTs = item.production_timestamp || item.produced_at;
                      const startTs = item.started_at as string | null;
                      const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date);
                      const sld = item.shelf_life_days as number;
                      const dlcD = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
                      const nowD = new Date();
                      const prodBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : null;
                      const startedBy = item.started_by_first_name ? `${item.started_by_first_name} ${item.started_by_last_name}` : null;
                      const planDateObj = new Date(plan.plan_date as string);
                      const lotNumber = (item.lot_number as string) || `LOT-${format(planDateObj, 'yyMMdd')}-${String(idx + 1).padStart(3, '0')}`;

                      return (
                        <tr key={item.id as string} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/60 ${isCancelled ? 'opacity-40' : ''} ${isInProgress ? 'bg-blue-50/40' : idx % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                          <td className="px-5 py-3">
                            <span className={`font-medium ${isCancelled ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.product_name as string}</span>
                            {item.nb_contenants && (
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700">
                                  <Layers size={10} /> {item.nb_contenants as number}x {item.contenant_nom as string || 'contenant'}
                                </span>
                                {(item.qty_from_frigo as number) > 0 && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-50 text-cyan-700">
                                    <Flame size={10} /> Frigo: -{item.qty_from_frigo as number}
                                  </span>
                                )}
                                {(item.surplus_frigo as number) > 0 && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
                                    <Package size={10} /> Surplus: +{item.surplus_frigo as number}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="font-bold text-gray-600">{item.planned_quantity as number}</div>
                            {item.quantite_brute_totale && (item.quantite_brute_totale as number) !== (item.planned_quantity as number) && (
                              <div className="text-[10px] text-indigo-500" title="Quantite brute totale (contenants)">
                                brut: {item.quantite_brute_totale as number}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {item.actual_quantity != null ? (
                              <span className={`font-bold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {item.actual_quantity as number}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-gray-600 font-mono whitespace-nowrap">
                            {(isProduced || isInProgress) ? lotNumber : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                            {isProduced && prodTs ? format(prodDate, 'dd/MM/yy HH:mm') : isInProgress && startTs ? format(new Date(startTs), 'dd/MM/yy HH:mm') : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {isProduced && prodBy ? prodBy : isInProgress && startedBy ? startedBy : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            {isProduced && dlcD ? (
                              <span className={dlcD <= nowD ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                                {dlcD <= nowD ? 'Expire' : format(dlcD, 'dd/MM/yyyy')}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            {isProduced ? (
                              (item.is_reexposable as boolean) ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">DLV</span>
                              ) : (item.is_recyclable as boolean) ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700">Recyclable</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700">Vente du jour</span>
                              )
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {isProduced ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700"><CheckCircle size={11} /> Produit</span>
                            ) : isInProgress ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 animate-pulse"><Play size={11} /> En cours</span>
                            ) : isCancelled ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600"><XCircle size={11} /> Annule</span>
                            ) : isItemWaiting ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600"><Clock size={11} /> Attente</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">A faire</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {plan.status === 'in_progress' && isChef && isPending && !isItemWaiting ? (
                              <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1">
                                <Play size={12} /> Lancer
                              </button>
                            ) : plan.status === 'in_progress' && isChef && isInProgress ? (
                              <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors inline-flex items-center gap-1">
                                <Play size={12} /> Continuer
                              </button>
                            ) : isProduced ? (
                              <button onClick={() => setPrintChoiceItem(item)} className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1" title="Imprimer ticket">
                                <Printer size={13} /> Ticket
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        );
      })() : (
        /* Non-replenishment plan: simple table */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers size={16} className="text-amber-600" />
              <h2 className="font-semibold text-gray-900 text-sm">Articles du plan</h2>
              <span className="text-xs text-gray-400">{items.length} article(s)</span>
            </div>
            {plan.status === 'in_progress' && totalActive > 0 && (
              <div className="flex items-center gap-3">
                <div className="w-28 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-500">{producedCount}/{totalActive}</span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <th className="text-left px-5 py-2.5">Produit</th>
                <th className="text-center px-3 py-2.5 w-14">Qte</th>
                <th className="text-center px-3 py-2.5 w-14">Fait</th>
                <th className="text-left px-3 py-2.5">N° Lot</th>
                <th className="text-center px-3 py-2.5">Date de production</th>
                <th className="text-left px-3 py-2.5">Produit par</th>
                <th className="text-center px-3 py-2.5">Date d'expiration</th>
                <th className="text-center px-3 py-2.5">Cycle de vie</th>
                <th className="text-center px-3 py-2.5 w-24">Statut</th>
                <th className="text-center px-3 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: Record<string, any>, idx: number) => {
                const itemStatus = (item.status as string) || 'pending';
                const isInProgress = itemStatus === 'in_progress';
                const isWaiting = item.waiting_status === 'waiting';
                const isCancelled = itemStatus === 'cancelled';
                const isProduced = itemStatus === 'produced' || itemStatus === 'transferred' || itemStatus === 'received';
                const prodTimestamp = item.production_timestamp || item.produced_at;
                const startTs = item.started_at as string | null;
                const prodDate = prodTimestamp ? new Date(prodTimestamp as string) : new Date(plan.plan_date);
                const sldays = item.shelf_life_days as number;
                const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sldays ? new Date(prodDate.getTime() + sldays * 86400000) : null;
                const now = new Date();
                const producedBy = item.produced_by_first_name ? `${item.produced_by_first_name} ${item.produced_by_last_name}` : null;
                const startedBy = item.started_by_first_name ? `${item.started_by_first_name} ${item.started_by_last_name}` : null;
                const planDateObj2 = new Date(plan.plan_date as string);
                const lotNumber = (item.lot_number as string) || `LOT-${format(planDateObj2, 'yyMMdd')}-${String(idx + 1).padStart(3, '0')}`;

                return (
                  <tr key={item.id as string} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/60 ${isCancelled ? 'opacity-40' : ''} ${isInProgress ? 'bg-blue-50/40' : idx % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                    <td className="px-5 py-3">
                      <span className={`font-medium ${isCancelled ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.product_name as string}</span>
                      {item.nb_contenants && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700">
                            <Layers size={10} /> {item.nb_contenants as number}x {item.contenant_nom as string || 'contenant'}
                          </span>
                          {(item.qty_from_frigo as number) > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-50 text-cyan-700">
                              <Flame size={10} /> Frigo: -{item.qty_from_frigo as number}
                            </span>
                          )}
                          {(item.surplus_frigo as number) > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
                              <Package size={10} /> Surplus: +{item.surplus_frigo as number}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="font-bold text-gray-600">{item.planned_quantity as number}</div>
                      {item.quantite_brute_totale && (item.quantite_brute_totale as number) !== (item.planned_quantity as number) && (
                        <div className="text-[10px] text-indigo-500" title="Quantite brute totale (contenants)">
                          brut: {item.quantite_brute_totale as number}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {item.actual_quantity != null ? (
                        <span className={`font-bold ${(item.actual_quantity as number) >= (item.planned_quantity as number) ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {item.actual_quantity as number}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-600 font-mono whitespace-nowrap">
                      {(isProduced || isInProgress) ? lotNumber : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600 whitespace-nowrap">
                      {isProduced && prodTimestamp ? format(prodDate, 'dd/MM/yy HH:mm') : isInProgress && startTs ? format(new Date(startTs), 'dd/MM/yy HH:mm') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {isProduced && producedBy ? producedBy : isInProgress && startedBy ? startedBy : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {isProduced && dlcDate ? (
                        <span className={dlcDate <= now ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                          {dlcDate <= now ? 'Expire' : format(dlcDate, 'dd/MM/yyyy')}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {isProduced ? (
                        (item.is_reexposable as boolean) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700">DLV</span>
                        ) : (item.is_recyclable as boolean) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700">Recyclable</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700">Vente du jour</span>
                        )
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {itemStatus === 'produced' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700"><CheckCircle size={11} /> Produit</span>
                      ) : itemStatus === 'transferred' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700"><TrendingUp size={11} /> Transfere</span>
                      ) : itemStatus === 'received' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700"><Package size={11} /> Recu</span>
                      ) : isInProgress ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 animate-pulse"><Play size={11} /> En cours</span>
                      ) : isCancelled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600"><XCircle size={11} /> Annule</span>
                      ) : isWaiting ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-600"><Clock size={11} /> Attente</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">A faire</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {plan.status === 'in_progress' && isChef && itemStatus === 'pending' && !isWaiting ? (
                        <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-1">
                          <Play size={12} /> Lancer
                        </button>
                      ) : plan.status === 'in_progress' && isChef && isInProgress ? (
                        <button onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors inline-flex items-center gap-1">
                          <Play size={12} /> Continuer
                        </button>
                      ) : isProduced ? (
                        <button onClick={() => setPrintChoiceItem(item)} className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-1" title="Imprimer ticket">
                          <Printer size={13} /> Ticket
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}</>}

      {/* ══════════════ WAITING LIST (onglet Production) ══════════════ */}
      {showProd && plan.status !== 'draft' && (() => {
        const waitingItems = items.filter((it: Record<string, any>) => it.waiting_status === 'waiting');
        const restoredItems = items.filter((it: Record<string, any>) => it.waiting_status === 'restored');
        if (waitingItems.length === 0 && restoredItems.length === 0) return null;
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="bg-amber-50 px-5 py-4 border-b border-amber-200 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
                <Clock size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-amber-900">Liste d'attente</h2>
                {waitingItems.length > 0 && <span className="text-xs text-amber-600">{waitingItems.length} en attente</span>}
              </div>
            </div>

            {waitingItems.length > 0 && (
              <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center gap-3">
                <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
                <span className="text-sm text-amber-800">
                  Ces articles ne peuvent pas etre produits — ingredients insuffisants.
                  {plan.status === 'in_progress' && ' La production ne peut pas etre terminee tant que des articles sont en attente.'}
                </span>
              </div>
            )}

            <div className="p-5 space-y-2">
              {waitingItems.map((item: Record<string, any>) => (
                <div key={item.id as string} className="flex items-center gap-3 p-3.5 bg-amber-50/50 rounded-xl border border-amber-100 hover:bg-amber-50 transition-colors">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <Clock size={16} className="text-amber-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{item.product_name as string}</div>
                    <div className="text-xs text-amber-600">Qte planifiee: {item.planned_quantity as number}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 flex items-center gap-1">
                    <Clock size={10} /> En attente
                  </span>
                  {isChef && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => restoreMutation.mutate([item.id as string])}
                        disabled={restoreMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <RotateCcw size={12} /> Restaurer
                      </button>
                      <button
                        onClick={() => cancelItemsMutation.mutate({ itemIds: [item.id as string], reason: 'Annule depuis la liste d\'attente' })}
                        disabled={cancelItemsMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <XCircle size={12} /> Annuler
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {restoredItems.map((item: Record<string, any>) => (
                <div key={item.id as string} className="flex items-center gap-3 p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                  {item.product_image ? (
                    <img src={item.product_image as string} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={16} className="text-emerald-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{item.product_name as string}</div>
                    <div className="text-xs text-emerald-600">Qte planifiee: {item.planned_quantity as number}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1">
                    <CheckCircle size={10} /> Restaure
                  </span>
                </div>
              ))}
            </div>

            {waitingItems.length > 1 && isChef && (
              <div className="px-5 pb-4 flex justify-end">
                <button
                  onClick={() => restoreMutation.mutate(waitingItems.map((it: Record<string, any>) => it.id as string))}
                  disabled={restoreMutation.isPending}
                  className="px-5 py-2.5 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl flex items-center gap-2 transition-all shadow-md"
                >
                  <RotateCcw size={14} /> Restaurer tous ({waitingItems.length})
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ══════════════ INGREDIENT NEEDS : DESACTIVE ici, rendu en haut via ingredientNeedsBlock ══════════════ */}
      {false && showPrep && plan.status !== 'draft' && needs.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500 flex items-center justify-center">
                <Beaker size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Besoins en ingredients</h2>
                <span className="text-xs text-gray-500">{needs.length} ingredient(s)</span>
              </div>
            </div>
            {insufficientNeeds.length > 0 && (
              <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {insufficientNeeds.length} insuffisant(s)
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-50">
            {needs.map((need: Record<string, any>) => {
              const needed = parseFloat(need.needed_quantity as string);
              const available = parseFloat(need.available_quantity as string);
              const sufficient = need.is_sufficient as boolean;
              const pct = needed > 0 ? Math.min(Math.round((available / needed) * 100), 100) : 100;

              return (
                <div key={need.id as string} className={`px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50/50 transition-colors ${!sufficient ? 'bg-red-50/30' : ''}`}>
                  {/* Left color bar */}
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${sufficient ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  {/* Name + unit (smart : affiche l'unité réelle d'affichage, g ou kg) */}
                  {(() => {
                    const fNeed = smartFormatQuantity(needed, need.unit as string);
                    const fDispo = smartFormatQuantity(available, need.unit as string);
                    const digits = fNeed.unit === 'g' || fNeed.unit === 'ml' ? 0 : 2;
                    return <>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900">{need.ingredient_name as string}</div>
                        <div className="text-xs text-gray-400">{fNeed.unit}</div>
                      </div>
                      <div className="w-24 flex-shrink-0">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${sufficient ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5 text-center">{pct}%</div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Besoin</div>
                          <div className="text-sm font-bold text-gray-700">{fNeed.value.toFixed(digits)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Dispo</div>
                          <div className="text-sm font-bold text-gray-700">{fDispo.value.toFixed(digits)}</div>
                        </div>
                      </div>
                    </>;
                  })()}
                  {/* Status */}
                  {sufficient ? (
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0">
                      <CheckCircle size={10} /> OK
                    </span>
                  ) : (() => {
                    const f = smartFormatQuantity(needed - available, need.unit as string);
                    const d = f.unit === 'g' || f.unit === 'ml' ? 0 : 2;
                    return (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1 flex-shrink-0">
                        <AlertTriangle size={10} /> -{f.value.toFixed(d)} {f.unit}
                      </span>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ LOT TRACEABILITY ══════════════ */}
      {showPrep && (plan.status === 'completed' || plan.status === 'in_progress') && (productionLotUsage as Record<string, any>[]).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Tracabilite des lots</h2>
              <span className="text-xs text-gray-500">{(productionLotUsage as Record<string, any>[]).length} lot(s) d'ingredients utilise(s)</span>
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {(productionLotUsage as Record<string, any>[]).map((usage, idx) => {
              const expDate = usage.expiration_date ? new Date(usage.expiration_date as string) : null;
              const isExpired = expDate && expDate < new Date();

              return (
                <div key={idx} className="px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50/50 transition-colors">
                  <div className={`w-1 h-10 rounded-full flex-shrink-0 ${isExpired ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900">{usage.ingredient_name as string}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {(usage.supplier_lot_number as string) || 'Sans ref.'}
                      </span>
                      {expDate && (
                        <span className={`text-[10px] ${isExpired ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                          DLC: {format(expDate, 'dd/MM/yyyy')}
                        </span>
                      )}
                      {usage.received_at && (
                        <span className="text-[10px] text-gray-400">
                          Recu: {format(new Date(usage.received_at as string), 'dd/MM/yyyy')}
                        </span>
                      )}
                      {usage.supplier_name ? <span className="text-[10px] text-gray-400">— {String(usage.supplier_name)}</span> : null}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-gray-700">{parseFloat(usage.quantity_used as string).toFixed(2)}</div>
                    <div className="text-[10px] text-gray-400">{(usage.ingredient_unit as string) || ''} utilise(s)</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ ÉTAPES + RENDEMENT + COUT REEL ══════════════ */}
      {showProd && plan && ['in_progress', 'completed'].includes(plan.status) && (
        <>
          <EtapesPanel planId={id!} planStatus={plan.status} isChef={isChef} />
          <RendementPanel planId={id!} planStatus={plan.status} items={items} isChef={isChef} />
          <CoutReelPanel planId={id!} planStatus={plan.status} isChef={isChef}
            totalQuantity={items.reduce((s: number, it: any) => s + ((it.actual_quantity as number) || (it.planned_quantity as number) || 0), 0)} />
        </>
      )}

      {/* ══════════════ PRODUCTION LAUNCH MODAL (4-step) ══════════════ */}
      {showProductionLaunch && (
        <ProductionLaunchModal
          planId={id!}
          plan={plan}
          items={items.filter((it: Record<string, any>) => it.status === 'in_progress' || it.status === 'pending')}
          targetItemId={launchTargetItemId}
          initialStepName={timerStepName}
          needs={needs}
          fefoPreview={fefoPreview}
          onClose={() => { setShowProductionLaunch(false); setLaunchTargetItemId(null); setTimerStepName(null); }}
          onCompleted={() => {}}
        />
      )}

      {/* Modal declaration de perte (contexte production) */}
      {showLossModal && (
        <LossDeclarationModal
          context="production"
          productionPlanId={id!}
          productIdFilter={items.map((it: Record<string, any>) => it.product_id as string)}
          onClose={() => { setShowLossModal(false); queryClient.invalidateQueries({ queryKey: ['production', id] }); }}
        />
      )}

      {/* Print overlay — compatible mobile */}
      {printHtml && (
        <PrintOverlay html={printHtml} onClose={() => setPrintHtml(null)} />
      )}

      {/* Choix imprimante : NIIMBOT B1 PRO (Web Bluetooth) ou apercu HTML */}
      {printChoiceItem && (() => {
        const lotData = buildLotLabelData(printChoiceItem);
        if (!lotData) return null;
        return (
          <PrintModeSelectorModal
            lotData={lotData}
            onPreviewHtml={() => printProductionTicket(printChoiceItem)}
            onClose={() => setPrintChoiceItem(null)}
          />
        );
      })()}

      {/* Demande de verification stock au responsable economat/pesage */}
      {restockNeed && (
        <RequestStockVerificationModal
          need={restockNeed}
          isPending={requestVerificationMutation.isPending}
          onClose={() => setRestockNeed(null)}
          onConfirm={(payload) => requestVerificationMutation.mutate(payload)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════ REQUEST STOCK VERIFICATION MODAL ═══════════════════════ */
function RequestStockVerificationModal({ need, isPending, onClose, onConfirm }: {
  need: Record<string, any>;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (data: { ingredientId: string; note?: string }) => void;
}) {
  const needed = parseFloat(need.needed_quantity as string) || 0;
  const available = parseFloat(need.available_quantity as string) || 0;
  const deficit = Math.max(0, needed - available);
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({ ingredientId: need.ingredient_id as string, note: note || undefined });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b border-blue-100 bg-blue-50 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Send size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-blue-900">Demander au responsable stock</h3>
            <p className="text-xs text-blue-700 mt-0.5">Une notification sera envoyee au magasinier/economat pour verifier la dispo.</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-blue-100 rounded-lg">
            <XCircle size={18} className="text-blue-700" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Ingredient</span>
              <span className="font-semibold text-gray-900">{need.ingredient_name as string}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Besoin / Dispo</span>
              <span className="font-mono text-xs text-gray-700">
                {formatQty(needed, need.unit as string)} / {formatQty(available, need.unit as string)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-gray-200">
              <span className="text-gray-500">Manque</span>
              <span className="font-bold text-red-700">{formatQty(deficit, need.unit as string)}</span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
            <Info size={14} className="inline mr-1.5 align-text-bottom" />
            Le responsable stock va verifier physiquement l'ingredient et marquer "OK" s'il est disponible.
            Apres confirmation, vous pourrez restaurer l'article en attente.
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Note (optionnel)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Ex : verifier dans la reserve B..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={isPending}
              className="flex-1 py-2.5 px-4 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200">
              Annuler
            </button>
            <button type="submit" disabled={isPending}
              className="flex-1 py-2.5 px-4 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {isPending ? 'Envoi...' : <><Send size={14} /> Envoyer la demande</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

