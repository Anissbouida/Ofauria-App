import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, ingredientsApi, ingredientLotsApi } from '../../api/inventory.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { suppliersApi } from '../../api/accounting.api';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Package, AlertTriangle, Boxes, ShieldCheck, CalendarClock,
  ChevronDown, ChevronRight, Factory, TrendingDown, Trash2, Edit3,
  X, Save, Truck, FileText, Clock, Beaker, Ban, Shield, Hash, ShoppingCart,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const INGREDIENT_CATEGORIES = [
  { value: 'farines', label: 'Farines & Céréales' },
  { value: 'sucres', label: 'Sucres & Édulcorants' },
  { value: 'produits_laitiers', label: 'Produits laitiers' },
  { value: 'oeufs', label: 'Oeufs & Ovoproduits' },
  { value: 'matieres_grasses', label: 'Matières grasses' },
  { value: 'fruits', label: 'Fruits & Purées' },
  { value: 'chocolat', label: 'Chocolat & Cacao' },
  { value: 'fruits_secs', label: 'Fruits secs & Oléagineux' },
  { value: 'epices', label: 'Épices & Arômes' },
  { value: 'levures', label: 'Levures & Agents levants' },
  { value: 'emballages', label: 'Emballages' },
  { value: 'autre', label: 'Autre' },
];

const CATEGORY_COLORS: Record<string, string> = {
  farines: 'bg-amber-100 text-amber-700',
  sucres: 'bg-pink-100 text-pink-700',
  produits_laitiers: 'bg-blue-100 text-blue-700',
  oeufs: 'bg-yellow-100 text-yellow-700',
  matieres_grasses: 'bg-orange-100 text-orange-700',
  fruits: 'bg-green-100 text-green-700',
  chocolat: 'bg-stone-200 text-stone-700',
  fruits_secs: 'bg-lime-100 text-lime-700',
  epices: 'bg-red-100 text-red-700',
  levures: 'bg-violet-100 text-violet-700',
  emballages: 'bg-gray-100 text-gray-600',
  autre: 'bg-gray-100 text-gray-500',
};

interface InventoryItem {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  current_quantity: string;
  minimum_threshold: string;
  unit: string;
  unit_cost: string;
  supplier: string;
  category: string;
  last_restocked_at: string | null;
  active_lots_count: string;
  nearest_dlc: string | null;
  expired_lots_count: string;
  expiring_soon_count: string;
  active_lot_numbers: string | null;
}

interface Lot {
  id: string;
  lot_number: string;
  supplier_lot_number: string | null;
  ingredient_name: string;
  ingredient_unit: string;
  ingredient_category: string;
  supplier_name: string | null;
  quantity_received: string;
  quantity_remaining: string;
  expiration_date: string | null;
  manufactured_date: string | null;
  received_at: string;
  status: string;
  expiration_status: string;
  reception_voucher_number?: string;
  purchase_order_number?: string;
}

interface Transaction {
  id: string;
  ingredient_name: string;
  type: string;
  quantity_change: string;
  note: string | null;
  performed_by_name: string;
  created_at: string;
}

interface LotTraceability {
  id: string;
  production_plan_id: string;
  quantity_used: string;
  plan_date: string;
  plan_status: string;
  plan_type: string;
  ingredient_name: string;
  created_by_name: string;
}

