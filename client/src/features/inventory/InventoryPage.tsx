import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { inventoryApi, ingredientsApi } from '../../api/inventory.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { TransferRequestsList } from '../warehouse/TransferRequestsList';
import { RuptureRequestsList } from '../warehouse/RuptureRequestsList';
import {
  AlertTriangle, Package, Search, TrendingUp,
  Clock, X, Boxes, CalendarClock, ChevronRight, ChevronDown, ChevronLeft,
  ArrowUp, ArrowDown, ArrowUpDown, Timer, Trash2, PackageOpen, Warehouse,
  Plus, List, LayoutGrid, Save, ShoppingCart, Upload, Download, BarChart3,
} from 'lucide-react';
import IngredientImportModal from './IngredientImportModal';
import ConsommationTab from './ConsommationTab';
import { notify } from '../../components/ui/InlineNotification';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { format } from 'date-fns';

type SortKey = 'name' | 'category' | 'supplier' | 'quantity' | 'lots' | 'dlc' | 'days_stock';
type SortDir = 'asc' | 'desc';
type ViewFilter = 'all' | 'low' | 'ok' | 'expiring';
type EconomatTab = 'stock' | 'transfers' | 'ruptures' | 'consumption';
type ViewMode = 'list' | 'kanban';

const INGREDIENT_CATEGORIES = [
  { value: 'farines', label: 'Farines & Céréales' },
  { value: 'sucres', label: 'Sucres & Édulcorants' },
  { value: 'lait', label: 'Lait & Boissons lactées' },
  { value: 'cremes', label: 'Crèmes (fraîche, liquide, épaisse)' },
  { value: 'beurre', label: 'Beurre & Margarines' },
  { value: 'fromages', label: 'Fromages & Fromages frais' },
  { value: 'produits_laitiers', label: 'Produits laitiers (divers)' },
  { value: 'oeufs', label: 'Oeufs & Ovoproduits' },
  { value: 'matieres_grasses', label: 'Matières grasses & Huiles' },
  { value: 'chocolat', label: 'Chocolat & Cacao' },
  { value: 'fruits', label: 'Fruits & Purées' },
  { value: 'fruits_secs', label: 'Fruits secs & Oléagineux' },
  { value: 'viandes', label: 'Viandes & Volailles' },
  { value: 'poissons_fruits_de_mer', label: 'Poissons & Fruits de mer' },
  { value: 'legumes', label: 'Légumes' },
  { value: 'epices', label: 'Épices & Arômes' },
  { value: 'sel_vinaigre', label: 'Sel & Vinaigre' },
  { value: 'levures', label: 'Levures & Agents levants' },
  { value: 'gelifiants', label: 'Gélifiants' },
  { value: 'colorants', label: 'Colorants' },
  { value: 'decors', label: 'Décors & Garnitures' },
  { value: 'sauces', label: 'Sauces & Condiments' },
  { value: 'conserves', label: 'Conserves' },
  { value: 'preparations', label: 'Préparations' },
  { value: 'pates_riz', label: 'Pâtes & Riz' },
  { value: 'emballages', label: 'Emballages' },
  { value: 'autre', label: 'Autre' },
];

