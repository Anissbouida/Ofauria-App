import { useState, useMemo, useRef, useEffect } from 'react';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { productsApi } from '../../api/products.api';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production.api';
import { productLossesApi } from '../../api/product-losses.api';
import { recipesApi } from '../../api/recipes.api';
import { contenantsApi } from '../../api/contenants.api';
import { useReferentiel } from '../../hooks/useReferentiel';
import {
  X, ChevronLeft, ChevronRight, Check, CheckCircle, AlertTriangle,
  Clock, Flame, Package, Factory, ClipboardList, Printer, Layers, Play, Hash,
  BookOpen, ChefHat, Scale, Eye, Snowflake,
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { useProductionTimers } from '../../context/ProductionTimerContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductionLaunchModalProps {
  planId: string;
  plan: Record<string, any>;
  items: Record<string, any>[];
  targetItemId?: string | null;
  initialStepName?: string | null; // jump to this étape by name (from timer notification)
  needs: Record<string, any>[];
  onClose: () => void;
  onCompleted: () => void;
}

interface SubRecipeAnalysis {
  subRecipeId: string;
  subRecipeName: string;
  yieldQuantity: number;
  totalNeeded: number;
  usedBy: { planItemId: string; productName: string; quantityNeeded: number }[];
  ingredients: Record<string, any>[];
}

// LOSS_REASONS is now loaded dynamically via useReferentiel('production_loss_reasons') inside the component

const STEPS = [
  { num: 1, label: 'Bases & Sous-recettes', color: 'indigo', icon: <Layers size={16} /> },
  { num: 2, label: 'Produits finis', color: 'emerald', icon: <Package size={16} /> },
  { num: 3, label: 'Pertes & Observations', color: 'amber', icon: <AlertTriangle size={16} /> },
  { num: 4, label: 'Confirmation', color: 'green', icon: <CheckCircle size={16} /> },
];

