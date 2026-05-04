import { useState, useMemo, useRef, useEffect } from 'react';
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
  plan: Record<string, unknown>;
  items: Record<string, unknown>[];
  targetItemId?: string | null;
  initialStepName?: string | null; // jump to this étape by name (from timer notification)
  needs: Record<string, unknown>[];
  fefoPreview: Record<string, unknown>[];
  onClose: () => void;
  onCompleted: () => void;
}

interface SubRecipeAnalysis {
  subRecipeId: string;
  subRecipeName: string;
  yieldQuantity: number;
  totalNeeded: number;
  usedBy: { planItemId: string; productName: string; quantityNeeded: number }[];
  ingredients: Record<string, unknown>[];
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

export default function ProductionLaunchModal({
  planId,
  plan,
  items: allItems,
  targetItemId,
  initialStepName,
  needs,
  fefoPreview,
  onClose,
  onCompleted,
}: ProductionLaunchModalProps) {
  // Dynamic loss reasons from referentiel
  const { entries: prodLossReasonEntries } = useReferentiel('production_loss_reasons');
  const LOSS_REASONS = prodLossReasonEntries.map(e => ({ value: e.code, label: e.label }));

  // Production timers
  const { timers: activeTimers, startTimer, stopTimer, getTimerRemaining } = useProductionTimers();

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
      .filter(Boolean) as (Record<string, unknown> & { planned: number; actual: number; lost: number })[];
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
        .map((itemId) => ({
          planItemId: itemId,
          actualQuantity: actuals[itemId] || 0,
        }))
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

      notify.success('Production enregistree avec succes');
      onCompleted();
      onClose();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Erreur lors de la production');
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
    const renderItemRow = (item: Record<string, unknown>, disabled = false) => {
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
    const ingredients = ((recipeData?.ingredients || []) as Record<string, unknown>[]);
    const subRecipesData = ((recipeData?.sub_recipes || []) as Record<string, unknown>[]);
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
                          {parseFloat(sr.quantity as string).toFixed(2)} (rendement: {sr.sub_yield_quantity as number} {(sr as Record<string, unknown>).sub_yield_unit as string || 'u.'})
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

    const ingredients = (recipeData.ingredients || []) as Record<string, unknown>[];
    const subRecipesData = (recipeData.sub_recipes || []) as Record<string, unknown>[];
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
                      {parseFloat(sr.quantity as string).toFixed(2)} (rendement: {sr.sub_yield_quantity as number} {(sr as Record<string, unknown>).sub_yield_unit as string || 'u.'})
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

  // -----------------------------------------------------------------------
  // Single-item stepped production view
  // -----------------------------------------------------------------------

  const isSingleItem = !!targetItemId && items.length === 1;
  const singleProductId = isSingleItem ? (items[0]?.product_id as string) : undefined;
  // If item is already in_progress (resuming), skip to step 2 (Recette)
  const initialSingleStep = isSingleItem && items[0] && (items[0].status as string) === 'in_progress' ? 2 : 1;
  const [singleStep, setSingleStep] = useState(initialSingleStep);
  const [starting, setStarting] = useState(false);

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
      notify.error(err instanceof Error ? err.message : 'Erreur lors du lancement');
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
  const recipeEtapes: Record<string, unknown>[] = recipeData?.etapes || [];
  const profileEtapesOverrides: Record<string, unknown>[] = productionProfile?.etapes || [];
  const dynamicSteps: Record<string, unknown>[] =
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
                          {currentProfileStep.timer_auto && currentProfileStep.duree_estimee_min && (() => {
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
                          <div className="text-[9px] text-gray-500 uppercase mt-0.5">Net / contenant</div>
                        </div>
                        <div className="bg-purple-50 rounded-xl p-3">
                          <div className="text-xl font-bold text-purple-700">{item.quantite_brute_totale || planned}</div>
                          <div className="text-[9px] text-gray-500 uppercase mt-0.5">Qte brute totale</div>
                        </div>
                      </div>
                    )}

                    {/* Timer display for steps with timer_auto */}
                    {currentProfileStep.timer_auto && currentProfileStep.duree_estimee_min && (() => {
                      const timerKey = `${id}_step${singleStep}`;
                      const existingTimer = activeTimers.find(t => t.planItemId === id && t.stepName === (currentProfileStep.nom as string));
                      const remaining = existingTimer ? getTimerRemaining(existingTimer.id) : 0;
                      const isRunning = !!existingTimer && remaining > 0;
                      const mins = Math.floor(remaining / 60);
                      const secs = remaining % 60;

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
                        </div>
                      );
                    })()}

                    {/* QC checklist */}
                    {currentProfileStep.controle_qualite && (
                      <div className="border border-green-200 rounded-2xl p-4 bg-green-50/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Check size={16} className="text-green-600" />
                          <span className="text-sm font-semibold text-green-800">Controle qualite</span>
                        </div>
                        <p className="text-xs text-green-700">Verifiez la qualite avant de passer a l'etape suivante.</p>
                        {currentProfileStep.checklist_items && (currentProfileStep.checklist_items as string[]).length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {(currentProfileStep.checklist_items as string[]).map((ci, i) => (
                              <li key={i} className="flex items-center gap-2 text-sm text-green-700">
                                <input type="checkbox" className="rounded border-green-300 text-green-600" />
                                <span>{ci}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Recipe access — always available */}
                    <div className="border border-gray-200 rounded-xl p-3">
                      <button
                        type="button"
                        onClick={() => setRecipeFullscreen(true)}
                        className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        <BookOpen size={16} /> Voir la recette
                      </button>
                    </div>
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
                          value={actual} onChange={(e) => setActuals((prev) => ({ ...prev, [id]: Number(e.target.value) }))} />
                      </div>
                    </div>

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
                          value={actual} onChange={(e) => setActuals((prev) => ({ ...prev, [id]: Number(e.target.value) }))} />
                      </div>
                    </div>

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
                }} disabled={starting}
                  className="flex items-center gap-1 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-2.5 rounded-xl shadow-sm hover:shadow-md transition-all disabled:opacity-50">
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
