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
import { PRODUCTION_STATUS_LABELS, getRoleCategorySlugs, type ProductionPlanEvent } from '@ofauria/shared';
import { usePermissions } from '../../context/PermissionsContext';
import {
  ArrowLeft, CheckCircle, CheckCircle2, Play, AlertTriangle, Factory, Printer, Package,
  User, Calendar, Box, Clock, RotateCcw, XCircle, ChefHat,
  Hash, FileText, Loader2, PackageOpen, Layers, Beaker, TrendingUp, Flame,
  Truck, Eye, Lock, RefreshCw, AlertCircle, BookOpen, Scale,
  MessageSquare, Send, Info, Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { planStatusTag, bonStatusTag } from './status';
import { buildTicketHtml, buildBsiHtml, buildFicheHtml } from './plan-print';
import { PlanJournal, PlanLotTraceability, PlanLinkedOrder } from './plan-sections';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import { smartFormatQuantity, formatQty } from '../../utils/units';
import ProductionLaunchModal from './ProductionLaunchModal';
import LossDeclarationModal from '../pos/LossDeclarationModal';
import PrintOverlay from '../../components/PrintOverlay';
import PrintModeSelectorModal from './PrintModeSelectorModal';
import type { LotLabelData } from '../../lib/niimbot';
import EtapesPanel from './EtapesPanel';
import RendementPanel from './RendementPanel';
import CoutReelPanel from './CoutReelPanel';

// Icone du statut du plan (le libelle vient de PRODUCTION_STATUS_LABELS, la couleur de statusTagClass).
const statusIcon: Record<string, React.ReactNode> = {
  draft: <FileText size={14} />,
  confirmed: <CheckCircle size={14} />,
  awaiting_ingredients: <Clock size={14} />,
  ready_to_produce: <AlertCircle size={14} />,
  in_progress: <Play size={14} />,
  completed: <CheckCircle size={14} />,
};

const roleLabel: Record<string, string> = {
  baker: 'Boulanger', pastry_chef: 'Pâtissier', viennoiserie: 'Viennoiserie', beldi_sale: 'Beldi & Salé',
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
  const confirmDialog = useConfirm();
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

  // Note : l'apercu FEFO a ete retire de cette page. La selection des lots se
  // fait maintenant dans le module Warehouse / BSI (transfert Economat -> Pesage).

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
    // Le chef attend le magasinier : on rafraichit tant que le bon n'est pas termine
    // (avant, aucun polling : il ne voyait pas « pret » sans recharger).
    refetchInterval: (q) => {
      const active = ((q.state.data || []) as Record<string, any>[]).find(b => b.status !== 'annule');
      return active && !['cloture', 'annule'].includes(active.status as string) ? 15000 : false;
    },
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
  // Fin de l'etape Preparation : UNIQUEMENT quand le bon de sortie est cloture
  // (ingredients transferes et reception confirmee), ou si la production est deja
  // demarree / terminee. Un plan sans besoin calcule (produit sans recette) n'est
  // PAS considere comme prepare : il faut corriger la recette et relancer le plan.
  // Tant que ce n'est pas le cas, l'onglet Production n'est pas affiche du tout.
  const noIngredientNeeds = !!plan && plan.status !== 'draft'
    && ((plan.ingredient_needs || []) as unknown[]).length === 0;
  const bsiCloture = activeBon?.status === 'cloture';
  const preparationDone = !!plan && (
    plan.status === 'in_progress' || plan.status === 'completed' || bsiCloture
  );
  // Auto-bascule sur 'production' des que la preparation est terminee (ouverture d'un plan
  // deja demarre, cloture du BSI par le magasinier, plan sans ingredient a prelever).
  useEffect(() => {
    if (plan && plan.status !== 'draft' && preparationDone) {
      setActivePlanTab('production');
    }
  }, [plan?.status, preparationDone]);
  // Auto-bascule sur le sous-onglet "Bon de sortie" quand un BSI est genere
  // (l'operateur vient de cliquer "Preparer le bon de sortie", on l'emmene directement
  // sur l'interface de prelevement sans changer de page).
  // Une seule fois par bon (a son apparition) : avant, chaque changement de statut
  // remonte par le polling ramenait l'utilisateur sur ce sous-onglet pendant qu'il
  // lisait les besoins.
  useEffect(() => {
    if (activeBon && activeBon.status !== 'cloture' && activeBon.status !== 'annule') {
      setPrepSubTab('bsi');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBon?.id]);

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

  // Delta v1 point 2 : bandeau persistant chef "Ingredients prets — Confirmer ou refuser".
  // S'affiche en haut de page (visible quel que soit l'onglet) quand le BSI est en 'pret'.
  // Les actions sont les memes que celles du BonSortiePanel mais accessibles globalement.
  const [bannerRejecting, setBannerRejecting] = useState(false);
  const [bannerRejectReason, setBannerRejectReason] = useState('');
  // Journal des transitions (plan + bons) — mig 299.
  const { data: planEvents = [] } = useQuery<ProductionPlanEvent[]>({
    queryKey: ['production-events', id],
    queryFn: () => productionApi.getEvents(id!),
    enabled: !!id,
  });

  const acceptReceptionMutation = useMutation({
    mutationFn: async ({ andStart }: { andStart: boolean }) => {
      const bonId = activeBon?.id as string;
      if (!bonId) throw new Error('Aucun bon de sortie actif');
      // Un seul appel : le serveur enchaine prelevement -> verifie -> cloture dans
      // une transaction (plus de bon laisse a mi-chemin avec le stock consomme).
      await bonSortieApi.acceptReception(bonId);
      // « Reception et demarrage » : le geste courant du chef, en un clic.
      if (andStart) await productionApi.start(id!);
      return andStart;
    },
    onSuccess: (andStart) => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', id] });
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success(andStart ? 'Réception acceptée — production démarrée' : 'Réception acceptée — ingrédients livrés, vous pouvez démarrer la production');
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur')),
  });
  const rejectReceptionMutation = useMutation({
    mutationFn: (reason: string) => bonSortieApi.chefReject(activeBon!.id as string, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', id] });
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      setBannerRejecting(false);
      setBannerRejectReason('');
      notify.success('Reception refusee — le magasinier a ete notifie');
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur')),
  });

  const revertMutation = useMutation({
    mutationFn: () => productionApi.revertToDraft(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success('Plan repasse en brouillon — vous pouvez le modifier');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        || (err as Error)?.message
        || 'Erreur lors de la repasse en brouillon';
      notify.error(msg);
    },
  });

  // Relance d'un plan bloque : remet en production les articles annules ou en
  // liste d'attente, sans creer de nouveau plan.
  const relaunchMutation = useMutation({
    mutationFn: () => productionApi.relaunch(id!),
    onSuccess: (result: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', id] });
      queryClient.invalidateQueries({ queryKey: ['production-activities', id] });
      const count = (result?.meta?.relaunchedCount as number) ?? 0;
      const recomputed = !!result?.meta?.recomputed;
      const quoi = [
        count > 0 ? `${count} article(s) remis en production` : null,
        recomputed ? 'besoins et bon de sortie recalcules' : null,
      ].filter(Boolean).join(', ');
      notify.success(`Plan relance — ${quoi}`);
      (result?.warnings as string[] | undefined)?.forEach((w) =>
        notify(w, { icon: '⚠️', duration: 6000 })
      );
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        || (err as Error)?.message
        || 'Erreur lors de la relance du plan';
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
    // Sans onError, les erreurs (409 statut invalide, 403 role refuse, 500 backend, etc.)
    // etaient avalees silencieusement : le bouton arretait son spinner et "rien ne se passait".
    onError: (e: unknown) => {
      const resp = (e as Record<string, any>)?.response as Record<string, any> | undefined;
      const data = resp?.data as Record<string, any> | undefined;
      const err = data?.error as Record<string, any> | undefined;
      const status = resp?.status as number | undefined;
      const msg = (err?.message as string)
        || (e as Error)?.message
        || `Impossible de confirmer le plan${status ? ` (HTTP ${status})` : ''}`;
      console.error('Confirm plan failed:', e);
      notify.error(msg);
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
    // Audit P1.6 : libelle du cycle DERIVE du sale_type (source de verite),
    // pas de is_reexposable seul (qui pouvait rendre 'DLV — Conservable' sur
    // un produit sale_type='jour' non reexposable — trace physique erronee).
    const saleType = (item.sale_type as string) || 'jour';
    const cycleLabel =
      saleType === 'dlv' ? (sld ? `DLC ${sld}j` : 'Multi-jours')
      : saleType === 'commande' ? 'Sur commande'
      : 'Vente du jour';
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

  // Impressions : gabarits dans plan-print.ts, la page ne fait que les afficher.
  const printProductionTicket = (item: Record<string, any>) => {
    if (plan) setPrintHtml(buildTicketHtml(plan, item, settings));
  };
  const printBonSortieIngredients = () => {
    if (plan) setPrintHtml(buildBsiHtml(plan, needs, settings, getPlanLotPrefix()));
  };
  const printFicheProduction = (planData?: Record<string, any>) => {
    const p = planData || plan;
    if (!p) return;
    const allPrintItems = (p.items || []) as Record<string, any>[];
    const planItems = allowedSlugs
      ? allPrintItems.filter((it) => allowedSlugs.includes(it.category_slug as string))
      : allPrintItems;
    setPrintHtml(buildFicheHtml(p, planItems, settings, getPlanLotPrefix(p)));
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
      notify.error(apiErrorMessage(error, 'Erreur lors de la restauration'));
    },
  });

  const cancelItemsMutation = useMutation({
    mutationFn: ({ itemIds, reason }: { itemIds: string[]; reason?: string }) => productionApi.cancelItems(id!, itemIds, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success('Article(s) annule(s)');
    },
    onError: (error: any) => {
      notify.error(apiErrorMessage(error, 'Erreur lors de l\'annulation'));
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
      notify.error(apiErrorMessage(error, 'Erreur lors de la demande'));
    },
  });

  // ═══ Bon de sortie mutations ═══
  // Start item: pending → in_progress
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

  const planIcon = statusIcon[plan.status] || statusIcon.draft;
  const rc = roleLabel[plan.target_role as string] ? { label: roleLabel[plan.target_role as string] } : null;

  // Progress stats
  const producedCount = items.filter((it: Record<string, any>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received').length;
  const cancelledCount = items.filter((it: Record<string, any>) => it.status === 'cancelled').length;
  const waitingCount = items.filter((it: Record<string, any>) => it.waiting_status === 'waiting').length;
  const totalActive = items.length - cancelledCount;
  const progressPct = totalActive > 0 ? Math.round((producedCount / totalActive) * 100) : 0;

  // Gating des onglets :
  //   - Plan semi-fini : tout est affiche (UI dediee, pas de tabs)
  //   - Plan en 'draft' : tout est affiche (pas encore de workflow BSI/production)
  //   - Sinon : sections filtrees par activePlanTab
  //   - L'onglet Production n'existe que si preparationDone : on force l'onglet actif a
  //     'preparation' tant que ce n'est pas le cas (securite si l'etat change, ex. relance).
  const hasTabs = !isSemiFini && plan.status !== 'draft';
  const productionTabVisible = hasTabs && preparationDone;
  const effectiveTab: 'preparation' | 'production' = productionTabVisible ? activePlanTab : 'preparation';
  const showPrep = !hasTabs || effectiveTab === 'preparation';
  const showProd = !hasTabs || effectiveTab === 'production';
  // Sous-gating onglet Preparation :
  const showPrepNeeds = showPrep && (!hasTabs || prepSubTab === 'needs');
  const showPrepBsi = showPrep && (!hasTabs || prepSubTab === 'bsi');
  // Aucun BSI generable : aucun besoin ingredient (produits sans recette) ou generate()
  // a repondu "rien a prelever". Ne debloque PAS la production : la preparation reste
  // bloquee tant que les besoins ne sont pas recalcules (recette + relance du plan).
  const bonNotNeeded = !isSemiFini && plan.status !== 'draft' && !activeBon && (noIngredientNeeds || !!bonNotNeededReason);

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
    return (
      <div className="odoo-section">
        <div className="odoo-section-header">
          <Beaker size={12} /> Semi-finis requis
          <span className={`odoo-tag ${allFulfilled ? 'odoo-tag-green' : 'odoo-tag-yellow'}`} style={{ marginLeft: 4 }}>
            {fulfilledCount} / {totalDeps}
          </span>
          {!allFulfilled && (
            <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 'auto' }}>
              <Lock size={10} /> Production bloquée
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Semi-fini</th>
                <th style={{ textAlign: 'right' }}>Besoin</th>
                <th style={{ textAlign: 'right' }}>En stock</th>
                <th style={{ textAlign: 'right' }}>À produire</th>
                <th>Avancement</th>
                <th>Plan de production</th>
                <th>Statut</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {deps.map((dep: Record<string, any>) => {
                const status = dep.status as string;
                const isFulfilled = status === 'fulfilled';
                const depPlanId = dep.dependency_plan_id as string | null;
                const depPlanStatus = dep.dep_plan_status as string | null;
                const needed = parseFloat(dep.quantity_needed as string);
                const fromStock = parseFloat(dep.quantity_from_stock as string);
                const toProduce = parseFloat(dep.quantity_to_produce as string);
                const itemPct = needed > 0 ? Math.round(((isFulfilled ? needed : fromStock) / needed) * 100) : 0;
                const depPlanTag = depPlanStatus ? planStatusTag(depPlanStatus) : null;
                return (
                  <tr key={dep.id as string} style={{ cursor: 'default' }}>
                    <td><span className={`odoo-status-dot ${isFulfilled ? 'ok' : 'warning'}`} /></td>
                    <td style={{ fontWeight: 600 }}>{dep.sub_recipe_name as string}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{needed.toFixed(1)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: fromStock > 0 ? '#155724' : 'var(--theme-text-muted)' }}>
                      {fromStock > 0 ? fromStock.toFixed(1) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: toProduce > 0 ? '#b85d1a' : 'var(--theme-text-muted)' }}>
                      {toProduce > 0 ? toProduce.toFixed(1) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 80, height: 4, backgroundColor: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${itemPct}%`, backgroundColor: isFulfilled ? '#155724' : 'var(--theme-accent)' }} />
                        </div>
                        <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{itemPct}%</span>
                      </div>
                    </td>
                    <td>{depPlanTag ? <span className={`odoo-tag ${depPlanTag.cls}`}>{depPlanTag.label}</span> : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}</td>
                    <td>
                      <span className={`odoo-tag ${isFulfilled ? 'odoo-tag-green' : 'odoo-tag-yellow'}`}>
                        {isFulfilled ? <CheckCircle size={10} /> : <Clock size={10} />}
                        {isFulfilled ? 'Disponible' : 'En attente'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {depPlanId && (
                        <button type="button" onClick={() => navigate(`/production/${depPlanId}`)} className="odoo-btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.6875rem' }}>
                          <Eye size={11} /> Voir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!allFulfilled && (
          <div className="odoo-alert danger" style={{ borderBottom: 'none', borderTop: '1px solid #f5c6cb' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>La production ne peut pas démarrer tant que les semi-finis sont en attente.</span>
          </div>
        )}
      </div>
    );
  })() : null;

  // Tableau des articles du plan — partage entre le cas "plan de reassort" et le cas
  // simple. Une ligne par article : quantites, lot, dates, cycle de vie, statut, action.
  const itemsTable = items.length > 0 ? (
    <div className="odoo-section">
      <div className="odoo-section-header">
        <Layers size={12} /> Articles du plan
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{items.length} article(s)</span>
        {plan.status === 'in_progress' && totalActive > 0 && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0 }}>
            <div style={{ width: 100, height: 4, backgroundColor: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, backgroundColor: progressPct >= 100 ? '#155724' : 'var(--theme-accent)', transition: 'width 0.3s' }} />
            </div>
            <span>{producedCount} / {totalActive}</span>
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Produit</th>
              <th style={{ textAlign: 'right' }}>Qté</th>
              <th style={{ textAlign: 'right' }}>Fait</th>
              <th>N° lot</th>
              <th>Date de production</th>
              <th>Produit par</th>
              <th>DLC</th>
              <th>Cycle de vie</th>
              <th>Statut</th>
              <th style={{ width: 110 }}></th>
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
              const lotNumber = (item.lot_number as string) || `LOT-${format(new Date(plan.plan_date as string), 'yyMMdd')}-${String(idx + 1).padStart(3, '0')}`;
              const planned = item.planned_quantity as number;
              const actual = item.actual_quantity as number | null;
              const saleType = (item.sale_type as string) || 'jour';

              const statusTag = itemStatus === 'produced' ? { cls: 'odoo-tag-green', label: 'Produit', Icon: CheckCircle }
                : itemStatus === 'transferred' ? { cls: 'odoo-tag-purple', label: 'Transféré', Icon: TrendingUp }
                : itemStatus === 'received' ? { cls: 'odoo-tag-blue', label: 'Reçu', Icon: Package }
                : isInProgress ? { cls: 'odoo-tag-yellow', label: 'En cours', Icon: Play }
                : isCancelled ? { cls: 'odoo-tag-red', label: 'Annulé', Icon: XCircle }
                : isWaiting ? { cls: 'odoo-tag-orange', label: 'En attente', Icon: Clock }
                : { cls: 'odoo-tag-grey', label: 'À faire', Icon: Clock };
              const dot = isProduced ? 'ok' : isInProgress ? 'warning' : isCancelled ? 'danger' : 'neutral';
              const empty = <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>;

              return (
                <tr key={item.id as string} className={isInProgress ? 'row-warning' : ''} style={{ cursor: 'default', opacity: isCancelled ? 0.5 : 1 }}>
                  <td><span className={`odoo-status-dot ${dot}`} /></td>
                  <td>
                    <span style={{ fontWeight: 600, textDecoration: isCancelled ? 'line-through' : undefined }}>{item.product_name as string}</span>
                    {Array.isArray(item.outputs) && item.outputs.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                        {(item.outputs as Record<string, any>[]).map((o, oi) => (
                          <span key={oi} className="odoo-tag odoo-tag-purple" title={o.lot_number ? `Lot ${o.lot_number}` : undefined}>
                            {parseFloat(String(o.quantity))} × {o.label as string}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.nb_contenants && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                        <span className="odoo-tag odoo-tag-grey"><Layers size={9} /> {item.nb_contenants as number}× {item.contenant_nom as string || 'format'}</span>
                        {(item.qty_from_frigo as number) > 0 && (
                          <span className="odoo-tag odoo-tag-blue"><Flame size={9} /> Frigo −{item.qty_from_frigo as number}</span>
                        )}
                        {(item.surplus_frigo as number) > 0 && (
                          <span className="odoo-tag odoo-tag-orange"><Package size={9} /> Surplus +{item.surplus_frigo as number}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{planned}</strong>
                    {item.quantite_brute_totale && (item.quantite_brute_totale as number) !== planned && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }} title="Quantité brute totale (formats)">brut {item.quantite_brute_totale as number}</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {actual != null ? <strong style={{ color: actual >= planned ? '#155724' : '#b85d1a' }}>{actual}</strong> : empty}
                  </td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{(isProduced || isInProgress) ? lotNumber : empty}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--theme-text-muted)' }}>
                    {isProduced && prodTimestamp ? format(prodDate, 'dd/MM/yy HH:mm') : isInProgress && startTs ? format(new Date(startTs), 'dd/MM/yy HH:mm') : empty}
                  </td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{isProduced && producedBy ? producedBy : isInProgress && startedBy ? startedBy : empty}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isProduced && dlcDate
                      ? (dlcDate <= now ? <span className="odoo-tag odoo-tag-red">Expiré</span> : <span style={{ color: 'var(--theme-text-muted)' }}>{format(dlcDate, 'dd/MM/yyyy')}</span>)
                      : empty}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isProduced ? (
                      saleType === 'dlv' ? <span className="odoo-tag odoo-tag-green">Multi-jours (DLC)</span>
                      : saleType === 'commande' ? <span className="odoo-tag odoo-tag-blue">Sur commande</span>
                      : <span className="odoo-tag odoo-tag-orange">Vente du jour</span>
                    ) : empty}
                  </td>
                  <td><span className={`odoo-tag ${statusTag.cls}`}><statusTag.Icon size={10} /> {statusTag.label}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    {plan.status === 'in_progress' && isChef && itemStatus === 'pending' && !isWaiting ? (
                      <button type="button" onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="odoo-btn-primary">
                        <Play size={12} /> Lancer
                      </button>
                    ) : plan.status === 'in_progress' && isChef && isInProgress ? (
                      <button type="button" onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="odoo-btn-primary">
                        <Play size={12} /> Continuer
                      </button>
                    ) : isProduced ? (
                      <button type="button" onClick={() => setPrintChoiceItem(item)} className="odoo-btn-secondary" title="Imprimer le ticket">
                        <Printer size={12} /> Ticket
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
  ) : null;

  // Actions de cycle de vie du plan, rendues dans l'en-tete (independantes de l'onglet) :
  //   confirmer (brouillon) / repasser en brouillon / relancer. Chef uniquement.
  const planActions = isChef ? (
    <>
      {plan.status === 'draft' && isChef && (
        <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}
          className="odoo-btn-primary">
          {confirmMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
          {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer le plan'}
        </button>
      )}
      {/* Repasse en brouillon : visible quand confirme/awaiting/ready ET avant tout demarrage.
          Le backend verifie aussi qu'aucun item n'a commence ni le BSI preleve. */}
      {['confirmed', 'awaiting_ingredients', 'ready_to_produce'].includes(plan.status) && isChef && (() => {
        const items = (plan.items || []) as Record<string, any>[];
        const anyStarted = items.some((it) => it.status === 'in_progress' || it.status === 'produced');
        const bsiActive = activeBon && ['prelevement', 'verifie', 'cloture'].includes(activeBon.status as string);
        const blocked = anyStarted || bsiActive;
        const tooltip = anyStarted
          ? 'Au moins un produit a deja demarre — annulez d\'abord les items en cours'
          : bsiActive
            ? 'Le bon de sortie a deja ete preleve — annulez d\'abord le BSI'
            : 'Repasser en brouillon pour modifier le plan';
        return (
          <button
            type="button"
            onClick={async () => {
              if (await confirmDialog('Le bon de sortie sera annulé et les besoins en ingrédients recalculés à la prochaine confirmation.', { title: 'Repasser le plan en brouillon ?', confirmLabel: 'Repasser en brouillon' })) {
                revertMutation.mutate();
              }
            }}
            disabled={revertMutation.isPending || blocked}
            title={tooltip}
            className="odoo-btn-secondary"
          >
            {revertMutation.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : <ArrowLeft size={13} />}
            {revertMutation.isPending ? 'Repasse...' : 'Modifier (revenir en brouillon)'}
          </button>
        );
      })()}
      {/* Relancer le plan : disponible sur TOUT plan non brouillon. Ne cree pas de
          nouveau plan — deux blocages traites :
            - articles annules / en attente -> ils repassent en 'pending'
            - plan confirme sur un referentiel incomplet (produit sans recette a
              l'epoque) -> besoins et BSI recalcules depuis les recettes actuelles
          Le recalcul n'est possible que tant que la preparation n'est pas engagee
          (rien de demarre, BSI non preleve) : sinon on retoucherait un prelevement
          deja fait, et le bouton n'a plus rien a faire s'il n'y a aucun article a
          reactiver. */}
      {plan.status !== 'draft' && isChef && (() => {
        const total = cancelledCount + waitingCount;
        const anyStarted = items.some((it: Record<string, any>) =>
          ['in_progress', 'produced', 'transferred', 'received'].includes(it.status as string));
        const bsiEngaged = !!activeBon && ['prelevement', 'verifie', 'cloture'].includes(activeBon.status as string);
        const canRecompute = !anyStarted && !bsiEngaged;
        const nothingToDo = total === 0 && !canRecompute;

        const detail = [
          cancelledCount > 0 ? `${cancelledCount} annule(s)` : null,
          waitingCount > 0 ? `${waitingCount} en attente` : null,
        ].filter(Boolean).join(' + ');
        const lignes = [
          total > 0 ? `• ${total} article(s) (${detail}) repassent en production` : null,
          canRecompute ? '• besoins en ingredients et bon de sortie recalcules depuis les recettes actuelles' : null,
        ].filter(Boolean).join('\n');

        return (
          <button
            type="button"
            onClick={async () => {
              if (await confirmDialog(`${lignes}\n\nAucun nouveau plan n'est créé.`, { title: 'Relancer le plan ?', confirmLabel: 'Relancer' })) {
                relaunchMutation.mutate();
              }
            }}
            disabled={relaunchMutation.isPending || nothingToDo}
            title={nothingToDo
              ? 'Rien a relancer : aucun article annule ou en attente, et la preparation est deja engagee'
              : 'Debloquer ce plan : reactiver les articles annules et recalculer besoins + bon de sortie'}
            className="odoo-btn-secondary"
          >
            {relaunchMutation.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : <RotateCcw size={13} />}
            {relaunchMutation.isPending
              ? 'Relance...'
              : total > 0 ? `Relancer le plan (${total})` : 'Relancer le plan'}
          </button>
        );
      })()}
    </>
  ) : null;

  const planStatusBadge = plan.status === 'completed' && plan.completion_type === 'partial'
    ? 'Terminé (partiel)'
    : plan.status === 'completed' && plan.completion_type === 'complete'
    ? 'Terminé (complet)'
    : PRODUCTION_STATUS_LABELS[plan.status as keyof typeof PRODUCTION_STATUS_LABELS];
  const statusTagClass = planStatusTag(plan.status).cls;

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
        <span className={`odoo-tag ${statusTagClass}`}>{planIcon}{planStatusBadge}</span>
      </div>

      {/* ══════════════ EN-TETE FICHE : titre, meta, processus ══════════════ */}
      <div className="odoo-form-header plan-header" style={{ padding: '0.875rem 1rem' }}>
        <div className="plan-header-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <h1 className="odoo-form-title" style={{ fontSize: '1.25rem' }}>
            Plan du {format(new Date(plan.plan_date), 'EEEE dd MMMM yyyy', { locale: fr })}
          </h1>
          {isSemiFini && <span className="odoo-tag odoo-tag-purple"><Beaker size={10} /> Semi-fini</span>}
          {!isSemiFini && items.length > 0 && (
            <span style={{ fontSize: '0.875rem', color: 'var(--theme-text-muted)' }}>
              · {items.length === 1
                ? (items[0].product_name as string)
                : `${items[0].product_name as string} +${items.length - 1} autre${items.length > 2 ? 's' : ''}`}
            </span>
          )}
        </div>
        <div className="odoo-form-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <User size={11} /> {isSemiFini
              ? (plan.dependency_of as Record<string, any>[])[0]?.parent_created_by_name as string || plan.created_by_name
              : plan.created_by_name}
          </span>
          {rc && <span className="odoo-tag odoo-tag-purple"><ChefHat size={9} /> {rc.label}</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Hash size={11} /> <span style={{ fontFamily: 'ui-monospace, monospace' }}>
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
        </div>
        </div>
        {/* Actions sur le plan (cycle de vie) : confirmer / repasser en brouillon / relancer.
            Elles ne dependent pas de l'onglet, donc elles vivent dans l'en-tete ;
            les actions d'etape (BSI, demarrage, cloture) restent sous les onglets. */}
        {planActions && <div className="plan-header-actions">{planActions}</div>}
      </div>

      {/* Processus du plan : une etape par statut, la courante en surbrillance.
          Un plan semi-fini n'a pas de bon de sortie propre (c'est celui du parent). */}
      {(() => {
        const bsiLabel = activeBon
          ? bonStatusTag(activeBon.status as string).label
          : bonNotNeeded ? 'Aucun besoin' : null;
        const steps: { label: string; detail: string | null }[] = [
          { label: planStatusTag('draft').label, detail: plan.created_by_name ? (plan.created_by_name as string) : null },
          { label: planStatusTag('confirmed').label, detail: null },
          ...(isSemiFini ? [] : [{ label: 'Ingrédients', detail: bsiLabel }]),
          { label: planStatusTag('ready_to_produce').label, detail: null },
          { label: planStatusTag('in_progress').label, detail: totalActive > 0 ? `${producedCount} / ${totalActive} produit${totalActive > 1 ? 's' : ''}` : null },
          { label: planStatusTag('completed').label, detail: plan.status === 'completed' ? (plan.completion_type === 'partial' ? 'Clôture partielle' : 'Clôture complète') : null },
        ];
        const offset = isSemiFini ? -1 : 0;
        const cur = plan.status === 'draft' ? 0
          : plan.status === 'confirmed' || plan.status === 'awaiting_ingredients' ? 2 + offset
          : plan.status === 'ready_to_produce' ? 3 + offset
          : plan.status === 'in_progress' ? 4 + offset
          : 5 + offset;
        const finished = plan.status === 'completed';
        return (
          <ol className="ui-timeline">
            {steps.map((s, i) => {
              const done = finished || i < cur;
              const current = !finished && i === cur;
              return (
                <li key={s.label} className={`ui-timeline-step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`}>
                  <span className="ui-timeline-dot">{done ? <CheckCircle2 size={12} /> : i + 1}</span>
                  <span className="ui-timeline-label">{s.label}</span>
                  {s.detail && <span className="ui-timeline-detail">{s.detail}</span>}
                </li>
              );
            })}
          </ol>
        );
      })()}

      {/* ══════════════ INDICATEURS ══════════════ */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label"><Package size={11} style={{ display: 'inline', marginRight: 4 }} />Articles</div>
          <div className="odoo-stat-card-value">{items.length}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label"><CheckCircle2 size={11} style={{ display: 'inline', marginRight: 4 }} />Produits</div>
          <div className="odoo-stat-card-value" style={{ color: producedCount > 0 ? '#155724' : undefined }}>{producedCount}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label"><Layers size={11} style={{ display: 'inline', marginRight: 4 }} />Ingrédients</div>
          <div className="odoo-stat-card-value">{needs.length}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">Progression</div>
          <div className="odoo-stat-card-value" style={{ color: progressPct >= 100 ? '#155724' : undefined }}>
            {progressPct}%
          </div>
          {(plan.status === 'in_progress' || plan.status === 'completed') && totalActive > 0 && (
            <div style={{ height: 4, backgroundColor: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
              <div style={{
                height: '100%', width: `${progressPct}%`,
                backgroundColor: progressPct >= 100 ? '#155724' : 'var(--theme-accent)',
                transition: 'width 0.3s',
              }} />
            </div>
          )}
        </div>
      </div>

      {/* ══════════════ RECEPTION DES INGREDIENTS (chef) ══════════════
          Bandeau d'action tant que le plan est 'ready_to_produce' et le BSI 'pret' :
          visible sur tous les onglets, disparait apres acceptation ou refus du chef. */}
      {activeBon?.status === 'pret' && isChef && (() => {
        const missing = ((activeBon.lines || []) as Record<string, any>[]).filter(l => l.status === 'rupture' && !l.is_packaging);
        const deps = (plan.dependencies || []) as Record<string, any>[];
        const canStartAfter = !deps.some(d => d.status !== 'fulfilled' && d.status !== 'cancelled');
        return (
        <div style={{ margin: '1rem 1rem 0' }}>
          <StatusBanner tone={missing.length > 0 ? 'warning' : 'success'} icon={CheckCircle}
            title={missing.length > 0
              ? `Ingrédients prêts — ${missing.length} manquant${missing.length > 1 ? 's' : ''} signalé${missing.length > 1 ? 's' : ''} par le magasinier`
              : 'Ingrédients prêts — confirmer ou refuser la réception'}
            actions={!bannerRejecting ? (
              <>
                <button onClick={() => setBannerRejecting(true)} className="odoo-btn-danger">
                  <XCircle size={13} /> Refuser
                </button>
                <button onClick={() => acceptReceptionMutation.mutate({ andStart: false })} disabled={acceptReceptionMutation.isPending}
                  className="odoo-btn-secondary">
                  {acceptReceptionMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                  Réceptionner
                </button>
                {canStartAfter && (
                  <button onClick={() => acceptReceptionMutation.mutate({ andStart: true })} disabled={acceptReceptionMutation.isPending}
                    className="odoo-btn-primary" title="Accepte la réception puis démarre la production">
                    {acceptReceptionMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    Réceptionner et démarrer
                  </button>
                )}
              </>
            ) : undefined}>
            Le magasinier a terminé la préparation du bon {activeBon.numero as string}. Vérifiez les quantités
            et la conformité avant de démarrer la production.
            {missing.length > 0 && (
              <ul className="status-banner-list">
                {missing.map(l => (
                  <li key={l.id as string}><strong>{l.ingredient_name as string}</strong> : manque {(parseFloat(l.needed_quantity as string || '0') - parseFloat(l.allocated_quantity as string || '0')).toFixed(2)} {(l.unit || 'kg') as string} — produire sans, ou refuser la réception.</li>
                ))}
              </ul>
            )}
            {bannerRejecting && (
              <div className="status-banner-form">
                <label>Motif du refus (obligatoire)</label>
                <textarea
                  value={bannerRejectReason}
                  onChange={(e) => setBannerRejectReason(e.target.value)}
                  autoFocus
                  rows={2}
                  placeholder="Ex : quantité insuffisante sur la farine, lot mal identifié..."
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => { setBannerRejecting(false); setBannerRejectReason(''); }} className="odoo-btn-secondary">
                    Annuler
                  </button>
                  <button onClick={() => rejectReceptionMutation.mutate(bannerRejectReason.trim())}
                    disabled={rejectReceptionMutation.isPending || !bannerRejectReason.trim()}
                    className="odoo-btn-danger">
                    {rejectReceptionMutation.isPending ? 'Envoi...' : 'Confirmer le refus'}
                  </button>
                </div>
              </div>
            )}
          </StatusBanner>
        </div>
        );
      })()}

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
                {(() => {
                  const t = planStatusTag(dep.parent_status as string);
                  return <span className={`odoo-tag ${t.cls}`}>{t.label}</span>;
                })()}
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
                <>
                  <div className="odoo-section-header" style={{ borderTop: '1px solid var(--theme-bg-separator)' }}>
                    <Scale size={12} /> Ingrédients
                    <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                      ×{multiplier.toFixed(1)} pour {qtyNeeded.toFixed(2)} {yieldUnit}
                    </span>
                  </div>
                  <table className="odoo-table">
                    <thead>
                      <tr>
                        <th>Ingrédient</th>
                        <th style={{ textAlign: 'right' }}>Quantité</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipeIngredients.map((ri, idx) => {
                        const baseQty = parseFloat(ri.quantity as string || '0');
                        const scaledQty = baseQty * multiplier;
                        const unit = ri.unit as string || ri.base_unit as string || '';
                        return (
                          <tr key={idx} style={{ cursor: 'default' }}>
                            <td style={{ fontWeight: 500 }}>{ri.ingredient_name as string}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{scaledQty.toFixed(3)}</strong>
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{unit}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </>
        );
      })()}

      {/* ══════════════ TABS (Preparation / Production) ══════════════ */}
      {/* Les onglets ne s'affichent pas :
            - en 'draft' (rien a montrer encore)
            - pour un plan semi-fini (UI dediee au-dessus)
          L'onglet Production n'apparait qu'une fois la preparation terminee (BSI cloture,
          aucun ingredient a prelever, ou production deja demarree/terminee). Avant cela,
          seul "1. Preparation" existe, avec un rappel de l'etape suivante a droite. */}
      {hasTabs && (() => {
        const prepBadgeTag = preparationDone ? 'odoo-tag-green' : 'odoo-tag-yellow';
        const prepBadgeLabel = preparationDone ? '✓ Terminée' : 'En cours';
        const nextStepHint = bonNotNeeded
          ? 'Production bloquée : aucun besoin en ingrédients calculé (recette manquante)'
          : !activeBon
          ? 'Étape suivante : Production — après la génération et la clôture du bon de sortie'
          : activeBon.status === 'pret'
            ? 'Étape suivante : Production — après confirmation de la réception des ingrédients'
            : 'Étape suivante : Production — après la clôture du bon de sortie par le magasinier';
        return (
          <div className="odoo-tabs plan-tabs">
            <button type="button" onClick={() => setActivePlanTab('preparation')}
              className={`odoo-tab ${effectiveTab === 'preparation' ? 'active' : ''}`}>
              <Truck size={13} />
              <span>1. Préparation</span>
              <span className={`odoo-tag ${prepBadgeTag}`} style={{ marginLeft: 4 }}>{prepBadgeLabel}</span>
            </button>
            {productionTabVisible ? (
              <button type="button" onClick={() => setActivePlanTab('production')}
                className={`odoo-tab ${effectiveTab === 'production' ? 'active' : ''}`}>
                <Factory size={13} />
                <span>2. Production</span>
                {plan.status === 'in_progress' && (
                  <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 4 }}>{producedCount} / {totalActive}</span>
                )}
                {plan.status === 'completed' && (
                  <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 4 }}>&#10003;</span>
                )}
              </button>
            ) : (
              <span className="plan-tabs-hint" title={nextStepHint}>
                <Lock size={12} /> {nextStepHint}
              </span>
            )}
          </div>
        );
      })()}

      {/* ══════════════ SOUS-ONGLETS de l'onglet Preparation ══════════════ */}
      {hasTabs && effectiveTab === 'preparation' && (
        <div className="odoo-tabs plan-subtabs">
          <button type="button" onClick={() => setPrepSubTab('needs')}
            className={`odoo-tab ${prepSubTab === 'needs' ? 'active' : ''}`}>
            <Beaker size={13} />
            <span>Besoins en ingrédients</span>
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

      {/* ══════════════ BARRE D'ACTIONS DE L'ETAPE ══════════════
          Actions propres a l'onglet actif : primaire = action principale de l'etape,
          secondaire = impression, danger = perte. Les actions de cycle de vie du plan
          (confirmer / brouillon / relancer) sont dans l'en-tete (planActions). */}
      <div className="plan-toolbar">
        {showPrepBsi && ['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(plan.status) && !isSemiFini && (
          <button onClick={() => printBonSortieIngredients()} className="odoo-btn-secondary">
            <Printer size={13} /> Bon de sortie ingredients
          </button>
        )}
        {showProd && ['confirmed', 'awaiting_ingredients', 'ready_to_produce'].includes(plan.status) && (() => {
          const deps = (plan.dependencies || []) as Record<string, any>[];
          const hasPendingDeps = deps.some(d => d.status !== 'fulfilled' && d.status !== 'cancelled');
          // Wizard etape 3 : production bloquee tant que le BSI n'est pas cloture.
          // Les plans semi-finis sont exemptes (leur BSI est celui du plan parent).
          // Pas de raccourci "plan sans besoin" : la production exige un BSI cloture.
          const bsiBlocked = !isSemiFini && (!activeBon || activeBon.status !== 'cloture');
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
                  className="odoo-btn-primary">
                  {(hasPendingDeps || bsiBlocked) ? <Lock size={13} /> : startMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
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
                  } catch (e: any) { notify.error(apiErrorMessage(e, 'Erreur')); }
                }} className="odoo-btn-primary">
                  <Play size={13} /> Lancer tout ({pendingItems.length})
                </button>
              )}
              {inProgressItems.length > 0 && (
                <button onClick={() => { setLaunchTargetItemId(null); setShowProductionLaunch(true); }} className="odoo-btn-primary">
                  <Factory size={13} /> Enregistrer tout ({inProgressItems.length})
                </button>
              )}
              {waitingCount > 0 && allProduced && (
                <button
                  onClick={async () => {
                    if (await confirmDialog(`${waitingCount} article(s) en attente seront annulés.`, { title: 'Clôture partielle', confirmLabel: 'Clôturer', danger: true })) {
                      productionApi.complete(id!, [], 'partial').then(() => {
                        queryClient.invalidateQueries({ queryKey: ['production', id] });
                        notify.success('Plan cloture partiellement');
                      }).catch((err: any) => {
                        notify.error(apiErrorMessage(err, 'Erreur'));
                      });
                    }
                  }}
                  className="odoo-btn-secondary"
                >
                  <CheckCircle size={13} /> Cloture partielle
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

      {/* ══════════════ ETAPE 2 : BON DE SORTIE (sous-onglet Gestion BSI) ══════════════ */}
      {showPrepBsi && bonNotNeeded && ['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(plan.status) && (
        <div style={{ margin: '1rem' }}>
          <StatusBanner tone="warning" icon={AlertTriangle} title="Aucun bon de sortie à préparer — préparation bloquée">
            {bonNotNeededReason || 'Aucun ingrédient à prélever pour ce plan (produits sans recette ou sans composition).'}
            <div style={{ marginTop: 4 }}>
              La production ne peut pas démarrer sans transfert d'ingrédients. Ajoutez une recette aux produits
              de ce plan, puis utilisez « Relancer le plan » pour recalculer les besoins et générer le bon de sortie.
            </div>
          </StatusBanner>
        </div>
      )}

      {/* Le BSI est genere automatiquement a la confirmation du plan (notification au
          magasinier). Ce bandeau sert de filet de securite si l'auto-generation a echoue
          ou si la query n'a pas encore ramene le BSI. */}
      {showPrepBsi && !isSemiFini && !activeBon && !bonNotNeeded && ['confirmed', 'in_progress'].includes(plan.status) && (
        <div style={{ margin: '1rem' }}>
          <StatusBanner tone="info" icon={RefreshCw} title="Bon de sortie en cours de génération…"
            actions={isChef ? (
              <button onClick={() => prepareBonMutation.mutate()} disabled={prepareBonMutation.isPending}
                className="odoo-btn-secondary">
                {prepareBonMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {prepareBonMutation.isPending ? 'Génération…' : 'Relancer la génération'}
              </button>
            ) : undefined}>
            Le magasinier sera notifié automatiquement dès qu'il est prêt à être préparé.
            Si rien ne s'affiche après quelques secondes, relancez la génération.
          </StatusBanner>
        </div>
      )}

      {/* Panneau de prelevement inline : il porte lui-meme son en-tete (numero) et
          ses bandeaux de statut. */}
      {showPrepBsi && !isSemiFini && activeBon && (
        <div style={{ margin: '1rem' }}>
          <BonSortiePanel planId={id!} isChef={isChef} isMagasinier={isMagasinier} variant="inline" />
        </div>
      )}

      {plan.order_number && <PlanLinkedOrder plan={plan} />}

      {/* ══════════════ ALERTES (onglet Preparation) ══════════════
          Visibles uniquement par le magasinier : elles concernent la dispo des
          ingredients (mise en liste d'attente faute de stock), hors champ du chef. */}
      {showPrep && isMagasinier && plan.warnings && (plan.warnings as string[]).length > 0 && (
        <div style={{ margin: '1rem' }}>
          <StatusBanner tone="warning" icon={AlertTriangle} title={`Alertes (${(plan.warnings as string[]).length})`}>
            <ul className="status-banner-list">
              {[...new Set(plan.warnings as string[])].map((w: string, i: number) => <li key={i}>{w}</li>)}
            </ul>
          </StatusBanner>
        </div>
      )}

      {/* Besoins en ingredients — l'apercu FEFO a ete retire :
          la selection des lots est maintenant geree dans le workflow de
          transfert Economat -> Pesage (cf module Warehouse / BSI), pas ici. */}
      {ingredientNeedsBlock}
      {showPrepNeeds && hasTabs && needs.length === 0 && (
        <div style={{ margin: '1rem' }}>
          <StatusBanner tone="warning" icon={AlertTriangle} title="Aucun besoin en ingrédients calculé — préparation bloquée">
            Les produits de ce plan n'ont pas de recette (ou leur composition est vide) : aucun bon de sortie
            ne peut être généré et l'étape Production reste fermée.
            {isChef && ' Ajoutez une recette aux produits concernés, puis utilisez « Relancer le plan » pour recalculer les besoins (ou revenez en brouillon pour retirer le produit).'}
          </StatusBanner>
        </div>
      )}


      {/* Semi-finis requis — rendu en tete de l'onglet Production (etape pre-production) */}
      {semiFinishedDepsBlock}

      {/* ══════════════ ARTICLES (onglet Production) ══════════════ */}
      {showProd && linkedReplenishment && (() => {
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
        if (stockItems.length === 0) return null;
        return (
          <div className="odoo-section">
            <div className="odoo-section-header">
              <Box size={12} /> Prélevés du stock
              <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{stockItems.length} article(s)</span>
              <span style={{ marginLeft: 'auto', color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <TrendingUp size={11} /> Transfert auto — demande {linkedReplenishment.request_number as string}
              </span>
            </div>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th style={{ textAlign: 'right' }}>Du stock / demandé</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.map((ri) => (
                  <tr key={ri.id as string} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 500 }}>{ri.product_name as string}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{ri.category_name as string}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <strong style={{ color: '#155724' }}>{(ri.fulfilled_from_stock as number) || 0}</strong>
                      <span style={{ color: 'var(--theme-text-muted)' }}> / {(ri.requested_quantity as number) || 0}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
      {showProd && itemsTable}

      {/* ══════════════ LISTE D'ATTENTE (onglet Production) ══════════════ */}
      {showProd && plan.status !== 'draft' && (() => {
        const waitingItems = items.filter((it: Record<string, any>) => it.waiting_status === 'waiting');
        const restoredItems = items.filter((it: Record<string, any>) => it.waiting_status === 'restored');
        if (waitingItems.length === 0 && restoredItems.length === 0) return null;
        return (
          <div className="odoo-section">
            <div className="odoo-section-header">
              <Clock size={12} /> Liste d'attente
              {waitingItems.length > 0 && <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: 4 }}>{waitingItems.length} en attente</span>}
              {waitingItems.length > 1 && isChef && (
                <button type="button"
                  onClick={() => restoreMutation.mutate(waitingItems.map((it: Record<string, any>) => it.id as string))}
                  disabled={restoreMutation.isPending}
                  className="odoo-btn-primary" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '0.6875rem', textTransform: 'none', letterSpacing: 0 }}>
                  <RotateCcw size={11} /> Restaurer tous ({waitingItems.length})
                </button>
              )}
            </div>
            {waitingItems.length > 0 && (
              <div className="odoo-alert warning">
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Ces articles ne peuvent pas être produits : ingrédients insuffisants.
                  {plan.status === 'in_progress' && ' La production ne peut pas être terminée tant que des articles sont en attente.'}
                </span>
              </div>
            )}
            <table className="odoo-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Produit</th>
                  <th style={{ textAlign: 'right' }}>Qté planifiée</th>
                  <th>Statut</th>
                  <th style={{ width: 190 }}></th>
                </tr>
              </thead>
              <tbody>
                {waitingItems.map((item: Record<string, any>) => (
                  <tr key={item.id as string} style={{ cursor: 'default' }}>
                    <td><span className="odoo-status-dot warning" /></td>
                    <td style={{ fontWeight: 500 }}>{item.product_name as string}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.planned_quantity as number}</td>
                    <td><span className="odoo-tag odoo-tag-orange"><Clock size={10} /> En attente</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {isChef && (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" onClick={() => restoreMutation.mutate([item.id as string])} disabled={restoreMutation.isPending}
                            className="odoo-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.6875rem' }}>
                            <RotateCcw size={11} /> Restaurer
                          </button>
                          <button type="button"
                            onClick={() => cancelItemsMutation.mutate({ itemIds: [item.id as string], reason: 'Annule depuis la liste d\'attente' })}
                            disabled={cancelItemsMutation.isPending}
                            className="odoo-btn-danger" style={{ padding: '2px 8px', fontSize: '0.6875rem' }}>
                            <XCircle size={11} /> Annuler
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {restoredItems.map((item: Record<string, any>) => (
                  <tr key={item.id as string} style={{ cursor: 'default' }}>
                    <td><span className="odoo-status-dot ok" /></td>
                    <td style={{ fontWeight: 500 }}>{item.product_name as string}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.planned_quantity as number}</td>
                    <td><span className="odoo-tag odoo-tag-green"><CheckCircle size={10} /> Restauré</span></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {showPrep && (plan.status === 'completed' || plan.status === 'in_progress') && (
        <PlanLotTraceability usage={productionLotUsage as Record<string, any>[]} />
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

      {/* ══════════════ NOTES + JOURNAL (chatter, commun aux deux onglets) ══════════════
          Toujours en pied de fiche, apres le contenu de l'onglet actif. */}
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

      <PlanJournal events={planEvents} />

      {/* ══════════════ PRODUCTION LAUNCH MODAL (4-step) ══════════════ */}
      {showProductionLaunch && (
        <ProductionLaunchModal
          planId={id!}
          plan={plan}
          items={items.filter((it: Record<string, any>) => it.status === 'in_progress' || it.status === 'pending')}
          targetItemId={launchTargetItemId}
          initialStepName={timerStepName}
          needs={needs}
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
          planItems={items
            .filter((it: Record<string, any>) => it.status !== 'cancelled')
            .map((it: Record<string, any>) => ({
              id: it.id as string,
              productId: (it.product_id as string) || null,
              productName: (it.product_name as string) || '',
              lotNumber: (it.lot_number as string) || null,
              status: (it.status as string) || 'pending',
              plannedQty: Number(it.planned_quantity) || 0,
              producedQty: Number(it.actual_quantity) || 0,
              saleUnit: (it.sale_unit as 'unit' | 'weight' | null) ?? null,
              costPrice: it.cost_price != null ? Number(it.cost_price) : null,
              imageUrl: (it.product_image as string) || null,
            }))}
          onClose={() => {
            setShowLossModal(false);
            queryClient.invalidateQueries({ queryKey: ['production', id] });
            queryClient.invalidateQueries({ queryKey: ['product-losses'] });
          }}
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

