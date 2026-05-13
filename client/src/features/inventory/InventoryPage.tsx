import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { inventoryApi, ingredientsApi } from '../../api/inventory.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { TransferRequestsList } from '../warehouse/TransferRequestsList';
import {
  AlertTriangle, Package, Search, TrendingUp, TrendingDown,
  Clock, X, Boxes, ShieldCheck, CalendarClock, ChevronRight, ChevronDown,
  ArrowUp, ArrowDown, ArrowUpDown, Timer, Trash2, PackageOpen, Warehouse,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { format } from 'date-fns';

type SortKey = 'name' | 'category' | 'supplier' | 'quantity' | 'lots' | 'dlc' | 'days_stock';
type SortDir = 'asc' | 'desc';
type ViewFilter = 'all' | 'low' | 'ok' | 'expiring';
type EconomatTab = 'stock' | 'transfers';

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
  { value: 'conserves', label: 'Conserves' },
  { value: 'legumes', label: 'Légumes' },
  { value: 'sauces', label: 'Sauces & Condiments' },
  { value: 'decors', label: 'Décors & Garnitures' },
  { value: 'gelifiants', label: 'Gélifiants' },
  { value: 'preparations', label: 'Préparations' },
  { value: 'viandes', label: 'Viandes & Volailles' },
  { value: 'pates_riz', label: 'Pâtes & Riz' },
  { value: 'sel_vinaigre', label: 'Sel & Vinaigre' },
  { value: 'colorants', label: 'Colorants' },
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
  conserves: 'bg-teal-100 text-teal-700',
  legumes: 'bg-emerald-100 text-emerald-700',
  sauces: 'bg-rose-100 text-rose-700',
  decors: 'bg-purple-100 text-purple-700',
  gelifiants: 'bg-cyan-100 text-cyan-700',
  preparations: 'bg-indigo-100 text-indigo-700',
  viandes: 'bg-red-200 text-red-800',
  pates_riz: 'bg-yellow-200 text-yellow-800',
  sel_vinaigre: 'bg-slate-100 text-slate-700',
  colorants: 'bg-fuchsia-100 text-fuchsia-700',
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
  // Phase Économat / Pesage
  economat_quantity?: string;
  pesage_quantity?: string;
  economat_lots_count?: string;
  pesage_lots_count?: string;
  pesage_nearest_dlc?: string | null;
  container_size?: string | null;
  nearest_dlc: string | null;
  expired_lots_count: string;
  expiring_soon_count: string;
  active_lot_numbers: string | null;
  avg_daily_consumption: string;
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { user } = useAuth();
  const isWarehouseUser = ['admin', 'manager', 'magasinier'].includes(user?.role || '');

  // Onglets : "Stock economat" (defaut, vue actuelle) + "Transferts demandes" (BSI a transferer).
  // Persiste l'onglet en URL pour permettre les deep-links (badge sidebar, lien BSI panel).
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as EconomatTab | null;
  const [econoTab, setEconoTab] = useState<EconomatTab>(
    tabFromUrl === 'transfers' ? 'transfers' : 'stock'
  );
  useEffect(() => {
    if (tabFromUrl === 'transfers' && econoTab !== 'transfers') setEconoTab('transfers');
    if (!tabFromUrl && econoTab !== 'stock') setEconoTab('stock');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);
  const changeEconoTab = (next: EconomatTab) => {
    setEconoTab(next);
    if (next === 'stock') searchParams.delete('tab');
    else searchParams.set('tab', next);
    setSearchParams(searchParams, { replace: true });
  };

  // Compteur de transferts en attente pour le badge de l'onglet.
  // Visible uniquement aux roles ayant le module pesage (magasinier/admin/manager).
  const { data: transferRequests = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-transfer-requests'],
    queryFn: bonSortieApi.transferRequests,
    enabled: isWarehouseUser,
    refetchInterval: 30000,
  });

  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showAddIngredient, setShowAddIngredient] = useState(false);
  const [showAllExpired, setShowAllExpired] = useState(false);
  const [showAllExpiring, setShowAllExpiring] = useState(false);

  const { data: expiringLots = [] } = useQuery({ queryKey: ['ingredient-lots-expiring'], queryFn: () => ingredientLotsApi.expiring(7) });
  const { data: expiredLots = [] } = useQuery({ queryKey: ['ingredient-lots-expired'], queryFn: ingredientLotsApi.expired });
  const { data: expiredActiveLots = [] } = useQuery({
    queryKey: ['ingredient-lots-expired-active'],
    queryFn: ingredientLotsApi.expiredActive,
    refetchInterval: 60_000,  // refresh chaque minute
  });
  const { data: inventory = [], isLoading } = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });
  const { data: alerts = [] } = useQuery({ queryKey: ['inventory-alerts'], queryFn: inventoryApi.alerts });

  // Phase pertes : dialog d'envoi aux pertes
  const [lossDialogLot, setLossDialogLot] = useState<Record<string, any> | null>(null);
  const sendToLossesMutation = useMutation({
    mutationFn: ({ lotId, reason, note }: { lotId: string; reason: string; note?: string }) =>
      ingredientLotsApi.sendToLosses(lotId, reason, note),
    onSuccess: (data) => {
      const d = data as { lostQuantity: number; lostValue: number; reasonLabel: string };
      notify.success(
        `Lot envoyé aux pertes : ${d.lostQuantity.toFixed(2)} u (${d.lostValue.toFixed(2)} DH) — ${d.reasonLabel}`
      );
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots-expired-active'] });
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots-expired'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setLossDialogLot(null);
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      notify.error(e?.response?.data?.error?.message || 'Erreur');
    },
  });

  const addIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventory'] }); setShowAddIngredient(false); notify.success('Ingrédient ajouté'); },
  });

  const filteredInventory = useMemo(() => {
    let items = inventory as InventoryItem[];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.ingredient_name.toLowerCase().includes(q) || (i.supplier || '').toLowerCase().includes(q) || (i.active_lot_numbers || '').toLowerCase().includes(q));
    }
    if (categoryFilter) items = items.filter(i => (i.category || 'autre') === categoryFilter);
    if (viewFilter === 'low') items = items.filter(i => parseFloat(i.current_quantity) <= parseFloat(i.minimum_threshold));
    else if (viewFilter === 'ok') items = items.filter(i => parseFloat(i.current_quantity) > parseFloat(i.minimum_threshold));
    else if (viewFilter === 'expiring') items = items.filter(i => (parseInt(i.expired_lots_count) || 0) > 0 || (parseInt(i.expiring_soon_count) || 0) > 0);

    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.ingredient_name.localeCompare(b.ingredient_name); break;
        case 'category': cmp = (a.category || '').localeCompare(b.category || ''); break;
        case 'supplier': cmp = (a.supplier || '').localeCompare(b.supplier || ''); break;
        case 'quantity': cmp = parseFloat(a.current_quantity) - parseFloat(b.current_quantity); break;
        case 'dlc': {
          const aDlc = a.nearest_dlc ? new Date(a.nearest_dlc).getTime() : Infinity;
          const bDlc = b.nearest_dlc ? new Date(b.nearest_dlc).getTime() : Infinity;
          cmp = aDlc - bDlc; break;
        }
        case 'lots': cmp = (parseInt(a.active_lots_count) || 0) - (parseInt(b.active_lots_count) || 0); break;
        case 'days_stock': {
          const aDays = parseFloat(a.avg_daily_consumption) > 0 ? parseFloat(a.current_quantity) / parseFloat(a.avg_daily_consumption) : Infinity;
          const bDays = parseFloat(b.avg_daily_consumption) > 0 ? parseFloat(b.current_quantity) / parseFloat(b.avg_daily_consumption) : Infinity;
          cmp = aDays - bDays; break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [inventory, search, categoryFilter, viewFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const lowCount = (alerts as InventoryItem[]).length;
  const totalItems = (inventory as InventoryItem[]).length;
  const expiringCount = (inventory as InventoryItem[]).filter(i => (parseInt(i.expired_lots_count) || 0) > 0 || (parseInt(i.expiring_soon_count) || 0) > 0).length;

  const SortHeader = ({ col, children, className = '', align = 'left' }: { col: SortKey; children: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) => {
    const active = sortKey === col;
    return (
      <th onClick={() => toggleSort(col)}
        className={`${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 transition-colors ${className}`}>
        <span className="inline-flex items-center gap-1">
          {align === 'right' && (active
            ? (sortDir === 'asc' ? <ArrowUp size={12} className="text-violet-500" /> : <ArrowDown size={12} className="text-violet-500" />)
            : <ArrowUpDown size={11} className="opacity-30" />)}
          {children}
          {align !== 'right' && (active
            ? (sortDir === 'asc' ? <ArrowUp size={12} className="text-violet-500" /> : <ArrowDown size={12} className="text-violet-500" />)
            : <ArrowUpDown size={11} className="opacity-30" />)}
        </span>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      {/* ══════ HEADER ══════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Économat — Stock principal</h1>
          <p className="text-sm text-gray-500 mt-1">Sacs, boîtes et contenants scellés. Une fois ouverts, ils basculent en Pesage.</p>
        </div>
        {econoTab === 'stock' && (
          <button onClick={() => setShowAddIngredient(true)} className="btn-primary flex items-center gap-2">
            <Package size={16} /> Ajouter un ingrédient
          </button>
        )}
      </div>

      {/* Onglets : Stock economat / Transferts demandes — visibles uniquement aux roles warehouse */}
      {isWarehouseUser && (
        <div className="flex items-center gap-1 border-b border-gray-200">
          <button
            type="button"
            onClick={() => changeEconoTab('stock')}
            className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-all ${
              econoTab === 'stock'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Warehouse size={14} />
            <span>Stock économat</span>
          </button>
          <button
            type="button"
            onClick={() => changeEconoTab('transfers')}
            className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-all ${
              econoTab === 'transfers'
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <PackageOpen size={14} />
            <span>Transferts demandés</span>
            {transferRequests.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700">
                {transferRequests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {econoTab === 'transfers' ? (
        <TransferRequestsList />
      ) : (
      <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button onClick={() => setViewFilter('all')} className={`bg-white rounded-xl border p-4 text-center transition-all hover:shadow-sm ${viewFilter === 'all' ? 'ring-2 ring-gray-300' : ''}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center mx-auto mb-2"><Package size={16} className="text-white" /></div>
          <p className="text-2xl font-bold text-gray-900">{totalItems}</p>
          <p className="text-xs text-gray-500">Total</p>
        </button>
        <button onClick={() => setViewFilter(viewFilter === 'low' ? 'all' : 'low')} className={`bg-white rounded-xl border p-4 text-center transition-all hover:shadow-sm ${viewFilter === 'low' ? 'ring-2 ring-red-300' : ''}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center mx-auto mb-2"><AlertTriangle size={16} className="text-white" /></div>
          <p className="text-2xl font-bold text-gray-900">{lowCount}</p>
          <p className="text-xs text-gray-500">Stock bas</p>
        </button>
        <button onClick={() => setViewFilter(viewFilter === 'ok' ? 'all' : 'ok')} className={`bg-white rounded-xl border p-4 text-center transition-all hover:shadow-sm ${viewFilter === 'ok' ? 'ring-2 ring-emerald-300' : ''}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center mx-auto mb-2"><TrendingUp size={16} className="text-white" /></div>
          <p className="text-2xl font-bold text-gray-900">{totalItems - lowCount}</p>
          <p className="text-xs text-gray-500">Stock OK</p>
        </button>
        <button onClick={() => setViewFilter(viewFilter === 'expiring' ? 'all' : 'expiring')} className={`bg-white rounded-xl border p-4 text-center transition-all hover:shadow-sm ${viewFilter === 'expiring' ? 'ring-2 ring-amber-300' : ''}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center mx-auto mb-2"><CalendarClock size={16} className="text-white" /></div>
          <p className="text-2xl font-bold text-gray-900">{expiringCount}</p>
          <p className="text-xs text-gray-500">DLC critique</p>
        </button>
      </div>

      {/* ══════ NEW : LOTS EXPIRES A TRAITER (DLC ou DLV depassee) ══════ */}
      {(expiredActiveLots as Record<string, any>[]).length > 0 && (() => {
        const lots = expiredActiveLots as Record<string, any>[];
        return (
          <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-2xl p-4 shadow-sm">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center shrink-0 animate-pulse">
                <AlertTriangle size={20} className="text-white" />
              </div>
              <div className="flex-1">
                <p className="text-base font-bold text-red-900">
                  {lots.length} lot{lots.length > 1 ? 's' : ''} expiré{lots.length > 1 ? 's' : ''} à retirer du stock
                </p>
                <p className="text-xs text-red-700 mt-0.5">
                  Ces ingrédients doivent être envoyés aux pertes — la date imprimée sur le paquet est dépassée.
                </p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-red-200 divide-y divide-red-50 max-h-80 overflow-y-auto">
              {lots.map((lot) => {
                const reason = lot.expiry_reason as string;
                const totalQty = parseFloat(lot.total_qty as string) || 0;
                const unitCost = parseFloat(lot.unit_cost as string) || 0;
                const lostValue = totalQty * unitCost;
                const daysExpired = lot.days_expired as number;
                return (
                  <div key={lot.id as string} className="px-4 py-2.5 flex items-center gap-3 hover:bg-red-50/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 truncate">{lot.ingredient_name as string}</span>
                        <span className="text-[10px] font-mono text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                          {(lot.lot_number as string) || '?'}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700">
                          DLC expirée
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Expiré depuis <strong className="text-red-600">{daysExpired}j</strong> ·
                        <span className="ml-1">Économat : {parseFloat(lot.economat_quantity as string).toFixed(1)}{lot.ingredient_unit as string}</span>
                        <span className="ml-2">Pesage : {parseFloat(lot.pesage_quantity as string).toFixed(1)}{lot.ingredient_unit as string}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-red-700">{totalQty.toFixed(1)} {lot.ingredient_unit as string}</div>
                      <div className="text-[10px] text-gray-500">{lostValue.toFixed(2)} DH perdus</div>
                    </div>
                    <button
                      onClick={() => setLossDialogLot(lot)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 shrink-0">
                      <Trash2 size={12} /> Envoyer aux pertes
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Dialog d'envoi aux pertes */}
      {lossDialogLot && (
        <SendToLossesDialog
          lot={lossDialogLot}
          isPending={sendToLossesMutation.isPending}
          onClose={() => setLossDialogLot(null)}
          onConfirm={(reason, note) => sendToLossesMutation.mutate({
            lotId: lossDialogLot.id as string, reason, note,
          })}
        />
      )}

      {/* ══════ DLC ALERTS — anciens lots expires sans stock (legacy display) ══════ */}
      {(expiredLots as Record<string, any>[]).length > 0 && (() => {
        const allExpired = expiredLots as Record<string, any>[];
        const visibleExpired = showAllExpired ? allExpired : allExpired.slice(0, 3);
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-red-100 bg-gradient-to-r from-red-50 to-rose-50 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center"><AlertTriangle size={12} className="text-white" /></div>
              <span className="text-xs font-bold text-red-700">{allExpired.length} lot(s) expiré(s) avec stock restant</span>
              {allExpired.length > 3 && (
                <button onClick={() => setShowAllExpired(!showAllExpired)} className="ml-auto text-[10px] font-medium text-red-600 hover:text-red-800 flex items-center gap-0.5">
                  {showAllExpired ? <><ChevronDown size={10} /> Réduire</> : <><ChevronRight size={10} /> Voir tous ({allExpired.length})</>}
                </button>
              )}
            </div>
            <div className="divide-y divide-red-50">
              {visibleExpired.map((lot) => (
                <div key={lot.id as string} className="px-5 py-2 flex items-center justify-between text-xs hover:bg-red-50/30">
                  <span className="text-gray-700"><strong>{lot.ingredient_name as string}</strong> — <span className="font-mono text-red-600">{lot.supplier_lot_number as string || '?'}</span> — expiré depuis {lot.days_expired as number}j</span>
                  <span className="font-bold text-red-600">{parseFloat(lot.quantity_remaining as string).toFixed(1)} {lot.ingredient_unit as string}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {(expiringLots as Record<string, any>[]).length > 0 && (() => {
        const allExpiring = expiringLots as Record<string, any>[];
        const visibleExpiring = showAllExpiring ? allExpiring : allExpiring.slice(0, 3);
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center"><Clock size={12} className="text-white" /></div>
              <span className="text-xs font-bold text-amber-700">{allExpiring.length} lot(s) expirent dans les 7 prochains jours</span>
              {allExpiring.length > 3 && (
                <button onClick={() => setShowAllExpiring(!showAllExpiring)} className="ml-auto text-[10px] font-medium text-amber-600 hover:text-amber-800 flex items-center gap-0.5">
                  {showAllExpiring ? <><ChevronDown size={10} /> Réduire</> : <><ChevronRight size={10} /> Voir tous ({allExpiring.length})</>}
                </button>
              )}
            </div>
            <div className="divide-y divide-amber-50">
              {visibleExpiring.map((lot) => (
                <div key={lot.id as string} className="px-5 py-2 flex items-center justify-between text-xs hover:bg-amber-50/30">
                  <span className="text-gray-700"><strong>{lot.ingredient_name as string}</strong> — <span className="font-mono text-amber-600">{lot.supplier_lot_number as string || '?'}</span> — DLC dans {lot.days_until_expiry as number}j</span>
                  <span className="font-bold text-amber-600">{parseFloat(lot.quantity_remaining as string).toFixed(1)} {lot.ingredient_unit as string}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ══════ SEARCH + FILTERS ══════ */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher par nom, fournisseur, N° lot..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input w-48">
          <option value="">Toutes les catégories</option>
          {INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* ══════ TABLE ══════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full">
            <thead className="border-b border-gray-100">
              <tr>
                <SortHeader col="name">Ingrédient</SortHeader>
                <SortHeader col="category" className="hidden sm:table-cell">Catégorie</SortHeader>
                <SortHeader col="supplier" className="hidden md:table-cell">Fournisseur</SortHeader>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 hidden md:table-cell" title="Dernier prix d'achat saisi — utilise pour estimer le cout des recettes">
                  <span className="inline-flex items-center gap-1">Dernier prix <span className="text-[9px] font-normal text-gray-400">(estim. recette)</span></span>
                </th>
                <SortHeader col="quantity">Stock</SortHeader>
                <SortHeader col="lots" className="hidden lg:table-cell">Lots</SortHeader>
                <SortHeader col="days_stock" className="hidden lg:table-cell">Jours stock</SortHeader>
                <SortHeader col="dlc" className="hidden lg:table-cell">DLC</SortHeader>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
              ) : filteredInventory.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Aucun ingrédient trouvé</td></tr>
              ) : filteredInventory.map((item, idx) => {
                const qty = parseFloat(item.current_quantity);
                const threshold = parseFloat(item.minimum_threshold);
                const isLow = threshold > 0 && qty <= threshold;
                const isOut = qty <= 0;
                const lotsCount = parseInt(item.active_lots_count) || 0;
                const expiredCount = parseInt(item.expired_lots_count) || 0;
                const expiringSoonCount = parseInt(item.expiring_soon_count) || 0;
                const nearestDlc = item.nearest_dlc ? new Date(item.nearest_dlc) : null;
                const daysUntilDlc = nearestDlc ? Math.ceil((nearestDlc.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                const pct = threshold > 0 ? Math.min(Math.round((qty / (threshold * 3)) * 100), 100) : (qty > 0 ? 100 : 0);

                return (
                  <tr key={item.id} onClick={() => navigate(`/inventory/${item.ingredient_id}`)}
                    className={`cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-gray-50/30' : ''} ${
                      expiredCount > 0 ? 'hover:bg-red-50/40' : isLow ? 'hover:bg-amber-50/40' : 'hover:bg-violet-50/40'
                    }`}>
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2 h-8 rounded-full shrink-0 ${
                          expiredCount > 0 ? 'bg-red-500' : isOut ? 'bg-red-400' : isLow ? 'bg-amber-400' : expiringSoonCount > 0 ? 'bg-amber-300' : 'bg-emerald-400'
                        }`} />
                        <span className="font-medium text-sm text-gray-900">{item.ingredient_name}</span>
                      </div>
                    </td>
                    {/* Category */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[item.category || 'autre'] || CATEGORY_COLORS.autre}`}>
                        {INGREDIENT_CATEGORIES.find(c => c.value === (item.category || 'autre'))?.label || 'Autre'}
                      </span>
                    </td>
                    {/* Supplier */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-gray-500">{item.supplier || '—'}</span>
                    </td>
                    {/* Dernier prix d'achat — base du cout estime des recettes */}
                    <td className="px-4 py-3 hidden md:table-cell text-right">
                      {(() => {
                        const cost = parseFloat(item.unit_cost || '0');
                        return cost > 0 ? (
                          <span className="text-xs font-semibold text-gray-700">
                            {cost.toFixed(2)} <span className="text-[10px] text-gray-400">DH/{item.unit}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        );
                      })()}
                    </td>
                    {/* Stock — split Économat / Pesage */}
                    <td className="px-4 py-3">
                      {(() => {
                        const economatQty = parseFloat(item.economat_quantity || '0');
                        const pesageQty = parseFloat(item.pesage_quantity || '0');
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-800'}`}>
                                {qty.toFixed(qty % 1 === 0 ? 0 : 1)}
                              </span>
                              <span className="text-[10px] text-gray-400">{item.unit}</span>
                              <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden sm:block">
                                <div className={`h-full rounded-full ${isOut ? 'bg-red-500' : isLow ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <div className="flex gap-2 text-[9px]">
                              <span className="text-amber-700" title="Stock scellé en Économat">
                                <strong>{economatQty.toFixed(economatQty % 1 === 0 ? 0 : 1)}</strong> écon.
                              </span>
                              <span className="text-blue-700" title="Stock ouvert en Pesage">
                                <strong>{pesageQty.toFixed(pesageQty % 1 === 0 ? 0 : 1)}</strong> pesage
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    {/* Lots */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {lotsCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold">
                          <Boxes size={10} /> {lotsCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    {/* Jours de stock */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {(() => {
                        const avgConso = parseFloat(item.avg_daily_consumption || '0');
                        if (avgConso <= 0) return <span className="text-[10px] text-gray-300">—</span>;
                        const daysOfStock = Math.round(qty / avgConso);
                        return (
                          <span className={`inline-flex items-center gap-1 text-xs font-bold ${
                            daysOfStock <= 3 ? 'text-red-600' : daysOfStock <= 7 ? 'text-amber-600' : daysOfStock <= 14 ? 'text-blue-600' : 'text-emerald-600'
                          }`}>
                            <Timer size={10} />
                            {daysOfStock}j
                          </span>
                        );
                      })()}
                    </td>
                    {/* DLC */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {nearestDlc ? (
                        <span className={`text-xs font-medium ${
                          daysUntilDlc !== null && daysUntilDlc < 0 ? 'text-red-600' :
                          daysUntilDlc !== null && daysUntilDlc <= 7 ? 'text-amber-600' : 'text-gray-500'
                        }`}>
                          {format(nearestDlc, 'dd/MM/yy')}
                          {daysUntilDlc !== null && daysUntilDlc <= 30 && (
                            <span className="text-[10px] ml-1 font-normal">({daysUntilDlc < 0 ? `${Math.abs(daysUntilDlc)}j!` : `${daysUntilDlc}j`})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    {/* Chevron */}
                    <td className="px-4 py-3"><ChevronRight size={16} className="text-gray-300" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Ingredient Modal */}
      {showAddIngredient && <AddIngredientModal
        onClose={() => setShowAddIngredient(false)}
        onSave={(data) => addIngredientMutation.mutate(data)}
        isLoading={addIngredientMutation.isPending} />}
      </>
      )}
    </div>
  );
}

/* ─── Add Ingredient Modal ─── */
function AddIngredientModal({ onClose, onSave, isLoading }: {
  onClose: () => void; onSave: (data: Record<string, any>) => void; isLoading: boolean;
}) {
  const [form, setForm] = useState({ name: '', unit: 'kg', unitCost: '', supplier: '', category: 'autre' });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Package size={20} className="text-white" /></div>
            <div><h2 className="text-lg font-bold text-white">Nouvel ingrédient</h2><p className="text-sm text-white/70">Ajouter au suivi inventaire</p></div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ name: form.name, unit: form.unit, unitCost: parseFloat(form.unitCost) || 0, supplier: form.supplier || undefined, category: form.category }); }} className="p-5 space-y-4">
          <div><label className="block text-sm font-medium mb-1">Nom de l'ingrédient *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Farine T55" autoFocus /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Unité</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option value="kg">Kilogramme (kg)</option><option value="g">Gramme (g)</option><option value="l">Litre (l)</option><option value="ml">Millilitre (ml)</option><option value="unit">Unité</option>
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Coût unitaire (DH)</label><input type="number" step="0.01" className="input" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} placeholder="0.00" required /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Catégorie</label><select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Fournisseur</label><input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Nom du fournisseur" /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={isLoading} className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50">{isLoading ? 'Ajout...' : 'Ajouter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ════════ SendToLossesDialog ═══════════════════════════════════════════
// Dialog confirmation : envoie un lot expire aux pertes (DLC ou DLV depassee).
// Demande un motif (pre-selectionne selon expiry_reason) + note optionnelle.
function SendToLossesDialog({ lot, isPending, onClose, onConfirm }: {
  lot: Record<string, any>;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string, note?: string) => void;
}) {
  const initialReason = (lot.expiry_reason as string) || 'dlc_expired';
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState('');

  const totalQty = parseFloat(lot.total_qty as string) || 0;
  const unitCost = parseFloat(lot.unit_cost as string) || 0;
  const lostValue = totalQty * unitCost;
  const economatQty = parseFloat(lot.economat_quantity as string) || 0;
  const pesageQty = parseFloat(lot.pesage_quantity as string) || 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-red-900">Envoyer aux pertes</h3>
            <p className="text-xs text-red-700 mt-0.5">Action irréversible — le lot sera retiré du stock.</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-red-100 rounded-lg">
            <X size={18} className="text-red-700" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Recap lot */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Produit</span>
              <span className="font-semibold text-gray-900">{lot.ingredient_name as string}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">N° lot</span>
              <span className="font-mono text-xs text-gray-700">{(lot.lot_number as string) || '?'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Stock à retirer</span>
              <span className="font-bold text-red-700">
                {totalQty.toFixed(2)} {lot.ingredient_unit as string}
                <span className="text-xs text-gray-400 ml-1">
                  ({economatQty > 0 ? `${economatQty.toFixed(1)} écon.` : ''}
                  {economatQty > 0 && pesageQty > 0 ? ' + ' : ''}
                  {pesageQty > 0 ? `${pesageQty.toFixed(1)} pesage` : ''})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-gray-200">
              <span className="text-gray-500">Valeur perdue</span>
              <span className="font-bold text-red-700">{lostValue.toFixed(2)} DH</span>
            </div>
          </div>

          {/* Motif */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Motif</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'dlc_expired', label: 'DLC expirée', sub: 'Date de péremption dépassée' },
                { v: 'damaged', label: 'Endommagé', sub: 'Casse, contamination' },
                { v: 'quarantine_failed', label: 'Échec contrôle', sub: 'Non conforme' },
                { v: 'other', label: 'Autre', sub: 'Préciser dans la note' },
              ] as const).map(opt => (
                <button key={opt.v} type="button" onClick={() => setReason(opt.v)}
                  className={`px-3 py-2 rounded-lg border text-left transition-all ${
                    reason === opt.v
                      ? 'border-red-400 bg-red-50 ring-2 ring-red-200'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                  <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Note optionnelle */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Note (optionnel)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="Détails additionnels..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={isPending}
              className="flex-1 py-2.5 px-4 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200">
              Annuler
            </button>
            <button onClick={() => onConfirm(reason, note || undefined)}
              disabled={isPending}
              className="flex-1 py-2.5 px-4 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {isPending ? 'Envoi...' : <><Trash2 size={14} /> Confirmer l&apos;envoi aux pertes</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