export default function IngredientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'lots' | 'history'>('lots');
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showOrderRequest, setShowOrderRequest] = useState(false);

  // Fetch inventory list and find this ingredient
  const { data: inventory = [] } = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });
  const item = (inventory as InventoryItem[]).find(i => i.ingredient_id === id) || null;

  // Fetch ingredient details
  const { data: ingredient } = useQuery({
    queryKey: ['ingredient', id],
    queryFn: () => ingredientsApi.getById(id!),
    enabled: !!id,
  });

  // Fetch lots for this ingredient
  const { data: lotsData } = useQuery({
    queryKey: ['ingredient-lots', id],
    queryFn: () => ingredientLotsApi.list({ ingredientId: id! }),
    enabled: !!id,
  });
  const lots = (lotsData?.data || []) as Lot[];

  // Fetch transactions for this ingredient
  const { data: transactions = [] } = useQuery({
    queryKey: ['inventory-transactions', id],
    queryFn: () => inventoryApi.transactions(id),
    enabled: !!id,
  });

  // Forward traceability for expanded lot
  const { data: lotTraceability = [] } = useQuery({
    queryKey: ['lot-traceability', expandedLot],
    queryFn: () => ingredientLotsApi.traceability(expandedLot!),
    enabled: !!expandedLot,
  });

  // Mutations
  const updateIngredientMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => ingredientsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setShowEdit(false);
      toast.success('Ingrédient mis à jour');
    },
  });

  const updateThresholdMutation = useMutation({
    mutationFn: (threshold: number) => inventoryApi.updateThreshold({ ingredientId: id!, threshold }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Seuil mis à jour');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (data: { quantity: number; type: string; note?: string }) =>
      inventoryApi.adjust({ ingredientId: id!, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions', id] });
      setShowAdjust(false);
      toast.success('Stock ajusté');
    },
  });

  const deleteIngredientMutation = useMutation({
    mutationFn: () => ingredientsApi.remove(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Ingrédient supprimé');
      navigate('/inventory');
    },
  });

  const quarantineMutation = useMutation({
    mutationFn: (lotId: string) => ingredientLotsApi.quarantine(lotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Lot mis en quarantaine');
    },
  });

  const wasteMutation = useMutation({
    mutationFn: (lotId: string) => ingredientLotsApi.markAsWaste(lotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Lot marqué comme déchet');
    },
  });

  const addToWaitingListMutation = useMutation({
    mutationFn: (data: { quantity: number; reason?: string; note?: string; supplierId?: string | null }) =>
      purchaseRequestsApi.create({
        ingredientId: id!,
        supplierId: data.supplierId || null,
        quantity: data.quantity,
        unit: unit || 'kg',
        reason: data.reason,
        note: data.note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      setShowOrderRequest(false);
      toast.success('Ajouté à la liste d\'attente d\'achat');
    },
  });

  if (!item && !ingredient) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <Package size={48} className="mx-auto mb-3 opacity-30" />
          <p>Ingrédient introuvable</p>
          <button onClick={() => navigate('/inventory')} className="mt-3 text-violet-600 text-sm font-medium hover:underline">Retour à l'inventaire</button>
        </div>
      </div>
    );
  }

  const qty = parseFloat(item?.current_quantity || '0');
  const threshold = parseFloat(item?.minimum_threshold || '0');
  const isLow = threshold > 0 && qty <= threshold;
  const isOut = qty <= 0;
  const unitCost = parseFloat(item?.unit_cost || ingredient?.unit_cost || '0');
  const lotsCount = parseInt(item?.active_lots_count || '0') || 0;
  const expiredCount = parseInt(item?.expired_lots_count || '0') || 0;
  const expiringSoonCount = parseInt(item?.expiring_soon_count || '0') || 0;
  const ingredientName = item?.ingredient_name || ingredient?.name || '';
  const category = item?.category || ingredient?.category || 'autre';
  const unit = item?.unit || ingredient?.unit || '';
  const supplier = item?.supplier || ingredient?.supplier || '';

  const activeLots = lots.filter(l => l.status === 'active' && parseFloat(l.quantity_remaining) > 0);
  const depletedLots = lots.filter(l => l.status === 'depleted' || parseFloat(l.quantity_remaining) <= 0);
  const quarantinedLots = lots.filter(l => l.status === 'quarantine');

  return (
    <div className="space-y-4">
      {/* ══════ HERO HEADER ══════ */}
      <div className="bg-gradient-to-br from-violet-600 to-purple-700 rounded-2xl p-6 text-white relative overflow-hidden shadow-lg">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/10 rounded-full" />

        <div className="relative">
          {/* Back + Title */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/inventory')}
                className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-2xl font-bold">{ingredientName}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium bg-white/20`}>
                    {INGREDIENT_CATEGORIES.find(c => c.value === category)?.label || 'Autre'}
                  </span>
                  {supplier ? <span className="text-xs text-white/60">{supplier}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowEdit(true)}
                className="p-2.5 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-xl transition-all">
                <Edit3 size={16} />
              </button>
              <button onClick={() => setShowOrderRequest(true)}
                className="px-4 py-2.5 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-xl font-medium transition-all flex items-center gap-2 text-sm">
                <ShoppingCart size={16} /> Commander
              </button>
            </div>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className={`text-2xl font-bold ${isOut ? 'text-red-200' : isLow ? 'text-amber-200' : ''}`}>
                {qty.toFixed(qty % 1 === 0 ? 0 : 1)}
              </p>
              <p className="text-xs text-white/70 flex items-center justify-center gap-1">
                <Package size={12} /> Stock ({unit})
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className="text-2xl font-bold">{threshold.toFixed(0)}</p>
              <p className="text-xs text-white/70 flex items-center justify-center gap-1">
                <AlertTriangle size={12} /> Seuil min
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className="text-2xl font-bold">{lotsCount}</p>
              <p className="text-xs text-white/70 flex items-center justify-center gap-1">
                <Boxes size={12} /> Lots actifs
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className="text-2xl font-bold">{unitCost.toFixed(2)}</p>
              <p className="text-xs text-white/70 flex items-center justify-center gap-1">
                DH/{unit}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ══════ STATUS ALERTS ══════ */}
      {isLow && (
        <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-amber-50 to-yellow-50 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center">
              <AlertTriangle size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-700">Stock bas</p>
              <p className="text-xs text-amber-600">
                {qty.toFixed(1)} {unit} restant(s) — seuil minimum: {threshold.toFixed(0)} {unit}
              </p>
            </div>
            <button onClick={() => setShowOrderRequest(true)}
              className="ml-auto text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-100 px-3 py-1.5 rounded-lg flex items-center gap-1">
              <ShoppingCart size={12} /> Demander
            </button>
          </div>
        </div>
      )}
      {expiredCount > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
          <div className="px-5 py-3 bg-gradient-to-r from-red-50 to-rose-50 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
              <CalendarClock size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-700">{expiredCount} lot(s) expiré(s)</p>
              <p className="text-xs text-red-600">Des lots actifs ont dépassé leur date limite de consommation</p>
            </div>
          </div>
        </div>
      )}

      {/* ══════ ACTIONS BAR ══════ */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setShowAdjust(true)}
          className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2 shadow-sm">
          <TrendingDown size={14} /> Ajuster le stock
        </button>
        <button onClick={() => setShowDelete(true)}
          className="px-4 py-2 bg-white border border-red-200 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2 shadow-sm">
          <Trash2 size={14} /> Supprimer
        </button>
      </div>

      {/* ══════ TABS ══════ */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setActiveTab('lots')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'lots' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <span className="flex items-center gap-2"><ShieldCheck size={14} /> Lots & Traçabilité</span>
        </button>
        <button onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'history' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <span className="flex items-center gap-2"><Clock size={14} /> Historique</span>
        </button>
      </div>

      {/* ══════ LOTS TAB ══════ */}
      {activeTab === 'lots' && (
        <div className="space-y-4">
          {/* Active lots */}
          {activeLots.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                  <Boxes size={12} className="text-white" />
                </div>
                <span className="text-sm font-bold text-emerald-700">Lots actifs ({activeLots.length})</span>
              </div>
              <div className="divide-y divide-gray-50">
                {activeLots.map((lot) => (
                  <LotRow key={lot.id} lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onQuarantine={() => quarantineMutation.mutate(lot.id)}
                    onWaste={() => wasteMutation.mutate(lot.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Quarantined lots */}
          {quarantinedLots.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-orange-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                  <Shield size={12} className="text-white" />
                </div>
                <span className="text-sm font-bold text-orange-700">Quarantaine ({quarantinedLots.length})</span>
              </div>
              <div className="divide-y divide-orange-50">
                {quarantinedLots.map((lot) => (
                  <LotRow key={lot.id} lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onWaste={() => wasteMutation.mutate(lot.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Depleted lots */}
          {depletedLots.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-slate-50 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-gray-400 to-slate-400 flex items-center justify-center">
                  <Package size={12} className="text-white" />
                </div>
                <span className="text-sm font-bold text-gray-500">Lots épuisés ({depletedLots.length})</span>
              </div>
              <div className="divide-y divide-gray-50">
                {depletedLots.slice(0, 10).map((lot) => (
                  <LotRow key={lot.id} lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                  />
                ))}
                {depletedLots.length > 10 && (
                  <div className="px-5 py-2 text-xs text-gray-400 text-center">
                    + {depletedLots.length - 10} lots épuisés supplémentaires
                  </div>
                )}
              </div>
            </div>
          )}

          {lots.length === 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
              <Boxes size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucun lot enregistré pour cet ingrédient</p>
              <p className="text-xs mt-1">Les lots sont créés automatiquement lors de la réception des bons de commande</p>
            </div>
          )}
        </div>
      )}

      {/* ══════ HISTORY TAB ══════ */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-purple-50 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
              <Clock size={12} className="text-white" />
            </div>
            <span className="text-sm font-bold text-violet-700">Historique des mouvements</span>
          </div>
          {(transactions as Transaction[]).length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <Clock size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucun mouvement enregistré</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {(transactions as Transaction[]).map((tx) => {
                const isPositive = parseFloat(tx.quantity_change) > 0;
                return (
                  <div key={tx.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isPositive ? 'bg-emerald-100' : 'bg-red-100'
                    }`}>
                      {tx.type === 'restock' ? <Package size={14} className="text-emerald-600" /> :
                       tx.type === 'purchase_order' ? <Package size={14} className="text-emerald-600" /> :
                       tx.type === 'production' ? <Factory size={14} className="text-blue-600" /> :
                       tx.type === 'adjustment' ? <TrendingDown size={14} className="text-amber-600" /> :
                       tx.type === 'waste' ? <Ban size={14} className="text-red-600" /> :
                       tx.type === 'usage' ? <Beaker size={14} className="text-orange-600" /> :
                       <Beaker size={14} className="text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 capitalize">
                        {tx.type === 'restock' ? 'Réapprovisionnement' :
                         tx.type === 'purchase_order' ? 'Bon de commande' :
                         tx.type === 'production' ? 'Production' :
                         tx.type === 'adjustment' ? 'Ajustement' :
                         tx.type === 'waste' ? 'Perte / Déchet' :
                         tx.type === 'usage' ? 'Utilisation' : tx.type}
                      </p>
                      <p className="text-xs text-gray-400">
                        {tx.performed_by_name || 'Système'} — {format(new Date(tx.created_at), 'dd/MM/yyyy HH:mm')}
                        {tx.note ? ` — ${tx.note}` : ''}
                      </p>
                    </div>
                    <span className={`text-sm font-bold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : ''}{parseFloat(tx.quantity_change).toFixed(1)} {unit}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════ MODALS ══════ */}
      {showEdit && ingredient && (
        <EditIngredientModal
          ingredient={ingredient}
          threshold={threshold}
          onClose={() => setShowEdit(false)}
          onSave={(data) => {
            if (data.threshold !== undefined) {
              updateThresholdMutation.mutate(data.threshold as number);
            }
            const { threshold: _t, ...ingredientData } = data;
            if (Object.keys(ingredientData).length > 0) {
              updateIngredientMutation.mutate(ingredientData);
            } else {
              setShowEdit(false);
            }
          }}
          isLoading={updateIngredientMutation.isPending || updateThresholdMutation.isPending}
        />
      )}

      {showAdjust && (
        <AdjustStockModal
          ingredientName={ingredientName}
          unit={unit}
          onClose={() => setShowAdjust(false)}
          onSave={(data) => adjustMutation.mutate(data)}
          isLoading={adjustMutation.isPending}
        />
      )}

      {showDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-red-500 to-rose-600 p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Trash2 size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Supprimer</h2>
                <p className="text-sm text-white/70">Action irréversible</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Voulez-vous vraiment supprimer <strong>{ingredientName}</strong> ? Cette action est irréversible et supprimera toutes les données associées.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowDelete(false)} className="btn-secondary flex-1">Annuler</button>
                <button onClick={() => deleteIngredientMutation.mutate()}
                  disabled={deleteIngredientMutation.isPending}
                  className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50">
                  {deleteIngredientMutation.isPending ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showOrderRequest && (
        <OrderRequestModal
          ingredientName={ingredientName}
          unit={unit}
          isLow={isLow}
          supplierHint={supplier}
          onClose={() => setShowOrderRequest(false)}
          onSave={(data) => addToWaitingListMutation.mutate(data)}
          isLoading={addToWaitingListMutation.isPending}
        />
      )}
    </div>
  );
}

/* ─── Order Request Modal (add to waiting list) ─── */
function OrderRequestModal({ ingredientName, unit, isLow, supplierHint, onClose, onSave, isLoading }: {
  ingredientName: string;
  unit: string;
  isLow: boolean;
  supplierHint?: string;
  onClose: () => void;
  onSave: (data: { quantity: number; reason?: string; note?: string; supplierId?: string | null }) => void;
  isLoading: boolean;
}) {
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  // Try to auto-match supplier by name
  const matchedSupplier = supplierHint
    ? (suppliers as Record<string, unknown>[]).find(s => (s.name as string)?.toLowerCase() === supplierHint.toLowerCase())
    : null;

  const [form, setForm] = useState({
    quantity: '',
    reason: isLow ? 'stock_bas' : 'manual',
    note: '',
    supplierId: '',
  });

  // Set matched supplier once loaded
  const [didAutoMatch, setDidAutoMatch] = useState(false);
  if (matchedSupplier && !didAutoMatch && !form.supplierId) {
    setForm(f => ({ ...f, supplierId: matchedSupplier.id as string }));
    setDidAutoMatch(true);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-teal-500 to-emerald-600 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <ShoppingCart size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Demande d'achat</h2>
              <p className="text-sm text-white/70">{ingredientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const qty = parseFloat(form.quantity);
          if (isNaN(qty) || qty <= 0) return;
          onSave({ quantity: qty, reason: form.reason, note: form.note || undefined, supplierId: form.supplierId || null });
        }} className="p-5 space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs text-teal-700">
            Cette demande sera ajoutée à la liste d'attente d'achat.
            Le manager pourra ensuite générer un bon de commande regroupé par fournisseur.
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Fournisseur</label>
            <select className="input" value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">-- Aucun fournisseur --</option>
              {(suppliers as Record<string, unknown>[]).filter(s => s.is_active !== false).map(s => (
                <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Quantité à commander ({unit})</label>
            <input type="number" step="0.1" min="0.1" className="input" value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })} required placeholder="0.0" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Motif</label>
            <select className="input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
              <option value="stock_bas">Stock bas</option>
              <option value="production">Besoin production</option>
              <option value="manual">Demande manuelle</option>
              <option value="replenishment">Approvisionnement</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Note (optionnel)</label>
            <input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="Contexte de la demande..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              <ShoppingCart size={14} /> {isLoading ? 'Ajout...' : 'Ajouter à la liste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Lot Row Component ─── */
function LotRow({ lot, isExpanded, onToggle, traceability, onQuarantine, onWaste }: {
  lot: Lot;
  isExpanded: boolean;
  onToggle: () => void;
  traceability: LotTraceability[];
  onQuarantine?: () => void;
  onWaste?: () => void;
}) {
  const remaining = parseFloat(lot.quantity_remaining);
  const received = parseFloat(lot.quantity_received);
  const pct = received > 0 ? Math.round((remaining / received) * 100) : 0;
  const isExpired = lot.expiration_date ? new Date(lot.expiration_date) < new Date() : false;
  const daysUntil = lot.expiration_date
    ? Math.ceil((new Date(lot.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div>
      <div onClick={onToggle}
        className={`px-5 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
          lot.status === 'quarantine' ? 'hover:bg-orange-50/40' :
          isExpired ? 'hover:bg-red-50/40' : 'hover:bg-violet-50/40'
        }`}>
        {/* Status dot */}
        <div className={`w-2 h-8 rounded-full shrink-0 ${
          lot.status === 'quarantine' ? 'bg-orange-400' :
          lot.status === 'waste' ? 'bg-gray-400' :
          remaining <= 0 ? 'bg-gray-300' :
          isExpired ? 'bg-red-500' :
          daysUntil !== null && daysUntil <= 7 ? 'bg-amber-400' : 'bg-emerald-400'
        }`} />

        {/* Lot info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-800 font-mono">
              {lot.supplier_lot_number || lot.lot_number || '—'}
            </span>
            {lot.status === 'quarantine' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold">QUARANTAINE</span>
            )}
            {isExpired && lot.status === 'active' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">EXPIRÉ</span>
            )}
            {!isExpired && daysUntil !== null && daysUntil <= 7 && lot.status === 'active' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{daysUntil}j</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
            {lot.supplier_name ? <span>{lot.supplier_name}</span> : null}
          </div>
        </div>

        {/* Quantity */}
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-gray-800">
            {remaining.toFixed(1)} / {received.toFixed(1)} {lot.ingredient_unit}
          </p>
          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1 ml-auto">
            <div className={`h-full rounded-full ${pct > 50 ? 'bg-emerald-400' : pct > 20 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Expand */}
        <div className="shrink-0">
          {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-5 pb-4 pt-0">
          <div className="ml-5 space-y-3">
            {/* Supply chain */}
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
              <h4 className="text-xs font-bold text-violet-700 mb-3 flex items-center gap-1.5">
                <ShieldCheck size={12} /> Chaîne d'approvisionnement
              </h4>
              <div className="flex items-center gap-2 flex-wrap">
                {lot.purchase_order_number ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs bg-white px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 font-medium">
                      <FileText size={10} /> BC: {lot.purchase_order_number}
                    </span>
                    <ChevronRight size={12} className="text-violet-300" />
                  </>
                ) : null}
                {lot.reception_voucher_number ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs bg-white px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 font-medium">
                      <Truck size={10} /> BR: {lot.reception_voucher_number}
                    </span>
                    <ChevronRight size={12} className="text-violet-300" />
                  </>
                ) : null}
                <span className="inline-flex items-center gap-1 text-xs bg-white px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 font-bold">
                  <Hash size={10} /> Lot fabriquant: {lot.supplier_lot_number || lot.lot_number || '—'}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-violet-600">
                {lot.expiration_date ? (
                  <span className={`flex items-center gap-1 ${isExpired ? 'text-red-600 font-bold' : ''}`}>
                    <CalendarClock size={10} /> DLC: {format(new Date(lot.expiration_date), 'dd/MM/yyyy')}
                  </span>
                ) : null}
                <span className="flex items-center gap-1">
                  <Clock size={10} /> Reçu: {format(new Date(lot.received_at), 'dd/MM/yyyy')}
                </span>
                {lot.manufactured_date ? (
                  <span className="flex items-center gap-1">
                    <Factory size={10} /> Fabriqué: {format(new Date(lot.manufactured_date), 'dd/MM/yyyy')}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Forward traceability — productions */}
            {traceability.length > 0 && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                <h4 className="text-xs font-bold text-blue-700 mb-3 flex items-center gap-1.5">
                  <Factory size={12} /> Productions utilisant ce lot ({traceability.length})
                </h4>
                <div className="space-y-1.5">
                  {traceability.map((t) => (
                    <div key={t.id}
                      onClick={(e) => { e.stopPropagation(); window.location.href = `/production/${t.production_plan_id}`; }}
                      className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-blue-100 cursor-pointer hover:bg-blue-50/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <Factory size={12} className="text-blue-500" />
                        <span className="text-xs font-medium text-gray-700">
                          {format(new Date(t.plan_date), 'dd/MM/yyyy')} — {t.plan_type === 'morning' ? 'Matin' : t.plan_type === 'afternoon' ? 'Après-midi' : t.plan_type}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          t.plan_status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                          t.plan_status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {t.plan_status === 'completed' ? 'Terminé' : t.plan_status === 'in_progress' ? 'En cours' : t.plan_status}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-blue-700">
                        {parseFloat(t.quantity_used).toFixed(1)} {lot.ingredient_unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {traceability.length === 0 && (
              <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100 text-center">
                <p className="text-xs text-blue-400">Aucune production liée à ce lot</p>
              </div>
            )}

            {/* Lot actions */}
            {(onQuarantine || onWaste) && lot.status === 'active' && remaining > 0 && (
              <div className="flex gap-2">
                {onQuarantine && (
                  <button onClick={(e) => { e.stopPropagation(); onQuarantine(); }}
                    className="px-3 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-lg border border-orange-200 transition-colors flex items-center gap-1">
                    <Shield size={10} /> Quarantaine
                  </button>
                )}
                {onWaste && (
                  <button onClick={(e) => { e.stopPropagation(); onWaste(); }}
                    className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors flex items-center gap-1">
                    <Ban size={10} /> Déchet
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Edit Ingredient Modal ─── */
function EditIngredientModal({ ingredient, threshold, onClose, onSave, isLoading }: {
  ingredient: Record<string, unknown>;
  threshold: number;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    name: (ingredient.name as string) || '',
    unit: (ingredient.unit as string) || 'kg',
    unitCost: String(ingredient.unit_cost || ''),
    supplier: (ingredient.supplier as string) || '',
    category: (ingredient.category as string) || 'autre',
    threshold: String(threshold),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Edit3 size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Modifier</h2>
              <p className="text-sm text-white/70">{ingredient.name as string}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name: form.name,
            unit: form.unit,
            unitCost: parseFloat(form.unitCost) || 0,
            supplier: form.supplier || undefined,
            category: form.category,
            threshold: parseFloat(form.threshold) || 0,
          });
        }} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nom</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Unité</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="unit">Unité</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Coût unitaire (DH)</label>
              <input type="number" step="0.01" className="input" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Catégorie</label>
            <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Fournisseur</label>
            <input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Seuil minimum d'alerte ({form.unit})</label>
            <input type="number" step="0.1" className="input" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              <Save size={14} /> {isLoading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Adjust Stock Modal ─── */
function AdjustStockModal({ ingredientName, unit, onClose, onSave, isLoading }: {
  ingredientName: string;
  unit: string;
  onClose: () => void;
  onSave: (data: { quantity: number; type: string; note?: string }) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({ quantity: '', type: 'loss', note: '' });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <TrendingDown size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Ajuster le stock</h2>
              <p className="text-sm text-white/70">{ingredientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const qty = parseFloat(form.quantity);
          if (isNaN(qty) || qty <= 0) return;
          onSave({ quantity: qty, type: form.type, note: form.note || undefined });
        }} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Type d'ajustement</label>
            <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="loss">Perte / Casse</option>
              <option value="adjustment">Correction d'inventaire</option>
              <option value="restock">Réapprovisionnement manuel</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Quantité ({unit})</label>
            <input type="number" step="0.1" min="0.1" className="input" value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })} required placeholder="0.0" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Note (optionnel)</label>
            <input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="Raison de l'ajustement..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50">
              {isLoading ? 'Ajustement...' : 'Ajuster'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