const stepColorMap: Record<string, { bg: string; ring: string; text: string; gradient: string; light: string }> = {
  indigo: { bg: 'bg-indigo-500', ring: 'ring-indigo-500', text: 'text-indigo-600', gradient: 'from-indigo-500 to-indigo-600', light: 'bg-indigo-50' },
  emerald: { bg: 'bg-emerald-500', ring: 'ring-emerald-500', text: 'text-emerald-600', gradient: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-50' },
  amber: { bg: 'bg-amber-500', ring: 'ring-amber-500', text: 'text-amber-600', gradient: 'from-amber-500 to-amber-600', light: 'bg-amber-50' },
  green: { bg: 'bg-green-600', ring: 'ring-green-600', text: 'text-green-700', gradient: 'from-emerald-500 to-emerald-600', light: 'bg-green-50' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowLocalISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function detectShift(dateStr: string): string {
  const h = new Date(dateStr).getHours();
  return h < 14 ? 'Matin' : 'Apres-midi';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Ligne de coupe saisie par le chef (mig 302). */
interface CutLine {
  key: string;
  /** true = la piece de l'article (equivalence 1, non supprimable). */
  base: boolean;
  productId: string;
  label: string;
  equiv: string;
  qty: string;
}

export default function ProductionLaunchModal({
  planId,
  plan,
  items: allItems,
  targetItemId,
  initialStepName,
  needs,
  onClose,
  onCompleted,
}: ProductionLaunchModalProps) {
  // Dynamic loss reasons from referentiel
  const { entries: prodLossReasonEntries } = useReferentiel('production_loss_reasons');
  const LOSS_REASONS = prodLossReasonEntries.map(e => ({ value: e.code, label: e.label }));

  // Production timers
  const { timers: activeTimers, startTimer, stopTimer, getTimerRemaining, hasTimerFired } = useProductionTimers();

  // If a specific item is targeted, only show that item; otherwise show all pending items
  const items = targetItemId
    ? allItems.filter((i) => (i.id as string) === targetItemId)
    : allItems;
  const queryClient = useQueryClient();

  // Step navigation
  const [step, setStep] = useState(1);

  // Step 1 state
  const [baseActuals, setBaseActuals] = useState<Record<string, number>>({});
  const [baseAlreadyProduced, setBaseAlreadyProduced] = useState<Record<string, boolean>>({});
  const [expandedBases, setExpandedBases] = useState<Set<string>>(new Set());

  // Step 2 state
  const [producedAt, setProducedAt] = useState(nowLocalISO());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      set.add(item.id as string);
    });
    return set;
  });
  const [actuals, setActuals] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    items.forEach((item) => {
      m[item.id as string] = (item.planned_quantity as number) || 0;
    });
    return m;
  });

  // Step 3 state
  const [declareLosses, setDeclareLosses] = useState(false);
  const [lossReasons, setLossReasons] = useState<Record<string, string>>({});
  const [lossNotes, setLossNotes] = useState<Record<string, string>>({});
  // Coupe (mig 302) : par article, mode mixte actif + lignes de sortie saisies par
  // le chef. La 1ere ligne est la piece de l'article ; les autres sont des produits
  // du catalogue avec leur equivalence en pieces (un entremets = 8 tranches).
  // Deroule des etapes de la fiche : points coches (controle qualite) et langue d'affichage.
  const [qcChecked, setQcChecked] = useState<Record<string, boolean>>({});
  const [stepLang, setStepLang] = useState<'fr' | 'ar'>('fr');
  // Chrono d'une etape bloquante declare « deja fait » par le chef (il a attendu
  // sans lancer le chrono dans l'application). Sans cette sortie, il devait
  // attendre une seconde fois la duree complete.
  const [timerSkipped, setTimerSkipped] = useState<Record<string, boolean>>({});
  const confirmDialog = useConfirm();
  const [cutMode, setCutMode] = useState<Record<string, boolean>>({});
  const [cutLines, setCutLines] = useState<Record<string, CutLine[]>>({});
  // Catalogue pour choisir le produit d'une sortie de coupe (charge seulement si besoin).
  const { data: cutProductsData } = useQuery({
    queryKey: ['products', 'cut-outputs'],
    queryFn: () => productsApi.list({ limit: '500' }),
    enabled: Object.values(cutMode).some(Boolean),
    staleTime: 3e5,
  });
  const cutProducts = ((cutProductsData as { data?: Record<string, any>[] } | undefined)?.data || [])
    .map((p) => ({ id: p.id as string, name: p.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const [observations, setObservations] = useState('');

  // Step 4 state
  const [printAfter, setPrintAfter] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Recipe panel state — auto-open for first item when single target
  const [recipeProductId, setRecipeProductId] = useState<string | null>(() => {
    if (targetItemId) {
      const target = items.find((i) => (i.id as string) === targetItemId);
      return target ? (target.product_id as string) : null;
    }
    return null;
  });
  const [recipeFullscreen, setRecipeFullscreen] = useState(false);
  // Etapes structurees : les instructions texte sont repliees par defaut (les
  // etapes SONT le procede), les ingredients restent toujours visibles.
  const [showStepInstructions, setShowStepInstructions] = useState(false);

  // For base recipes (no product_id), resolve base_recipe_id directly
  const singleItemBaseRecipeId = targetItemId
    ? (items.find((i) => (i.id as string) === targetItemId)?.base_recipe_id as string | undefined) || null
    : null;

  // Queries
  const { data: subRecipes = [], isLoading: loadingSubRecipes } = useQuery<SubRecipeAnalysis[]>({
    queryKey: ['sub-recipe-analysis', planId],
    queryFn: () => productionApi.analyzeSubRecipes(planId),
  });

  // Recipe data for the selected product (by product_id)
  const { data: recipeByProduct, isLoading: loadingRecipeByProduct } = useQuery({
    queryKey: ['recipe-by-product', recipeProductId],
    queryFn: () => recipesApi.getByProductId(recipeProductId!),
    enabled: !!recipeProductId,
  });

  // Recipe data by direct recipe ID (for base recipes with no product_id)
  const { data: recipeByDirectId, isLoading: loadingRecipeById } = useQuery({
    queryKey: ['recipe-by-id', singleItemBaseRecipeId],
    queryFn: () => recipesApi.getById(singleItemBaseRecipeId!),
    enabled: !!singleItemBaseRecipeId && !recipeProductId,
  });

  // Use whichever recipe data is available
  const recipeData = recipeByProduct || recipeByDirectId || null;
  const loadingRecipe = loadingRecipeByProduct || loadingRecipeById;

  // Derived data
  const producibleItems = useMemo(
    () => items.filter((i) => (i.waiting_status as string) !== 'waiting'),
    [items],
  );
  const waitingItems = useMemo(
    () => items.filter((i) => (i.waiting_status as string) === 'waiting'),
    [items],
  );

  const shift = detectShift(producedAt);
  const currentStepDef = STEPS[step - 1];
  const colors = stepColorMap[currentStepDef.color];

  // Loss detection
  const itemsWithLoss = useMemo(() => {
    return [...selectedItems]
      .map((id) => {
        const item = items.find((i) => (i.id as string) === id);
        if (!item) return null;
        const planned = (item.planned_quantity as number) || 0;
        const actual = actuals[id] || 0;
        const lost = planned - actual;
        return lost > 0 ? { ...item, planned, actual, lost } : null;
      })
      .filter(Boolean) as (Record<string, any> & { planned: number; actual: number; lost: number })[];
  }, [selectedItems, actuals, items]);

  // Auto-enable losses when discrepancies first appear going to step 3
  const hasDiscrepancies = itemsWithLoss.length > 0;

  // KPIs for step 4
  const totalSelected = selectedItems.size;
  const totalPlanned = [...selectedItems].reduce((sum, id) => {
    const item = items.find((i) => (i.id as string) === id);
    return sum + ((item?.planned_quantity as number) || 0);
  }, 0);
  const totalActual = [...selectedItems].reduce((sum, id) => sum + (actuals[id] || 0), 0);
  const yieldRate = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 100;
  const totalLosses = declareLosses ? itemsWithLoss.length : 0;

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  function validateStep(s: number): string | null {
    if (s === 2) {
      const hasSelection = [...selectedItems].some((id) => (actuals[id] || 0) > 0);
      if (!hasSelection) return 'Selectionnez au moins un produit avec une quantite > 0';
    }
    if (s === 3 && declareLosses) {
      for (const item of itemsWithLoss) {
        if (!lossReasons[item.id as string]) {
          return `Selectionnez un motif de perte pour "${item.product_name}"`;
        }
      }
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      notify.error(err);
      return;
    }
    if (step === 2) {
      // auto-set declareLosses based on discrepancies when entering step 3
      setDeclareLosses(hasDiscrepancies);
    }
    setStep((s) => Math.min(s + 1, 4));
  }

  function goPrev() {
    setStep((s) => Math.max(s - 1, 1));
  }

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // 1. Produce items
      const itemsToSubmit = [...selectedItems]
        .map((itemId) => {
          const outputs = cutMode[itemId]
            ? (cutLines[itemId] || [])
                .map((l) => ({
                  productId: l.base ? null : l.productId,
                  equivPieces: l.base ? undefined : (parseFloat(l.equiv.replace(',', '.')) || 0),
                  quantity: parseFloat(l.qty.replace(',', '.')) || 0,
                }))
                .filter((o) => o.quantity > 0 && (o.productId === null || (o.productId && (o.equivPieces || 0) > 0)))
            : [];
          return {
            planItemId: itemId,
            actualQuantity: actuals[itemId] || 0,
            ...(outputs.length > 0 ? { outputs } : {}),
          };
        })
        .filter((i) => i.actualQuantity > 0);

      await productionApi.produceItems(planId, itemsToSubmit, producedAt);

      // 2. Record losses (auto-detect for single item, or declareLosses flag for multi)
      const shouldRecordLosses = isSingleItem || declareLosses;
      if (shouldRecordLosses) {
        for (const itemId of selectedItems) {
          const item = items.find((i) => (i.id as string) === itemId);
          if (!item) continue;
          const planned = (item.planned_quantity as number) || 0;
          const actual = actuals[itemId] || 0;
          const lost = planned - actual;
          if (lost > 0 && lossReasons[itemId]) {
            await productLossesApi.create({
              productId: item.product_id as string,
              quantity: lost,
              lossType: 'production',
              reason: lossReasons[itemId],
              reasonNote: lossNotes[itemId] || undefined,
              productionPlanId: planId,
            });
          }
        }
      }

      // 3. Invalidate queries and wait for refetch to complete
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['production'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['product-losses'] }),
        queryClient.invalidateQueries({ queryKey: ['fefo-preview'] }),
        queryClient.invalidateQueries({ queryKey: ['production-lots'] }),
      ]);

      // Production finalisee : on nettoie le pointeur de reprise (sinon la prochaine
      // production de ce meme item rouvrirait sur la derniere etape de la precedente).
      if (resumeKey) {
        try { localStorage.removeItem(resumeKey); } catch { /* ignore */ }
      }
      notify.success('Production enregistree avec succes');
      onCompleted();
      onClose();
    } catch (err) {
      notify.error(apiErrorMessage(err, 'Erreur lors de la production'));
    } finally {
      setSubmitting(false);
    }
  };

  // -----------------------------------------------------------------------
  // Select helpers
  // -----------------------------------------------------------------------

  const allProducibleSelected = producibleItems.every((i) => selectedItems.has(i.id as string));

  function toggleSelectAll() {
    if (allProducibleSelected) {
      setSelectedItems(new Set());
    } else {
      const set = new Set<string>();
      producibleItems.forEach((i) => set.add(i.id as string));
      setSelectedItems(set);
    }
  }

  function toggleItem(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-1 sm:gap-2 py-4 px-4">
      {STEPS.map((s, idx) => {
        const done = step > s.num;
        const active = step === s.num;
        const sc = stepColorMap[s.color];
        return (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                  done
                    ? `${sc.bg} text-white`
                    : active
                      ? `${sc.bg} text-white ring-4 ${sc.ring} ring-opacity-30`
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {done ? <Check size={16} /> : s.num}
              </div>
              <span
                className={`text-[10px] sm:text-xs font-medium text-center leading-tight max-w-[70px] sm:max-w-[90px] ${
                  active ? sc.text : done ? 'text-gray-700' : 'text-gray-400'
                }`}
              >
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`w-6 sm:w-12 h-0.5 mx-1 sm:mx-2 mt-[-18px] ${
                  step > s.num ? sc.bg : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  // -----------------------------------------------------------------------
  // Step 1: Bases & Sous-recettes
  // -----------------------------------------------------------------------

  const renderStep1 = () => {
    if (loadingSubRecipes) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          <span className="ml-3 text-gray-500">Analyse des sous-recettes...</span>
        </div>
      );
    }

    if (!subRecipes || subRecipes.length === 0) {
      return (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
          <CheckCircle className="mx-auto mb-3 text-emerald-500" size={40} />
          <p className="text-gray-700 font-medium">
            Aucune base partagee detectee
          </p>
          <p className="text-gray-500 text-sm mt-1">
            Les ingredients seront deduits directement des recettes des produits finis.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500 mb-2">
          Les bases ci-dessous sont partagees entre plusieurs produits finis. Renseignez les quantites produites.
        </p>
        {subRecipes.map((sr) => {
          const isExpanded = expandedBases.has(sr.subRecipeId);
          const alreadyProduced = baseAlreadyProduced[sr.subRecipeId] || false;
          return (
            <div
              key={sr.subRecipeId}
              className={`border border-gray-100 rounded-2xl shadow-sm overflow-hidden ${
                alreadyProduced ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-center justify-between p-4 bg-indigo-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
                    <Layers size={18} className="text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{sr.subRecipeName}</p>
                    <p className="text-xs text-gray-500">
                      Besoin total : {sr.totalNeeded} | Rendement : {sr.yieldQuantity}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={alreadyProduced}
                      onChange={(e) =>
                        setBaseAlreadyProduced((prev) => ({
                          ...prev,
                          [sr.subRecipeId]: e.target.checked,
                        }))
                      }
                    />
                    Deja produite
                  </label>
                  {!alreadyProduced && (
                    <input
                      type="number"
                      min={0}
                      className="w-20 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Qte"
                      value={baseActuals[sr.subRecipeId] ?? sr.totalNeeded}
                      onChange={(e) =>
                        setBaseActuals((prev) => ({
                          ...prev,
                          [sr.subRecipeId]: Number(e.target.value),
                        }))
                      }
                    />
                  )}
                </div>
              </div>
              <button
                className="w-full text-left px-4 py-2 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                onClick={() =>
                  setExpandedBases((prev) => {
                    const next = new Set(prev);
                    if (next.has(sr.subRecipeId)) next.delete(sr.subRecipeId);
                    else next.add(sr.subRecipeId);
                    return next;
                  })
                }
              >
                <ChevronRight
                  size={14}
                  className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
                Utilise par {sr.usedBy.length} produit{sr.usedBy.length > 1 ? 's' : ''}
              </button>
              {isExpanded && (
                <div className="px-4 pb-3">
                  <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                    {sr.usedBy.map((u) => (
                      <div key={u.planItemId} className="flex justify-between text-sm">
                        <span className="text-gray-700">{u.productName}</span>
                        <span className="text-gray-500">{u.quantityNeeded}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Step 2: Produits finis
  // -----------------------------------------------------------------------

  const renderStep2 = () => {
    const renderItemRow = (item: Record<string, any>, disabled = false) => {
      const id = item.id as string;
      const isSelected = selectedItems.has(id);
      const planned = (item.planned_quantity as number) || 0;
      const shelfLifeDays = item.shelf_life_days as number | undefined;
      const dlc = shelfLifeDays
        ? format(addDays(new Date(producedAt), shelfLifeDays), 'dd/MM/yyyy', { locale: fr })
        : 'Vente du jour';

      return (
        <div
          key={id}
          className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
            disabled
              ? 'bg-gray-50 opacity-50'
              : isSelected
                ? 'bg-emerald-50/50 border border-emerald-200'
                : 'border border-gray-100'
          }`}
        >
          <input
            type="checkbox"
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0"
            checked={isSelected}
            disabled={disabled}
            onChange={() => toggleItem(id)}
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm truncate">
              {item.product_name as string}
            </p>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Hash size={12} />
                {(item.lot_number as string) || '—'}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {dlc}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setRecipeProductId(recipeProductId === (item.product_id as string) ? null : (item.product_id as string)); }}
              className={`p-1.5 rounded-lg transition-colors ${recipeProductId === (item.product_id as string) ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}
              title="Voir la recette"
            >
              <BookOpen size={14} />
            </button>
            <div className="text-center">
              <p className="text-[10px] text-gray-400 uppercase">Plan</p>
              <p className="text-sm font-semibold text-gray-700">{planned}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-gray-400 uppercase">Reel</p>
              <input
                type="number"
                min={0}
                className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100"
                value={actuals[id] ?? planned}
                disabled={disabled || !isSelected}
                onChange={(e) =>
                  setActuals((prev) => ({
                    ...prev,
                    [id]: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {/* DateTime + Shift */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Date & heure de production
            </label>
            <input
              type="datetime-local"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              value={producedAt}
              onChange={(e) => setProducedAt(e.target.value)}
            />
          </div>
          <div className="sm:w-40">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Equipe detectee
            </label>
            <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 bg-gray-50">
              <Clock size={16} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-700">{shift}</span>
            </div>
          </div>
        </div>

        {/* Select all */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              checked={allProducibleSelected}
              onChange={toggleSelectAll}
            />
            Selectionner tout ({producibleItems.length})
          </label>
          <span className="text-xs text-gray-400">
            {selectedItems.size} selectionne{selectedItems.size > 1 ? 's' : ''}
          </span>
        </div>

        {/* Producible items */}
        <div className="space-y-2">{producibleItems.map((item) => renderItemRow(item))}</div>

        {/* Waiting items */}
        {waitingItems.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400 uppercase mb-2 flex items-center gap-1">
              <AlertTriangle size={12} />
              En attente ({waitingItems.length})
            </p>
            <div className="space-y-2">
              {waitingItems.map((item) => renderItemRow(item, true))}
            </div>
          </div>
        )}

        {/* Recipe panel inline */}
        {recipeProductId && renderRecipeContent()}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Step 3: Pertes & Observations
  // -----------------------------------------------------------------------

  const renderStep3 = () => (
    <div className="space-y-4">
      {/* Toggle losses */}
      <div className="flex items-center justify-between p-4 border border-gray-100 rounded-2xl bg-amber-50/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
            <Flame size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Declarer des pertes</p>
            <p className="text-xs text-gray-500">
              {hasDiscrepancies
                ? `${itemsWithLoss.length} ecart${itemsWithLoss.length > 1 ? 's' : ''} detecte${itemsWithLoss.length > 1 ? 's' : ''}`
                : 'Aucun ecart detecte'}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={declareLosses}
          onClick={() => setDeclareLosses((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            declareLosses ? 'bg-amber-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              declareLosses ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Loss items */}
      {declareLosses && itemsWithLoss.length > 0 && (
        <div className="space-y-3">
          {itemsWithLoss.map((item) => {
            const id = item.id as string;
            return (
              <div key={id} className="border border-amber-200 rounded-2xl p-4 bg-amber-50/20">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-gray-900 text-sm">
                    {item.product_name as string}
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">Plan : {item.planned}</span>
                    <span className="text-emerald-600 font-medium">Prod : {item.actual}</span>
                    <span className="text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded-lg">
                      -{item.lost}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
                    value={lossReasons[id] || ''}
                    onChange={(e) =>
                      setLossReasons((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                  >
                    <option value="">-- Motif --</option>
                    {LOSS_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {lossReasons[id] === 'autre' && (
                    <input
                      type="text"
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      placeholder="Precisez..."
                      value={lossNotes[id] || ''}
                      onChange={(e) =>
                        setLossNotes((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {declareLosses && itemsWithLoss.length === 0 && (
        <div className="text-center py-6 text-sm text-gray-500">
          <CheckCircle className="mx-auto mb-2 text-emerald-400" size={32} />
          Aucun ecart entre quantites planifiees et produites.
        </div>
      )}

      {/* Global observations */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Observations generales
        </label>
        <textarea
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
          rows={3}
          placeholder="Notes, commentaires sur la production..."
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
        />
      </div>
    </div>
  );

  // -----------------------------------------------------------------------
  // Step 4: Confirmation
  // -----------------------------------------------------------------------

  const renderStep4 = () => (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <Package className="mx-auto mb-1 text-emerald-500" size={22} />
          <p className="text-2xl font-bold text-gray-900">{totalSelected}</p>
          <p className="text-xs text-gray-500">Total produits</p>
        </div>
        <div className="border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <Factory className="mx-auto mb-1 text-blue-500" size={22} />
          <p className={`text-2xl font-bold ${yieldRate >= 95 ? 'text-emerald-600' : yieldRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
            {yieldRate}%
          </p>
          <p className="text-xs text-gray-500">Taux de rendement</p>
        </div>
        <div className="border border-gray-100 rounded-2xl p-4 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-1 text-amber-500" size={22} />
          <p className="text-2xl font-bold text-gray-900">{totalLosses}</p>
          <p className="text-xs text-gray-500">Pertes declarees</p>
        </div>
      </div>

      {/* Recap table */}
      <div className="border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <p className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <ClipboardList size={16} className="text-gray-500" />
            Recapitulatif de production
          </p>
        </div>
        <div className="divide-y divide-gray-50">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-medium text-gray-400 uppercase">
            <div className="col-span-4">Produit</div>
            <div className="col-span-2 text-center">Planifie</div>
            <div className="col-span-2 text-center">Produit</div>
            <div className="col-span-2 text-center">Lot</div>
            <div className="col-span-2 text-center">DLC</div>
          </div>
          {[...selectedItems].map((id) => {
            const item = items.find((i) => (i.id as string) === id);
            if (!item) return null;
            const planned = (item.planned_quantity as number) || 0;
            const actual = actuals[id] || 0;
            const shelfLifeDays = item.shelf_life_days as number | undefined;
            const dlc = shelfLifeDays
              ? format(addDays(new Date(producedAt), shelfLifeDays), 'dd/MM', { locale: fr })
              : 'VDJ';
            return (
              <div
                key={id}
                className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm"
              >
                <div className="col-span-4 font-medium text-gray-900 truncate">
                  {item.product_name as string}
                </div>
                <div className="col-span-2 text-center text-gray-500">{planned}</div>
                <div
                  className={`col-span-2 text-center font-semibold ${
                    actual < planned ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                >
                  {actual}
                </div>
                <div className="col-span-2 text-center text-xs text-gray-500 font-mono">
                  {(item.lot_number as string)?.slice(-6) || '—'}
                </div>
                <div className="col-span-2 text-center text-xs text-gray-500">{dlc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Losses recap */}
      {declareLosses && itemsWithLoss.length > 0 && (
        <div className="border border-amber-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
            <p className="font-semibold text-amber-800 text-sm flex items-center gap-2">
              <Flame size={16} />
              Pertes declarees
            </p>
          </div>
          <div className="divide-y divide-amber-50">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-medium text-gray-400 uppercase">
              <div className="col-span-5">Produit</div>
              <div className="col-span-2 text-center">Perdu</div>
              <div className="col-span-5">Motif</div>
            </div>
            {itemsWithLoss.map((item) => {
              const id = item.id as string;
              const reason = LOSS_REASONS.find((r) => r.value === lossReasons[id]);
              return (
                <div
                  key={id}
                  className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm"
                >
                  <div className="col-span-5 text-gray-900 truncate">
                    {item.product_name as string}
                  </div>
                  <div className="col-span-2 text-center text-red-600 font-semibold">
                    -{item.lost}
                  </div>
                  <div className="col-span-5 text-gray-600 text-xs">
                    {reason?.label || '—'}
                    {lossReasons[id] === 'autre' && lossNotes[id]
                      ? ` — ${lossNotes[id]}`
                      : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Print checkbox */}
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          checked={printAfter}
          onChange={(e) => setPrintAfter(e.target.checked)}
        />
        <Printer size={16} className="text-gray-400" />
        Imprimer les tickets apres validation
      </label>
    </div>
  );

  // -----------------------------------------------------------------------
  // Recipe panel
  // -----------------------------------------------------------------------

  const renderRecipeFullscreen = () => {
    if (!recipeProductId || !recipeFullscreen) return null;

    const productName = items.find((i) => (i.product_id as string) === recipeProductId)?.product_name as string || '';
    const ingredients = ((recipeData?.ingredients || []) as Record<string, any>[]);
    const subRecipesData = ((recipeData?.sub_recipes || []) as Record<string, any>[]);
    const instructions = ((recipeData?.instructions as string) || '');

    return (
      <div className="fixed inset-0 z-[60] bg-white overflow-auto flex flex-col">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChefHat size={22} className="text-blue-600" />
            <div>
              <h2 className="font-bold text-gray-900 text-lg">Recette : {productName}</h2>
              {recipeData && (
                <p className="text-sm text-gray-500">
                  Rendement : {recipeData.yield_quantity} {recipeData.yield_unit || 'unite(s)'}
                  {recipeData.total_cost && parseFloat(recipeData.total_cost) > 0 && ` | Cout : ${parseFloat(recipeData.total_cost).toFixed(2)} DH`}
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setRecipeFullscreen(false)} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-gray-100 transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full space-y-6">
          {loadingRecipe ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
              <span className="ml-3 text-gray-500">Chargement...</span>
            </div>
          ) : !recipeData ? (
            <div className="text-center py-12 text-gray-500">
              <BookOpen className="mx-auto mb-3 text-gray-300" size={40} />
              <p>Aucune recette enregistree.</p>
            </div>
          ) : (
            <>
              {/* Ingredients — large font for kitchen */}
              {ingredients.length > 0 && (
                <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-200 flex items-center gap-2">
                    <Scale size={18} className="text-emerald-600" />
                    <span className="font-bold text-emerald-800">Ingredients ({ingredients.length})</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {ingredients.map((ing, idx) => (
                      <div key={idx} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50">
                        <span className="text-base font-medium text-gray-900">{ing.ingredient_name as string}</span>
                        <span className="text-base text-gray-700 font-mono font-semibold">
                          {parseFloat(ing.quantity as string).toFixed(2)} {ing.unit as string}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-recipes */}
              {subRecipesData.length > 0 && (
                <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center gap-2">
                    <Layers size={18} className="text-indigo-600" />
                    <span className="font-bold text-indigo-800">Sous-recettes ({subRecipesData.length})</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {subRecipesData.map((sr, idx) => (
                      <div key={idx} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50">
                        <span className="text-base font-medium text-gray-900">{sr.sub_recipe_name as string}</span>
                        <span className="text-base text-gray-700 font-mono">
                          {parseFloat(sr.quantity as string).toFixed(2)} (rendement: {sr.sub_yield_quantity as number} {(sr as Record<string, any>).sub_yield_unit as string || 'u.'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Instructions — large and readable */}
              {instructions && (
                <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                    <ClipboardList size={18} className="text-amber-600" />
                    <span className="font-bold text-amber-800">Instructions de preparation</span>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-base text-gray-800 whitespace-pre-wrap leading-7">
                      {instructions}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const renderRecipeContent = () => {
    const productName = items.find((i) => (i.product_id as string) === recipeProductId)?.product_name as string || '';

    if (loadingRecipe) {
      return (
        <div className="mt-4 bg-blue-50/50 border border-blue-200 rounded-2xl p-6">
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
            <span className="ml-2 text-gray-500 text-sm">Chargement de la recette...</span>
          </div>
        </div>
      );
    }

    if (!recipeData) {
      return (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
          <BookOpen className="mx-auto mb-2 text-gray-300" size={28} />
          <p className="text-sm text-gray-500">Aucune recette enregistree pour {productName}.</p>
        </div>
      );
    }

    const ingredients = (recipeData.ingredients || []) as Record<string, any>[];
    const subRecipesData = (recipeData.sub_recipes || []) as Record<string, any>[];
    const instructions = (recipeData.instructions as string) || '';

    return (
      <div className="mt-4 border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Recipe header */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <ChefHat size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-blue-900 text-sm">Recette : {productName}</h3>
              <div className="flex items-center gap-3 text-xs text-blue-600">
                {recipeData.yield_quantity && <span>Rendement : {recipeData.yield_quantity} {recipeData.yield_unit || 'unite(s)'}</span>}
                {recipeData.total_cost && parseFloat(recipeData.total_cost) > 0 && (
                  <span>Cout : {parseFloat(recipeData.total_cost).toFixed(2)} DH</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setRecipeFullscreen(true)} className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors" title="Plein ecran">
              <Eye size={14} />
            </button>
            <button onClick={() => setRecipeProductId(null)} className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors" title="Fermer">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3 bg-white">
          {/* Ingredients */}
          {ingredients.length > 0 && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
                <Scale size={13} className="text-emerald-600" />
                <span className="font-semibold text-emerald-800 text-xs uppercase tracking-wider">Ingredients ({ingredients.length})</span>
              </div>
              <div className="divide-y divide-gray-50">
                {ingredients.map((ing, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50/50">
                    <span className="text-sm font-medium text-gray-800">{ing.ingredient_name as string}</span>
                    <span className="text-sm text-gray-600 font-mono">
                      {parseFloat(ing.quantity as string).toFixed(2)} {ing.unit as string}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sub-recipes */}
          {subRecipesData.length > 0 && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
                <Layers size={13} className="text-indigo-600" />
                <span className="font-semibold text-indigo-800 text-xs uppercase tracking-wider">Sous-recettes ({subRecipesData.length})</span>
              </div>
              <div className="divide-y divide-gray-50">
                {subRecipesData.map((sr, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50/50">
                    <span className="text-sm font-medium text-gray-800">{sr.sub_recipe_name as string}</span>
                    <span className="text-sm text-gray-600 font-mono">
                      {parseFloat(sr.quantity as string).toFixed(2)} (rendement: {sr.sub_yield_quantity as number} {(sr as Record<string, any>).sub_yield_unit as string || 'u.'})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          {instructions && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                <ClipboardList size={13} className="text-amber-600" />
                <span className="font-semibold text-amber-800 text-xs uppercase tracking-wider">Instructions de preparation</span>
              </div>
              <div className="px-3 py-3">
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {instructions}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };


  // Recette visible sur CHAQUE etape structuree : le patissier doit avoir les
  // pesees sous les yeux pendant qu'il execute l'etape, sans quitter l'assistant.
  //
  // Une etape peut porter `ingredient_refs` (mig 297) : "<ingredient_id>" ou
  // "<ingredient_id>#n" (n-ieme occurrence du meme ingredient, ordre de saisie).
  //   - cle absente  → etape non affectee : toute la recette
  //   - cle presente → seulement ces lignes ("Aucune pesee" si vide), le reste
  //     de la recette reste accessible repliee.
  // Les quantites sont mises a l'echelle du lot (planifie / rendement recette).
  const renderRecipeSummary = (step: Record<string, any> | null, item: Record<string, any>) => {
    if (loadingRecipe) {
      return (
        <div className="border border-gray-200 rounded-xl p-4 flex items-center justify-center gap-2 text-sm text-gray-500">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" /> Chargement de la recette…
        </div>
      );
    }
    if (!recipeData) {
      return (
        <div className="border border-gray-200 rounded-xl p-4 text-center text-sm text-gray-500">
          <BookOpen className="mx-auto mb-1 text-gray-300" size={22} /> Aucune recette enregistrée.
        </div>
      );
    }
    const rawIngredients = (recipeData.ingredients || []) as Record<string, any>[];
    const subRecipesData = (recipeData.sub_recipes || []) as Record<string, any>[];
    const instructions = (recipeData.instructions as string) || '';

    // Occurrence de chaque ingredient dans l'ordre de saisie → ref "id" / "id#n".
    const seen = new Map<string, number>();
    const ingredients = [...rawIngredients]
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
      .map((ing) => {
        const ingId = ing.ingredient_id as string;
        const n = (seen.get(ingId) || 0) + 1;
        seen.set(ingId, n);
        return { ...ing, _occ: n };
      });
    const dupIds = new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
    const refOf = (ing: Record<string, any>) =>
      dupIds.has(ing.ingredient_id as string) ? `${ing.ingredient_id}#${ing._occ}` : (ing.ingredient_id as string);
    const matches = (ing: Record<string, any>, refs: string[]) =>
      refs.includes(refOf(ing)) || refs.includes(ing.ingredient_id as string);

    const refs = step && Array.isArray(step.ingredient_refs) ? (step.ingredient_refs as string[]) : null;
    const stepIngredients = refs ? ingredients.filter((ing) => matches(ing, refs)) : null;

    // Mise a l'echelle : planifie / rendement. Produits a la piece dont la recette
    // est en poids : on passe par le poids piece.
    const yieldQty = parseFloat(recipeData.yield_quantity as string || '0');
    const yieldUnit = ((recipeData.yield_unit as string) || '').toLowerCase();
    const pieceKg = parseFloat(recipeData.piece_weight_kg as string || '0');
    const plannedQty = Number(item.quantite_brute_totale || item.planned_quantity || 0);
    const yieldIsWeight = ['kg', 'g', 'l', 'ml'].includes(yieldUnit);
    const yieldInKg = yieldUnit === 'g' || yieldUnit === 'ml' ? yieldQty / 1000 : yieldQty;
    let factor = 1;
    if (yieldQty > 0 && plannedQty > 0) {
      factor = (yieldIsWeight && pieceKg > 0 && !item.base_recipe_id)
        ? (plannedQty * pieceKg) / yieldInKg
        : plannedQty / yieldQty;
    }
    const scaled = Number.isFinite(factor) && factor > 0 && Math.abs(factor - 1) > 1e-6;
    const fmtQty = (ing: Record<string, any>) => {
      const q = parseFloat(ing.quantity as string || '0') * (scaled ? factor : 1);
      const u = (ing.unit as string) || '';
      const digits = u === 'g' || u === 'ml' ? 0 : 2;
      return `${q.toFixed(digits)} ${u}`;
    };

    const Row = ({ ing, muted }: { ing: Record<string, any>; muted?: boolean }) => (
      <tr className={muted ? 'text-gray-500' : ''}>
        <td className="px-3 py-2 font-medium">
          {ing.ingredient_name as string}
          {dupIds.has(ing.ingredient_id as string) && <span className="ml-1 text-xs text-gray-400">({ing._occ})</span>}
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
          <span className={muted ? '' : 'text-base font-semibold text-gray-900'}>{fmtQty(ing)}</span>
          {scaled && <span className="ml-2 text-xs text-gray-400">({parseFloat(ing.quantity as string).toFixed(0)} {ing.unit as string})</span>}
        </td>
      </tr>
    );

    return (
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2 flex-wrap">
          <Scale size={14} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
            {stepIngredients ? 'À peser pour cette étape' : `Recette · ${ingredients.length} ingrédient${ingredients.length > 1 ? 's' : ''}`}
          </span>
          {scaled && (
            <span className="text-xs text-gray-500">
              — lot ×{factor.toFixed(2)} ({plannedQty} {item.base_recipe_id ? yieldUnit : 'pièces'} pour {yieldQty} {yieldUnit || 'u.'} de recette)
            </span>
          )}
          <button type="button" onClick={() => setRecipeFullscreen(true)}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800" title="Plein écran">
            <Eye size={13} /> Plein écran
          </button>
        </div>

        {stepIngredients ? (
          stepIngredients.length > 0 ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {stepIngredients.map((ing) => <Row key={refOf(ing)} ing={ing} />)}
              </tbody>
            </table>
          ) : (
            <div className="px-3 py-3 text-sm text-gray-500 italic">Aucune pesée à cette étape.</div>
          )
        ) : ingredients.length > 0 && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {ingredients.map((ing) => <Row key={refOf(ing)} ing={ing} />)}
            </tbody>
          </table>
        )}

        {/* Reste de la recette (replie) quand l'etape est affectee */}
        {stepIngredients && (ingredients.length > stepIngredients.length || subRecipesData.length > 0) && (
          <details className="border-t border-gray-200 group">
            <summary className="px-3 py-2 flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-50 list-none">
              <Layers size={13} className="text-gray-500" /> Toute la recette ({ingredients.length} ingrédient{ingredients.length > 1 ? 's' : ''}{subRecipesData.length > 0 ? `, ${subRecipesData.length} sous-recette${subRecipesData.length > 1 ? 's' : ''}` : ''})
              <span className="ml-auto text-gray-400 group-open:hidden">afficher</span>
              <span className="ml-auto text-gray-400 hidden group-open:inline">masquer</span>
            </summary>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {ingredients.map((ing) => <Row key={refOf(ing)} ing={ing} muted={!matches(ing, refs!)} />)}
                {subRecipesData.map((sr, idx) => (
                  <tr key={`sr-${idx}`} className="bg-indigo-50/40">
                    <td className="px-3 py-2 font-medium text-indigo-900"><Layers size={12} className="inline mr-1 text-indigo-500" />{sr.sub_recipe_name as string}</td>
                    <td className="px-3 py-2 text-right font-mono text-indigo-800 whitespace-nowrap">
                      {(parseFloat(sr.quantity as string) * (scaled ? factor : 1)).toFixed(2)} {(sr as Record<string, any>).sub_yield_unit as string || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {instructions && (
          <div className="border-t border-gray-200">
            <button type="button" onClick={() => setShowStepInstructions(v => !v)}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              <ClipboardList size={13} className="text-gray-500" />
              Instructions complètes
              <span className="ml-auto text-gray-400">{showStepInstructions ? 'masquer' : 'afficher'}</span>
            </button>
            {showStepInstructions && (
              <div className="px-3 pb-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{instructions}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Single-item stepped production view
  // -----------------------------------------------------------------------

  const isSingleItem = !!targetItemId && items.length === 1;
  const singleProductId = isSingleItem ? (items[0]?.product_id as string) : undefined;
  // Reprise : si l'utilisateur a sauvegarde-et-quitte sur une etape precise, on
  // restaure cette etape. Sinon, fallback historique : in_progress → step 2 (Recette),
  // sinon step 1 (Lancement).
  const resumeKey = targetItemId ? `ofauria_resume_step_${targetItemId}` : null;
  const initialSingleStep = (() => {
    if (!isSingleItem || !items[0]) return 1;
    if (resumeKey) {
      try {
        const saved = localStorage.getItem(resumeKey);
        const parsed = saved ? parseInt(saved, 10) : NaN;
        if (Number.isFinite(parsed) && parsed >= 1) return parsed;
      } catch { /* localStorage indispo */ }
    }
    return (items[0].status as string) === 'in_progress' ? 2 : 1;
  })();
  const [singleStep, setSingleStepState] = useState(initialSingleStep);
  const [starting, setStarting] = useState(false);

  // Wrapper qui persiste l'etape courante dans localStorage a chaque changement,
  // pour que la fermeture brutale (cmd+W) ne perde pas la position.
  const setSingleStep: typeof setSingleStepState = (action) => {
    setSingleStepState((prev) => {
      const next = typeof action === 'function' ? (action as (p: number) => number)(prev) : action;
      if (resumeKey) {
        try { localStorage.setItem(resumeKey, String(next)); } catch { /* ignore */ }
      }
      return next;
    });
  };

  // Fetch production profile for single-item view
  const { data: profileData } = useQuery({
    queryKey: ['production-profile', singleProductId],
    queryFn: () => contenantsApi.getProfile(singleProductId!),
    enabled: !!singleProductId,
  });
  const productionProfile = profileData?.data || null;

  // Auto-start item when modal opens for a pending item
  const handleAutoStart = async () => {
    const item = items[0];
    if (!item || (item.status as string) !== 'pending') return;
    setStarting(true);
    try {
      await productionApi.startItems(planId, [item.id as string], producedAt);
      await queryClient.invalidateQueries({ queryKey: ['production'] });
    } catch (err: unknown) {
      notify.error(apiErrorMessage(err, 'Erreur lors du lancement'));
    } finally {
      setStarting(false);
    }
  };

  // Save & quit: close modal, item stays in_progress
  const handleSaveAndQuit = async () => {
    const item = items[0];
    if (!item) return;
    // If item is still pending, start it first
    if ((item.status as string) === 'pending') {
      await handleAutoStart();
    }
    notify.success('Production sauvegardee — vous pouvez y revenir');
    onClose();
  };

  // Dynamic steps: recipe étapes take priority, then profile overrides, then generic flow
  const recipeEtapes: Record<string, any>[] = recipeData?.etapes || [];
  const profileEtapesOverrides: Record<string, any>[] = productionProfile?.etapes || [];
  const dynamicSteps: Record<string, any>[] =
    (profileEtapesOverrides.length > 0 ? profileEtapesOverrides : recipeEtapes);
  const hasProfileSteps = dynamicSteps.length > 0;

  const SINGLE_STEPS = hasProfileSteps
    ? [
        ...dynamicSteps.map((s, i) => ({ num: i + 1, label: s.nom as string, icon: <ClipboardList size={14} />, profileStep: s })),
        { num: dynamicSteps.length + 1, label: 'Enregistrement', icon: <CheckCircle size={14} />, profileStep: null },
      ]
    : [
        { num: 1, label: 'Lancement', icon: <Play size={14} />, profileStep: null },
        { num: 2, label: 'Recette', icon: <BookOpen size={14} />, profileStep: null },
        { num: 3, label: 'Enregistrement', icon: <CheckCircle size={14} />, profileStep: null },
      ];
  const totalSteps = SINGLE_STEPS.length;
  const isLastStep = singleStep === totalSteps;

  // Jump to the correct step when opened from a timer notification
  const initialStepApplied = useRef(false);
  useEffect(() => {
    if (initialStepName && !initialStepApplied.current && SINGLE_STEPS.length > 1) {
      const idx = SINGLE_STEPS.findIndex(s => s.label === initialStepName);
      if (idx >= 0) {
        initialStepApplied.current = true;
        setSingleStep(idx + 1);
      }
    }
  }, [initialStepName, SINGLE_STEPS]);

  // ─── Coupe : repartition des sorties d'un cadre (tranches / entremets) ───
  // Decision du chef, prise ici, dans le plan : aucun parametrage dans la fiche
  // technique. « Pieces uniquement » = comportement habituel. « Coupe mixte » =
  // il ajoute les produits qu'il a preleves (un entremets) et dit combien de
  // pieces chacun prend dans le cadre ; la quantite produite devient la somme
  // en pieces equivalentes. Les sorties deja utilisees pour ce produit sont
  // proposees d'un clic.
  const renderCutSection = (item: Record<string, any>) => {
    if (!item.product_id) return null;
    const id = item.id as string;
    const planned = (item.planned_quantity as number) || 0;
    const active = !!cutMode[id];
    const presets = (Array.isArray(item.cut_presets) ? item.cut_presets : []) as Record<string, any>[];
    const num = (v: string) => parseFloat(String(v ?? '').replace(',', '.')) || 0;
    const lines: CutLine[] = cutLines[id] || [];
    const totalOf = (ls: CutLine[]) => ls.reduce((sum, l) => sum + num(l.qty) * (l.base ? 1 : num(l.equiv)), 0);
    const total = totalOf(lines);
    const apply = (next: CutLine[]) => {
      setCutLines((prev) => ({ ...prev, [id]: next }));
      setActuals((prev) => ({ ...prev, [id]: Math.round(totalOf(next)) }));
    };
    const edit = (key: string, patch: Partial<CutLine>) => apply(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const toggle = (on: boolean) => {
      setCutMode((prev) => ({ ...prev, [id]: on }));
      if (on) {
        if (lines.length === 0) {
          // Point de depart : tout en pieces ; le chef ajoute ce qu'il a preleve.
          apply([{ key: 'base', base: true, productId: item.product_id as string, label: (item.product_name as string) || 'Pièce', equiv: '1', qty: String(actuals[id] ?? planned) }]);
        }
      } else {
        setActuals((prev) => ({ ...prev, [id]: planned }));
      }
    };
    const addLine = (preset?: Record<string, any>) => {
      const key = `l${Date.now()}${Math.round(Math.random() * 1000)}`;
      apply([...lines, {
        key, base: false,
        productId: (preset?.product_id as string) || '',
        label: (preset?.label as string) || '',
        equiv: preset ? String(parseFloat(String(preset.equiv_pieces))) : '',
        qty: '',
      }]);
    };
    const diff = Math.round((total - planned) * 100) / 100;
    const usedIds = new Set(lines.map((l) => l.productId));
    const incomplete = lines.some((l) => !l.base && num(l.qty) > 0 && (!l.productId || !(num(l.equiv) > 0)));

    return (
      <div className="border border-indigo-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-2 flex-wrap">
          <Layers size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-900">Coupe</span>
          <span className="text-xs text-indigo-700">
            {item.cut_contenant_nom ? `${item.cut_contenant_nom} · ` : ''}prévu {planned} pièces
          </span>
          <div className="ml-auto inline-flex rounded-lg border border-indigo-200 overflow-hidden text-xs font-medium">
            <button type="button" onClick={() => toggle(false)}
              className={`px-3 py-1.5 ${!active ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}>
              Pièces uniquement
            </button>
            <button type="button" onClick={() => toggle(true)}
              className={`px-3 py-1.5 border-l border-indigo-200 ${active ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-700 hover:bg-indigo-50'}`}>
              Coupe mixte
            </button>
          </div>
        </div>
        {active ? (
          <div className="p-3 space-y-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-left font-medium pb-1">Sortie</th>
                  <th className="text-right font-medium pb-1 w-24">Quantité</th>
                  <th className="text-right font-medium pb-1 w-28">Vaut (pièces)</th>
                  <th className="text-right font-medium pb-1 w-20">= pièces</th>
                  <th className="w-7" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="py-1.5 pr-2">
                      {l.base ? (
                        <span className="font-medium text-gray-800">{l.label}</span>
                      ) : (
                        <select value={l.productId}
                          onChange={(e) => {
                            const p = cutProducts.find((x) => x.id === e.target.value);
                            edit(l.key, { productId: e.target.value, label: p?.name || '' });
                          }}
                          className={`w-full h-9 px-2 bg-white border rounded-lg text-sm ${!l.productId ? 'border-amber-300' : 'border-gray-300'}`}>
                          <option value="">— choisir le produit sorti —</option>
                          {cutProducts
                            .filter((p) => p.id !== item.product_id && (p.id === l.productId || !usedIds.has(p.id)))
                            .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <input type="number" min={0} step={1} inputMode="numeric"
                        value={l.qty} placeholder="0"
                        onChange={(e) => edit(l.key, { qty: e.target.value })}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-right font-semibold tabular-nums focus:ring-2 focus:ring-indigo-400" />
                    </td>
                    <td className="py-1.5 text-right">
                      {l.base ? (
                        <span className="text-gray-500 tabular-nums">× 1</span>
                      ) : (
                        <input type="number" min={0} step={0.5} inputMode="decimal"
                          value={l.equiv} placeholder="8"
                          title="Combien de pièces cette sortie prend dans le cadre"
                          onChange={(e) => edit(l.key, { equiv: e.target.value })}
                          className={`w-20 border rounded-lg px-2 py-1.5 text-right tabular-nums focus:ring-2 focus:ring-indigo-400 ${num(l.qty) > 0 && !(num(l.equiv) > 0) ? 'border-amber-400' : 'border-gray-300'}`} />
                      )}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">
                      {(() => { const v = num(l.qty) * (l.base ? 1 : num(l.equiv)); return v.toFixed(v % 1 === 0 ? 0 : 1); })()}
                    </td>
                    <td className="py-1.5 text-right">
                      {!l.base && (
                        <button type="button" onClick={() => apply(lines.filter((x) => x.key !== l.key))}
                          className="p-1 text-gray-400 hover:text-red-600" title="Retirer cette sortie">
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" onClick={() => addLine()}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50">
                + Ajouter une sortie (entremets…)
              </button>
              {presets.filter((p) => !usedIds.has(p.product_id as string)).map((p) => (
                <button key={p.product_id as string} type="button" onClick={() => addLine(p)}
                  title="Sortie déjà utilisée pour ce produit"
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-gray-200 text-gray-600 bg-white hover:bg-gray-50">
                  {p.label as string} <span className="text-gray-400">= {parseFloat(String(p.equiv_pieces))} pièces</span>
                </button>
              ))}
            </div>

            <div className={`flex items-center justify-between gap-2 flex-wrap rounded-lg px-3 py-2 text-sm ${
              Math.abs(diff) < 0.01 ? 'bg-emerald-50 text-emerald-800'
              : diff > 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
              <span>
                Total : <strong>{total.toFixed(total % 1 === 0 ? 0 : 1)}</strong> pièces équivalentes sur {planned} prévues
              </span>
              <span className="font-semibold">
                {Math.abs(diff) < 0.01 ? 'coupe complète'
                  : diff > 0 ? `+${diff} : plus que le cadre ne peut donner`
                  : `${diff} : chutes ou perte à justifier`}
              </span>
            </div>
            {incomplete && (
              <p className="text-xs text-amber-700">Chaque sortie ajoutée a besoin d'un produit et du nombre de pièces qu'elle prend dans le cadre.</p>
            )}
          </div>
        ) : (
          <p className="px-3 py-2 text-xs text-gray-500">
            Tout sort en « {item.product_name as string} ». Passe en coupe mixte si tu as aussi prélevé un entremets ou un autre format dans ce cadre.
          </p>
        )}
      </div>
    );
  };

  const renderSingleItemView = () => {
    const item = items[0];
    if (!item) return null;
    const id = item.id as string;
    const planned = (item.planned_quantity as number) || 0;
    const actual = actuals[id] ?? planned;
    const lotNumber = (item.lot_number as string) || '';
    const shelfLifeDays = item.shelf_life_days as number | undefined;
    const dlc = shelfLifeDays
      ? format(addDays(new Date(producedAt), shelfLifeDays), 'dd/MM/yyyy', { locale: fr })
      : 'Vente du jour';
    const hasLoss = actual < planned;
    const isAlreadyStarted = (item.status as string) === 'in_progress';

    // Progression stricte : pour une etape de profil avec timer auto, il faut que le
    // timer ait demarre ET soit termine pour passer a l'etape suivante. Les etapes
    // sans timer n'ont pas de critere objectif → on laisse passer (le chef choisit).
    const currentProfileStep = hasProfileSteps && singleStep <= dynamicSteps.length
      ? dynamicSteps[singleStep - 1]
      : null;
    const stepHasTimer = !!(currentProfileStep?.timer_auto && currentProfileStep?.duree_estimee_min);
    const stepIsBlocking = !!currentProfileStep?.est_bloquante;
    const stepName = currentProfileStep?.nom as string | undefined;
    const stepTimer = stepHasTimer && stepName
      ? activeTimers.find(t => t.planItemId === id && t.stepName === stepName)
      : null;
    const stepTimerRemaining = stepTimer ? getTimerRemaining(stepTimer.id) : -1;
    // Un timer est "fait" si :
    //   - il n'existe plus mais a deja sonne pour ce step (firedMap)
    //   - ou il existe et son temps restant est 0
    const stepTimerAlreadyFired = !!(stepHasTimer && stepName && hasTimerFired(id, stepName));
    const stepTimerNotStarted = stepHasTimer && !stepTimer && !stepTimerAlreadyFired;
    const stepTimerRunning = stepHasTimer && !!stepTimer && stepTimerRemaining > 0;
    // Le blocage de Suivant ne s'applique QU'AUX etapes bloquantes : pour les non-bloquantes,
    // le chef peut avancer librement meme sans avoir lance/termine le chrono.
    const stepTimerSkipped = !!timerSkipped[`${id}:${singleStep}`];
    const blockedByTimer = stepIsBlocking && !stepTimerSkipped && (stepTimerNotStarted || stepTimerRunning);
    // Controle qualite : comme l'annonce la fiche, l'etape ne se quitte qu'une fois
    // tous ses points coches.
    const qcItems = currentProfileStep?.controle_qualite
      ? ((currentProfileStep.checklist_items as string[]) || [])
      : [];
    const qcDone = qcItems.filter((_, i) => qcChecked[`${id}:${singleStep}:${i}`]).length;
    const blockedByQc = qcItems.length > 0 && qcDone < qcItems.length;
    const canAdvance = !blockedByTimer && !blockedByQc;
    // Ce qui empeche de passer a la suite, dit en clair a cote du bouton (avant :
    // bouton grise sans explication, sauf en survolant).
    const blockReasons: string[] = [];
    if (blockedByTimer && stepTimerNotStarted) blockReasons.push('le chrono n\'a pas été démarré');
    if (blockedByTimer && stepTimerRunning) {
      blockReasons.push(`le chrono tourne encore (${Math.floor(stepTimerRemaining / 60)} min ${String(stepTimerRemaining % 60).padStart(2, '0')} s)`);
    }
    if (blockedByQc) blockReasons.push(`${qcItems.length - qcDone} point(s) de contrôle à cocher sur ${qcItems.length}`);

    return (
      <div className="fixed inset-0 z-50 bg-white overflow-auto flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-gray-100 transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
              <div>
                <h1 className="font-bold text-gray-900 text-lg">{item.product_name as string}</h1>
                <p className="text-xs text-gray-500">
                  {format(new Date(plan.plan_date as string), 'EEEE d MMMM yyyy', { locale: fr })}
                  {lotNumber && <span className="ml-2 font-mono">• {lotNumber}</span>}
                </p>
              </div>
            </div>
            <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-50 text-blue-700">
              Etape {singleStep}/{totalSteps}
            </span>
          </div>
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1 py-3 px-4 overflow-x-auto">
            {SINGLE_STEPS.map((s, idx) => {
              const done = singleStep > s.num;
              const active = singleStep === s.num;
              return (
                <div key={s.num} className="flex items-center shrink-0">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                      done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-600 text-white ring-4 ring-blue-200' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {done ? <Check size={14} /> : s.num}
                    </div>
                    <span className={`text-[10px] font-medium max-w-[60px] text-center truncate ${active ? 'text-blue-700' : done ? 'text-gray-700' : 'text-gray-400'}`}>
                      {s.label}
                    </span>
                  </div>
                  {idx < SINGLE_STEPS.length - 1 && (
                    <div className={`w-6 sm:w-10 h-0.5 mx-0.5 mt-[-16px] ${singleStep > s.num ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full">

          {/* ─── Dynamic steps from profile OR generic flow ─── */}
          {hasProfileSteps ? (
            <>
              {/* Profile step content */}
              {singleStep <= dynamicSteps.length && (() => {
                const currentProfileStep = dynamicSteps[singleStep - 1];
                const isFirstStep = singleStep === 1;
                return (
                  <div className="space-y-4">
                    {/* Step header */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 text-lg font-bold flex items-center justify-center shrink-0">
                        {singleStep}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">{currentProfileStep.nom as string}</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                          {!!currentProfileStep.est_bloquante && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">BLOQUANT</span>
                          )}
                          {currentProfileStep.duree_estimee_min && (() => {
                            const runningTimer = activeTimers.find(t => t.planItemId === id && t.stepName === (currentProfileStep.nom as string));
                            return runningTimer ? (
                              <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded flex items-center gap-0.5 animate-pulse">
                                <Clock size={10} /> En cours
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded flex items-center gap-0.5">
                                <Clock size={10} /> {currentProfileStep.duree_estimee_min as number} min
                              </span>
                            );
                          })()}
                          {currentProfileStep.controle_qualite && (
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded flex items-center gap-0.5">
                              <Check size={10} /> Controle qualite
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* First step: show product info + date + contenant */}
                    {isFirstStep && (
                      <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-blue-200">
                          <div className="flex items-center gap-3">
                            {item.product_image ? (
                              <img src={item.product_image as string} alt="" className="w-12 h-12 rounded-xl object-cover" />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                                <Package size={20} className="text-blue-600" />
                              </div>
                            )}
                            <div className="flex-1">
                              <h3 className="font-bold text-gray-900">{item.product_name as string}</h3>
                              <div className="flex items-center gap-3 mt-0.5 text-sm text-gray-600">
                                <span className="font-semibold">Qte : {planned}</span>
                                <span className="text-xs"><Clock size={11} className="inline" /> {dlc}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="p-3 space-y-3">
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 mb-1">Date & heure de lancement</label>
                              <input type="datetime-local" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
                            </div>
                            <div className="w-28">
                              <label className="block text-xs font-medium text-gray-500 mb-1">Equipe</label>
                              <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-center font-medium text-gray-700 flex items-center gap-1 justify-center">
                                <Clock size={12} className="text-gray-400" /> {detectShift(producedAt)}
                              </div>
                            </div>
                          </div>
                          {isAlreadyStarted && (
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-sm text-blue-700 flex items-center gap-2">
                              <CheckCircle size={14} /> Production deja lancee.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Contenant info (first step only) */}
                    {isFirstStep && productionProfile && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-indigo-50 rounded-xl p-3">
                          <div className="text-xl font-bold text-indigo-700">{item.nb_contenants || Math.ceil(planned / productionProfile.quantite_nette_cible)}</div>
                          <div className="text-[9px] text-gray-500 uppercase mt-0.5">{productionProfile.contenant_nom}</div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <div className="text-xl font-bold text-gray-700">{productionProfile.quantite_nette_cible}</div>
                          <div className="text-[9px] text-gray-500 uppercase mt-0.5">Net / format</div>
                        </div>
                        <div className="bg-purple-50 rounded-xl p-3">
                          <div className="text-xl font-bold text-purple-700">{item.quantite_brute_totale || planned}</div>
                          <div className="text-[9px] text-gray-500 uppercase mt-0.5">Qte brute totale</div>
                        </div>
                      </div>
                    )}

                    {/* Timer display for steps with timer_auto */}
                    {currentProfileStep.timer_auto && currentProfileStep.duree_estimee_min && (() => {
                      const existingTimer = activeTimers.find(t => t.planItemId === id && t.stepName === (currentProfileStep.nom as string));
                      const remaining = existingTimer ? getTimerRemaining(existingTimer.id) : 0;
                      const isRunning = !!existingTimer && remaining > 0;
                      const mins = Math.floor(remaining / 60);
                      const secs = remaining % 60;
                      const fired = hasTimerFired(id, currentProfileStep.nom as string);
                      const skipKey = `${id}:${singleStep}`;
                      const skipped = !!timerSkipped[skipKey];

                      // Chrono termine (ou declare fait) : on le dit, au lieu de reproposer
                      // « Demarrer le chrono » comme si rien n'avait ete fait.
                      if (!isRunning && (fired || skipped)) {
                        return (
                          <div className="border border-emerald-200 bg-emerald-50 rounded-2xl p-4 flex items-center gap-3">
                            <CheckCircle size={22} className="text-emerald-600 shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-emerald-900">
                                {fired ? 'Chrono terminé' : 'Durée déclarée respectée'} — {currentProfileStep.duree_estimee_min as number} min
                              </p>
                              {skipped && !fired && <p className="text-xs text-emerald-700">Temps d'attente fait sans le chrono de l'application.</p>}
                            </div>
                            {skipped && !fired && (
                              <button type="button" onClick={() => setTimerSkipped((prev) => ({ ...prev, [skipKey]: false }))}
                                className="text-xs text-emerald-700 hover:underline">Annuler</button>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div className={`border rounded-2xl p-5 text-center transition-all ${
                          isRunning
                            ? 'border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50 animate-pulse-slow'
                            : 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50'
                        }`}>
                          <Clock size={28} className={`mx-auto mb-2 ${isRunning ? 'text-orange-600' : 'text-blue-600'}`} />
                          <div className={`text-4xl font-bold font-mono ${isRunning ? 'text-orange-800' : 'text-blue-800'}`}>
                            {isRunning
                              ? `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                              : `${currentProfileStep.duree_estimee_min as number}:00`
                            }
                          </div>
                          <p className={`text-xs mt-1 ${isRunning ? 'text-orange-600' : 'text-blue-600'}`}>
                            {isRunning ? 'Chronometre en cours...' : 'Duree estimee pour cette etape'}
                          </p>
                          <div className="mt-3">
                            {!isRunning ? (
                              <button
                                type="button"
                                onClick={() => startTimer({
                                  planId,
                                  planItemId: id,
                                  productName: item.product_name as string,
                                  stepName: currentProfileStep.nom as string,
                                  durationMin: currentProfileStep.duree_estimee_min as number,
                                })}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all"
                              >
                                <Play size={14} /> Demarrer le chrono
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => stopTimer(existingTimer!.id)}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-300 transition-all"
                              >
                                <X size={14} /> Arreter
                              </button>
                            )}
                          </div>
                          {!!currentProfileStep.est_bloquante && (
                            <button type="button"
                              onClick={async () => {
                                const ok = await confirmDialog(
                                  `Le temps de cette étape (${currentProfileStep.duree_estimee_min as number} min) est déjà écoulé ?\n\nÀ utiliser seulement si l'attente a été faite sans lancer le chrono.`,
                                  { title: 'Passer le chrono', confirmLabel: 'Oui, le temps est écoulé' });
                                if (!ok) return;
                                if (existingTimer) stopTimer(existingTimer.id);
                                setTimerSkipped((prev) => ({ ...prev, [skipKey]: true }));
                              }}
                              className="mt-3 block mx-auto text-xs text-gray-500 hover:text-gray-800 underline">
                              Le temps est déjà écoulé ? Passer le chrono
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Deroule de l'etape : les lignes de la fiche technique. Toujours
                        affichees (avant : seulement sur les etapes sous controle qualite,
                        une etape « Decor » ne montrait que son titre). Sous controle
                        qualite, chaque point se coche et l'ensemble conditionne « Suivant ». */}
                    {(() => {
                      const linesFr = (currentProfileStep.checklist_items as string[]) || [];
                      const linesAr = (currentProfileStep.checklist_items_ar as string[]) || [];
                      const hasAr = linesAr.length > 0 || !!currentProfileStep.nom_ar;
                      const ar = stepLang === 'ar' && hasAr;
                      const isQc = !!currentProfileStep.controle_qualite;
                      if (linesFr.length === 0 && !isQc) return null;
                      return (
                        <div className={`border rounded-2xl p-4 ${isQc ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {isQc ? <Check size={16} className="text-green-600" /> : <ClipboardList size={16} className="text-gray-500" />}
                            <span className={`text-sm font-semibold ${isQc ? 'text-green-800' : 'text-gray-800'}`}>
                              {isQc ? 'Déroulé et contrôle qualité' : 'Déroulé de l\'étape'}
                            </span>
                            {isQc && linesFr.length > 0 && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${blockedByQc ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                                {qcDone} / {linesFr.length} points validés
                              </span>
                            )}
                            {hasAr && (
                              <div className="ml-auto inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                                <button type="button" onClick={() => setStepLang('fr')}
                                  className={`px-2.5 py-1 ${!ar ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>FR</button>
                                <button type="button" onClick={() => setStepLang('ar')}
                                  className={`px-2.5 py-1 border-l border-gray-200 ${ar ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>عربي</button>
                              </div>
                            )}
                          </div>
                          {ar && currentProfileStep.nom_ar && (
                            <p dir="rtl" className="text-base font-semibold text-gray-900 mb-2">{currentProfileStep.nom_ar as string}</p>
                          )}
                          {isQc && linesFr.length === 0 && (
                            <p className="text-xs text-green-700">Vérifiez la qualité avant de passer à l'étape suivante.</p>
                          )}
                          <ul className="space-y-1.5" dir={ar ? 'rtl' : 'ltr'}>
                            {linesFr.map((ci, i) => {
                              const key = `${id}:${singleStep}:${i}`;
                              // La version arabe peut ne pas avoir le meme nombre de lignes : repli sur le francais.
                              const text = ar ? (linesAr[i] || ci) : ci;
                              return isQc ? (
                                <li key={i}>
                                  <label className="flex items-start gap-2.5 text-sm text-gray-800 cursor-pointer">
                                    <input type="checkbox" checked={!!qcChecked[key]}
                                      onChange={(e) => setQcChecked((prev) => ({ ...prev, [key]: e.target.checked }))}
                                      className="mt-0.5 w-4 h-4 rounded border-green-400 text-green-600 shrink-0" />
                                    <span className={qcChecked[key] ? 'text-gray-500' : ''}>{text}</span>
                                  </label>
                                </li>
                              ) : (
                                <li key={i} className="flex items-start gap-2.5 text-sm text-gray-800">
                                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                                  <span>{text}</span>
                                </li>
                              );
                            })}
                          </ul>
                          {isQc && linesFr.length > 1 && blockedByQc && (
                            <button type="button"
                              onClick={() => setQcChecked((prev) => {
                                const next = { ...prev };
                                linesFr.forEach((_, i) => { next[`${id}:${singleStep}:${i}`] = true; });
                                return next;
                              })}
                              className="mt-3 text-xs font-medium text-green-700 hover:underline">
                              Tout valider
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Recette : ingredients de l'etape toujours visibles */}
                    {renderRecipeSummary(currentProfileStep, item)}
                  </div>
                );
              })()}

              {/* Last step: Enregistrement (same as before) */}
              {isLastStep && (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold text-emerald-700 flex items-center gap-2"><CheckCircle size={18} /> Enregistrement</h2>
                  <p className="text-sm text-gray-500">Renseignez la quantite produite et terminez la production.</p>

                  <div className="border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Date & heure de fin</label>
                        <input type="datetime-local" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                          value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
                      </div>
                      <div className="w-28">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Planifie</label>
                        <div className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 text-center font-bold text-gray-700">{planned}</div>
                      </div>
                      <div className="w-28">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Quantite produite</label>
                        <input type="number" min={0}
                          className="w-full border border-emerald-300 rounded-xl px-3 py-2 text-sm text-center font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-emerald-50"
                          value={actual} disabled={!!cutMode[id]} title={cutMode[id] ? 'Calculée depuis la coupe' : undefined}
                          onChange={(e) => setActuals((prev) => ({ ...prev, [id]: Number(e.target.value) }))} />
                      </div>
                    </div>

                    {renderCutSection(item)}


                    {hasLoss && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle size={14} className="text-amber-600" />
                          <span className="text-sm font-semibold text-amber-800">Perte detectee : {planned - actual} unite(s)</span>
                        </div>
                        <select className="w-full border border-amber-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-amber-500"
                          value={lossReasons[id] || ''} onChange={(e) => setLossReasons((prev) => ({ ...prev, [id]: e.target.value }))}>
                          <option value="">-- Motif de perte --</option>
                          {LOSS_REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                        </select>
                        {lossReasons[id] === 'autre' && (
                          <input type="text" className="w-full mt-2 border border-amber-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500"
                            placeholder="Precisez..." value={lossNotes[id] || ''} onChange={(e) => setLossNotes((prev) => ({ ...prev, [id]: e.target.value }))} />
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-2 border-t border-gray-100 text-xs text-gray-500">
                      {lotNumber && <span className="font-mono bg-gray-100 px-2 py-0.5 rounded"><Hash size={10} className="inline" /> {lotNumber}</span>}
                      <span>DLC : {dlc}</span>
                      <span>Equipe : {detectShift(producedAt)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* ─── Generic Step 1: Lancement ─── */}
              {singleStep === 1 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold text-blue-700 flex items-center gap-2"><Play size={18} /> Lancement</h2>
                  <p className="text-sm text-gray-500">Confirmez les informations de production et lancez la fabrication.</p>

                  <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-4 border-b border-blue-200">
                      <div className="flex items-center gap-3">
                        {item.product_image ? (
                          <img src={item.product_image as string} alt="" className="w-14 h-14 rounded-xl object-cover" />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-blue-100 flex items-center justify-center">
                            <Package size={24} className="text-blue-600" />
                          </div>
                        )}
                        <div className="flex-1">
                          <h3 className="font-bold text-gray-900 text-lg">{item.product_name as string}</h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-600">
                            <span className="font-semibold">Quantite : {planned}</span>
                            <span className="flex items-center gap-1 text-xs"><Clock size={11} /> DLC : {dlc}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Date & heure de lancement</label>
                          <input type="datetime-local" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
                        </div>
                        <div className="w-32">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Equipe</label>
                          <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-center font-medium text-gray-700 flex items-center gap-1.5 justify-center">
                            <Clock size={13} className="text-gray-400" /> {detectShift(producedAt)}
                          </div>
                        </div>
                      </div>
                      {isAlreadyStarted && (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-center gap-2">
                          <CheckCircle size={14} /> Production deja lancee — vous pouvez continuer les etapes.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Generic Step 2: Recette ─── */}
              {singleStep === 2 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold text-blue-700 flex items-center gap-2"><BookOpen size={18} /> Recette & Instructions</h2>
                  <p className="text-sm text-gray-500">Suivez la recette. Vous pouvez sauvegarder et quitter a tout moment.</p>

                  <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm">
                    <Package size={16} className="text-blue-600" />
                    <span className="text-blue-800">
                      <strong>Quantite a produire : {planned}</strong> — {dlc !== 'Vente du jour' ? `DLC : ${dlc}` : 'Vente du jour'}
                    </span>
                  </div>

                  {renderRecipeContent()}
                </div>
              )}

              {/* ─── Generic Step 3: Enregistrement ─── */}
              {singleStep === 3 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold text-emerald-700 flex items-center gap-2"><CheckCircle size={18} /> Enregistrement</h2>
                  <p className="text-sm text-gray-500">Renseignez la quantite produite et terminez la production.</p>

                  <div className="border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Date & heure de fin</label>
                        <input type="datetime-local" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                          value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
                      </div>
                      <div className="w-28">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Planifie</label>
                        <div className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 text-center font-bold text-gray-700">{planned}</div>
                      </div>
                      <div className="w-28">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Quantite produite</label>
                        <input type="number" min={0}
                          className="w-full border border-emerald-300 rounded-xl px-3 py-2 text-sm text-center font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-emerald-50"
                          value={actual} disabled={!!cutMode[id]} title={cutMode[id] ? 'Calculée depuis la coupe' : undefined}
                          onChange={(e) => setActuals((prev) => ({ ...prev, [id]: Number(e.target.value) }))} />
                      </div>
                    </div>

                    {renderCutSection(item)}


                    {hasLoss && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle size={14} className="text-amber-600" />
                          <span className="text-sm font-semibold text-amber-800">Perte detectee : {planned - actual} unite(s)</span>
                        </div>
                        <select className="w-full border border-amber-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-amber-500"
                          value={lossReasons[id] || ''} onChange={(e) => setLossReasons((prev) => ({ ...prev, [id]: e.target.value }))}>
                          <option value="">-- Motif de perte --</option>
                          {LOSS_REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                        </select>
                        {lossReasons[id] === 'autre' && (
                          <input type="text" className="w-full mt-2 border border-amber-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500"
                            placeholder="Precisez..." value={lossNotes[id] || ''} onChange={(e) => setLossNotes((prev) => ({ ...prev, [id]: e.target.value }))} />
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-2 border-t border-gray-100 text-xs text-gray-500">
                      {lotNumber && <span className="font-mono bg-gray-100 px-2 py-0.5 rounded"><Hash size={10} className="inline" /> {lotNumber}</span>}
                      <span>DLC : {dlc}</span>
                      <span>Equipe : {detectShift(producedAt)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Fullscreen recipe overlay */}
        {renderRecipeFullscreen()}

        {/* Bottom bar */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
          <div className="flex items-center justify-between px-4 py-3 max-w-2xl mx-auto w-full">
            <div className="flex items-center gap-2">
              {singleStep === 1 ? (
                <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Annuler</button>
              ) : (
                <button onClick={() => setSingleStep((s) => s - 1)} className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-4 py-2.5 rounded-xl transition-colors">
                  <ChevronLeft size={16} /> Precedent
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isLastStep && blockReasons.length > 0 && (
                <span className="hidden sm:block max-w-[260px] text-xs text-amber-700 text-right leading-tight">
                  Pour continuer : {blockReasons.join(' ; ')}.
                </span>
              )}
              <button onClick={handleSaveAndQuit} disabled={starting}
                className="flex items-center gap-1 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
                Sauvegarder et quitter
              </button>

              {!isLastStep ? (
                <button onClick={async () => {
                  if (singleStep === 1 && !isAlreadyStarted) {
                    await handleAutoStart();
                  }
                  setSingleStep((s) => s + 1);
                }} disabled={starting || !canAdvance}
                  title={
                    stepTimerNotStarted ? 'Demarre le chronometre de cette etape avant de passer a la suivante'
                    : stepTimerRunning ? 'Attends la fin du chronometre pour passer a l\'etape suivante'
                    : blockedByQc ? `Valide les ${qcItems.length - qcDone} point(s) de controle restants pour passer a la suite`
                    : ''
                  }
                  className="flex items-center gap-1 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  {starting ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Lancement...</>) : (<>Suivant <ChevronRight size={16} /></>)}
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={submitting || actual <= 0 || (hasLoss && !lossReasons[id])}
                  className="flex items-center gap-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  {submitting ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Finalisation...</>) : (<><CheckCircle size={16} /> Terminer la production</>)}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  // Single item → quick production form (no steps)
  if (isSingleItem) return renderSingleItemView();

  // Multi-item → 4-step wizard
  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
            <div>
              <h1 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                <Play size={18} className={colors.text} />
                Lancer la production
              </h1>
              <p className="text-xs text-gray-500">
                {format(new Date(plan.plan_date as string), 'EEEE d MMMM yyyy', { locale: fr })}
              </p>
            </div>
          </div>
          <span
            className={`text-xs font-medium px-3 py-1 rounded-full ${colors.light} ${colors.text}`}
          >
            Etape {step}/4
          </span>
        </div>
        {renderStepIndicator()}
      </div>

      {/* Step content */}
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        <h2 className={`text-lg font-bold ${colors.text} mb-1 flex items-center gap-2`}>
          {currentStepDef.icon}
          {currentStepDef.label}
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          {step === 1 && 'Verifiez les bases partagees avant de lancer la production.'}
          {step === 2 && 'Renseignez les quantites reelles pour chaque produit fini.'}
          {step === 3 && 'Declarez les pertes et ajoutez des observations si necessaire.'}
          {step === 4 && 'Verifiez le recapitulatif et confirmez la production.'}
        </p>

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>

      {/* Fullscreen recipe overlay */}
      {renderRecipeFullscreen()}

      {/* Bottom navigation */}
      <div className="sticky bottom-0 bg-white border-t border-gray-100 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between px-4 py-3 max-w-2xl mx-auto w-full">
          <div>
            {step === 1 ? (
              <button
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Annuler
              </button>
            ) : (
              <button
                onClick={goPrev}
                className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-4 py-2.5 rounded-xl transition-colors"
              >
                <ChevronLeft size={16} />
                Precedent
              </button>
            )}
          </div>

          {step < 4 ? (
            <button
              onClick={goNext}
              className={`flex items-center gap-1 text-sm font-semibold text-white bg-gradient-to-r ${colors.gradient} px-6 py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all`}
            >
              Suivant
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  En cours...
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  Confirmer la production
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
