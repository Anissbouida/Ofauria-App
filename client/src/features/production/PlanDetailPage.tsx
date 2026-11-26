import { useProductionPolicies, shiftOf } from './usePolicies';
import { RowMenu } from '../../components/ui/RowMenu';
import { PlanPanels } from './planPanels';
import { useProdTerms } from '../../hooks/useProdTerms';
import ItemRecipeSelect from './ItemRecipeSelect';
import { money } from '../../utils/money';
import { usePermissions } from '../../context/PermissionsContext';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi, useWorkshops, PRIORITY_LABELS, usePlanSummary, useScreenHidden } from '../../api/production.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { productionCoutApi } from '../../api/production-cout.api';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { PRODUCTION_STATUS_LABELS, type ProductionPlanEvent } from '@ofauria/shared';
import {
  ArrowLeft, CheckCircle, CheckCircle2, Play, AlertTriangle, Factory, Printer, Package,
  User, Calendar, Box, Clock, RotateCcw, XCircle, ChefHat,
  Hash, FileText, Loader2, PackageOpen, Layers, Beaker, TrendingUp, Flame,
  Truck, Eye, Lock, RefreshCw, BookOpen, Scale, ShoppingBag,
  MessageSquare, Send, Info, Trash2, ChevronDown, LayoutDashboard, Coins, type LucideIcon
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { EquipmentLoadPanel, MaterialReturnPanel } from './PlanFlowPanels';
import { planStatusTag, bonStatusTag } from './status';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { buildTicketHtml, buildBsiHtml, buildFicheHtml, buildBatchRecordHtml } from './plan-print';
import { PlanJournal } from './plan-sections';
import './production.css';
import '../projects/projects.css';
import '../sales/sales.css';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Alert, Breadcrumb, DataPanel, EmptyState, ErrorState, FormField, FormFooter, LoadingState, Modal, SectionHeader } from '../../components/ds';
import { apiErrorMessage } from '../../api/errors';
import { smartFormatQuantity, formatQty } from '../../utils/units';
import ProductionLaunchModal from './ProductionLaunchModal';
import LossDeclarationModal from '../pos/LossDeclarationModal';
import PrintOverlay from '../../components/PrintOverlay';
import PrintModeSelectorModal from './PrintModeSelectorModal';
import type { LotLabelData } from '../../lib/niimbot';
import { useScreenDefinition } from '../../hooks/useScreenDefinition';

type PlanTab = 'synthese' | 'ingredients' | 'production' | 'couts';