const CATEGORY_COLORS: Record<string, string> = {
  farines: 'bg-amber-100 text-amber-700',
  sucres: 'bg-pink-100 text-pink-700',
  lait: 'bg-sky-100 text-sky-700',
  cremes: 'bg-amber-50 text-amber-600',
  beurre: 'bg-yellow-50 text-yellow-600',
  fromages: 'bg-orange-200 text-orange-800',
  produits_laitiers: 'bg-blue-100 text-blue-700',
  oeufs: 'bg-yellow-100 text-yellow-700',
  matieres_grasses: 'bg-orange-100 text-orange-700',
  chocolat: 'bg-stone-200 text-stone-700',
  fruits: 'bg-green-100 text-green-700',
  fruits_secs: 'bg-lime-100 text-lime-700',
  viandes: 'bg-red-200 text-red-800',
  poissons_fruits_de_mer: 'bg-teal-200 text-teal-800',
  legumes: 'bg-emerald-100 text-emerald-700',
  epices: 'bg-red-100 text-red-700',
  sel_vinaigre: 'bg-slate-100 text-slate-700',
  levures: 'bg-violet-100 text-violet-700',
  gelifiants: 'bg-cyan-100 text-cyan-700',
  colorants: 'bg-fuchsia-100 text-fuchsia-700',
  decors: 'bg-purple-100 text-purple-700',
  sauces: 'bg-rose-100 text-rose-700',
  conserves: 'bg-teal-100 text-teal-700',
  preparations: 'bg-indigo-100 text-indigo-700',
  pates_riz: 'bg-yellow-200 text-yellow-800',
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
  // Admin/gerant uniquement : actions de gestion en masse (import/export ingredients).
  const canManageIngredients = ['admin', 'manager'].includes(user?.role || '');

  // Onglets : "Stock economat" (defaut) + "Transferts demandes" (BSI a transferer)
  // + "Ingredients a commander" (BSI en rupture totale, cross-plans).
  // Persiste l'onglet en URL pour permettre les deep-links (badge sidebar, lien BSI panel).
  const validTabs: EconomatTab[] = ['stock', 'transfers', 'ruptures', 'consumption'];
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as EconomatTab | null;
  const [econoTab, setEconoTab] = useState<EconomatTab>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'stock'
  );
  useEffect(() => {
    if (tabFromUrl && validTabs.includes(tabFromUrl) && econoTab !== tabFromUrl) setEconoTab(tabFromUrl);
    if (!tabFromUrl && econoTab !== 'stock') setEconoTab('stock');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);
  const changeEconoTab = (next: EconomatTab) => {
    setEconoTab(next);
    if (next === 'stock') searchParams.delete('tab');
    else searchParams.set('tab', next);
    setSearchParams(searchParams, { replace: true });
  };

  // Compteurs pour les badges des onglets (transferts + ruptures).
  // Visible uniquement aux roles ayant le module economat (magasinier/admin/manager).
  const { data: transferRequests = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-transfer-requests'],
    queryFn: bonSortieApi.transferRequests,
    enabled: isWarehouseUser,
    refetchInterval: 30000,
  });
  const { data: ruptureRequests = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-rupture-requests'],
    queryFn: bonSortieApi.ruptureRequests,
    enabled: isWarehouseUser,
    refetchInterval: 30000,
  });

  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showAddIngredient, setShowAddIngredient] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
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
        style={{ textAlign: align }}
        className={className}>
        <span className="inline-flex items-center gap-1">
          {children}
          <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
            {active ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div className="odoo-scope">
      {/* ══════ CONTROL BAR (Odoo) ══════ */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <Warehouse size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Économat</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">
            {econoTab === 'transfers' ? 'Transferts demandés' : 'Stock principal'}
          </span>
        </div>
        {econoTab === 'stock' && (
          <button onClick={() => setShowAddIngredient(true)} className="odoo-btn-primary">
            <Plus size={14} /> Nouveau
          </button>
        )}
        {econoTab === 'stock' && canManageIngredients && (
          <>
            <button onClick={() => setShowImport(true)} className="odoo-btn-secondary" title="Importer des ingrédients depuis un fichier Excel">
              <Upload size={14} /> Importer
            </button>
            <button
              onClick={async () => {
                setExportLoading(true);
                try {
                  const stamp = new Date().toISOString().slice(0, 10);
                  await ingredientsApi.exportXlsx(`ingredients-economat-${stamp}.xlsx`);
                  notify.success('Export téléchargé');
                } catch {
                  notify.error('Erreur lors de l\'export');
                } finally {
                  setExportLoading(false);
                }
              }}
              disabled={exportLoading}
              className="odoo-btn-secondary"
              title="Exporter tous les ingrédients avec leur stock vers Excel"
            >
              <Download size={14} /> {exportLoading ? 'Export…' : 'Exporter'}
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        {econoTab === 'stock' && totalItems > 0 && (
          <div className="odoo-pager">
            <span style={{ marginRight: '0.5rem' }}>
              <strong>1-{filteredInventory.length}</strong> / {totalItems}
            </span>
            <button className="odoo-pager-btn" disabled><ChevronLeft size={14} /></button>
            <button className="odoo-pager-btn" disabled><ChevronRight size={14} /></button>
          </div>
        )}
        <div className="odoo-view-switcher">
          <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'active' : ''} title="Vue liste">
            <List size={14} />
          </button>
          <button onClick={() => setViewMode('kanban')} className={viewMode === 'kanban' ? 'active' : ''} title="Vue kanban (groupée par catégorie)">
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>

      {/* Onglets : Stock / Transferts / Ingredients a commander */}
      {isWarehouseUser && (
        <div className="odoo-tabs">
          <button
            type="button"
            onClick={() => changeEconoTab('stock')}
            className={`odoo-tab ${econoTab === 'stock' ? 'active' : ''}`}>
            <Warehouse size={13} />
            <span>Stock économat</span>
          </button>
          <button
            type="button"
            onClick={() => changeEconoTab('transfers')}
            className={`odoo-tab ${econoTab === 'transfers' ? 'active' : ''}`}>
            <PackageOpen size={13} />
            <span>Transferts demandés</span>
            {transferRequests.length > 0 && (
              <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: '0.25rem' }}>
                {transferRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => changeEconoTab('ruptures')}
            className={`odoo-tab ${econoTab === 'ruptures' ? 'active' : ''}`}>
            <ShoppingCart size={13} />
            <span>Ingrédients à commander</span>
            {ruptureRequests.length > 0 && (
              <span className="odoo-tag odoo-tag-red" style={{ marginLeft: '0.25rem' }}>
                {ruptureRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => changeEconoTab('consumption')}
            className={`odoo-tab ${econoTab === 'consumption' ? 'active' : ''}`}>
            <BarChart3 size={13} />
            <span>Consommation</span>
          </button>
        </div>
      )}

      {econoTab === 'transfers' ? (
        <div style={{ padding: '1rem' }}>
          <TransferRequestsList />
        </div>
      ) : econoTab === 'ruptures' ? (
        <div style={{ padding: '1rem' }}>
          <RuptureRequestsList />
        </div>
      ) : econoTab === 'consumption' ? (
        <div style={{ padding: '1rem' }}>
          <ConsommationTab />
        </div>
      ) : (
      <>
      {/* ══════ STAT TILES (sober) ══════ */}
      <div className="odoo-stat-grid">
        <button onClick={() => setViewFilter('all')}
          className={`odoo-stat-card ${viewFilter === 'all' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <Package size={11} style={{ display: 'inline', marginRight: 4 }} />Total ingrédients
          </div>
          <div className="odoo-stat-card-value">{totalItems}</div>
        </button>
        <button onClick={() => setViewFilter(viewFilter === 'low' ? 'all' : 'low')}
          className={`odoo-stat-card ${viewFilter === 'low' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4, color: '#dc3545' }} />Stock bas
          </div>
          <div className="odoo-stat-card-value" style={{ color: lowCount > 0 ? '#dc3545' : undefined }}>{lowCount}</div>
        </button>
        <button onClick={() => setViewFilter(viewFilter === 'ok' ? 'all' : 'ok')}
          className={`odoo-stat-card ${viewFilter === 'ok' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <TrendingUp size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Stock OK
          </div>
          <div className="odoo-stat-card-value">{totalItems - lowCount}</div>
        </button>
        <button onClick={() => setViewFilter(viewFilter === 'expiring' ? 'all' : 'expiring')}
          className={`odoo-stat-card ${viewFilter === 'expiring' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <CalendarClock size={11} style={{ display: 'inline', marginRight: 4, color: '#b85d1a' }} />DLC critique
          </div>
          <div className="odoo-stat-card-value" style={{ color: expiringCount > 0 ? '#b85d1a' : undefined }}>{expiringCount}</div>
        </button>
      </div>

      {/* ══════ LOTS EXPIRES A TRAITER (DLC depassee) ══════ */}
      {(expiredActiveLots as Record<string, any>[]).length > 0 && (() => {
        const lots = expiredActiveLots as Record<string, any>[];
        return (
          <div className="odoo-alert danger">
            <AlertTriangle size={16} style={{ marginTop: 2, color: '#dc3545', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="odoo-alert-title">
                {lots.length} lot{lots.length > 1 ? 's' : ''} expiré{lots.length > 1 ? 's' : ''} à retirer du stock
              </div>
              <div style={{ fontSize: '0.75rem', marginTop: 2, opacity: 0.9 }}>
                Ces ingrédients doivent être envoyés aux pertes — la date imprimée sur le paquet est dépassée.
              </div>
              <div style={{ marginTop: '0.5rem', maxHeight: '18rem', overflowY: 'auto', border: '1px solid #f5c6cb', borderRadius: 4, backgroundColor: '#fff' }}>
                {lots.map((lot, i) => {
                  const totalQty = parseFloat(lot.total_qty as string) || 0;
                  const unitCost = parseFloat(lot.unit_cost as string) || 0;
                  const lostValue = totalQty * unitCost;
                  const daysExpired = lot.days_expired as number;
                  return (
                    <div key={lot.id as string} style={{
                      padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                      borderTop: i > 0 ? '1px solid #fce4e1' : 'none', fontSize: '0.75rem',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--theme-text-strong)' }}>{lot.ingredient_name as string}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.6875rem', color: '#721c24', backgroundColor: '#f8d7da', padding: '0 0.375rem', borderRadius: 2 }}>
                            {(lot.lot_number as string) || '?'}
                          </span>
                          <span className="odoo-tag odoo-tag-red">DLC expirée</span>
                        </div>
                        <div style={{ marginTop: 2, color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                          Expiré depuis <strong style={{ color: '#dc3545' }}>{daysExpired}j</strong> ·
                          Écon. {parseFloat(lot.economat_quantity as string).toFixed(1)}{lot.ingredient_unit as string} ·
                          Pesage {parseFloat(lot.pesage_quantity as string).toFixed(1)}{lot.ingredient_unit as string}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 600, color: '#721c24' }}>{totalQty.toFixed(1)} {lot.ingredient_unit as string}</div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{lostValue.toFixed(2)} DH</div>
                      </div>
                      <button onClick={() => setLossDialogLot(lot)} className="odoo-btn-danger" style={{ flexShrink: 0 }}>
                        <Trash2 size={11} /> Pertes
                      </button>
                    </div>
                  );
                })}
              </div>
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

      {/* ══════ DLC ALERTS — anciens lots expires sans stock ══════ */}
      {(expiredLots as Record<string, any>[]).length > 0 && (() => {
        const allExpired = expiredLots as Record<string, any>[];
        const visibleExpired = showAllExpired ? allExpired : allExpired.slice(0, 3);
        return (
          <div className="odoo-alert danger">
            <AlertTriangle size={14} style={{ color: '#dc3545', marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="odoo-alert-title">{allExpired.length} lot(s) expiré(s) avec stock restant</span>
                {allExpired.length > 3 && (
                  <button onClick={() => setShowAllExpired(!showAllExpired)} className="odoo-filter-dropdown" style={{ fontSize: '0.6875rem' }}>
                    {showAllExpired ? <><ChevronDown size={11} /> Réduire</> : <><ChevronRight size={11} /> Voir tous ({allExpired.length})</>}
                  </button>
                )}
              </div>
              {visibleExpired.map((lot, i) => (
                <div key={lot.id as string} style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem',
                  paddingTop: i === 0 ? '0.375rem' : '0.25rem',
                }}>
                  <span><strong>{lot.ingredient_name as string}</strong> — <span style={{ fontFamily: 'monospace', color: '#dc3545' }}>{lot.supplier_lot_number as string || '?'}</span> — expiré depuis {lot.days_expired as number}j</span>
                  <span style={{ fontWeight: 600, color: '#dc3545' }}>{parseFloat(lot.quantity_remaining as string).toFixed(1)} {lot.ingredient_unit as string}</span>
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
          <div className="odoo-alert warning">
            <Clock size={14} style={{ color: '#856404', marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="odoo-alert-title">{allExpiring.length} lot(s) expirent dans les 7 prochains jours</span>
                {allExpiring.length > 3 && (
                  <button onClick={() => setShowAllExpiring(!showAllExpiring)} className="odoo-filter-dropdown" style={{ fontSize: '0.6875rem' }}>
                    {showAllExpiring ? <><ChevronDown size={11} /> Réduire</> : <><ChevronRight size={11} /> Voir tous ({allExpiring.length})</>}
                  </button>
                )}
              </div>
              {visibleExpiring.map((lot, i) => (
                <div key={lot.id as string} style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem',
                  paddingTop: i === 0 ? '0.375rem' : '0.25rem',
                }}>
                  <span><strong>{lot.ingredient_name as string}</strong> — <span style={{ fontFamily: 'monospace', color: '#856404' }}>{lot.supplier_lot_number as string || '?'}</span> — DLC dans {lot.days_until_expiry as number}j</span>
                  <span style={{ fontWeight: 600, color: '#856404' }}>{parseFloat(lot.quantity_remaining as string).toFixed(1)} {lot.ingredient_unit as string}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ══════ SEARCH PANEL Odoo ══════ */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Rechercher par nom, fournisseur, N° lot..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="odoo-search-input"
        />
        {search && (
          <span className="odoo-filter-chip">
            Recherche: {search}
            <span className="odoo-filter-chip-remove" onClick={() => setSearch('')}>×</span>
          </span>
        )}
        {categoryFilter && (
          <span className="odoo-filter-chip">
            {INGREDIENT_CATEGORIES.find(c => c.value === categoryFilter)?.label}
            <span className="odoo-filter-chip-remove" onClick={() => setCategoryFilter('')}>×</span>
          </span>
        )}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="odoo-filter-dropdown"
          style={{ border: 'none', backgroundColor: 'transparent', outline: 'none' }}
        >
          <option value="">▾ Catégorie</option>
          {INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* ══════ TABLE Odoo (dense) — vue liste ══════ */}
      {viewMode === 'list' && (
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <SortHeader col="name">Ingrédient</SortHeader>
              <SortHeader col="category" className="hidden sm:table-cell">Catégorie</SortHeader>
              <SortHeader col="supplier" className="hidden md:table-cell">Fournisseur</SortHeader>
              <th
                className="hidden md:table-cell"
                style={{ textAlign: 'right' }}
                title="Dernier prix d'achat saisi — base du cout estime des recettes">
                Dernier prix
              </th>
              <SortHeader col="quantity" align="right">Stock</SortHeader>
              <SortHeader col="lots" className="hidden lg:table-cell" align="right">Lots</SortHeader>
              <SortHeader col="days_stock" className="hidden lg:table-cell" align="right">Jours stock</SortHeader>
              <SortHeader col="dlc" className="hidden lg:table-cell">DLC</SortHeader>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Chargement...</td></tr>
            ) : filteredInventory.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucun ingrédient trouvé</td></tr>
            ) : filteredInventory.map((item) => {
              const qty = parseFloat(item.current_quantity);
              const threshold = parseFloat(item.minimum_threshold);
              const isLow = threshold > 0 && qty <= threshold;
              const isOut = qty <= 0;
              const lotsCount = parseInt(item.active_lots_count) || 0;
              const expiredCount = parseInt(item.expired_lots_count) || 0;
              const expiringSoonCount = parseInt(item.expiring_soon_count) || 0;
              const nearestDlc = item.nearest_dlc ? new Date(item.nearest_dlc) : null;
              const daysUntilDlc = nearestDlc ? Math.ceil((nearestDlc.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

              const statusDot = expiredCount > 0 ? 'danger' :
                isOut ? 'danger' :
                isLow ? 'warning' :
                expiringSoonCount > 0 ? 'warning' : 'ok';
              const rowClass = expiredCount > 0 ? 'row-danger' : isLow ? 'row-warning' : '';

              return (
                <tr key={item.id} onClick={() => navigate(`/inventory/${item.ingredient_id}`)} className={rowClass}>
                  <td><span className={`odoo-status-dot ${statusDot}`} /></td>
                  <td><span style={{ fontWeight: 500 }}>{item.ingredient_name}</span></td>
                  <td className="hidden sm:table-cell">
                    <span className={`odoo-tag ${
                      ['farines','pates_riz'].includes(item.category) ? 'odoo-tag-yellow' :
                      ['sucres','decors'].includes(item.category) ? 'odoo-tag-purple' :
                      ['produits_laitiers','gelifiants'].includes(item.category) ? 'odoo-tag-blue' :
                      ['fruits','legumes','preparations'].includes(item.category) ? 'odoo-tag-green' :
                      ['chocolat','viandes','epices','sauces','colorants'].includes(item.category) ? 'odoo-tag-red' :
                      ['matieres_grasses','levures','conserves'].includes(item.category) ? 'odoo-tag-orange' :
                      'odoo-tag-grey'
                    }`}>
                      {INGREDIENT_CATEGORIES.find(c => c.value === (item.category || 'autre'))?.label || 'Autre'}
                    </span>
                  </td>
                  <td className="hidden md:table-cell" style={{ color: 'var(--theme-text-muted)' }}>{item.supplier || '—'}</td>
                  <td className="hidden md:table-cell" style={{ textAlign: 'right' }}>
                    {(() => {
                      const cost = parseFloat(item.unit_cost || '0');
                      return cost > 0 ? (
                        <span style={{ fontWeight: 500 }}>{cost.toFixed(2)} <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>DH/{item.unit}</span></span>
                      ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>;
                    })()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {(() => {
                      const economatQty = parseFloat(item.economat_quantity || '0');
                      const pesageQty = parseFloat(item.pesage_quantity || '0');
                      return (
                        <div>
                          <div style={{ fontWeight: 600, color: isOut ? '#dc3545' : isLow ? '#b85d1a' : 'var(--theme-text-strong)' }}>
                            {qty.toFixed(qty % 1 === 0 ? 0 : 1)} <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.6875rem' }}>{item.unit}</span>
                          </div>
                          <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
                            <span title="Économat">éc. {economatQty.toFixed(economatQty % 1 === 0 ? 0 : 1)}</span>
                            <span style={{ margin: '0 0.25rem', color: 'var(--theme-bg-separator)' }}>·</span>
                            <span title="Pesage">pe. {pesageQty.toFixed(pesageQty % 1 === 0 ? 0 : 1)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="hidden lg:table-cell" style={{ textAlign: 'right' }}>
                    {lotsCount > 0 ? (
                      <span className="odoo-tag odoo-tag-blue">
                        <Boxes size={9} /> {lotsCount}
                      </span>
                    ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                  </td>
                  <td className="hidden lg:table-cell" style={{ textAlign: 'right' }}>
                    {(() => {
                      const avgConso = parseFloat(item.avg_daily_consumption || '0');
                      if (avgConso <= 0) return <span style={{ color: 'var(--theme-text-muted)' }}>—</span>;
                      const daysOfStock = Math.round(qty / avgConso);
                      return (
                        <span style={{
                          fontWeight: 600,
                          color: daysOfStock <= 3 ? '#dc3545' : daysOfStock <= 7 ? '#b85d1a' : daysOfStock <= 14 ? '#1f6391' : '#28a745',
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                          <Timer size={10} />{daysOfStock}j
                        </span>
                      );
                    })()}
                  </td>
                  <td className="hidden lg:table-cell">
                    {nearestDlc ? (
                      <span style={{
                        fontWeight: 500,
                        color: daysUntilDlc !== null && daysUntilDlc < 0 ? '#dc3545' :
                          daysUntilDlc !== null && daysUntilDlc <= 7 ? '#b85d1a' : 'var(--theme-text-muted)',
                      }}>
                        {format(nearestDlc, 'dd/MM/yy')}
                        {daysUntilDlc !== null && daysUntilDlc <= 30 && (
                          <span style={{ fontSize: '0.625rem', marginLeft: 4, opacity: 0.7 }}>
                            ({daysUntilDlc < 0 ? `${Math.abs(daysUntilDlc)}j!` : `${daysUntilDlc}j`})
                          </span>
                        )}
                      </span>
                    ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* ══════ KANBAN view — groupée par catégorie ══════ */}
      {viewMode === 'kanban' && (
        <KanbanView
          items={filteredInventory}
          onSelect={(id) => navigate(`/inventory/${id}`)}
        />
      )}

      {/* Add Ingredient Modal */}
      {showAddIngredient && <AddIngredientModal
        onClose={() => setShowAddIngredient(false)}
        onSave={(data) => addIngredientMutation.mutate(data)}
        isLoading={addIngredientMutation.isPending} />}

      {/* Import Ingredients Modal (admin/gérant) */}
      {showImport && <IngredientImportModal onClose={() => setShowImport(false)} />}
      </>
      )}
    </div>
  );
}

/* ─── Add Ingredient Modal (Odoo style) ─── */
function AddIngredientModal({ onClose, onSave, isLoading }: {
  onClose: () => void; onSave: (data: Record<string, any>) => void; isLoading: boolean;
}) {
  const [form, setForm] = useState({ name: '', unit: 'kg', unitCost: '', supplier: '', category: 'autre' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 480, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f9fafb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={16} style={{ color: 'var(--theme-accent)' }} />
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>Nouvel ingrédient</h2>
          </div>
          <button onClick={onClose} style={{ padding: 4, color: 'var(--theme-text-muted)' }}><X size={16} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave({ name: form.name, unit: form.unit, unitCost: parseFloat(form.unitCost) || 0, supplier: form.supplier || undefined, category: form.category }); }}
          style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Nom de l'ingrédient *</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Farine T55" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Unité</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option value="kg">Kilogramme (kg)</option><option value="g">Gramme (g)</option><option value="l">Litre (l)</option><option value="ml">Millilitre (ml)</option><option value="unit">Unité</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Coût unitaire (DH)</label>
              <input type="number" step="0.01" className="input" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} placeholder="0.00" required />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Catégorie</label>
            <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {INGREDIENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Fournisseur</label>
            <input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Nom du fournisseur" />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)', marginTop: '0.25rem' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">
              <Save size={13} /> {isLoading ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fdf0ed' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Trash2 size={16} style={{ color: '#dc3545' }} />
            <div>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#721c24' }}>Envoyer aux pertes</h3>
              <p style={{ fontSize: '0.75rem', color: '#721c24', opacity: 0.85, marginTop: 1 }}>Action irréversible — le lot sera retiré du stock.</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 4, color: '#721c24' }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          {/* Recap lot */}
          <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, backgroundColor: '#f9fafb', padding: '0.625rem 0.75rem', fontSize: '0.8125rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.125rem 0' }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>Produit</span>
              <span style={{ fontWeight: 600 }}>{lot.ingredient_name as string}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.125rem 0' }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>N° lot</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{(lot.lot_number as string) || '?'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.125rem 0' }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>Stock à retirer</span>
              <span style={{ fontWeight: 600, color: '#721c24' }}>
                {totalQty.toFixed(2)} {lot.ingredient_unit as string}
                <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginLeft: 4 }}>
                  ({economatQty > 0 ? `${economatQty.toFixed(1)} écon.` : ''}
                  {economatQty > 0 && pesageQty > 0 ? ' + ' : ''}
                  {pesageQty > 0 ? `${pesageQty.toFixed(1)} pesage` : ''})
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0 0', borderTop: '1px solid var(--theme-bg-separator)', marginTop: '0.25rem' }}>
              <span style={{ color: 'var(--theme-text-muted)' }}>Valeur perdue</span>
              <span style={{ fontWeight: 600, color: '#721c24' }}>{lostValue.toFixed(2)} DH</span>
            </div>
          </div>

          {/* Motif */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 6 }}>Motif</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
              {([
                { v: 'dlc_expired', label: 'DLC expirée', sub: 'Date de péremption dépassée' },
                { v: 'damaged', label: 'Endommagé', sub: 'Casse, contamination' },
                { v: 'quarantine_failed', label: 'Échec contrôle', sub: 'Non conforme' },
                { v: 'other', label: 'Autre', sub: 'Préciser dans la note' },
              ] as const).map(opt => (
                <button key={opt.v} type="button" onClick={() => setReason(opt.v)}
                  style={{
                    padding: '0.5rem 0.625rem',
                    borderRadius: 3,
                    border: `1px solid ${reason === opt.v ? 'var(--theme-accent)' : 'var(--theme-bg-separator)'}`,
                    backgroundColor: reason === opt.v ? '#f3edf2' : '#fff',
                    textAlign: 'left',
                    boxShadow: reason === opt.v ? 'inset 0 0 0 1px var(--theme-accent)' : 'none',
                  }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>{opt.label}</div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Note optionnelle */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Note (optionnel)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="Détails additionnels..."
              className="input" style={{ width: '100%' }} />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} disabled={isPending} className="odoo-btn-secondary">Annuler</button>
            <button onClick={() => onConfirm(reason, note || undefined)} disabled={isPending}
              className="odoo-btn-primary" style={{ backgroundColor: '#dc3545', borderColor: '#dc3545' }}>
              <Trash2 size={13} /> {isPending ? 'Envoi...' : 'Envoyer aux pertes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Kanban View (Odoo) ─────────────────────────────────────────────
   Affiche les ingredients groupes par categorie, chaque section
   contient une grille de cartes cliquables avec stock + indicateurs.
   ───────────────────────────────────────────────────────────────── */
function KanbanView({ items, onSelect }: {
  items: InventoryItem[];
  onSelect: (ingredientId: string) => void;
}) {
  const grouped = useMemo(() => {
    const groups: Record<string, InventoryItem[]> = {};
    items.forEach((item) => {
      const cat = item.category || 'autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return INGREDIENT_CATEGORIES
      .map((c) => ({ key: c.value, label: c.label, items: groups[c.value] || [] }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="odoo-kanban">
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Package size={48} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.875rem' }}>Aucun ingrédient trouvé</p>
        </div>
      </div>
    );
  }

  return (
    <div className="odoo-kanban">
      {grouped.map((group) => {
        const totalStock = group.items.reduce((sum, i) => sum + parseFloat(i.current_quantity || '0'), 0);
        return (
          <div key={group.key} className="odoo-kanban-section">
            <div className="odoo-kanban-section-header">
              <span>{group.label}</span>
              <span className="odoo-kanban-section-count">{group.items.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                Stock total : {totalStock.toFixed(totalStock % 1 === 0 ? 0 : 1)}
              </span>
            </div>
            <div className="odoo-kanban-grid">
              {group.items.map((item) => {
                const qty = parseFloat(item.current_quantity);
                const threshold = parseFloat(item.minimum_threshold);
                const isLow = threshold > 0 && qty <= threshold;
                const isOut = qty <= 0;
                const lotsCount = parseInt(item.active_lots_count) || 0;
                const expiredCount = parseInt(item.expired_lots_count) || 0;
                const expiringSoonCount = parseInt(item.expiring_soon_count) || 0;
                const economatQty = parseFloat(item.economat_quantity || '0');
                const pesageQty = parseFloat(item.pesage_quantity || '0');
                const pct = threshold > 0 ? Math.min(Math.round((qty / (threshold * 3)) * 100), 100) : (qty > 0 ? 100 : 0);
                const cost = parseFloat(item.unit_cost || '0');
                const nearestDlc = item.nearest_dlc ? new Date(item.nearest_dlc) : null;
                const daysUntilDlc = nearestDlc ? Math.ceil((nearestDlc.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

                const cardStatus = expiredCount > 0 || isOut ? 'danger' : isLow || expiringSoonCount > 0 ? 'warning' : 'ok';

                return (
                  <div key={item.id}
                    className={`odoo-kanban-card ${cardStatus}`}
                    onClick={() => onSelect(item.ingredient_id)}>
                    <div className="odoo-kanban-card-title">
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.ingredient_name}
                      </span>
                      {expiredCount > 0 && <span className="odoo-tag odoo-tag-red">DLC</span>}
                      {!expiredCount && isLow && <span className="odoo-tag odoo-tag-orange">BAS</span>}
                    </div>
                    {item.supplier && (
                      <div className="odoo-kanban-card-supplier">{item.supplier}</div>
                    )}
                    <div className="odoo-kanban-card-stock">
                      <span className="odoo-kanban-card-stock-value" style={{
                        color: isOut ? '#dc3545' : isLow ? '#b85d1a' : 'var(--theme-text-strong)',
                      }}>
                        {qty.toFixed(qty % 1 === 0 ? 0 : 1)}
                      </span>
                      <span className="odoo-kanban-card-stock-unit">{item.unit}</span>
                    </div>
                    {(economatQty > 0 || pesageQty > 0) && (
                      <div className="odoo-kanban-card-split">
                        <span>écon. <strong>{economatQty.toFixed(economatQty % 1 === 0 ? 0 : 1)}</strong></span>
                        <span style={{ color: 'var(--theme-bg-separator)' }}>·</span>
                        <span>pesage <strong>{pesageQty.toFixed(pesageQty % 1 === 0 ? 0 : 1)}</strong></span>
                      </div>
                    )}
                    <div className="odoo-kanban-card-progress">
                      <div className="odoo-kanban-card-progress-bar" style={{
                        width: `${pct}%`,
                        backgroundColor: isOut ? '#dc3545' : isLow ? '#ffc107' : '#28a745',
                      }} />
                    </div>
                    <div className="odoo-kanban-card-footer">
                      <span>
                        {lotsCount > 0 && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <Boxes size={9} /> {lotsCount} lot{lotsCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </span>
                      <span>
                        {nearestDlc && daysUntilDlc !== null ? (
                          <span style={{
                            color: daysUntilDlc < 0 ? '#dc3545' : daysUntilDlc <= 7 ? '#b85d1a' : 'var(--theme-text-muted)',
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                          }}>
                            <CalendarClock size={9} />
                            {daysUntilDlc < 0 ? `${Math.abs(daysUntilDlc)}j!` : `${daysUntilDlc}j`}
                          </span>
                        ) : cost > 0 ? (
                          <span>{cost.toFixed(2)} DH/{item.unit}</span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
