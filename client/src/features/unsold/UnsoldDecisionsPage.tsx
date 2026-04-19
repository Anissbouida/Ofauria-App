import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { unsoldDecisionApi } from '../../api/unsold-decision.api';
import { useAuth } from '../../context/AuthContext';
import { useReferentiel } from '../../hooks/useReferentiel';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Package, ShieldCheck, Recycle, Trash2, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Search, Filter, BarChart3, ClipboardList,
  ArrowRight, Eye, RefreshCw, Calendar, TrendingDown, Loader2,
  Info, XCircle, Edit3,
} from 'lucide-react';

/* ─── Types ─── */
type Product = Record<string, unknown>;
type Decision = {
  productId: string;
  finalDestination: 'reexpose' | 'recycle' | 'waste';
  overrideReason?: string;
  remainingQty: number;
};

type Tab = 'decide' | 'history' | 'dashboard';

const DEST_CONFIG = {
  reexpose: {
    label: 'Vitrine J+1',
    icon: <ShieldCheck size={16} />,
    bg: 'bg-green-50 border-green-300',
    text: 'text-green-800',
    badge: 'bg-green-100 text-green-700',
    dot: 'bg-green-500',
  },
  recycle: {
    label: 'Recycler',
    icon: <Recycle size={16} />,
    bg: 'bg-cyan-50 border-cyan-300',
    text: 'text-cyan-800',
    badge: 'bg-cyan-100 text-cyan-700',
    dot: 'bg-cyan-500',
  },
  waste: {
    label: 'Detruire',
    icon: <Trash2 size={16} />,
    bg: 'bg-red-50 border-red-300',
    text: 'text-red-800',
    badge: 'bg-red-100 text-red-700',
    dot: 'bg-red-500',
  },
};