export default function PlanDetailPage() {
  const T = useProdTerms();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { sectorLabel, hasFeature } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showProductionLaunch, setShowProductionLaunch] = useState(false);
  const [launchTargetItemId, setLaunchTargetItemId] = useState<string | null>(null);
  const [timerStepName, setTimerStepName] = useState<string | null>(null);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const confirmDialog = useConfirm();
  const [printChoiceItem, setPrintChoiceItem] = useState<Record<string, any> | null>(null);
  const { settings } = useSettings();
  // Membre d'un atelier (mig 511) ou direction.
  const ws = useWorkshops();
  const isChef = ['admin', 'manager'].includes(user?.role || '') || ws.mine.length > 0;
  // Admin/manager ont aussi le privilege magasinier (peuvent prendre en charge la preparation BSI).
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');

  const { data: plan, isLoading, isError, error, refetch } = useQuery({
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
  // G1-05 : fonctions de production activées (étapes, rendement, coût de revient).
  const { data: productionSettings } = useQuery({ queryKey: ['production-settings'], queryFn: productionApi.getSettings, staleTime: 5 * 60_000 });
  // M8-04 : gabarits d'impression du type d'ordre (titre, colonnes, signatures, mention).
  const { data: printTpl } = useQuery({
    queryKey: ['production-print-templates', plan?.order_type_id ?? null],
    queryFn: () => productionApi.printTemplates((plan?.order_type_id as string) ?? null),
    enabled: !!plan, staleTime: 5 * 60_000,
  });
  // Étape 10 (10b) : ordre et visibilité des sections de la fiche, par profil, société et rôle.
  const planScreenDefinition = useScreenDefinition('production.plan');
  // Étape 6 : un document désactivé dans le registre n'est plus proposé (l'enregistrement reste).
  const { data: docRegistry = [] } = useQuery({ queryKey: ['production-documents'], queryFn: productionApi.documents, staleTime: 5 * 60_000 });
  const docOn = (key: string) => docRegistry.find(d => d.docKey === key)?.enabled !== false;
  // Étape 8 : réservations de matière (capacité « reservation_matiere », éteinte par défaut).
  const { data: reservations = [] } = useQuery({
    queryKey: ['production-reservations', id], queryFn: () => productionApi.reservations(id!),
    enabled: !!id && hasFeature('reservation_matiere'), staleTime: 30_000,
  });
  // M1-03 : seuils et coupure d'équipe lus dans les politiques de production (atelier du plan).
  const policies = useProductionPolicies({ workshop: plan?.target_role as string | undefined, store: plan?.store_id as string | undefined });
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
  // Le plan porte son propre indicateur : le lien avec le plan parent peut disparaître (parent
  // relancé ou supprimé après la fabrication de la base) sans que ce plan cesse d'être une
  // préparation de base — il affichait alors « Préparation bloquée : aucun besoin calculé ».
  const isSemiFini = plan?.is_semi_finished_plan === true
    || (plan?.dependency_of && (plan.dependency_of as Record<string, any>[]).length > 0);

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

  // Onglets de la fiche, par sujet (un seul niveau) :
  //   synthese    : ce qui reste a faire + resume de chaque phase
  //   ingredients : besoins, bon de sortie et tracabilite des lots
  //   production  : semi-finis, articles, liste d'attente, procede, rendement
  //   couts       : cout de revient (une fois la production demarree)
  // L'onglet Production n'apparait qu'une fois le BSI cloture (ou deja en cours).
  const [planTab, setPlanTab] = useState<PlanTab>('synthese');
  // Menu « Plus » de l'en-tete (impressions, relance, brouillon, perte).
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
  // Onglet ouvert par defaut selon l'etat : la ou se trouve le travail du moment.
  // Recalcule a chaque changement de statut seulement (le polling ne ramene pas
  // l'utilisateur sur un onglet qu'il a quitte).
  useEffect(() => {
    if (!plan) return;
    setPlanTab(plan.status === 'in_progress' ? 'production'
      : ['confirmed', 'awaiting_ingredients'].includes(plan.status as string) ? 'ingredients'
      : 'synthese');
  }, [plan?.status]);

  // Rendement et cout reel : alimentent les indicateurs et la synthese. Memes cles
  // que RendementPanel / CoutReelPanel, la requete n'est donc faite qu'une fois.
  const hasResults = plan?.status === 'in_progress' || plan?.status === 'completed';
  const { data: rendements = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['production-rendement', id],
    queryFn: () => productionEtapesApi.planRendement(id!),
    enabled: !!id && hasResults,
  });
  const { data: coutReel } = useQuery<Record<string, any> | null>({
    queryKey: ['production-cout', id],
    queryFn: () => productionCoutApi.getCost(id!).catch(() => null),
    enabled: !!id && hasResults,
  });
  // M8-05 : synthèse chiffrée calculée au serveur ; clé sous ['production', id], rafraîchie
  // avec l'ordre et par les panneaux Rendement / Coûts après saisie.
  const { data: summary } = usePlanSummary(id, !!plan);
  // Écrans de fabrication (mig 591) : éléments masqués pour la société ou le type de l'ordre.
  const screenHidden = useScreenHidden(plan?.order_type_id as string | undefined);

  const prepareBonMutation = useMutation({
    mutationFn: () => bonSortieApi.generate(id!, plan!.store_id as string),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', id] });
      if (result?.data) {
        setBonNotNeededReason(null);
        notify.success(`Bon de sortie généré — procédez au prélèvement des ${T.ingredientsLc}`);
        // Lots hors DLC ecartes de l'allocation (mig 339) : le chef doit le savoir
        // pour deroger explicitement depuis le bon de sortie s'il le juge utile.
        const skipped = (result.data as { expired_lots_skipped?: { ingredient_name: string; lot_number: string }[] }).expired_lots_skipped;
        if (skipped && skipped.length > 0) {
          const liste = skipped.map(s => `${s.ingredient_name} (lot ${s.lot_number})`).join(', ');
          notify(`${skipped.length} lot(s) a DLC depassee ecarte(s) : ${liste}. Derogation possible depuis le bon de sortie.`, { icon: '⚠️', duration: 9000 });
        }
      } else {
        const reason = result?.reason || `Rien à prélever pour ce plan (produits sans ${T.recipeLc}).`;
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
      notify.success(andStart ? 'Réception acceptée — production démarrée' : `Réception des ${T.ingredientsLc} acceptée — vous pouvez démarrer la production`);
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
      notify.success('Réception refusée — le magasinier a été notifié');
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
      notify.success('Plan confirmé avec succès');
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
    // G0-25 : aucun numéro n'est fabriqué dans le navigateur. Sans lot attribué par le
    // serveur, le préfixe est vide (les gabarits impriment « — »).
    void dateStr;
    return '';
  };

  const buildLotLabelData = (item: Record<string, any>): LotLabelData | null => {
    if (!plan) return null;
    const prodTs = item.production_timestamp || item.produced_at;
    const prodDate = prodTs ? new Date(prodTs as string) : new Date(plan.plan_date as string);
    const sld = item.shelf_life_days as number;
    const dlcDate = item.expires_at ? new Date(item.expires_at as string) : sld ? new Date(prodDate.getTime() + sld * 86400000) : null;
    const planDate = new Date(plan.plan_date as string);
    // G0-25 : le numéro de lot vient du serveur (attribué à la confirmation, sous verrou).
    // Sans lui, pas d'étiquette : un numéro fabriqué ici pouvait exister en double.
    const lotNumber = item.lot_number as string | undefined;
    if (!lotNumber) return null;
    void planDate;
    // Audit P1.6 : libelle du cycle DERIVE du sale_type (source de verite),
    // pas de is_reexposable seul (qui pouvait rendre 'DLV — Conservable' sur
    // un produit sale_type='jour' non reexposable — trace physique erronee).
    const saleType = (item.sale_type as string) || 'jour';
    const cycleLabel =
      saleType === 'dlv' ? (sld ? `DLC ${sld}j` : 'Multi-jours')
      : saleType === 'commande' ? 'Sur commande'
      : 'Sans date limite';
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
  // G0-25 : sans numéro venu du serveur, l'impression est refusée avec un message clair.
  const NO_LOT_NUMBER = "Impression refusée : cet article n'a pas encore de numéro de lot. Le numéro est attribué par le serveur à la confirmation du plan.";
  const printProductionTicket = (item: Record<string, any>) => {
    if (!plan) return;
    if (!item.lot_number) { notify.error(NO_LOT_NUMBER); return; }
    setPrintHtml(buildTicketHtml(plan, item, settings, printTpl?.production_ticket));
  };
  const printBonSortieIngredients = () => {
    if (!plan) return;
    const bonNumber = activeBon?.numero as string | undefined;
    if (!bonNumber) {
      notify.error("Impression refusée : ce plan n'a pas encore de bon de sortie. Générez le bon de sortie, son numéro est attribué par le serveur.");
      return;
    }
    setPrintHtml(buildBsiHtml(plan, needs, settings, getPlanLotPrefix(), bonNumber, shiftOf(new Date(), policies.num('production.shift_cutoff', 'hour')), printTpl?.production_bon_sortie));
  };
  const printFicheProduction = (planData?: Record<string, any>) => {
    const p = planData || plan;
    if (!p) return;
    const allPrintItems = (p.items || []) as Record<string, any>[];
    const planItems = allowedSlugs
      ? allPrintItems.filter((it) => allowedSlugs.includes(it.category_slug as string))
      : allPrintItems;
    setPrintHtml(buildFicheHtml(p, planItems, settings, getPlanLotPrefix(p), printTpl?.production_fiche));
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
    mutationFn: (arg: string[] | { itemIds: string[]; waiveMissing: boolean }) => Array.isArray(arg)
      ? productionApi.restoreItems(id!, arg)
      : productionApi.restoreItems(id!, arg.itemIds, arg.waiveMissing),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production', id] });
      queryClient.invalidateQueries({ queryKey: ['bon-sortie'] });
      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => notify(w, { icon: '\u26a0\ufe0f', duration: 5000 }));
      } else {
        notify.success('Article(s) restauré(s) avec succès');
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
      notify.success('Demande envoyée au responsable stock');
      setRestockNeed(null);
    },
    onError: (error: any) => {
      notify.error(apiErrorMessage(error, 'Erreur lors de la demande'));
    },
  });

  // ═══ Bon de sortie mutations ═══
  // Start item: pending → in_progress
  // Produits de l'atelier du plan (catégories rattachées, mig 511).
  const allowedSlugs = plan?.is_semi_finished_plan || plan?.order_id
    ? null
    : ws.slugsOf(plan?.target_role as string | null);

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
  const listLabel = sectorLabel('production_plans', 'Plans de production');
  const crumbs = (current?: string) => (
    <div className="odoo-control-bar">
      <button type="button" onClick={() => navigate('/production')} className="ds-icon-btn" title={`Retour aux ${listLabel.toLowerCase()}`} aria-label={`Retour aux ${listLabel.toLowerCase()}`}>
        <ArrowLeft size={16} aria-hidden="true" />
      </button>
      <Breadcrumb icon={Factory} items={[
        { label: sectorLabel('production', 'Production') },
        { label: listLabel, onClick: () => navigate('/production') },
        ...(current ? [{ label: current }] : []),
      ]} />
    </div>
  );

  if (isLoading) return (
    <div className="odoo-scope pd">{crumbs()}<div className="pd-page">
      <LoadingState label="Chargement du plan…" />
    </div></div>
  );

  if (!plan) return (
    <div className="odoo-scope pd">{crumbs()}<div className="pd-page">
      {isError
        ? <ErrorState error={error} title="Le plan n'a pas pu être chargé" onRetry={() => refetch()} />
        : <EmptyState icon={PackageOpen} title="Plan introuvable" text="Il a peut-être été supprimé."
            action={<button type="button" onClick={() => navigate('/production')} className="odoo-btn-secondary"><ArrowLeft size={14} aria-hidden="true" /> Retour aux plans</button>} />}
    </div></div>
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

  const rc = plan.target_role ? { label: (plan.target_role_label as string) || ws.label(plan.target_role as string) } : null;

  // Progress stats
  const producedCount = items.filter((it: Record<string, any>) => it.status === 'produced' || it.status === 'transferred' || it.status === 'received').length;
  const cancelledCount = items.filter((it: Record<string, any>) => it.status === 'cancelled').length;
  const waitingCount = items.filter((it: Record<string, any>) => it.waiting_status === 'waiting').length;
  const totalActive = items.length - cancelledCount;
  const progressPct = totalActive > 0 ? Math.round((producedCount / totalActive) * 100) : 0;

  // Gating des onglets :
  //   - Plan semi-fini : tout est affiche (UI dediee, pas de tabs)
  //   - Plan en 'draft' : tout est affiche (pas encore de workflow BSI/production)
  //   - Sinon : sections filtrees par planTab
  //   - Production n'existe que si preparationDone, Couts qu'une fois la production
  //     demarree : un onglet devenu invisible (ex. relance) retombe sur la synthese.
  const hasTabs = !isSemiFini && plan.status !== 'draft';
  const productionTabVisible = hasTabs && preparationDone;
  const costsTabVisible = hasTabs && hasResults;
  const effectiveTab: PlanTab = (planTab === 'production' && !productionTabVisible) || (planTab === 'couts' && !costsTabVisible)
    ? 'synthese' : planTab;
  const showSynth = hasTabs && effectiveTab === 'synthese';
  const showIngr = !hasTabs || effectiveTab === 'ingredients';
  const showProd = !hasTabs || effectiveTab === 'production';
  const showCosts = !hasTabs || effectiveTab === 'couts';
  // Aucun BSI generable : aucun besoin ingredient (produits sans recette) ou generate()
  // a repondu "rien a prelever". Ne debloque PAS la production : la preparation reste
  // bloquee tant que les besoins ne sont pas recalcules (recette + relance du plan).
  const bonNotNeeded = !isSemiFini && plan.status !== 'draft' && !activeBon && (noIngredientNeeds || !!bonNotNeededReason);
  const panelCtx = { summary, hidden: screenHidden, definition: planScreenDefinition, warnings: (plan.warnings as string[] | undefined) ?? [], needsCount: needs.length, bonNotNeeded, hasTabs, recipeLc: T.recipeLc, plan, id: id!, isChef, items, productionSettings, hasFeature, isMagasinier, isSemiFini: !!isSemiFini, activeBon: !!activeBon, lotUsage: productionLotUsage as Record<string, any>[] };

  // Bloc Besoins en ingredients extrait en JSX pour pouvoir le placer au-dessus de
  // l'apercu FEFO (demande UX : besoins en haut, FEFO en bas dans le sous-onglet "Besoins").
  // Option B : visible des deux cotes, mais le chef voit UNIQUEMENT la liste des
  // ingredients + qty necessaire (pas de DISPO, pas de "insuffisant", pas de
  // "Demander au stock" / "Restaurer & relancer"). La gestion stock est au magasinier.
  // Une fois le bon de sortie genere, c'est lui la liste des ingredients (demande,
  // pese, ecart, lot) : la table des besoins ne reste que pour le magasinier quand
  // il manque du stock (bouton « Demander »).
  const ingredientNeedsBlock = (showIngr && plan.status !== 'draft' && needs.length > 0
    && (!activeBon || (isMagasinier && insufficientNeeds.length > 0))) ? (
    <div className="ds-panel pd-section">
      <div className="pd-section-head">
        <Beaker size={12} /> {isMagasinier ? `Besoins en ${sectorLabel('ingredients', 'Ingrédients').toLowerCase()}` : `${sectorLabel('ingredients', 'Ingrédients')} nécessaires`}
        <span style={{ marginLeft: 4, color: 'var(--ds-muted)', fontWeight: 400 }}>{needs.length} {T.ingredientLc}(s)</span>
        {isMagasinier && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            {insufficientNeeds.length > 0 && (
              <StatusTag tone="blocked" label={`${insufficientNeeds.length} insuffisant(s)`} />
            )}
            {(() => {
              const waiting = (plan.items as Record<string, any>[] || [])
                .filter(it => it.waiting_status === 'waiting');
              if (waiting.length === 0) return null;
              return (
                <button onClick={() => restoreMutation.mutate(waiting.map(it => it.id as string))}
                  disabled={restoreMutation.isPending} className="odoo-btn-primary ds-btn-sm"
                  title="Re-vérifier la dispo et relancer les articles en attente.">
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
            <th>{T.ingredient}</th>
            {isMagasinier && <th>Disponibilité</th>}
            <th className="ds-num">Besoin</th>
            {isMagasinier && <th className="ds-num">Dispo</th>}
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
                    <div style={{ width: 80, height: 4, backgroundColor: 'var(--ds-sep)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        backgroundColor: sufficient ? 'var(--ds-success)' : 'var(--ds-danger)',
                      }} />
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--ds-muted)' }}>{pct}%</span>
                  </td>
                )}
                <td className="ds-num">
                  {(() => {
                    const f = smartFormatQuantity(needed, need.unit as string);
                    const digits = f.unit === 'g' || f.unit === 'ml' ? 0 : 2;
                    return <>
                      <span style={{ fontWeight: 600 }}>{f.value.toFixed(digits)}</span>
                      <span style={{ color: 'var(--ds-muted)', fontSize: '12px', marginLeft: 2 }}>{f.unit}</span>
                    </>;
                  })()}
                </td>
                {isMagasinier && (
                  <td className="ds-num">
                    {(() => {
                      const f = smartFormatQuantity(available, need.unit as string);
                      const digits = f.unit === 'g' || f.unit === 'ml' ? 0 : 2;
                      return <>
                        <span style={{ fontWeight: 500 }}>{f.value.toFixed(digits)}</span>
                        <span style={{ color: 'var(--ds-muted)', fontSize: '12px', marginLeft: 2 }}>{f.unit}</span>
                      </>;
                    })()}
                  </td>
                )}
                {isMagasinier && (
                  <td>
                    {sufficient ? (
                      <StatusTag tone="done" label="OK" />
                    ) : (
                      <StatusTag tone="blocked" label={`-${(needed - available).toFixed(2)}`} />
                    )}
                  </td>
                )}
                {isMagasinier && (
                  <td className="ds-num">
                    {!sufficient && (
                      requestedVerifications.has(need.ingredient_id as string) ? (
                        <StatusTag tone="progress" icon={Send} label="Envoyée" title="Demande envoyée" />
                      ) : (
                        <button onClick={() => setRestockNeed(need)} className="odoo-btn-primary ds-btn-sm"
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
      <div className="ds-panel pd-section">
        <div className="pd-section-head">
          <Beaker size={12} /> Semi-finis requis
          <span style={{ marginLeft: 4 }}>
            <StatusTag tone={allFulfilled ? 'done' : 'progress'} label={`${fulfilledCount} / ${totalDeps}`} />
          </span>
          {!allFulfilled && (
            <span style={{ marginLeft: 'auto' }}>
              <StatusTag tone="blocked" icon={Lock} label="Production bloquée" />
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Semi-fini</th>
                <th className="ds-num">Besoin</th>
                <th className="ds-num">En stock</th>
                <th className="ds-num">À produire</th>
                <th>Avancement</th>
                <th>{sectorLabel('production_plan', 'Plan de production')}</th>
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
                    <td className="ds-num">{needed.toFixed(1)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: fromStock > 0 ? 'var(--ds-success)' : 'var(--ds-muted)' }}>
                      {fromStock > 0 ? fromStock.toFixed(1) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: toProduce > 0 ? 'var(--ds-warning)' : 'var(--ds-muted)' }}>
                      {toProduce > 0 ? toProduce.toFixed(1) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 80, height: 4, backgroundColor: 'var(--ds-sep)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${itemPct}%`, backgroundColor: isFulfilled ? 'var(--ds-success)' : 'var(--ds-accent)' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{itemPct}%</span>
                      </div>
                    </td>
                    <td>{depPlanTag ? <StatusTag tone={depPlanTag.tone} icon={depPlanTag.icon} label={depPlanTag.label} /> : <span style={{ color: 'var(--ds-sep)' }}>—</span>}</td>
                    <td>
                      <StatusTag tone={isFulfilled ? 'done' : 'todo'} label={isFulfilled ? 'Disponible' : 'En attente'} />
                    </td>
                    <td className="ds-num">
                      {depPlanId && (
                        <button type="button" onClick={() => navigate(`/production/${depPlanId}`)} className="odoo-btn-secondary ds-btn-sm">
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
          <div className="odoo-alert danger" style={{ borderBottom: 'none', borderTop: '1px solid color-mix(in srgb, var(--ds-danger) 25%, var(--ds-card))' }}>
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
    <div className="ds-panel pd-section">
      <div className="pd-section-head">
        <Layers size={12} /> Articles du plan
        <span style={{ marginLeft: 4, color: 'var(--ds-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{items.length} article(s)</span>
        {plan.status === 'in_progress' && totalActive > 0 && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0 }}>
            <div style={{ width: 100, height: 4, backgroundColor: 'var(--ds-sep)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, backgroundColor: progressPct >= 100 ? 'var(--ds-success)' : 'var(--ds-accent)', transition: 'width 0.3s' }} />
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
              <th className="ds-num">Qté</th>
              <th className="ds-num">Fait</th>
              <th>N° lot</th>
              <th>Date de production</th>
              <th>Produit par</th>
              {hasFeature('dlc_ddm') && <th>DLC</th>}
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
              const lotNumber = (item.lot_number as string) || '';
              const planned = item.planned_quantity as number;
              const actual = item.actual_quantity as number | null;
              const saleType = (item.sale_type as string) || 'jour';

              const statusTag: { tone: StatusTone; label: string; icon?: LucideIcon } = itemStatus === 'produced' ? { tone: 'done', label: 'Produit' }
                : itemStatus === 'transferred' ? { tone: 'done', label: 'Transféré', icon: Truck }
                : itemStatus === 'received' ? { tone: 'done', label: 'Reçu', icon: Package }
                : isInProgress ? { tone: 'progress', label: 'En cours', icon: ChefHat }
                : isCancelled ? { tone: 'cancelled', label: 'Annulé' }
                : isWaiting ? { tone: 'todo', label: 'En attente' }
                : { tone: 'todo', label: 'À faire' };
              const dot = isProduced ? 'ok' : isInProgress ? 'warning' : isCancelled ? 'danger' : 'neutral';
              const empty = <span style={{ color: 'var(--ds-sep)' }}>—</span>;

              return (
                <tr key={item.id as string} className={isInProgress ? 'row-warning' : ''} style={{ cursor: 'default', opacity: isCancelled ? 0.5 : 1 }}>
                  <td><span className={`odoo-status-dot ${dot}`} /></td>
                  <td>
                    <span style={{ fontWeight: 600, textDecoration: isCancelled ? 'line-through' : undefined }}>{item.product_name as string}</span>
                    {Number(item.alt_recipe_count) > 0 && (
                      <div><ItemRecipeSelect planId={plan.id as string} itemId={item.id as string} productId={item.product_id as string}
                        value={(item.alt_recipe_id as string) ?? null} editable={plan.status === 'draft'} /></div>
                    )}
                    {item.bom_version_no != null && (
                      <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}
                        title={item.bom_active_version_no && item.bom_active_version_no !== item.bom_version_no ? `Version ${item.bom_active_version_no} active depuis : cet ordre garde sa version` : 'Version de la fiche figée sur l\'ordre'}>
                        v{item.bom_version_no as number}{item.bom_active_version_no && item.bom_active_version_no !== item.bom_version_no ? ` · v${item.bom_active_version_no} disponible` : ''}
                      </span>
                    )}
                    {item.line_order_number && (
                      <div style={{ marginTop: 3 }}>
                        <a href={`/orders/${item.line_order_id as string}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${item.line_order_id as string}`); }}
                          className="odoo-tag odoo-tag-blue" title="Ligne de commande servie par cette ligne d'ordre"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                          <ShoppingBag size={10} aria-hidden /> {item.line_order_number as string}
                          {item.line_order_customer ? ` · ${item.line_order_customer as string}` : ''}
                          {item.line_order_quantity ? ` · ${parseFloat(String(item.line_order_quantity))} cmd.` : ''}
                        </a>
                      </div>
                    )}
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
                        <span className="odoo-tag odoo-tag-grey"><Layers size={9} /> {item.nb_contenants as number}× {(item.contenant_nom || item.format_nom) as string || T.batchLc}</span>
                        {/* Mig 662 : quantité arrondie à la fournée — demande d'origine et excédent prévu. */}
                        {item.requested_quantity != null && (
                          <span className="odoo-tag odoo-tag-orange" title={`La quantité demandée a été arrondie au nombre entier de ${T.batchesLc} supérieur`}>
                            Demandé {parseFloat(String(item.requested_quantity))} · excédent +{Math.round((parseFloat(String(item.planned_quantity)) - parseFloat(String(item.requested_quantity))) * 1000) / 1000}
                          </span>
                        )}
                        {(item.qty_from_frigo as number) > 0 && (
                          <span className="odoo-tag odoo-tag-blue"><Flame size={9} /> Frigo −{item.qty_from_frigo as number}</span>
                        )}
                        {(item.surplus_frigo as number) > 0 && (
                          <span className="odoo-tag odoo-tag-orange"><Package size={9} /> Surplus +{item.surplus_frigo as number}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="ds-num">
                    <strong>{planned}</strong>
                    {item.quantite_brute_totale && (item.quantite_brute_totale as number) !== planned && (
                      <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }} title="Quantité brute totale (formats)">brut {item.quantite_brute_totale as number}</div>
                    )}
                  </td>
                  <td className="ds-num">
                    {actual != null ? <strong style={{ color: actual >= planned ? 'var(--ds-success)' : 'var(--ds-warning)' }}>{actual}</strong> : empty}
                  </td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{(isProduced || isInProgress) && lotNumber ? lotNumber : empty}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--ds-muted)' }}>
                    {isProduced && prodTimestamp ? format(prodDate, 'dd/MM/yy HH:mm') : isInProgress && startTs ? format(new Date(startTs), 'dd/MM/yy HH:mm') : empty}
                  </td>
                  <td style={{ color: 'var(--ds-muted)' }}>{isProduced && producedBy ? producedBy : isInProgress && startedBy ? startedBy : empty}</td>
                  {hasFeature('dlc_ddm') && <td style={{ whiteSpace: 'nowrap' }}>
                    {isProduced && dlcDate
                      ? (dlcDate <= now ? <StatusTag tone="late" label="Expiré" /> : <span style={{ color: 'var(--ds-muted)' }}>{format(dlcDate, 'dd/MM/yyyy')}</span>)
                      : empty}
                  </td>}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isProduced ? (
                      saleType === 'dlv' ? <span className="odoo-tag odoo-tag-green">Multi-jours (DLC)</span>
                      : saleType === 'commande' ? <span className="odoo-tag odoo-tag-blue">Sur commande</span>
                      : <span className="odoo-tag odoo-tag-orange">Sans date limite</span>
                    ) : empty}
                  </td>
                  <td><StatusTag tone={statusTag.tone} icon={statusTag.icon} label={statusTag.label} /></td>
                  <td className="ds-num">
                    {plan.status === 'in_progress' && isChef && itemStatus === 'pending' && !isWaiting ? (
                      <button type="button" onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="odoo-btn-primary">
                        <Play size={12} /> Lancer
                      </button>
                    ) : plan.status === 'in_progress' && isChef && isInProgress ? (
                      <button type="button" onClick={() => { setLaunchTargetItemId(item.id as string); setShowProductionLaunch(true); }} className="odoo-btn-primary">
                        <Play size={12} /> Continuer
                      </button>
                    ) : isProduced ? (
                      <button type="button" onClick={() => { if (!item.lot_number) { notify.error(NO_LOT_NUMBER); return; } setPrintChoiceItem(item); }} className="odoo-btn-secondary" title="Imprimer le ticket">
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

  // ══ Actions de la fiche, rendues dans l'en-tete ══
  // Une seule action principale visible (l'etape suivante du plan), plus les gestes
  // de production frequents ; tout le reste (impressions, relance, brouillon, perte)
  // est range dans le menu « Plus ». Chef uniquement.
  const deps = (plan.dependencies || []) as Record<string, any>[];
  const hasPendingDeps = deps.some(d => d.status !== 'fulfilled' && d.status !== 'cancelled');
  const pendingItems = items.filter((it: Record<string, any>) => it.status === 'pending' && it.waiting_status !== 'waiting');
  const inProgressItems = items.filter((it: Record<string, any>) => it.status === 'in_progress');
  const allProduced = pendingItems.length === 0 && inProgressItems.length === 0
    && items.some((it: Record<string, any>) => ['produced', 'transferred', 'received'].includes(it.status as string));
  // Articles produits dont le rendement n'est pas encore saisi.
  const recordedItemIds = new Set((rendements as Record<string, any>[]).map(r => r.plan_item_id as string));
  const rendementsMissing = items.filter((it: Record<string, any>) =>
    ['produced', 'transferred', 'received'].includes(it.status as string) && !recordedItemIds.has(it.id as string));

  const goToRendement = () => {
    setPlanTab('production');
    setTimeout(() => document.getElementById('plan-rendement')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const launchAll = async () => {
    const ids = pendingItems.map((it: Record<string, any>) => it.id as string);
    try {
      await productionApi.startItems(id!, ids);
      await queryClient.invalidateQueries({ queryKey: ['production', id] });
      notify.success(`${ids.length} production(s) lancee(s)`);
    } catch (e: any) { notify.error(apiErrorMessage(e, 'Erreur')); }
  };

  const closePartial = async () => {
    if (await confirmDialog(`${waitingCount} article(s) en attente seront annulés.`, { title: 'Clôture partielle', confirmLabel: 'Clôturer', danger: true })) {
      productionApi.complete(id!, [], 'partial').then(() => {
        queryClient.invalidateQueries({ queryKey: ['production', id] });
        notify.success('Plan cloture partiellement');
      }).catch((err: any) => notify.error(apiErrorMessage(err, 'Erreur')));
    }
  };

  // Demarrage : bloque tant que les semi-finis sont en attente ou que le BSI n'est
  // pas cloture (les plans semi-finis sont exemptes : leur BSI est celui du parent).
  const canShowStart = ['confirmed', 'awaiting_ingredients', 'ready_to_produce'].includes(plan.status)
    && (isSemiFini || bsiCloture);

  const primaryActions = isChef ? (
    <>
      {plan.status === 'draft' && (
        <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending} className="odoo-btn-primary">
          {confirmMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
          {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer le plan'}
        </button>
      )}
      {canShowStart && (
        <button onClick={() => startMutation.mutate()} disabled={startMutation.isPending || hasPendingDeps}
          title={hasPendingDeps ? 'Semi-finis en attente — production impossible' : undefined} className="odoo-btn-primary">
          {hasPendingDeps ? <Lock size={13} /> : startMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {hasPendingDeps ? 'Semi-finis en attente' : startMutation.isPending ? 'Demarrage...' : 'Demarrer la production'}
        </button>
      )}
      {plan.status === 'in_progress' && (
        <>
          {waitingCount > 0 && allProduced && (
            <button onClick={closePartial} className="odoo-btn-secondary">
              <CheckCircle size={13} /> Cloture partielle
            </button>
          )}
          {pendingItems.length > 0 && (
            <button onClick={launchAll} className={inProgressItems.length > 0 ? 'odoo-btn-secondary' : 'odoo-btn-primary'}>
              <Play size={13} /> Lancer tout ({pendingItems.length})
            </button>
          )}
          {inProgressItems.length > 0 && (
            <button onClick={() => { setLaunchTargetItemId(null); setShowProductionLaunch(true); }} className="odoo-btn-primary">
              <Factory size={13} /> Enregistrer tout ({inProgressItems.length})
            </button>
          )}
          {/* Le rendement ne se saisit que pendant la production (RendementPanel) :
              apres cloture, la saisie pousserait du stock au frigo a posteriori. */}
          {rendementsMissing.length > 0 && !isSemiFini && (
            <button onClick={goToRendement} className={pendingItems.length + inProgressItems.length > 0 ? 'odoo-btn-secondary' : 'odoo-btn-primary'}>
              <Scale size={13} /> Saisir le rendement{rendementsMissing.length > 1 ? ` (${rendementsMissing.length})` : ''}
            </button>
          )}
        </>
      )}
      {plan.status === 'completed' && docOn('fiche_suivi') && (
        <button onClick={() => printFicheProduction()} className="odoo-btn-secondary">
          <Printer size={13} /> Fiche de production
        </button>
      )}
      {['in_progress', 'completed'].includes(plan.status as string) && (
        <button onClick={() => { productionApi.batchRecord(plan.id as string).then(d => setPrintHtml(buildBatchRecordHtml(d, settings))).catch(e => notify.error(apiErrorMessage(e))); }} className="odoo-btn-secondary">
          <Printer size={13} /> Dossier de lot
        </button>
      )}
    </>
  ) : null;

  // Menu « Plus » : chaque entree garde ses gardes (disabled + motif en infobulle).
  type MenuItem = { key: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean; sep?: boolean };
  const menuItems: MenuItem[] = [];
  if (['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(plan.status) && !isSemiFini && docOn('bon_sortie')) {
    menuItems.push({ key: 'bsi', label: sectorLabel('doc_bon_sortie', 'Bon de sortie ingrédients'), icon: <Printer size={13} />, onClick: () => printBonSortieIngredients() });
  }
  // Repasse en brouillon : le serveur ne l'accepte que pour un plan au statut « confirmé »
  // (et vérifie qu'aucun article n'a démarré ni le bon de sortie été prélevé). Le menu ne
  // propose donc l'action que dans ce cas, au lieu d'un clic voué à l'erreur.
  if (isChef && plan.status === 'confirmed') {
    const anyStarted = items.some((it: Record<string, any>) => it.status === 'in_progress' || it.status === 'produced');
    const bsiActive = !!activeBon && ['prelevement', 'verifie', 'cloture'].includes(activeBon.status as string);
    menuItems.push({
      key: 'revert', sep: menuItems.length > 0,
      label: revertMutation.isPending ? 'Repasse...' : 'Modifier (revenir en brouillon)',
      icon: <ArrowLeft size={13} />,
      disabled: revertMutation.isPending || anyStarted || bsiActive,
      title: anyStarted
        ? 'Au moins un produit a deja demarre — annulez d\'abord les items en cours'
        : bsiActive ? 'Le bon de sortie a deja ete preleve — annulez d\'abord le BSI' : 'Repasser en brouillon pour modifier le plan',
      onClick: async () => {
        if (await confirmDialog(`Le bon de sortie sera annulé et les besoins en ${T.ingredientsLc} recalculés à la prochaine confirmation.`, { title: 'Repasser le plan en brouillon ?', confirmLabel: 'Repasser en brouillon' })) {
          revertMutation.mutate();
        }
      },
    });
  }
  // Relancer le plan : tout plan non brouillon, sans creer de nouveau plan.
  //   - articles annules / en attente -> ils repassent en 'pending'
  //   - plan confirme sur un referentiel incomplet -> besoins et BSI recalcules
  // Le recalcul n'est possible que tant que la preparation n'est pas engagee.
  if (isChef && plan.status !== 'draft') {
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
      canRecompute ? `• besoins en ${T.ingredientsLc} et bon de sortie recalculés depuis les ${T.recipesLc} actuelles` : null,
    ].filter(Boolean).join('\n');
    menuItems.push({
      key: 'relaunch', sep: menuItems.length > 0 && !menuItems.some(m => m.key === 'revert'),
      label: relaunchMutation.isPending ? 'Relance...' : total > 0 ? `Relancer le plan (${total})` : 'Relancer le plan',
      icon: <RotateCcw size={13} />,
      disabled: relaunchMutation.isPending || nothingToDo,
      title: nothingToDo
        ? 'Rien a relancer : aucun article annule ou en attente, et la preparation est deja engagee'
        : 'Debloquer ce plan : reactiver les articles annules et recalculer besoins + bon de sortie',
      onClick: async () => {
        if (await confirmDialog(`${lignes}\n\nAucun nouveau plan n'est créé.`, { title: 'Relancer le plan ?', confirmLabel: 'Relancer' })) {
          relaunchMutation.mutate();
        }
      },
    });
  }
  // Perte de production (brule, rate, panne, matiere defectueuse) : tracee par productionPlanId.
  if (isChef && ['in_progress', 'completed'].includes(plan.status) && !isSemiFini) {
    menuItems.push({ key: 'loss', sep: menuItems.length > 0, danger: true, label: 'Déclarer une perte', icon: <Trash2 size={13} />, onClick: () => setShowLossModal(true) });
  }

  // Menu « Plus » : menu commun (séparateurs, infobulles des actions désactivées).
  const moreMenu = menuItems.length > 0 ? (
    <RowMenu label="Plus d'actions sur le plan" trigger="Plus"
      items={menuItems.map(m => ({ label: m.label, iconNode: m.icon, onSelect: m.onClick, danger: m.danger, disabled: m.disabled, title: m.title, separator: m.sep }))} />
  ) : null;

  const planStatusBadge = plan.status === 'completed' && plan.completion_type === 'partial'
    ? 'Terminé (partiel)'
    : plan.status === 'completed' && plan.completion_type === 'complete'
    ? 'Terminé (complet)'
    : PRODUCTION_STATUS_LABELS[plan.status as keyof typeof PRODUCTION_STATUS_LABELS];
  const planTag = planStatusTag(plan.status);

  // ══ Indicateurs de l'en-tete, choisis selon l'etat du plan ══
  //   avant production : quoi produire et ou en est la preparation
  //   en production    : avancement
  //   termine          : resultat (quantite, rendement, cout, pertes)
  const num = (v: unknown) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(x) ? x : 0; };
  const fmtDh = (v: number) => money(v);
  // M8-05 : chiffres calculés au serveur (GET /production/:id/summary) ; l'écran les affiche.
  const qtyPlanned = summary?.quantities.planned ?? 0;
  const qtyDone = summary?.quantities.done ?? 0;
  const bsiTag = activeBon ? bonStatusTag(activeBon.status as string) : null;
  const depsFulfilled = deps.filter(d => d.status === 'fulfilled').length;
  const recordedYields = summary?.yield.recorded ?? 0;
  const avgRendement = summary?.yield.average ?? null;
  const minSeuil = summary?.yield.threshold ?? null;
  const pertesTotal = summary?.yield.lossesTotal ?? 0;
  const coutTotal = summary?.cost.total ?? null;
  const coutUnitaire = summary?.cost.perUnit ?? null;
  const ecartPct = summary?.cost.variancePct ?? null;
  const ecartLabel = ecartPct != null
    ? `${ecartPct > 0 ? '+' : ''}${ecartPct.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % vs prévu` : null;
  type Kpi = { label: string; icon: React.ReactNode; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad'; bar?: number };
  const kpis: Kpi[] = plan.status === 'in_progress' ? [
    { label: 'Avancement', icon: <TrendingUp size={11} />, value: `${producedCount} / ${totalActive}`, sub: `${progressPct} % des articles`, tone: progressPct >= 100 ? 'ok' : undefined, bar: progressPct },
    { label: 'Pièces produites', icon: <CheckCircle2 size={11} />, value: String(qtyDone), sub: `sur ${qtyPlanned} prévue${qtyPlanned > 1 ? 's' : ''}` },
    { label: 'Liste d\'attente', icon: <Clock size={11} />, value: String(waitingCount), sub: waitingCount > 0 ? 'stock insuffisant' : 'aucun article', tone: waitingCount > 0 ? 'warn' : undefined },
    { label: T.ingredients, icon: <Layers size={11} />, value: bsiTag?.label || '—', sub: activeBon ? (activeBon.numero as string) : undefined, tone: bsiCloture ? 'ok' : undefined },
  ] : plan.status === 'completed' ? (() => {
    const pct = summary?.quantities.donePct ?? 0;
    return [
      { label: 'Produit', icon: <CheckCircle2 size={11} />, value: `${qtyDone} / ${qtyPlanned}`, sub: `${pct} % du prévu`, tone: pct >= 100 ? 'ok' : 'warn' },
      avgRendement != null
        ? { label: 'Rendement', icon: <Scale size={11} />, value: `${avgRendement.toFixed(1)} %`,
            sub: rendementsMissing.length > 0 ? `${rendementsMissing.length} article(s) non saisi(s)` : minSeuil === null ? '' : `seuil ${minSeuil} %`,
            tone: rendementsMissing.length > 0 || summary?.yield.belowThreshold ? 'warn' : 'ok' }
        : { label: 'Rendement', icon: <Scale size={11} />, value: isSemiFini ? '—' : 'Non saisi', sub: isSemiFini ? undefined : 'pas saisi pendant la production', tone: isSemiFini ? undefined : 'warn' },
      coutTotal != null
        ? { label: 'Coût réel', icon: <Coins size={11} />, value: fmtDh(coutTotal),
            sub: [coutUnitaire != null ? `${fmtDh(coutUnitaire)} / pièce` : null, ecartLabel].filter(Boolean).join(' · '),
            tone: ecartPct != null && ecartPct > 5 ? 'warn' : undefined }
        : { label: 'Coût réel', icon: <Coins size={11} />, value: 'Non calculé', sub: 'voir l\'onglet Coûts' },
      { label: 'Pertes', icon: <Trash2 size={11} />, value: recordedYields > 0 ? String(pertesTotal) : '—',
        sub: recordedYields > 0 ? 'relevées au rendement' : 'rendement non saisi', tone: pertesTotal > 0 ? 'warn' : recordedYields > 0 ? 'ok' : undefined },
    ] as Kpi[];
  })() : [
    { label: 'Quantité prévue', icon: <Package size={11} />, value: String(qtyPlanned), sub: `${items.length} article${items.length > 1 ? 's' : ''}` },
    { label: T.ingredients, icon: <Layers size={11} />, value: String(needs.length),
      sub: isMagasinier && insufficientNeeds.length > 0 ? `${insufficientNeeds.length} insuffisant(s)` : 'à prélever',
      tone: isMagasinier && insufficientNeeds.length > 0 ? 'bad' : undefined },
    { label: 'Bon de sortie', icon: <Truck size={11} />,
      value: bsiTag?.label || (plan.status === 'draft' ? 'À la confirmation' : bonNotNeeded ? 'Aucun besoin' : 'En génération'),
      sub: activeBon ? (activeBon.numero as string) : undefined, tone: bsiCloture ? 'ok' : bonNotNeeded ? 'bad' : undefined },
    { label: 'Semi-finis', icon: <Beaker size={11} />, value: deps.length > 0 ? `${depsFulfilled} / ${deps.length}` : 'Aucun',
      sub: deps.length > 0 ? (hasPendingDeps ? 'en attente' : 'disponibles') : 'requis', tone: deps.length > 0 ? (hasPendingDeps ? 'warn' : 'ok') : undefined },
  ];
  const kpiColor = { ok: 'var(--prj-green)', warn: 'var(--prj-orange)', bad: 'var(--prj-red)' };

  // ══ Synthese : ce qui reste a faire (dans l'ordre du processus) ══
  // Le bandeau de reception des ingredients (BSI « pret ») est global et n'est pas repete ici.
  type Todo = { tone: 'info' | 'warning' | 'success' | 'danger'; icon: typeof CheckCircle; title: string; text?: string; action?: React.ReactNode };
  const todos: Todo[] = [];
  if (bonNotNeeded || (plan.status !== 'draft' && !isSemiFini && needs.length === 0)) {
    todos.push({ tone: 'danger', icon: AlertTriangle, title: `Préparation bloquée : aucun besoin en ${T.ingredientsLc} calculé`,
      text: `Ajoutez une ${T.recipeLc} aux produits concernés, puis « Relancer » (menu Plus) pour recalculer les besoins.` });
  } else if (['confirmed', 'awaiting_ingredients'].includes(plan.status) && activeBon && !['pret', 'cloture'].includes(activeBon.status as string)) {
    todos.push({ tone: 'info', icon: Truck, title: `Préparation des ${T.ingredientsLc} par le magasinier — ${bsiTag?.label}`,
      text: `Bon de sortie ${activeBon.numero as string}. Vous serez notifié quand la préparation sera prête.`,
      action: <button className="odoo-btn-secondary" onClick={() => setPlanTab('ingredients')}><Eye size={13} /> Voir le bon</button> });
  }
  if (canShowStart && hasPendingDeps) {
    todos.push({ tone: 'warning', icon: Lock, title: `Semi-finis en attente (${depsFulfilled} / ${deps.length})`,
      text: 'La production ne peut pas démarrer tant que les semi-finis ne sont pas disponibles.' });
  } else if (canShowStart && isChef) {
    todos.push({ tone: 'success', icon: Play, title: `${T.ingredients} — livraison reçue, la production peut démarrer`,
      action: <button className="odoo-btn-primary" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}><Play size={13} /> Démarrer la production</button> });
  }
  if (plan.status === 'in_progress' && !isSemiFini && rendementsMissing.length > 0) {
    todos.push({ tone: 'warning', icon: Scale, title: `Rendement à saisir pour ${rendementsMissing.length} article(s) produit(s)`,
      text: 'À saisir avant la clôture du plan : il n\'est plus modifiable ensuite.',
      action: isChef ? <button className="odoo-btn-primary" onClick={goToRendement}><Scale size={13} /> Saisir le rendement</button> : undefined });
  }
  if (plan.status === 'in_progress') {
    const left = totalActive - producedCount;
    todos.push({ tone: 'info', icon: Factory, title: left > 0 ? `${left} article(s) restent à produire` : 'Tous les articles sont produits',
      text: waitingCount > 0 ? `${waitingCount} article(s) en liste d'attente (stock insuffisant).` : undefined,
      action: <button className="odoo-btn-secondary" onClick={() => setPlanTab('production')}><Factory size={13} /> Ouvrir la production</button> });
  }
  if (plan.status === 'completed' && !isSemiFini && rendementsMissing.length > 0) {
    todos.push({ tone: 'info', icon: Scale, title: `Rendement non saisi pour ${rendementsMissing.length} article(s)`,
      text: `${rendementsMissing.map((it: Record<string, any>) => it.product_name as string).join(', ')} : le rendement n'a pas été saisi pendant la production, les pertes de ce plan ne sont pas connues.` });
  }
  // Audit 2026-11 C-35 : matière utilisée sans être en stock. La production est passée, le manque
  // est compté dans le coût réel au coût courant ; il reste à régulariser le stock.
  const shortfallLines = ((coutReel?.detail_matieres ?? []) as { ingredient_id: string; name: string; total: number | string }[])
    .filter(d => String(d.ingredient_id).startsWith('manque:'));
  if (shortfallLines.length > 0) {
    const total = shortfallLines.reduce((t, d) => t + num(d.total), 0);
    todos.push({ tone: 'warning', icon: AlertTriangle, title: `Production déclarée avec ${shortfallLines.length} matière(s) manquante(s) en stock`,
      text: `${shortfallLines.map(d => d.name.replace(/ \(manque de stock.*$/, '')).join(', ')} : ${fmtDh(total)} comptés dans le coût réel au coût courant. Stock à régulariser dans Stock › Anomalies.`,
      action: <button className="odoo-btn-secondary" onClick={() => setPlanTab('couts')}><Coins size={13} /> Ouvrir les coûts</button> });
  }
  if (plan.status === 'completed' && coutTotal == null) {
    todos.push({ tone: 'warning', icon: Coins, title: 'Coût réel non calculé',
      action: <button className="odoo-btn-secondary" onClick={() => setPlanTab('couts')}><Coins size={13} /> Ouvrir les coûts</button> });
  }
  if (plan.status === 'completed' && !todos.some(t => t.tone === 'warning' || t.tone === 'danger')) {
    todos.push({ tone: 'success', icon: CheckCircle, title: 'Plan clôturé — rien à faire',
      text: plan.completion_type === 'partial' ? 'Clôture partielle : les articles en attente ont été annulés.' : undefined });
  }
  const lotUsage = productionLotUsage as Record<string, any>[];
  const nearestDlc = lotUsage
    .map(u => (u.expiration_date ? new Date(u.expiration_date as string) : null))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <div className="odoo-scope pd">
      {/* ══════════════ BARRE : retour + fil d'Ariane jusqu'au numéro du plan ══════════════ */}
      {crumbs((plan.of_number as string) || (plan.id as string).slice(0, 8).toUpperCase())}

      <div className="pd-page">
      {/* ══════════════ EN-TETE FICHE : titre, meta, actions, processus ══════════════ */}
      <section className="prj-panel prj-hero pd-hero">
        <div className="prj-hero-top">
          <span className="prj-hero-icon">{isSemiFini ? <Beaker size={22} /> : <Factory size={22} />}</span>
          <div className="plan-header-main" style={{ minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1>Plan du {format(new Date(plan.plan_date), 'EEEE d MMMM yyyy', { locale: fr })}</h1>
              <StatusTag tone={planTag.tone} icon={planTag.icon} label={planStatusBadge || planTag.label} />
              {isSemiFini && <span className="odoo-tag odoo-tag-purple"><Beaker size={10} /> Semi-fini</span>}
              <PlanHeaderTags plan={plan} />
            </div>
            <div className="prj-hero-meta">
              {!isSemiFini && items.length > 0 && (
                <span style={{ color: 'var(--ds-ink)', fontWeight: 500 }}>
                  {items.length === 1
                    ? (items[0].product_name as string)
                    : `${items[0].product_name as string} +${items.length - 1} autre${items.length > 2 ? 's' : ''}`}
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <User size={12} /> {isSemiFini
                  ? (plan.dependency_of as Record<string, any>[])[0]?.parent_created_by_name as string || plan.created_by_name
                  : plan.created_by_name}
              </span>
              {rc && <span className="odoo-tag odoo-tag-purple"><ChefHat size={9} /> {rc.label}</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Hash size={12} /> <span style={{ fontFamily: 'ui-monospace, monospace' }}>
                  {isSemiFini
                    ? ((plan.dependency_of as Record<string, any>[])[0]?.parent_short_id as string || '').toUpperCase()
                    : (plan.id as string).slice(0, 8).toUpperCase()}
                </span>
              </span>
              {plan.type && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={12} /> {plan.type === 'daily' ? 'Quotidien' : 'Hebdomadaire'}
                </span>
              )}
              {plan.notes ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <FileText size={12} /> {plan.notes}
                </span>
              ) : null}
            </div>
          </div>
          {/* Action principale (etape suivante) + menu « Plus » : toutes les actions de
              la fiche vivent ici, quel que soit l'onglet ouvert. */}
          {(primaryActions || moreMenu) && <div className="plan-header-actions">{moreMenu}{primaryActions}</div>}
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
            ...(isSemiFini ? [] : [{ label: T.ingredients, detail: bsiLabel }]),
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
                    <span className="ui-timeline-dot">{done ? <CheckCircle2 size={12} /> : null}</span>
                    <span className="ui-timeline-label">{s.label}</span>
                    {s.detail && <span className="ui-timeline-detail">{s.detail}</span>}
                  </li>
                );
              })}
            </ol>
          );
        })()}
      </section>

      {/* ══════════════ INDICATEURS (selon l'etat du plan) ══════════════ */}
      <div className="prj-kpis">
        {kpis.map(k => (
          <div key={k.label} className="prj-kpi">
            <div className="prj-kpi-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{k.icon} {k.label}</span></div>
            <div className="prj-kpi-value" style={{ color: k.tone ? kpiColor[k.tone] : undefined }}>{k.value}</div>
            {k.sub && <div className="prj-kpi-sub">{k.sub}</div>}
            {k.bar != null && (
              <div style={{ height: 6, backgroundColor: 'var(--kl-fill, var(--ds-sep))', borderRadius: 99, overflow: 'hidden', marginTop: 8 }}>
                <div style={{ height: '100%', width: `${k.bar}%`, backgroundColor: k.bar >= 100 ? 'var(--prj-green)' : 'var(--ds-accent)', borderRadius: 99, transition: 'width 0.3s' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ══════════════ RECEPTION DES INGREDIENTS (chef) ══════════════
          Bandeau d'action tant que le plan est 'ready_to_produce' et le BSI 'pret' :
          visible sur tous les onglets, disparait apres acceptation ou refus du chef. */}
      {activeBon?.status === 'pret' && isChef && (() => {
        const missing = ((activeBon.lines || []) as Record<string, any>[]).filter(l => l.status === 'rupture' && !l.is_packaging);
        const deps = (plan.dependencies || []) as Record<string, any>[];
        const canStartAfter = !deps.some(d => d.status !== 'fulfilled' && d.status !== 'cancelled');
        return (
        <div>
          <StatusBanner tone={missing.length > 0 ? 'warning' : 'success'} icon={CheckCircle}
            title={missing.length > 0
              ? `Préparation prête — ${missing.length} manquant${missing.length > 1 ? 's' : ''} signalé${missing.length > 1 ? 's' : ''} par le magasinier`
              : 'Préparation prête — confirmer ou refuser la réception'}
            actions={!bannerRejecting ? (
              <>
                <button onClick={() => setBannerRejecting(true)} className="ds-btn-danger">
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
                  placeholder="Ex : quantité insuffisante, lot mal identifié..."
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => { setBannerRejecting(false); setBannerRejectReason(''); }} className="odoo-btn-secondary">
                    Annuler
                  </button>
                  <button onClick={() => rejectReceptionMutation.mutate(bannerRejectReason.trim())}
                    disabled={rejectReceptionMutation.isPending || !bannerRejectReason.trim()}
                    className="ds-btn-danger">
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

      {/* ══════════════ ONGLETS (un seul niveau, par sujet) ══════════════ */}
      {/* Pas d'onglets en 'draft' ni pour un plan semi-fini (tout est affiche).
          Production n'apparait qu'une fois la preparation terminee (BSI cloture ou
          production deja demarree) ; Couts qu'une fois la production demarree. */}
      {hasTabs && (() => {
        const nextStepHint = bonNotNeeded
          ? `Production bloquée : aucun besoin en ${T.ingredientsLc} calculé (${T.recipeLc} manquante)`
          : !activeBon
          ? 'Production : après la génération et la clôture du bon de sortie'
          : activeBon.status === 'pret'
            ? `Production : après confirmation de la réception des ${T.ingredientsLc}`
            : 'Production : après la clôture du bon de sortie par le magasinier';
        const ingrBadge = bsiCloture
          ? <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 4 }}>&#10003;</span>
          : activeBon
            ? <span style={{ marginLeft: 4 }}><StatusTag tone={bsiTag?.tone ?? 'todo'} icon={bsiTag?.icon} label={bsiTag?.label ?? ''} /></span>
            : bonNotNeeded ? <span style={{ marginLeft: 4 }}><StatusTag tone="blocked" label="Bloqué" /></span> : null;
        return (
          <div className="plan-tabs pd-tabs">
            <div className="prj-views" role="tablist" aria-label="Contenu du plan">
            <button type="button" onClick={() => setPlanTab('synthese')}
              role="tab" aria-selected={effectiveTab === 'synthese'} className={effectiveTab === 'synthese' ? 'active' : ''}>
              <LayoutDashboard size={13} />
              <span>Synthèse</span>
              {todos.some(t => t.tone === 'warning' || t.tone === 'danger') && (
                <span style={{ marginLeft: 4 }}><StatusTag tone="todo" label="À faire" /></span>
              )}
            </button>
            <button type="button" onClick={() => setPlanTab('ingredients')}
              role="tab" aria-selected={effectiveTab === 'ingredients'} className={effectiveTab === 'ingredients' ? 'active' : ''}>
              <Truck size={13} />
              <span>{T.ingredients}</span>
              {ingrBadge}
            </button>
            {productionTabVisible ? (
              <button type="button" onClick={() => setPlanTab('production')}
                role="tab" aria-selected={effectiveTab === 'production'} className={effectiveTab === 'production' ? 'active' : ''}>
                <Factory size={13} />
                <span>Production</span>
                {plan.status === 'in_progress' && (
                  <span style={{ marginLeft: 4 }}><StatusTag tone="progress" icon={ChefHat} label={`${producedCount} / ${totalActive}`} /></span>
                )}
                {plan.status === 'completed' && (
                  <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 4 }}>&#10003;</span>
                )}
              </button>
            ) : null}
            {costsTabVisible && (
              <button type="button" onClick={() => setPlanTab('couts')}
                role="tab" aria-selected={effectiveTab === 'couts'} className={effectiveTab === 'couts' ? 'active' : ''}>
                <Coins size={13} />
                <span>Coûts</span>
              </button>
            )}
            </div>
            {!productionTabVisible && (
              <span className="plan-tabs-hint" title={nextStepHint}>
                <Lock size={12} /> {nextStepHint}
              </span>
            )}
          </div>
        );
      })()}

      {/* ══════════════ CORPS : contenu de l'onglet + volet notes/journal ══════════════ */}
      <div className="plan-body">
      <div className="plan-main">

      {/* Audit 2026-11 C-35 : un plan de préparation de base n'a pas l'onglet Synthèse — le
          manque de matière à la déclaration y est rappelé ici. */}
      {isSemiFini && shortfallLines.length > 0 && (
        <Alert tone="warning" icon={AlertTriangle}>
          <strong>Production déclarée avec {shortfallLines.length} matière(s) manquante(s) en stock</strong> ·{' '}
          {shortfallLines.map(d => d.name.replace(/ \(manque de stock.*$/, '')).join(', ')} :{' '}
          {fmtDh(shortfallLines.reduce((t, d) => t + num(d.total), 0))} comptés dans le coût réel au coût courant. Stock à régulariser dans Stock › Anomalies.
        </Alert>
      )}

      {/* ══════════════ PLAN SEMI-FINI (2026-11-24, Design System) ══════════════ */}
      {/* Même gabarit que les autres plans : contenu dans la colonne principale, notes et
          journal à droite. Le plan parent est rappelé en bandeau, la préparation en panneau
          (besoin, stock, à produire, produit) avec les ingrédients à peser. */}
      {isSemiFini && ((plan.dependency_of as Record<string, any>[] | undefined)?.length ?? 0) > 0 && (() => {
        const deps = plan.dependency_of as Record<string, any>[];
        const dep = deps[0]; // dépendance principale
        const recipeName = dep.sub_recipe_name as string;
        const qtyNeeded = parseFloat(dep.quantity_needed as string || '0');
        const qtyFromStock = parseFloat(dep.quantity_from_stock as string || '0');
        // Ce plan fabrique la part non couverte par le stock : les ingrédients s'y rapportent.
        const qtyToProduce = parseFloat(dep.quantity_to_produce as string || '') || qtyNeeded;
        const yieldQty = parseFloat(dep.yield_quantity as string || '1');
        const yieldUnit = dep.yield_unit as string || 'kg';
        const instructions = dep.instructions as string || '';
        const parentPlanId = dep.parent_plan_id as string;
        const parentShortId = dep.parent_short_id as string || parentPlanId.slice(0, 8);
        const parentNotes = dep.parent_notes as string || '';
        const recipeIngredients = (plan.recipe_ingredients || []) as Record<string, any>[];
        const multiplier = yieldQty > 0 ? qtyToProduce / yieldQty : 1;
        // Ligne du semi-fini : « produced » est le statut d'une ligne fabriquée (il manquait,
        // d'où « Produit 0,00 » et « 0 % » sur un plan terminé).
        const sfItem = (plan.items as Record<string, any>[] || []).find(
          (it: Record<string, any>) => ['pending', 'in_progress', 'produced', 'completed'].includes(it.status as string)
        );
        const actualQty = sfItem ? parseFloat(sfItem.actual_quantity as string || '0') : 0;
        const done = ['produced', 'completed'].includes(sfItem?.status as string);
        const pct = done ? 100 : qtyToProduce > 0 ? Math.min(100, Math.round(actualQty / qtyToProduce * 100)) : 0;
        const fq = (v: number, d = 2) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
        const parentTag = planStatusTag(dep.parent_status as string);

        return (
          <>
            <Alert tone="info" icon={Layers}
              action={<button type="button" onClick={() => navigate(`/production/${parentPlanId}`)} className="odoo-btn-secondary ds-btn-sm"><Eye size={12} /> Voir le plan</button>}>
              Préparé pour le plan <strong>#{parentShortId.toUpperCase()}</strong> du {format(new Date(dep.parent_plan_date as string), 'd MMM yyyy', { locale: fr })}
              {parentNotes ? <> · {parentNotes}</> : null}
              <span style={{ marginLeft: 8, display: 'inline-flex', verticalAlign: 'middle' }}><StatusTag tone={parentTag.tone} icon={parentTag.icon} label={parentTag.label} /></span>
            </Alert>

            <div className="ds-panel pd-section">
              <div className="pd-section-head">
                <Beaker size={12} /> {recipeName}
                <span style={{ color: 'var(--ds-muted)', fontSize: 13, fontWeight: 400 }}>{T.basePrep.toLowerCase()}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <StatusTag tone={done ? 'done' : actualQty > 0 ? 'progress' : 'todo'} label={done ? 'Produit' : actualQty > 0 ? `${pct} %` : 'À produire'} />
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderBottom: '1px solid var(--ds-hair)' }}>
                {[
                  { label: 'Besoin du plan parent', value: qtyNeeded },
                  { label: 'Pris en stock', value: qtyFromStock, muted: qtyFromStock <= 0 },
                  { label: 'À produire', value: qtyToProduce, strong: true },
                  { label: `Produit · ${pct} %`, value: actualQty, ok: done },
                ].map((k, i) => (
                  <div key={k.label} style={{ padding: '12px 16px', borderLeft: i ? '1px solid var(--ds-hair)' : undefined }}>
                    <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{k.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k.ok ? 'var(--ds-success)' : k.muted ? 'var(--ds-muted)' : 'var(--ds-ink)' }}>
                      {k.muted ? '—' : fq(k.value)} {!k.muted && <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ds-muted)' }}>{yieldUnit}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {instructions && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ds-hair)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-ink)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <BookOpen size={12} aria-hidden="true" /> Instructions
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-body)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{instructions}</p>
                </div>
              )}

              {recipeIngredients.length > 0 ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '12px 16px 4px' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ds-ink)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Scale size={12} aria-hidden="true" /> {T.ingredients} à peser</span>
                    <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
                      {fq(qtyToProduce)} {yieldUnit} = {fq(multiplier, 2)} × la {T.recipeLc} ({fq(yieldQty)} {yieldUnit})
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="odoo-table ds-dense" aria-label={`${T.ingredients} à peser pour ${recipeName}`}>
                      <thead><tr>
                        <th>{T.ingredient}</th>
                        <th className="ds-num">Pour la {T.recipeLc}</th>
                        <th className="ds-num">{hasFeature('pesage') ? 'À peser' : 'À sortir'}</th>
                      </tr></thead>
                      <tbody>
                        {recipeIngredients.map((ri, idx) => {
                          const baseQty = parseFloat(ri.quantity as string || '0');
                          const unit = ri.unit as string || ri.base_unit as string || '';
                          // Unité saisie sur la fiche conservée ; arrondi adapté à l'unité.
                          const dec = ['g', 'ml', 'mg'].includes(unit) ? 0 : unit === 'unit' ? 1 : 3;
                          return (
                            <tr key={(ri.ingredient_id as string) ?? idx}>
                              <td className="ds-strong">{ri.ingredient_name as string}</td>
                              <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{fq(baseQty, 3)} {unit}</td>
                              <td className="ds-num"><strong>{fq(baseQty * multiplier, dec)}</strong> <span style={{ color: 'var(--ds-muted)' }}>{unit}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <EmptyState bare icon={Scale} title={`${T.ingredients} : aucune ligne`} text={`La ${T.recipeLc} de ${recipeName} n'a pas de composition matière.`} />
              )}
            </div>
          </>
        );
      })()}


      {/* ══════════════ SYNTHESE ══════════════ */}
      {showSynth && (
        <div className="plan-synth">
          {todos.map((t, i) => (
            <StatusBanner key={i} tone={t.tone} icon={t.icon} title={t.title} actions={t.action}>
              {t.text}
            </StatusBanner>
          ))}
          <div className="plan-synth-grid">
            <div className="ds-panel pd-section plan-phase">
              <div className="pd-section-head">
                <Truck size={12} /> {T.ingredients}
                {bsiTag && <span style={{ marginLeft: 'auto' }}><StatusTag tone={bsiCloture ? 'done' : bsiTag.tone} icon={bsiTag.icon} label={bsiTag.label} /></span>}
              </div>
              <ul className="plan-phase-list">
                <li>{needs.length} {needs.length > 1 ? T.ingredientsLc : T.ingredientLc} à prélever</li>
                {activeBon && <li>Bon de sortie {activeBon.numero as string}</li>}
                {lotUsage.length > 0 && <li>{lotUsage.length} lot{lotUsage.length > 1 ? 's' : ''} utilisé{lotUsage.length > 1 ? 's' : ''}{nearestDlc ? `, DLC la plus proche le ${format(nearestDlc, 'dd/MM/yyyy')}` : ''}</li>}
                {isMagasinier && insufficientNeeds.length > 0 && <li style={{ color: 'var(--ds-danger)' }}>{insufficientNeeds.length} {T.ingredientLc}(s) en stock insuffisant</li>}
              </ul>
              <button type="button" className="plan-phase-link" onClick={() => setPlanTab('ingredients')}>Voir les {T.ingredientsLc} →</button>
            </div>
            <div className="ds-panel pd-section plan-phase">
              <div className="pd-section-head">
                <Factory size={12} /> Production
                {hasResults && <span style={{ marginLeft: 'auto' }}><StatusTag tone={progressPct >= 100 ? 'done' : 'progress'} label={`${producedCount} / ${totalActive}`} /></span>}
              </div>
              <ul className="plan-phase-list">
                <li>{hasResults ? `${qtyDone} pièce(s) produite(s) sur ${qtyPlanned}` : `${qtyPlanned} pièce(s) prévue(s), ${items.length} article(s)`}</li>
                {deps.length > 0 && <li>Semi-finis : {depsFulfilled} / {deps.length} disponible(s)</li>}
                {waitingCount > 0 && <li style={{ color: 'var(--ds-warning)' }}>{waitingCount} article(s) en liste d'attente</li>}
                {plan.status === 'completed' && !isSemiFini && (
                  <li>Rendement : {avgRendement != null ? `${avgRendement.toFixed(1)} %` : <strong style={{ color: 'var(--ds-warning)' }}>non saisi</strong>}{recordedYields > 0 ? ` · pertes ${pertesTotal}` : ''}</li>
                )}
              </ul>
              {productionTabVisible
                ? <button type="button" className="plan-phase-link" onClick={() => setPlanTab('production')}>Voir la production →</button>
                : <span className="plan-phase-hint"><Lock size={11} /> Ouvert après la livraison des {T.ingredientsLc}</span>}
            </div>
            {costsTabVisible && (
              <div className="ds-panel pd-section plan-phase">
                <div className="pd-section-head">
                  <Coins size={12} /> Coûts
                  <span style={{ marginLeft: 'auto' }}>
                    <StatusTag tone={coutTotal == null ? 'draft' : 'done'} label={coutTotal == null ? 'Non calculé' : 'Calculé'} />
                  </span>
                </div>
                <ul className="plan-phase-list">
                  {coutTotal != null ? (
                    <>
                      <li>Coût réel : {fmtDh(coutTotal)}{qtyDone > 0 ? `, soit ${fmtDh(coutTotal / qtyDone)} par pièce` : ''}</li>
                      {coutReel?.cout_prevu != null && <li>Prévu : {fmtDh(num(coutReel.cout_prevu))}{ecartLabel ? ` (${ecartLabel})` : ''}</li>}
                    </>
                  ) : <li>Le coût de revient n'a pas encore été calculé.</li>}
                </ul>
                <button type="button" className="plan-phase-link" onClick={() => setPlanTab('couts')}>Voir les coûts →</button>
              </div>
            )}
            <div className="ds-panel pd-section plan-phase">
              <div className="pd-section-head">
                <Info size={12} /> Origine
              </div>
              <ul className="plan-phase-list">
                <li>Créé par {(plan.created_by_name as string) || '—'}{plan.created_at ? ` le ${format(new Date(plan.created_at as string), 'dd/MM à HH:mm')}` : ''}</li>
                {linkedReplenishment && <li>Demande boutique {linkedReplenishment.request_number as string}</li>}
                {plan.order_number && <li>Commande {plan.order_number as string}</li>}
                {plan.notes ? <li>{plan.notes as string}</li> : null}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ INGREDIENTS : bon de sortie ══════════════ */}
      {showIngr && bonNotNeeded && ['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'].includes(plan.status) && (
        <div>
          <StatusBanner tone="warning" icon={AlertTriangle} title="Aucun bon de sortie à préparer — préparation bloquée">
            {bonNotNeededReason || `Rien à prélever (produits sans ${T.recipeLc} ou sans composition).`}
            <div style={{ marginTop: 4 }}>
              La production ne peut pas démarrer sans transfert des {T.ingredientsLc}. Ajoutez une recette aux produits
              de ce plan, puis utilisez « Relancer le plan » pour recalculer les besoins et générer le bon de sortie.
            </div>
          </StatusBanner>
        </div>
      )}

      {/* Le BSI est genere automatiquement a la confirmation du plan (notification au
          magasinier). Ce bandeau sert de filet de securite si l'auto-generation a echoue
          ou si la query n'a pas encore ramene le BSI. */}
      {showIngr && !isSemiFini && !activeBon && !bonNotNeeded && ['confirmed', 'in_progress'].includes(plan.status) && (
        <div>
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
      {/* M8-01 : bon de sortie inscrit au registre. */}
      {showIngr && <PlanPanels tab="preparation" ctx={panelCtx} only={['bon-sortie']} />}
      {/* Audit C-28 : matière déjà prélevée rendue au magasin (article annulé, reste). */}
      {showIngr && activeBon && ['prelevement', 'verifie', 'cloture'].includes(activeBon.status as string) && (
        <MaterialReturnPanel bonId={activeBon.id as string} planId={id!} closed={plan.status === 'completed'} />
      )}

      {/* M8-01 : panneaux de synthèse inscrits au registre (planPanels.tsx). */}
      {(showSynth || !hasTabs) && <PlanPanels tab="synthese" ctx={panelCtx} />}
      {/* Audit C-19 : charge des équipements de la journée (seulement s'il en occupe). */}
      {(showSynth || !hasTabs) && plan.status !== 'cancelled' && <EquipmentLoadPanel planId={id!} />}

      {/* ══════════════ ALERTES (onglet Preparation) ══════════════
          Visibles uniquement par le magasinier : elles concernent la dispo des
          ingredients (mise en liste d'attente faute de stock), hors champ du chef. */}
      {showIngr && <PlanPanels tab="preparation" ctx={panelCtx} only={['stock-warnings']} />}

      {/* Besoins en ingredients — l'apercu FEFO a ete retire :
          la selection des lots est maintenant geree dans le workflow de
          transfert Economat -> Pesage (cf module Warehouse / BSI), pas ici. */}
      {ingredientNeedsBlock}
      {reservations.length > 0 && (
        <div className="ds-panel pd-section">
          <div className="pd-section-head">
            <Layers size={12} /> Matière réservée
            <span style={{ marginLeft: 4, color: 'var(--ds-muted)', fontWeight: 400 }}>{reservations.filter(r => r.status === 'reservee').length} réservation(s) active(s)</span>
          </div>
          <table className="odoo-table">
            <thead><tr><th>Matière</th><th className="ds-num">Réservé</th><th className="ds-num">Non couvert</th><th>État</th></tr></thead>
            <tbody>
              {reservations.map(r => (
                <tr key={r.id}>
                  <td className="ds-strong">{r.ingredient_name}</td>
                  <td className="ds-num">{r.quantity} {r.unit ?? ''}</td>
                  <td className="ds-num">{r.shortage > 0 ? <span style={{ color: 'var(--ds-danger, #b42318)' }}>{r.shortage} {r.unit ?? ''}</span> : '—'}</td>
                  <td><StatusTag tone={r.status === 'reservee' ? (r.shortage > 0 ? 'blocked' : 'progress') : r.status === 'consommee' ? 'done' : 'cancelled'}
                    label={r.status === 'reservee' ? 'Réservée' : r.status === 'consommee' ? 'Consommée' : 'Libérée'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showIngr && <PlanPanels tab="preparation" ctx={panelCtx} only={['no-needs']} />}


      {/* Semi-finis requis — rendu en tete de l'onglet Production (etape pre-production) */}
      {semiFinishedDepsBlock}

      {/* ══════════════ ARTICLES (onglet Production) ══════════════ */}
      {showProd && linkedReplenishment && (() => {
        const repItems = (linkedReplenishment.items || []) as Record<string, any>[];
        const planRoleSlugs = ws.slugsOf(plan?.target_role as string | null);
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
          <div className="ds-panel pd-section">
            <div className="pd-section-head">
              <Box size={12} /> Prélevés du stock
              <span style={{ marginLeft: 4, color: 'var(--ds-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{stockItems.length} article(s)</span>
              <span style={{ marginLeft: 'auto', color: 'var(--ds-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <TrendingUp size={11} /> Transfert auto — demande {linkedReplenishment.request_number as string}
              </span>
            </div>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Catégorie</th>
                  <th className="ds-num">Du stock / demandé</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.map((ri) => (
                  <tr key={ri.id as string} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 500 }}>{ri.product_name as string}</td>
                    <td style={{ color: 'var(--ds-muted)' }}>{ri.category_name as string}</td>
                    <td className="ds-num">
                      <strong style={{ color: 'var(--ds-success)' }}>{(ri.fulfilled_from_stock as number) || 0}</strong>
                      <span style={{ color: 'var(--ds-muted)' }}> / {(ri.requested_quantity as number) || 0}</span>
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
          <div className="ds-panel pd-section">
            <div className="pd-section-head">
              <Clock size={12} /> Liste d'attente
              {waitingItems.length > 0 && <span style={{ marginLeft: 4 }}><StatusTag tone="todo" label={`${waitingItems.length} en attente`} /></span>}
              {waitingItems.length > 1 && isChef && (
                <button type="button"
                  onClick={() => restoreMutation.mutate(waitingItems.map((it: Record<string, any>) => it.id as string))}
                  disabled={restoreMutation.isPending}
                  className="odoo-btn-primary ds-btn-sm" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
                  <RotateCcw size={11} /> Restaurer tous ({waitingItems.length})
                </button>
              )}
            </div>
            {waitingItems.length > 0 && (
              <div className="odoo-alert warning">
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Ces articles attendent une matière que le bon de sortie n'a pas livrée ; les autres articles du plan se produisent normalement.
                  « Restaurer » sort la matière manquante pour l'article dès qu'elle est en stock ; « Produire sans » le lance sans elle.
                  {plan.status === 'in_progress' && ' La production ne peut pas être terminée tant que des articles sont en attente.'}
                </span>
              </div>
            )}
            <table className="odoo-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Produit</th>
                  <th className="ds-num">Qté planifiée</th>
                  <th>Statut</th>
                  <th style={{ width: 190 }}></th>
                </tr>
              </thead>
              <tbody>
                {waitingItems.map((item: Record<string, any>) => {
                  // Mig 664 : matières non livrées par le bon pour cet article.
                  const missing = ((item.shortages ?? []) as { name: string; unit: string; missing_qty: string | number; status: string }[])
                    .filter(s => s.status === 'open');
                  return (
                  <tr key={item.id as string} style={{ cursor: 'default' }}>
                    <td><span className="odoo-status-dot warning" /></td>
                    <td style={{ fontWeight: 500 }}>
                      {item.product_name as string}
                      {missing.length > 0 && (
                        <div style={{ fontWeight: 400, fontSize: 12, color: 'var(--ds-muted)', marginTop: 2 }}>
                          Manque : {missing.map(s => `${s.name} ${Number(s.missing_qty).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${s.unit}`).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="ds-num">{item.planned_quantity as number}</td>
                    <td><StatusTag tone="todo" label={missing.length > 0 ? 'Matière manquante' : 'En attente'} /></td>
                    <td className="ds-num">
                      {isChef && (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" onClick={() => restoreMutation.mutate([item.id as string])} disabled={restoreMutation.isPending}
                            className="odoo-btn-secondary ds-btn-sm"
                            title={missing.length > 0 ? 'Sort la matière manquante pour cet article (si elle est en stock) et le remet en production' : undefined}>
                            <RotateCcw size={11} /> Restaurer
                          </button>
                          {missing.length > 0 && (
                            <button type="button" onClick={() => restoreMutation.mutate({ itemIds: [item.id as string], waiveMissing: true })}
                              disabled={restoreMutation.isPending} className="odoo-btn-secondary ds-btn-sm"
                              title="Lance l'article sans la matière manquante (aucune sortie de stock pour elle)">
                              Produire sans
                            </button>
                          )}
                          <button type="button"
                            onClick={() => cancelItemsMutation.mutate({ itemIds: [item.id as string], reason: 'Annule depuis la liste d\'attente' })}
                            disabled={cancelItemsMutation.isPending}
                            className="ds-btn-danger ds-btn-sm">
                            <XCircle size={11} /> Annuler
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {restoredItems.map((item: Record<string, any>) => (
                  <tr key={item.id as string} style={{ cursor: 'default' }}>
                    <td><span className="odoo-status-dot ok" /></td>
                    <td style={{ fontWeight: 500 }}>{item.product_name as string}</td>
                    <td className="ds-num">{item.planned_quantity as number}</td>
                    <td><StatusTag tone="done" label="Restauré" /></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {showIngr && <PlanPanels tab="preparation" ctx={panelCtx} only={['lot-traceability']} />}

      {/* ══════════════ PROCEDE + RENDEMENT (onglet Production) ══════════════
          Le retro-planning sert a caler le demarrage : inutile une fois le plan termine. */}
      {showProd && hasResults && (
        <>
          {/* M8-01 : panneaux de production inscrits au registre (planPanels.tsx). */}
          <PlanPanels tab="production" ctx={panelCtx} />
        </>
      )}

      {/* ══════════════ COUT DE REVIENT (onglet Couts) ══════════════ */}
      {showCosts && hasResults && <PlanPanels tab="couts" ctx={panelCtx} />}

      </div>{/* /plan-main */}

      {/* ══════════════ NOTES + JOURNAL (volet lateral, visible sur tous les onglets) ══════════════ */}
      <aside className="plan-side">
      <div className="ds-panel pd-section">
        <div className="pd-section-head">
          <MessageSquare size={12} /> Notes de production
          {(activities as Record<string, any>[]).length > 0 && (
            <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>
              {(activities as Record<string, any>[]).length}
            </span>
          )}
        </div>
        <div style={{ padding: '0.5rem 0.75rem', backgroundColor: 'var(--ds-card)' }}>
          {/* New note input */}
          <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.5rem' }}>
            <input type="text" value={newNote} onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
              placeholder="Ajouter une note..."
              className="ds-input sm" style={{ flex: 1 }}
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
                  borderTop: i > 0 ? '1px solid var(--ds-sep)' : 'none',
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    backgroundColor: 'var(--ds-tint)',
                    color: 'var(--ds-accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
                  }}>
                    {act.activity_type === 'note_added' ? <MessageSquare size={11} /> : <Play size={11} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', color: 'var(--ds-ink)' }}>{act.message as string}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: 1, fontSize: '12px', color: 'var(--ds-muted)' }}>
                      {act.first_name && <span style={{ fontWeight: 500 }}>{act.first_name as string} {act.last_name as string}</span>}
                      <span>{format(new Date(act.created_at as string), 'dd/MM HH:mm', { locale: fr })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--ds-muted)', textAlign: 'center', padding: '0.5rem' }}>Aucune note pour le moment</p>
          )}
        </div>
      </div>

      <PlanJournal events={planEvents} />
      </aside>
      </div>{/* /plan-body */}
      </div>{/* /pd-page */}

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
            onPreviewHtml={docOn('ordre_fabrication') ? () => printProductionTicket(printChoiceItem) : undefined}
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
  const T = useProdTerms();
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({ ingredientId: need.ingredient_id as string, note: note || undefined });
  };

  return (
    <Modal title="Demander au responsable stock" onClose={onClose} width={448} locked={isPending}
      subtitle="Une notification sera envoyee au magasinier/economat pour verifier la dispo."
      footer={<FormFooter onCancel={onClose} busy={isPending} onSubmit={() => onConfirm({ ingredientId: need.ingredient_id as string, note: note || undefined })}
        submitLabel={isPending ? 'Envoi...' : 'Envoyer la demande'} />}>
        <form onSubmit={submit} className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">{T.ingredient}</span>
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
              <span className="font-bold" style={{ color: 'var(--ds-danger)' }}>{formatQty(deficit, need.unit as string)}</span>
            </div>
          </div>

          <Alert tone="info" icon={Info}>
            Le responsable stock va vérifier physiquement le stock et marquer "OK" s'il est disponible.
            Après confirmation, vous pourrez restaurer l'article en attente.
          </Alert>

          <FormField label="Note" htmlFor="stock-verif-note" hint="Optionnel.">
            <textarea id="stock-verif-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Ex : vérifier dans la réserve B..." className="ds-input" />
          </FormField>
        </form>
    </Modal>
  );
}


/** En-tête d'ordre (M2-02) : numéro OF, type d'ordre, priorité modifiable tant que l'ordre n'est pas terminé. */
function PlanHeaderTags({ plan }: { plan: Record<string, any> }) {
  const queryClient = useQueryClient();
  const prio = Number(plan.priority ?? 3);
  const locked = ['completed', 'cancelled'].includes(plan.status as string);
  const m = useMutation({
    mutationFn: (priority: number) => productionApi.updateHeader(plan.id as string, { priority }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['production'] }); notify.success('Priorité modifiée'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {plan.of_number && <span className="odoo-tag odoo-tag-grey" style={{ fontFamily: 'monospace' }}>{plan.of_number as string}</span>}
      {plan.order_type_label && plan.order_type_code !== 'PLAN_JOUR' && (
        <span className="odoo-tag odoo-tag-blue" title={plan.order_type_requires_bon_sortie ? undefined : 'Sans bon de sortie : matières consommées à la déclaration'}>
          {plan.order_type_label as string}
        </span>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '13px', color: 'var(--ds-muted)' }}>
        Priorité
        <select value={prio} disabled={locked || m.isPending} onChange={(e) => m.mutate(Number(e.target.value))}
          className="ds-input sm" style={{ width: 'auto' }} aria-label="Priorité de l'ordre">
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{PRIORITY_LABELS[n]}</option>)}
        </select>
      </label>
    </span>
  );
}