function InlineMsg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  const isError = msg.type === 'error';
  return (
    <div className={`mt-3 p-3 rounded-xl text-sm flex items-center gap-2 ${
      isError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'
    }`}>
      {isError ? <AlertTriangle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
      {msg.text}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  COMPOSANT PRINCIPAL                                          */
/* ═══════════════════════════════════════════════════════════════ */
export default function UnsoldDecisionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { entries: unsoldDests, getLabel: getDestLabel } = useReferentiel('unsold_destinations');
  const [tab, setTab] = useState<Tab>('decide');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventaire de fin de journee</h1>
        <p className="text-sm text-gray-500 mt-1">
          Verifiez les quantites et decidez du devenir de chaque produit invendu
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
        {([
          { key: 'decide' as Tab, label: 'Decisions', icon: <ClipboardList size={16} /> },
          { key: 'history' as Tab, label: 'Historique', icon: <Eye size={16} /> },
          { key: 'dashboard' as Tab, label: 'Tableau de bord', icon: <BarChart3 size={16} /> },
        ]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setMsg(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <InlineMsg msg={msg} />

      {tab === 'decide' && <DecisionPanel setMsg={setMsg} />}
      {tab === 'history' && <HistoryPanel />}
      {tab === 'dashboard' && <DashboardPanel />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  ONGLET 1 : DECISIONS INVENDUS                                */
/* ═══════════════════════════════════════════════════════════════ */
function DecisionPanel({ setMsg }: { setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void }) {
  const queryClient = useQueryClient();
  const { getLabel: getDestLabel } = useReferentiel('unsold_destinations');
  const [search, setSearch] = useState('');
  const [filterDest, setFilterDest] = useState<string>('');
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [editingOverride, setEditingOverride] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const { data: products = [], isLoading, refetch } = useQuery({
    queryKey: ['unsold-suggestions'],
    queryFn: unsoldDecisionApi.suggestions,
  });

  // Initialize counts from product data
  useMemo(() => {
    const newCounts: Record<string, number> = {};
    for (const p of products as Product[]) {
      const pid = p.product_id as string;
      if (counts[pid] === undefined) {
        newCounts[pid] = parseInt(String(p.current_stock)) || 0;
      }
    }
    if (Object.keys(newCounts).length > 0) {
      setCounts(prev => ({ ...newCounts, ...prev }));
    }
  }, [products]);

  const filteredProducts = useMemo(() => {
    let items = products as Product[];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(p =>
        (p.product_name as string).toLowerCase().includes(q) ||
        (p.category_name as string || '').toLowerCase().includes(q)
      );
    }
    if (filterDest) {
      items = items.filter(p => {
        const pid = p.product_id as string;
        const dec = decisions[pid];
        const dest = dec ? dec.finalDestination : (p.suggested_destination as string);
        return dest === filterDest;
      });
    }
    return items;
  }, [products, search, filterDest, decisions]);

  // Summary stats
  const summary = useMemo(() => {
    const s = { reexpose: 0, recycle: 0, waste: 0, total: 0, totalCost: 0 };
    for (const p of products as Product[]) {
      const pid = p.product_id as string;
      const remaining = counts[pid] ?? (parseInt(String(p.current_stock)) || 0);
      if (remaining <= 0) continue;
      const dec = decisions[pid];
      const dest = dec ? dec.finalDestination : (p.suggested_destination as string);
      const cost = (parseFloat(String(p.cost_price)) || 0) * remaining;
      s[dest as keyof typeof s] = (s[dest as keyof typeof s] as number || 0) + remaining;
      s.total += remaining;
      s.totalCost += cost;
    }
    return s;
  }, [products, decisions, counts]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const allDecisions = (products as Product[])
        .filter(p => {
          const pid = p.product_id as string;
          const remaining = counts[pid] ?? (parseInt(String(p.current_stock)) || 0);
          return remaining > 0;
        })
        .map(p => {
          const pid = p.product_id as string;
          const remaining = counts[pid] ?? (parseInt(String(p.current_stock)) || 0);
          const sold = parseInt(String(p.sold_qty)) || 0;
          const initial = remaining + sold;
          const dec = decisions[pid];
          const finalDest = dec ? dec.finalDestination : (p.suggested_destination as string);
          const isOverride = finalDest !== (p.suggested_destination as string);

          return {
            productId: pid,
            productName: p.product_name as string,
            categoryName: (p.category_name as string) || undefined,
            initialQty: initial,
            soldQty: sold,
            remainingQty: remaining,
            suggestedDestination: p.suggested_destination as string,
            suggestedReason: p.suggested_reason as string,
            finalDestination: finalDest,
            overrideReason: isOverride ? (overrideReasons[pid] || 'Decision operateur') : undefined,
            shelfLifeDays: p.shelf_life_days as number | undefined,
            displayLifeHours: p.display_life_hours as number | undefined,
            isReexposable: p.is_reexposable as boolean | undefined,
            maxReexpositions: p.max_reexpositions as number | undefined,
            currentReexpositionCount: p.reexposition_count as number | undefined,
            isRecyclable: p.is_recyclable as boolean | undefined,
            recycleIngredientId: (p.recycle_ingredient_id as string) || undefined,
            saleType: (p.sale_type as string) || undefined,
            displayExpiresAt: (p.display_expires_at as string) || undefined,
            expiresAt: (p.expires_at as string) || undefined,
            producedAt: (p.produced_at as string) || undefined,
            unitCost: parseFloat(String(p.cost_price)) || 0,
          };
        });

      return unsoldDecisionApi.save({ decisions: allDecisions });
    },
    onSuccess: () => {
      setMsg({ type: 'success', text: 'Decisions enregistrees avec succes. Les effets sur le stock ont ete appliques.' });
      queryClient.invalidateQueries({ queryKey: ['unsold-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['unsold-history'] });
      queryClient.invalidateQueries({ queryKey: ['unsold-stats'] });
    },
    onError: () => setMsg({ type: 'error', text: 'Erreur lors de l\'enregistrement des decisions.' }),
  });

  const handleDestinationChange = (pid: string, dest: 'reexpose' | 'recycle' | 'waste', product: Product) => {
    const remaining = counts[pid] ?? (parseInt(String(product.current_stock)) || 0);
    setDecisions(prev => ({
      ...prev,
      [pid]: { productId: pid, finalDestination: dest, remainingQty: remaining },
    }));
    // If overriding, prompt for reason
    if (dest !== (product.suggested_destination as string)) {
      setEditingOverride(pid);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-amber-500" size={32} />
        <span className="ml-3 text-gray-500">Chargement des invendus...</span>
      </div>
    );
  }

  if ((products as Product[]).length === 0) {
    return (
      <div className="text-center py-16">
        <Package size={48} className="mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-600">Aucun invendu</h3>
        <p className="text-sm text-gray-400 mt-1">Tous les produits en stock ont ete vendus. Bravo !</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{summary.total}</div>
          <div className="text-xs text-gray-500 font-medium">Total invendus</div>
        </div>
        <div className={`border rounded-xl p-3 text-center ${DEST_CONFIG.reexpose.bg}`}>
          <div className={`text-2xl font-bold ${DEST_CONFIG.reexpose.text}`}>{summary.reexpose}</div>
          <div className={`text-xs font-medium ${DEST_CONFIG.reexpose.text}`}>{getDestLabel('reexpose')}</div>
        </div>
        <div className={`border rounded-xl p-3 text-center ${DEST_CONFIG.recycle.bg}`}>
          <div className={`text-2xl font-bold ${DEST_CONFIG.recycle.text}`}>{summary.recycle}</div>
          <div className={`text-xs font-medium ${DEST_CONFIG.recycle.text}`}>{getDestLabel('recycle')}</div>
        </div>
        <div className={`border rounded-xl p-3 text-center ${DEST_CONFIG.waste.bg}`}>
          <div className={`text-2xl font-bold ${DEST_CONFIG.waste.text}`}>{summary.waste}</div>
          <div className={`text-xs font-medium ${DEST_CONFIG.waste.text}`}>{getDestLabel('waste')}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{summary.totalCost.toFixed(2)}</div>
          <div className="text-xs text-amber-600 font-medium">Cout total (DH)</div>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher un produit..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
        </div>
        <select value={filterDest} onChange={e => setFilterDest(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-500">
          <option value="">Toutes destinations</option>
          <option value="reexpose">Vitrine J+1</option>
          <option value="recycle">Recyclage</option>
          <option value="waste">Destruction</option>
        </select>
        <button onClick={() => refetch()} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
          <RefreshCw size={16} className="text-gray-500" />
        </button>
      </div>

      {/* Products list */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <span className="col-span-3">Produit</span>
          <span className="col-span-1 text-center">Stock</span>
          <span className="col-span-1 text-center">Vendu</span>
          <span className="col-span-1 text-center">Reste</span>
          <span className="col-span-3 text-center">Suggestion systeme</span>
          <span className="col-span-3 text-center">Decision finale</span>
        </div>

        <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
          {filteredProducts.map((p) => {
            const pid = p.product_id as string;
            const currentStock = parseInt(String(p.current_stock)) || 0;
            const sold = parseInt(String(p.sold_qty)) || 0;
            const remaining = counts[pid] ?? currentStock;
            const sugDest = p.suggested_destination as 'reexpose' | 'recycle' | 'waste';
            const sugReason = p.suggested_reason as string;
            const dec = decisions[pid];
            const finalDest = dec ? dec.finalDestination : sugDest;
            const isOverride = finalDest !== sugDest;
            const isExpanded = expandedProduct === pid;
            const destConf = DEST_CONFIG[finalDest];
            const sugConf = DEST_CONFIG[sugDest];
            const unitCost = parseFloat(String(p.cost_price)) || 0;

            return (
              <div key={pid}>
                <div className={`grid grid-cols-12 gap-2 items-center px-4 py-3 transition-colors hover:bg-gray-50 ${
                  isOverride ? 'bg-amber-50/50' : ''
                }`}>
                  {/* Product info */}
                  <div className="col-span-3 min-w-0">
                    <button onClick={() => setExpandedProduct(isExpanded ? null : pid)}
                      className="flex items-center gap-1 text-left w-full">
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400 shrink-0" /> : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-gray-900 truncate block">{p.product_name as string}</span>
                        <span className="text-[11px] text-gray-400">{p.category_name as string || 'Sans categorie'}</span>
                      </div>
                    </button>
                  </div>

                  {/* Stock */}
                  <div className="col-span-1 text-center">
                    <span className="text-sm font-bold text-indigo-600">{currentStock + sold}</span>
                  </div>

                  {/* Sold */}
                  <div className="col-span-1 text-center">
                    <span className="text-sm font-bold text-blue-600">{sold}</span>
                  </div>

                  {/* Remaining (editable) */}
                  <div className="col-span-1 flex justify-center">
                    <input type="number" min={0} max={currentStock}
                      value={remaining}
                      onChange={(e) => setCounts(prev => ({ ...prev, [pid]: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="w-14 h-8 text-center text-sm font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  {/* Suggestion */}
                  <div className="col-span-3 flex justify-center">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${sugConf.bg} ${sugConf.text}`}>
                      {sugConf.icon}
                      <span>{getDestLabel(sugDest)}</span>
                    </div>
                  </div>

                  {/* Final decision */}
                  <div className="col-span-3">
                    {remaining > 0 ? (
                      <div className="flex items-center gap-1 justify-center">
                        {(['reexpose', 'recycle', 'waste'] as const).map(d => {
                          const dc = DEST_CONFIG[d];
                          const isActive = finalDest === d;
                          // Disable reexpose if not reexposable and suggestion is not reexpose
                          const canReexpose = p.is_reexposable || sugDest === 'reexpose';
                          const canRecycle = p.is_recyclable && p.recycle_ingredient_id;
                          const disabled = (d === 'reexpose' && !canReexpose) || (d === 'recycle' && !canRecycle);

                          return (
                            <button key={d}
                              onClick={() => !disabled && handleDestinationChange(pid, d, p)}
                              disabled={disabled as boolean}
                              title={disabled ? (d === 'reexpose' ? 'Non re-exposable' : 'Non recyclable') : getDestLabel(d)}
                              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                                isActive
                                  ? `${dc.bg} ${dc.text} ring-2 ring-offset-1 ${d === 'reexpose' ? 'ring-green-400' : d === 'recycle' ? 'ring-cyan-400' : 'ring-red-400'}`
                                  : disabled
                                    ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
                                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                              }`}>
                              {dc.icon}
                              <span className="hidden lg:inline">{d === 'reexpose' ? 'Vitrine' : d === 'recycle' ? 'Recycler' : 'Detruire'}</span>
                            </button>
                          );
                        })}
                        {isOverride && (
                          <span className="ml-1" title="Decision differente de la suggestion">
                            <Edit3 size={12} className="text-amber-500" />
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 text-center block">Tout vendu</span>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-gray-400 block">Type de vente</span>
                        <span className="font-semibold text-gray-700">
                          {p.sale_type === 'jour' ? 'Vente du jour' : p.sale_type === 'dlv' ? 'DLV multi-jours' : 'Sur commande'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">DLV</span>
                        <span className="font-semibold text-gray-700">{String(p.shelf_life_days || '-')} jour(s)</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Exposition max</span>
                        <span className="font-semibold text-gray-700">{String(p.display_life_hours || '-')}h</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Reexpositions</span>
                        <span className="font-semibold text-gray-700">
                          {p.reexposition_count as number || 0} / {p.max_reexpositions as number || 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Recyclable</span>
                        <span className={`font-semibold ${p.is_recyclable ? 'text-cyan-600' : 'text-gray-400'}`}>
                          {p.is_recyclable ? `Oui → ${p.recycle_ingredient_name || 'ingredient'}` : 'Non'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Cout unitaire</span>
                        <span className="font-semibold text-gray-700">{unitCost.toFixed(2)} DH</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">Cout perte potentielle</span>
                        <span className="font-semibold text-red-600">{(unitCost * remaining).toFixed(2)} DH</span>
                      </div>
                      {p.expires_at as unknown as boolean && (
                        <div>
                          <span className="text-xs text-gray-400 block">Expiration DLV</span>
                          <span className={`font-semibold ${new Date(p.expires_at as string) <= new Date() ? 'text-red-600' : 'text-green-600'}`}>
                            {format(new Date(p.expires_at as string), 'dd MMM yyyy HH:mm', { locale: fr })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Suggestion reason */}
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2">
                      <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-semibold text-blue-700 block">Justification du systeme :</span>
                        <span className="text-xs text-blue-600">{sugReason}</span>
                      </div>
                    </div>

                    {/* Override reason input */}
                    {isOverride && (
                      <div className="mt-3">
                        <label className="text-xs font-semibold text-amber-700 block mb-1">
                          Motif du changement (obligatoire) :
                        </label>
                        <input type="text"
                          value={overrideReasons[pid] || ''}
                          onChange={(e) => setOverrideReasons(prev => ({ ...prev, [pid]: e.target.value }))}
                          placeholder="Ex: Aspect visuel encore correct, client regulier demain..."
                          className="w-full px-3 py-2 rounded-lg border border-amber-300 text-sm focus:ring-2 focus:ring-amber-500 bg-amber-50"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Override reason popup (inline) */}
                {editingOverride === pid && !isExpanded && isOverride && (
                  <div className="px-6 py-3 bg-amber-50 border-t border-amber-200">
                    <div className="flex items-center gap-2">
                      <Edit3 size={14} className="text-amber-600 shrink-0" />
                      <input type="text"
                        autoFocus
                        value={overrideReasons[pid] || ''}
                        onChange={(e) => setOverrideReasons(prev => ({ ...prev, [pid]: e.target.value }))}
                        onBlur={() => setEditingOverride(null)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditingOverride(null)}
                        placeholder="Motif du changement..."
                        className="flex-1 px-3 py-1.5 rounded-lg border border-amber-300 text-sm focus:ring-2 focus:ring-amber-500 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Validation button */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-sm text-gray-500">
          {filteredProducts.length} produit(s) invendu(s)
        </div>
        <button
          onClick={() => {
            // Check that all overrides have reasons
            for (const p of products as Product[]) {
              const pid = p.product_id as string;
              const remaining = counts[pid] ?? (parseInt(String(p.current_stock)) || 0);
              if (remaining <= 0) continue;
              const dec = decisions[pid];
              const finalDest = dec ? dec.finalDestination : (p.suggested_destination as string);
              if (finalDest !== (p.suggested_destination as string) && !overrideReasons[pid]) {
                setMsg({ type: 'error', text: `Motif obligatoire pour "${p.product_name}" — vous avez change la suggestion du systeme.` });
                setExpandedProduct(pid);
                return;
              }
            }
            saveMutation.mutate();
          }}
          disabled={saveMutation.isPending || summary.total === 0}
          className="btn-primary px-8 py-3 text-base flex items-center gap-2 disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          Valider les decisions
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  ONGLET 2 : HISTORIQUE                                        */
/* ═══════════════════════════════════════════════════════════════ */
function HistoryPanel() {
  const { getLabel: getDestLabel } = useReferentiel('unsold_destinations');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [destFilter, setDestFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['unsold-history', { dateFrom, dateTo, destFilter, page }],
    queryFn: () => unsoldDecisionApi.list({
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(destFilter ? { destination: destFilter } : {}),
      page: String(page),
      limit: '50',
    }),
  });

  const rows = data?.data || [];
  const total = data?.total || 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-gray-400" />
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          <ArrowRight size={14} className="text-gray-300" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
        </div>
        <select value={destFilter} onChange={e => { setDestFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
          <option value="">Toutes destinations</option>
          <option value="reexpose">Vitrine J+1</option>
          <option value="recycle">Recyclage</option>
          <option value="waste">Destruction</option>
        </select>
        <span className="text-xs text-gray-400 ml-auto">{total} decision(s)</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-amber-500" size={28} /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Aucune decision trouvee pour cette periode.</div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <span className="col-span-2">Date</span>
            <span className="col-span-3">Produit</span>
            <span className="col-span-1 text-center">Reste</span>
            <span className="col-span-2 text-center">Suggestion</span>
            <span className="col-span-2 text-center">Decision</span>
            <span className="col-span-1 text-center">Cout</span>
            <span className="col-span-1 text-center">Par</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {rows.map((r: Record<string, unknown>) => {
              const sugConf = DEST_CONFIG[(r.suggested_destination as string) as keyof typeof DEST_CONFIG];
              const finalConf = DEST_CONFIG[(r.final_destination as string) as keyof typeof DEST_CONFIG];
              return (
                <div key={r.id as string} className={`grid grid-cols-12 gap-2 items-center px-4 py-2.5 hover:bg-gray-50 ${r.is_override ? 'bg-amber-50/30' : ''}`}>
                  <div className="col-span-2 text-xs text-gray-500">
                    {format(new Date(r.created_at as string), 'dd/MM/yy HH:mm')}
                  </div>
                  <div className="col-span-3 min-w-0">
                    <span className="text-sm font-medium text-gray-900 truncate block">{r.product_name as string}</span>
                    <span className="text-[11px] text-gray-400">{r.category_name as string || ''}</span>
                  </div>
                  <div className="col-span-1 text-center text-sm font-bold text-gray-700">{r.remaining_qty as number}</div>
                  <div className="col-span-2 flex justify-center">
                    <span className={`text-[11px] px-2 py-1 rounded-lg font-semibold ${sugConf?.badge || ''}`}>{getDestLabel(r.suggested_destination as string)}</span>
                  </div>
                  <div className="col-span-2 flex justify-center items-center gap-1">
                    <span className={`text-[11px] px-2 py-1 rounded-lg font-semibold ${finalConf?.badge || ''}`}>{getDestLabel(r.final_destination as string)}</span>
                    {r.is_override as unknown as boolean && <Edit3 size={10} className="text-amber-500" />}
                  </div>
                  <div className="col-span-1 text-center text-xs font-semibold text-red-600">
                    {parseFloat(String(r.total_cost)).toFixed(0)} DH
                  </div>
                  <div className="col-span-1 text-center text-[11px] text-gray-400 truncate">
                    {r.decided_by_first_name as string}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30">Precedent</button>
          <span className="px-3 py-1.5 text-sm text-gray-500">Page {page} / {Math.ceil(total / 50)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-30">Suivant</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  ONGLET 3 : TABLEAU DE BORD                                   */
/* ═══════════════════════════════════════════════════════════════ */
function DashboardPanel() {
  const { getLabel: getDestLabel } = useReferentiel('unsold_destinations');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data: stats, isLoading } = useQuery({
    queryKey: ['unsold-stats', { month, year }],
    queryFn: () => unsoldDecisionApi.stats({ month, year }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-amber-500" size={28} /></div>;
  }

  if (!stats) {
    return <div className="text-center py-12 text-gray-400">Aucune donnee disponible.</div>;
  }

  const byDest = stats.byDestination || [];
  const byCategory = stats.byCategory || [];
  const topWaste = stats.topWasteProducts || [];
  const dailyData = stats.daily || [];
  const overrideRate = stats.overrideRate || { override_count: 0, total_count: 0 };
  const recurringWaste = stats.recurringWaste || [];

  // Compute totals by destination
  const destTotals: Record<string, { qty: number; cost: number }> = { reexpose: { qty: 0, cost: 0 }, recycle: { qty: 0, cost: 0 }, waste: { qty: 0, cost: 0 } };
  for (const d of byDest) {
    const key = d.final_destination as string;
    destTotals[key] = {
      qty: parseInt(String(d.total_qty)) || 0,
      cost: parseFloat(String(d.total_cost)) || 0,
    };
  }
  const grandTotal = Object.values(destTotals).reduce((s, v) => s + v.qty, 0);
  const recycleRate = grandTotal > 0 ? ((destTotals.recycle.qty / grandTotal) * 100).toFixed(1) : '0';
  const wasteRate = grandTotal > 0 ? ((destTotals.waste.qty / grandTotal) * 100).toFixed(1) : '0';
  const keepRate = grandTotal > 0 ? ((destTotals.reexpose.qty / grandTotal) * 100).toFixed(1) : '0';

  // Group by category
  const categoryMap: Record<string, Record<string, number>> = {};
  for (const c of byCategory) {
    const cat = (c.category_name as string) || 'Sans categorie';
    if (!categoryMap[cat]) categoryMap[cat] = { reexpose: 0, recycle: 0, waste: 0 };
    categoryMap[cat][c.final_destination as string] = parseInt(String(c.total_qty)) || 0;
  }

  const MONTH_NAMES = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium">
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium">
          {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-gray-700">{grandTotal}</div>
          <div className="text-xs text-gray-500">Total invendus</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-700">{keepRate}%</div>
          <div className="text-xs text-green-600">Taux conservation</div>
          <div className="text-[10px] text-green-500">{destTotals.reexpose.qty} unites</div>
        </div>
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-cyan-700">{recycleRate}%</div>
          <div className="text-xs text-cyan-600">Taux recyclage</div>
          <div className="text-[10px] text-cyan-500">{destTotals.recycle.qty} unites</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-red-700">{wasteRate}%</div>
          <div className="text-xs text-red-600">Taux destruction</div>
          <div className="text-[10px] text-red-500">{destTotals.waste.qty} unites</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-amber-700">{destTotals.waste.cost.toFixed(0)}</div>
          <div className="text-xs text-amber-600">Pertes (DH)</div>
          <div className="text-[10px] text-amber-500">Cout destruction</div>
        </div>
      </div>

      {/* Override rate */}
      {parseInt(String(overrideRate.total_count)) > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <Edit3 size={20} className="text-amber-600" />
          <div>
            <span className="text-sm font-semibold text-amber-800">
              {parseInt(String(overrideRate.override_count))} decision(s) modifiee(s) par les operateurs
            </span>
            <span className="text-xs text-amber-600 block">
              sur {parseInt(String(overrideRate.total_count))} decisions ce mois ({((parseInt(String(overrideRate.override_count)) / parseInt(String(overrideRate.total_count))) * 100).toFixed(1)}%)
            </span>
          </div>
        </div>
      )}

      {/* By category breakdown */}
      {Object.keys(categoryMap).length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3">Repartition par categorie</h3>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-5 gap-2 px-4 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase">
              <span className="col-span-2">Categorie</span>
              <span className="text-center">Vitrine</span>
              <span className="text-center">Recycle</span>
              <span className="text-center">Detruit</span>
            </div>
            {Object.entries(categoryMap).map(([cat, vals]) => {
              const catTotal = vals.reexpose + vals.recycle + vals.waste;
              return (
                <div key={cat} className="grid grid-cols-5 gap-2 px-4 py-2.5 border-b border-gray-100 items-center">
                  <div className="col-span-2">
                    <span className="text-sm font-medium text-gray-800">{cat}</span>
                    <span className="text-[10px] text-gray-400 ml-2">{catTotal} total</span>
                  </div>
                  <div className="text-center">
                    {vals.reexpose > 0 && <span className="text-sm font-bold text-green-600">{vals.reexpose}</span>}
                    {!vals.reexpose && <span className="text-gray-300">-</span>}
                  </div>
                  <div className="text-center">
                    {vals.recycle > 0 && <span className="text-sm font-bold text-cyan-600">{vals.recycle}</span>}
                    {!vals.recycle && <span className="text-gray-300">-</span>}
                  </div>
                  <div className="text-center">
                    {vals.waste > 0 && <span className="text-sm font-bold text-red-600">{vals.waste}</span>}
                    {!vals.waste && <span className="text-gray-300">-</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top waste products */}
      {topWaste.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <TrendingDown size={16} className="text-red-500" />
            Top produits detruits (par cout)
          </h3>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {topWaste.map((p: Record<string, unknown>, i: number) => (
              <div key={p.product_id as string} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <div>
                    <span className="text-sm font-medium text-gray-800">{p.product_name as string}</span>
                    <span className="text-[11px] text-gray-400 block">{p.category_name as string || ''} — {p.waste_count as number}x detruits</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-red-600">{parseFloat(String(p.total_cost)).toFixed(0)} DH</span>
                  <span className="text-[11px] text-gray-400 block">{parseInt(String(p.total_qty))} unites</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recurring waste alerts (surproduction) */}
      {recurringWaste.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-red-700 mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            Alertes surproduction (destruction recurrente)
          </h3>
          <div className="space-y-2">
            {recurringWaste.map((p: Record<string, unknown>) => (
              <div key={p.product_id as string} className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-red-800">{p.product_name as string}</span>
                  <span className="text-xs text-red-600 block">
                    Detruit {p.waste_days as number} jours sur le mois — {parseInt(String(p.total_qty))} unites perdues
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-red-700">{parseFloat(String(p.total_cost)).toFixed(0)} DH</span>
                  <span className="text-[10px] text-red-500 block">de pertes</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily trend (simple text) */}
      {dailyData.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3">Tendance quotidienne</h3>
          <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
            <div className="grid grid-cols-5 gap-2 px-4 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase">
              <span>Date</span>
              <span className="text-center">Destination</span>
              <span className="text-center">Quantite</span>
              <span className="text-center">Cout</span>
              <span className="text-center">Decisions</span>
            </div>
            {dailyData.map((d: Record<string, unknown>, i: number) => {
              const dc = DEST_CONFIG[(d.final_destination as string) as keyof typeof DEST_CONFIG];
              return (
                <div key={i} className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-gray-100 text-sm">
                  <span className="text-gray-600">{format(new Date(d.date as string), 'dd/MM')}</span>
                  <div className="flex justify-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${dc?.badge || 'bg-gray-100 text-gray-600'}`}>
                      {getDestLabel(d.final_destination as string)}
                    </span>
                  </div>
                  <span className="text-center font-semibold">{parseInt(String(d.total_qty))}</span>
                  <span className="text-center text-red-600 font-semibold">{parseFloat(String(d.total_cost)).toFixed(0)} DH</span>
                  <span className="text-center text-gray-400">{parseInt(String(d.count))}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
