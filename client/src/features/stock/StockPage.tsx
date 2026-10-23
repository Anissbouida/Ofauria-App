import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { inventoryApi, ingredientsApi } from '../../api/inventory.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { TransferRequestsList } from './TransferRequestsList';
import { TransferToPesage } from './TransferToPesage';
import { ToOrderBoard } from './ToOrderBoard';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { WarehouseQueueList, WarehouseBonWorkspace, BonsPipeline, type ProcessStep } from './WarehouseProcessQueue';
import { PesageStockList } from './PesageStockList';
import { HistoryList } from './HistoryList';
import { LotMovementModal } from './LotMovementModal';
import {
  AlertTriangle, Package, Search, TrendingUp, TrendingDown,
  Clock, X, Boxes, CalendarClock, ChevronRight, ChevronDown, ChevronLeft,
  ArrowUp, ArrowDown, ArrowUpDown, Timer, Trash2, PackageOpen, Warehouse,
  Plus, List, LayoutGrid, Save, ShoppingCart, Upload, Download, BarChart3,
  ClipboardList, Archive, Beaker, Loader2,
} from 'lucide-react';
import IngredientImportModal from './IngredientImportModal';
import ConsommationTab from './ConsommationTab';
import GoodsEntryRegisterTab from './GoodsEntryRegisterTab';
import PackagingPage from '../packaging/PackagingPage';
import { notify } from '../../components/ui/InlineNotification';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import SearchSelect from '../../components/ui/SearchSelect';
import { useStockCategories, STOCKABLE_ROOT_IDS } from './useStockCategories';
import { format } from 'date-fns';
import { fmtQty, type InventoryItem } from './types';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StagePipeline, Pager, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';

type SortKey = 'name' | 'category' | 'supplier' | 'scelle' | 'entame' | 'quantity' | 'lots' | 'dlc' | 'days_stock' | 'price' | 'value';
type SortDir = 'asc' | 'desc';
type ViewFilter = 'all' | 'low' | 'ok' | 'expiring' | 'rupture' | 'expired' | 'stale';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Nom', category: 'Catégorie', supplier: 'Fournisseur', price: 'Dernier prix',
  value: 'Valeur stock', scelle: 'En réserve', entame: 'Au pesage', quantity: 'Total', lots: 'Lots', days_stock: 'Jours stock', dlc: 'DLC',
};

const STATE_LABELS: Record<ViewFilter, string> = {
  all: 'Tous les états', low: 'Stock bas', ok: 'Stock OK', expiring: 'DLC critique',
  rupture: 'En rupture (0)', expired: 'Périmés à retirer', stale: 'Sans mouvement (30j)',
};
/**
 * Situation d'un ingrédient (exclusive, la plus urgente d'abord) : même logique que
 * les cartes « situation » des Fournisseurs. « Sans usage » = rien en stock et jamais
 * consommé : ce n'est pas une rupture à traiter.
 */
type Situation = 'expired' | 'rupture' | 'low' | 'expiring' | 'ok' | 'unused';
const SITUATIONS: Array<StageDef & { key: Situation }> = [
  { key: 'expired', label: 'DLC dépassée', hint: 'lots à retirer', icon: Trash2 },
  { key: 'rupture', label: 'Rupture', hint: 'utilisé, plus en stock', icon: AlertTriangle },
  { key: 'low', label: 'Sous le seuil', hint: 'à réapprovisionner', icon: TrendingDown },
  { key: 'expiring', label: 'DLC ≤ 7 j', hint: 'à consommer en priorité', icon: CalendarClock },
  { key: 'ok', label: 'OK', hint: 'rien à faire', icon: TrendingUp },
  { key: 'unused', label: 'Sans usage', hint: 'à 0, jamais consommé', icon: Package },
];
const SITUATION_DOT: Record<Situation, string> = {
  expired: '#dc3545', rupture: '#dc3545', low: '#d9822b', expiring: '#c99a06', ok: '#28a745', unused: '#adb5bd',
};
function situationOf(i: InventoryItem): Situation {
  const qty = parseFloat(i.current_quantity) || 0;
  const threshold = parseFloat(i.minimum_threshold) || 0;
  const used = parseFloat(i.avg_daily_consumption || '0') > 0;
  if ((parseInt(i.expired_lots_count) || 0) > 0) return 'expired';
  if (qty <= 0) return used || threshold > 0 ? 'rupture' : 'unused';
  if (threshold > 0 && qty <= threshold) return 'low';
  if ((parseInt(i.expiring_soon_count) || 0) > 0) return 'expiring';
  return 'ok';
}

/** Onglets du module Stock (fusion Économat + Pesage, 2026-10-11). */
type StockTab = 'stock' | 'bons' | 'commander' | 'consumables' | 'analyse' | 'registre';
/** Sous-vues de l'onglet Bons de sortie (?view=). */
type BonsView = 'queue' | 'transfers' | 'history';
/** Zone affichee dans l'onglet Stock (?zone=) : scelle (ex-Économat) ou entame (ex-Pesage). */
type StockZone = 'scelle' | 'entame';
type ViewMode = 'list' | 'kanban';


export default function StockPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { user } = useAuth();
  const isWarehouseUser = ['admin', 'manager', 'magasinier'].includes(user?.role || '');
  // Admin/gerant uniquement : actions de gestion en masse (import/export ingredients).
  const canManageIngredients = ['admin', 'manager'].includes(user?.role || '');

  // Onglets du module Stock, dans l'ordre du travail du magasinier :
  //   Stock (scelle / entame) -> Bons de sortie (file, contenants a ouvrir, historique)
  //   -> A commander (ruptures BSI) -> Consommables -> Analyse (admin/gerant).
  // Tout est persiste en URL (?tab=&view=&zone=&bon=) pour les deep-links
  // (notifications, liens « Ouvrir au pesage », rafraichissement).
  const validTabs: StockTab[] = ['stock', 'bons', 'commander', 'consumables', 'analyse', 'registre'];
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as StockTab | null;
  const [econoTab, setEconoTab] = useState<StockTab>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'stock'
  );
  useEffect(() => {
    if (tabFromUrl && validTabs.includes(tabFromUrl) && econoTab !== tabFromUrl) setEconoTab(tabFromUrl);
    if (!tabFromUrl && econoTab !== 'stock') setEconoTab('stock');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);
  const changeEconoTab = (next: StockTab) => {
    setEconoTab(next);
    if (next === 'stock') searchParams.delete('tab');
    else searchParams.set('tab', next);
    searchParams.delete('ingredient');
    searchParams.delete('view');
    searchParams.delete('zone');
    searchParams.delete('bon');
    setSearchParams(searchParams, { replace: true });
  };
  const bonsView: BonsView = (['queue', 'transfers', 'history'] as BonsView[]).includes(searchParams.get('view') as BonsView)
    ? (searchParams.get('view') as BonsView) : 'queue';
  const changeBonsView = (next: BonsView) => {
    if (next === 'queue') searchParams.delete('view'); else searchParams.set('view', next);
    searchParams.delete('bon');
    searchParams.delete('ingredient');
    setSearchParams(searchParams, { replace: true });
  };
  const zone: StockZone = searchParams.get('zone') === 'entame' ? 'entame' : 'scelle';
  const changeZone = (next: StockZone) => {
    if (next === 'scelle') searchParams.delete('zone'); else searchParams.set('zone', next);
    setSearchParams(searchParams, { replace: true });
  };
  // Demande ouverte en traitement (?bon=<id>) : deep-linkable, survit au rafraichissement.
  const selectedBonId = searchParams.get('bon');
  const openBon = (bonId: string | null) => {
    if (bonId) searchParams.set('bon', bonId); else searchParams.delete('bon');
    setSearchParams(searchParams);
  };
  const [step, setStep] = useState<ProcessStep>('all');
  // Transfert vers le pesage depuis une ligne du stock : ouvre les contenants a
  // ouvrir avec l'ingredient pre-rempli (?tab=bons&view=transfers&ingredient=<id>).
  const transferIngredientId = searchParams.get('ingredient');
  // « Commander » depuis une ligne du stock : ouvre À commander avec l'article ajouté.
  const orderIngredient = (ingredientId: string) => {
    setEconoTab('commander');
    searchParams.set('tab', 'commander');
    searchParams.set('add', ingredientId);
    setSearchParams(searchParams, { replace: true });
  };
  const openTransferFor = (ingredientId: string) => {
    setEconoTab('bons');
    searchParams.set('tab', 'bons');
    searchParams.set('view', 'transfers');
    searchParams.set('ingredient', ingredientId);
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
  // Badge de l'onglet « À commander » : besoins non couverts (même source que l'écran).
  const { data: toOrder } = useQuery({
    queryKey: ['to-order'],
    queryFn: purchaseRequestsApi.toOrder,
    enabled: isWarehouseUser,
    refetchInterval: 60000,
  });
  const toOrderCount = (toOrder?.rows ?? []).filter(r => !r.covered).length;
  // File des bons de sortie (ex-Pesage) : polling serre uniquement sur l'onglet.
  const { data: bons = [], isLoading: isLoadingBons } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-queue'],
    queryFn: bonSortieApi.warehouseQueue,
    enabled: isWarehouseUser,
    refetchInterval: econoTab === 'bons' ? 15000 : false,
  });
  // Compteur de la 4e carte du pipeline (« Remis au chef ») : total de l'historique, sans filtre.
  const { data: historyCount } = useQuery<{ data: Record<string, any>[]; total: number }>({
    queryKey: ['warehouse-history', 'count'],
    queryFn: () => bonSortieApi.warehouseHistory({ limit: 1, offset: 0 }),
    enabled: isWarehouseUser && econoTab === 'bons',
  });
  // Zone entamee : lots actifs avec pesage_quantity > 0, agreges par ingredient.
  const { data: pesageStock = [], isLoading: isLoadingPesage } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-pesage-stock'],
    queryFn: ingredientLotsApi.pesageStock,
    enabled: isWarehouseUser && econoTab === 'stock' && zone === 'entame',
    refetchInterval: 30000,
  });

  const [search, setSearch] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [situation, setSituation] = useState<Situation | ''>('');
  const [page, setPage] = useState(1);
  const [showExpiredLots, setShowExpiredLots] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [branchFilter, setBranchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const { resolve: resolveCategory, branches: categoryBranches, leavesUnder, isUnder, tagClass: categoryTagClass } = useStockCategories();
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

  const addIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventory'] }); setShowAddIngredient(false); notify.success('Ingrédient ajouté'); },
  });

  // Fournisseurs distincts presents dans l'inventaire (pour le filtre dedie).
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    (inventory as InventoryItem[]).forEach(i => { if (i.supplier) set.add(i.supplier); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [inventory]);

  const stockValue = (i: InventoryItem) => parseFloat(i.current_quantity || '0') * parseFloat(i.unit_cost || '0');

  const filteredInventory = useMemo(() => {
    let items = inventory as InventoryItem[];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.ingredient_name.toLowerCase().includes(q) || (i.supplier || '').toLowerCase().includes(q) || (i.active_lot_numbers || '').toLowerCase().includes(q));
    }
    // Filtre categorie a 2 niveaux : branche (sous-arbre) puis type precis.
    if (branchFilter) items = items.filter(i => isUnder(i.category_id, branchFilter));
    if (typeFilter) items = items.filter(i => String(i.category_id || '') === typeFilter);
    if (supplierFilter) items = items.filter(i => (i.supplier || '') === supplierFilter);
    if (viewFilter === 'low') items = items.filter(i => parseFloat(i.current_quantity) <= parseFloat(i.minimum_threshold));
    else if (viewFilter === 'ok') items = items.filter(i => parseFloat(i.current_quantity) > parseFloat(i.minimum_threshold));
    else if (viewFilter === 'expiring') items = items.filter(i => (parseInt(i.expired_lots_count) || 0) > 0 || (parseInt(i.expiring_soon_count) || 0) > 0);
    else if (viewFilter === 'rupture') items = items.filter(i => parseFloat(i.current_quantity) <= 0);
    else if (viewFilter === 'expired') items = items.filter(i => (parseInt(i.expired_lots_count) || 0) > 0);
    else if (viewFilter === 'stale') items = items.filter(i => parseFloat(i.avg_daily_consumption || '0') <= 0);
    if (situation) items = items.filter(i => situationOf(i) === situation);

    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.ingredient_name.localeCompare(b.ingredient_name); break;
        case 'category': cmp = (resolveCategory(a.category_id)?.path || '~').localeCompare(resolveCategory(b.category_id)?.path || '~'); break;
        case 'supplier': cmp = (a.supplier || '').localeCompare(b.supplier || ''); break;
        case 'quantity': cmp = parseFloat(a.current_quantity) - parseFloat(b.current_quantity); break;
        case 'scelle': cmp = parseFloat(a.economat_quantity || '0') - parseFloat(b.economat_quantity || '0'); break;
        case 'entame': cmp = parseFloat(a.pesage_quantity || '0') - parseFloat(b.pesage_quantity || '0'); break;
        case 'price': cmp = parseFloat(a.unit_cost || '0') - parseFloat(b.unit_cost || '0'); break;
        case 'value': cmp = stockValue(a) - stockValue(b); break;
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
      // Tri secondaire stable : a egalite, ordre alphabetique du nom.
      if (cmp === 0 && sortKey !== 'name') cmp = a.ingredient_name.localeCompare(b.ingredient_name);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [inventory, search, branchFilter, typeFilter, supplierFilter, viewFilter, situation, sortKey, sortDir, isUnder, resolveCategory]);

  useEffect(() => { setPage(1); }, [search, branchFilter, typeFilter, supplierFilter, viewFilter, situation, sortKey, sortDir]);
  const pagedInventory = filteredInventory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const situationCounts = useMemo(() => {
    const c: Record<Situation, number> = { expired: 0, rupture: 0, low: 0, expiring: 0, ok: 0, unused: 0 };
    for (const i of inventory as InventoryItem[]) c[situationOf(i)]++;
    return c;
  }, [inventory]);

  /** Prochaine action selon la situation de l'ingrédient. */
  const nextAction = (item: InventoryItem): { label: string; run: () => void; cls: string; title?: string } | null => {
    const sit = situationOf(item);
    const sealed = parseFloat(item.economat_quantity || '0') > 0;
    if (sit === 'expired') return { label: 'Retirer le lot', run: () => navigate(`/stock/${item.ingredient_id}`), cls: 'odoo-btn-danger', title: 'Ouvrir la fiche pour envoyer le lot périmé aux pertes' };
    if (sit === 'rupture' || sit === 'low') return { label: 'Commander', run: () => orderIngredient(item.ingredient_id), cls: 'odoo-btn-primary', title: 'Ajouter à « À commander »' };
    if (sit === 'expiring' && isWarehouseUser && sealed) return { label: 'Ouvrir en priorité', run: () => openTransferFor(item.ingredient_id), cls: 'odoo-btn-secondary', title: 'Passer ce lot au poste de pesée pour le consommer avant sa DLC' };
    if (isWarehouseUser && sealed && sit !== 'unused') return { label: 'Ouvrir', run: () => openTransferFor(item.ingredient_id), cls: 'odoo-btn-secondary', title: 'Ouvrir un contenant : passer une partie de la réserve au poste de pesée' };
    return null;
  };

  const hasActiveFilters = Boolean(search || branchFilter || typeFilter || supplierFilter || viewFilter !== 'all' || situation);
  const resetFilters = () => { setSearch(''); setBranchFilter(''); setTypeFilter(''); setSupplierFilter(''); setViewFilter('all'); setSituation(''); };

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
          <span>Stock</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">
            {econoTab === 'bons' ? 'Bons de sortie'
              : econoTab === 'commander' ? 'À commander'
              : econoTab === 'consumables' ? 'Consommables'
              : econoTab === 'analyse' ? 'Analyse'
              : econoTab === 'registre' ? 'Registre des entrées'
              : zone === 'entame' ? 'Poste de pesée' : 'Réserve'}
          </span>
        </div>
        {econoTab === 'stock' && zone === 'scelle' && canManageIngredients && (
          <button onClick={() => setShowAddIngredient(true)} className="odoo-btn-primary">
            <Plus size={14} /> Nouveau
          </button>
        )}
        {econoTab === 'stock' && zone === 'scelle' && canManageIngredients && (
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
        {econoTab === 'stock' && zone === 'scelle' && (
          <div className="odoo-view-switcher">
            <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'active' : ''} title="Vue liste">
              <List size={14} />
            </button>
            <button onClick={() => setViewMode('kanban')} className={viewMode === 'kanban' ? 'active' : ''} title="Vue kanban (groupée par catégorie)">
              <LayoutGrid size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Onglets du module Stock */}
      {isWarehouseUser && (
        <div className="odoo-tabs">
          <button type="button" onClick={() => changeEconoTab('stock')}
            className={`odoo-tab ${econoTab === 'stock' ? 'active' : ''}`}>
            <Warehouse size={13} />
            <span>Stock</span>
          </button>
          <button type="button" onClick={() => changeEconoTab('bons')}
            className={`odoo-tab ${econoTab === 'bons' ? 'active' : ''}`}>
            <ClipboardList size={13} />
            <span>Bons de sortie</span>
            {bons.length > 0 && (
              <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: '0.25rem' }}>{bons.length}</span>
            )}
            {transferRequests.length > 0 && (
              <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: '0.25rem' }} title="Contenants à ouvrir">
                {transferRequests.length}
              </span>
            )}
          </button>
          <button type="button" onClick={() => changeEconoTab('commander')}
            className={`odoo-tab ${econoTab === 'commander' ? 'active' : ''}`}>
            <ShoppingCart size={13} />
            <span>À commander</span>
            {toOrderCount > 0 && (
              <span className="odoo-tag odoo-tag-red" style={{ marginLeft: '0.25rem' }}>{toOrderCount}</span>
            )}
          </button>
          <button type="button" onClick={() => changeEconoTab('consumables')}
            className={`odoo-tab ${econoTab === 'consumables' ? 'active' : ''}`}>
            <Boxes size={13} />
            <span>Consommables</span>
          </button>
          {/* Mig 312 (D9) : registre des entrées (traçabilité ONSSA), magasinier compris. */}
          {isWarehouseUser && (
            <button type="button" onClick={() => changeEconoTab('registre')}
              className={`odoo-tab ${econoTab === 'registre' ? 'active' : ''}`}>
              <ClipboardList size={13} />
              <span>Registre des entrées</span>
            </button>
          )}
          {/* Analyse : les endpoints consommation/achats sont reserves admin/gerant cote serveur. */}
          {canManageIngredients && (
            <button type="button" onClick={() => changeEconoTab('analyse')}
              className={`odoo-tab ${econoTab === 'analyse' ? 'active' : ''}`}>
              <BarChart3 size={13} />
              <span>Analyse</span>
            </button>
          )}
        </div>
      )}

      {/* Sous-navigation : zones de l'onglet Stock, vues de l'onglet Bons de sortie */}
      {isWarehouseUser && econoTab === 'stock' && (
        <div className="odoo-tabs stock-subtabs">
          <button type="button" onClick={() => changeZone('scelle')} className={`odoo-tab ${zone === 'scelle' ? 'active' : ''}`}>
            <Package size={12} /><span>Réserve · contenants fermés</span>
          </button>
          <button type="button" onClick={() => changeZone('entame')} className={`odoo-tab ${zone === 'entame' ? 'active' : ''}`}>
            <Beaker size={12} /><span>Poste de pesée · contenants ouverts</span>
            {pesageStock.length > 0 && <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: '0.25rem' }}>{pesageStock.length}</span>}
          </button>
        </div>
      )}
      {isWarehouseUser && econoTab === 'bons' && !selectedBonId && (
        <div className="odoo-tabs stock-subtabs">
          <button type="button" onClick={() => changeBonsView('queue')} className={`odoo-tab ${bonsView === 'queue' ? 'active' : ''}`}>
            <ClipboardList size={12} /><span>File active</span>
          </button>
          <button type="button" onClick={() => changeBonsView('transfers')} className={`odoo-tab ${bonsView === 'transfers' ? 'active' : ''}`}>
            <PackageOpen size={12} /><span>Contenants à ouvrir</span>
            {transferRequests.length > 0 && <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: '0.25rem' }}>{transferRequests.length}</span>}
          </button>
          <button type="button" onClick={() => changeBonsView('history')} className={`odoo-tab ${bonsView === 'history' ? 'active' : ''}`}>
            <Archive size={12} /><span>Historique</span>
          </button>
        </div>
      )}

      {econoTab === 'consumables' ? (
        <div style={{ padding: '1rem' }}>
          <PackagingPage embedded />
        </div>
      ) : econoTab === 'bons' ? (
        selectedBonId ? (
          <WarehouseBonWorkspace
            bonId={selectedBonId}
            queue={bons}
            onBack={() => openBon(null)}
            onOpen={openBon}
          />
        ) : bonsView === 'transfers' ? (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Transfert libre (hors bon) : le magasinier met au pesage ce qu'il veut, quand il
                veut. En dessous, les contenants que les bons de sortie en cours attendent. */}
            <TransferToPesage initialIngredientId={transferIngredientId} />
            <div>
              <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>
                <PackageOpen size={12} /> Demandés par les bons de sortie en cours
              </div>
              <TransferRequestsList />
            </div>
          </div>
        ) : bonsView === 'history' ? (
          <div style={{ padding: '1rem 0' }}>
            <BonsPipeline bons={bons} step={step} onStep={(s) => { setStep(s); changeBonsView('queue'); }}
              historyTotal={historyCount?.total} historyActive onHistory={() => changeBonsView('history')} />
            <div style={{ padding: '0 1rem' }}>
              <HistoryList onOpen={(planId) => navigate(`/stock/bsi/${planId}`)} />
            </div>
          </div>
        ) : isLoadingBons ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
          </div>
        ) : (
          <WarehouseQueueList
            bons={bons}
            step={step}
            onStep={setStep}
            onOpen={openBon}
            onHistory={() => changeBonsView('history')}
            historyTotal={historyCount?.total}
          />
        )
      ) : econoTab === 'commander' ? (
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Écran unique des besoins d'achat (ruptures, demandes, stock bas) : le gérant y
              crée directement les BC, le magasinier y fait ses demandes. Remplace la Liste d'attente. */}
          <ToOrderBoard />
        </div>
      ) : econoTab === 'registre' ? (
        <GoodsEntryRegisterTab />
      ) : econoTab === 'analyse' ? (
        <div style={{ padding: '1rem' }}>
          <ConsommationTab />
        </div>
      ) : zone === 'entame' ? (
        <div style={{ padding: '1rem 0' }}>
          <PesageStockList rows={pesageStock} isLoading={isLoadingPesage}
            inventory={inventory as InventoryItem[]} canOpen={isWarehouseUser} />
        </div>
      ) : (
      <>
      {/* ══════ SITUATION : une carte par situation, clic = filtre ══════ */}
      <div style={{ padding: '1rem 1rem 0' }}>
        <StagePipeline
          title="Où en est mon stock"
          summary={`${totalItems} ingrédient${totalItems > 1 ? 's' : ''} · ${situationCounts.expired + situationCounts.rupture + situationCounts.low + situationCounts.expiring} à traiter`}
          stages={SITUATIONS}
          stats={Object.fromEntries(SITUATIONS.map(x => [x.key, { count: situationCounts[x.key], sub: '' }]))}
          isActive={k => situation === k}
          onPick={k => setSituation(situation === k ? '' : (k as Situation))}
        />
      </div>

      {/* ══════ LOTS EXPIRES A TRAITER (DLC depassee) ══════ */}
      {(expiredActiveLots as Record<string, any>[]).length > 0 && (() => {
        const lots = expiredActiveLots as Record<string, any>[];
        return (
          <div style={{ padding: '0.75rem 1rem 0' }}>
          <StatusBanner tone="danger" icon={AlertTriangle}
            title={`${lots.length} lot${lots.length > 1 ? 's' : ''} expiré${lots.length > 1 ? 's' : ''} à retirer du stock`}
            actions={<button type="button" className="odoo-btn-secondary" onClick={() => setShowExpiredLots(v => !v)}>{showExpiredLots ? 'Masquer' : 'Voir les lots'}</button>}>
              La date imprimée sur le paquet est dépassée : envoyez ces lots aux pertes.
              {showExpiredLots && (
              <div style={{ marginTop: '0.5rem', maxHeight: '18rem', overflowY: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4, backgroundColor: 'var(--odoo-bg)' }}>
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
                          En réserve {parseFloat(lot.economat_quantity as string).toFixed(1)}{lot.ingredient_unit as string} ·
                          Au pesage {parseFloat(lot.pesage_quantity as string).toFixed(1)}{lot.ingredient_unit as string}
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
              )}
          </StatusBanner>
          </div>
        );
      })()}

      {/* Dialog d'envoi aux pertes */}
      {lossDialogLot && (
        <LotMovementModal
          lot={{
            id: lossDialogLot.id as string,
            lot_number: (lossDialogLot.supplier_lot_number || lossDialogLot.lot_number) as string | null,
            ingredient_name: lossDialogLot.ingredient_name as string,
            unit: lossDialogLot.ingredient_unit as string,
            economat_quantity: parseFloat(lossDialogLot.economat_quantity as string) || 0,
            pesage_quantity: parseFloat(lossDialogLot.pesage_quantity as string) || 0,
            unit_cost: parseFloat(lossDialogLot.unit_cost as string) || null,
            is_expired: true,
          }}
          initialType="losses"
          lockType
          onClose={() => setLossDialogLot(null)}
        />
      )}

      {/* ══════ SEARCH PANEL Odoo ══════ */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap' }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Rechercher par nom, fournisseur, N° lot..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="odoo-search-input"
        />

        {/* Chips de filtres actifs */}
        {search && (
          <span className="odoo-filter-chip">Recherche: {search}
            <span className="odoo-filter-chip-remove" onClick={() => setSearch('')}>×</span>
          </span>
        )}
        {branchFilter && (
          <span className="odoo-filter-chip">{resolveCategory(branchFilter)?.typeName || 'Catégorie'}
            <span className="odoo-filter-chip-remove" onClick={() => { setBranchFilter(''); setTypeFilter(''); }}>×</span>
          </span>
        )}
        {typeFilter && (
          <span className="odoo-filter-chip">{resolveCategory(typeFilter)?.typeName || 'Type'}
            <span className="odoo-filter-chip-remove" onClick={() => setTypeFilter('')}>×</span>
          </span>
        )}
        {supplierFilter && (
          <span className="odoo-filter-chip">{supplierFilter}
            <span className="odoo-filter-chip-remove" onClick={() => setSupplierFilter('')}>×</span>
          </span>
        )}
        {viewFilter !== 'all' && (
          <span className="odoo-filter-chip">{STATE_LABELS[viewFilter]}
            <span className="odoo-filter-chip-remove" onClick={() => setViewFilter('all')}>×</span>
          </span>
        )}

        {/* Catégorie (branche) → Type (feuille) */}
        <SearchSelect
          options={categoryBranches.map(b => ({ id: b.id, label: `${'  '.repeat(b.depth)}${b.name}` }))}
          value={branchFilter}
          onChange={id => { setBranchFilter(id); setTypeFilter(''); }}
          placeholder="Catégorie"
        />
        <SearchSelect
          options={leavesUnder(branchFilter).map(l => ({ id: String(l.id), label: l.name }))}
          value={typeFilter}
          onChange={setTypeFilter}
          placeholder="Type"
        />

        {/* Fournisseur */}
        <SearchSelect
          options={supplierOptions.map(s => ({ id: s, label: s }))}
          value={supplierFilter}
          onChange={setSupplierFilter}
          placeholder="Fournisseur"
        />

        {/* État de stock */}
        <SearchSelect
          options={(Object.keys(STATE_LABELS) as ViewFilter[]).filter(k => k !== 'all').map(k => ({ id: k, label: STATE_LABELS[k] }))}
          value={viewFilter === 'all' ? '' : viewFilter}
          onChange={id => setViewFilter((id || 'all') as ViewFilter)}
          placeholder="État"
        />

        <span style={{ flex: 1 }} />

        {/* Tri */}
        <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
          className="odoo-filter-dropdown" style={{ border: 'none', backgroundColor: 'transparent', outline: 'none' }}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
            <option key={k} value={k}>{`Trier : ${SORT_LABELS[k]}`}</option>
          ))}
        </select>
        <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="odoo-pager-btn" title={sortDir === 'asc' ? 'Croissant' : 'Décroissant'}>
          {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </button>

        {hasActiveFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={13} /> Réinitialiser
          </button>
        )}
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
              <SortHeader col="price" className="hidden md:table-cell" align="right">Dernier prix</SortHeader>
              <SortHeader col="scelle" className="hidden sm:table-cell" align="right">En réserve</SortHeader>
              <SortHeader col="entame" className="hidden sm:table-cell" align="right">Au pesage</SortHeader>
              <SortHeader col="quantity" align="right">Total</SortHeader>
              <SortHeader col="lots" className="hidden lg:table-cell" align="right">Lots</SortHeader>
              <SortHeader col="days_stock" className="hidden lg:table-cell" align="right">Jours stock</SortHeader>
              <SortHeader col="dlc" className="hidden lg:table-cell">DLC</SortHeader>
              <th style={{ textAlign: 'right' }}>Prochaine action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={12} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Chargement...</td></tr>
            ) : filteredInventory.length === 0 ? (
              <tr><td colSpan={12} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucun ingrédient trouvé</td></tr>
            ) : pagedInventory.map((item) => {
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
                <tr key={item.id} onClick={() => navigate(`/stock/${item.ingredient_id}`)} className={rowClass}>
                  <td><span className={`odoo-status-dot ${statusDot}`} /></td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{item.ingredient_name}</span>
                    {(() => {
                      const sit = situationOf(item);
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>
                          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: SITUATION_DOT[sit] }} />
                          {SITUATIONS.find(x => x.key === sit)?.label}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className={`odoo-tag ${categoryTagClass(item.category_id)}`}>
                      {resolveCategory(item.category_id)?.typeName || 'Non classé'}
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
                  {(() => {
                    const economatQty = parseFloat(item.economat_quantity || '0');
                    const pesageQty = parseFloat(item.pesage_quantity || '0');
                    const muted = { color: 'var(--theme-text-muted)' };
                    return (
                      <>
                        <td className="hidden sm:table-cell" style={{ textAlign: 'right' }}>
                          {economatQty > 0 ? <span style={{ fontWeight: 500 }}>{fmtQty(economatQty)}</span> : <span style={muted}>—</span>}
                        </td>
                        <td className="hidden sm:table-cell" style={{ textAlign: 'right' }}>
                          {pesageQty > 0 ? (
                            <span style={{ fontWeight: 500, color: '#6f42c1' }} title={item.pesage_lots_count ? `${item.pesage_lots_count} contenant(s) ouvert(s)` : undefined}>
                              {fmtQty(pesageQty)}
                            </span>
                          ) : <span style={muted}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 600, color: isOut ? '#dc3545' : isLow ? '#b85d1a' : 'var(--theme-text-strong)' }}>
                            {fmtQty(qty)} <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.6875rem' }}>{item.unit}</span>
                          </span>
                        </td>
                      </>
                    );
                  })()}
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
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const a = nextAction(item);
                      return a ? (
                        <button type="button" className={a.cls} onClick={a.run} title={a.title}>
                          {a.label === 'Ouvrir' || a.label === 'Ouvrir en priorité' ? <PackageOpen size={12} /> : null} {a.label}
                        </button>
                      ) : null;
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager page={page} total={filteredInventory.length} onPage={setPage}
          note={`${filteredInventory.length} ingrédient${filteredInventory.length > 1 ? 's' : ''}${hasActiveFilters ? ' (filtré)' : ''} sur ${totalItems}`} />
      </div>
      )}

      {/* ══════ KANBAN view — groupée par catégorie ══════ */}
      {viewMode === 'kanban' && (
        <KanbanView
          items={filteredInventory}
          onSelect={(id) => navigate(`/stock/${id}`)}
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
  const [form, setForm] = useState({ name: '', unit: 'kg', unitCost: '', supplier: '', categoryId: '' });
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
        <form onSubmit={(e) => { e.preventDefault(); onSave({ name: form.name, unit: form.unit, unitCost: parseFloat(form.unitCost) || 0, supplier: form.supplier || undefined, categoryId: form.categoryId || null }); }}
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
            <CategoryCascadeSelector value={form.categoryId} onChange={id => setForm({ ...form, categoryId: id })} rootIds={STOCKABLE_ROOT_IDS} />
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

/* ─── Kanban View (Odoo) ─────────────────────────────────────────────
   Affiche les ingredients groupes par categorie, chaque section
   contient une grille de cartes cliquables avec stock + indicateurs.
   ───────────────────────────────────────────────────────────────── */
function KanbanView({ items, onSelect }: {
  items: InventoryItem[];
  onSelect: (ingredientId: string) => void;
}) {
  const { groups: categoryGroups, resolve: resolveCategory } = useStockCategories();
  const grouped = useMemo(() => {
    const byCat: Record<string, InventoryItem[]> = {};
    items.forEach((item) => {
      const key = String(item.category_id || 'none');
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(item);
    });
    // Ordre = feuilles des branches stockables, puis le reste (non classé / legacy)
    const orderedLeaves = categoryGroups.flatMap(g => g.leaves);
    const known = new Set(orderedLeaves.map(l => String(l.id)));
    const result = orderedLeaves
      .map((leaf) => ({ key: String(leaf.id), label: leaf.name, items: byCat[String(leaf.id)] || [] }))
      .filter((g) => g.items.length > 0);
    Object.keys(byCat)
      .filter(k => !known.has(k))
      .forEach(k => result.push({
        key: k,
        label: k === 'none' ? 'Non classé' : (resolveCategory(k)?.typeName || 'Non classé'),
        items: byCat[k],
      }));
    return result;
  }, [items, categoryGroups, resolveCategory]);

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
                        <span>réserve <strong>{fmtQty(economatQty)}</strong></span>
                        <span style={{ color: 'var(--theme-bg-separator)' }}>·</span>
                        <span>pesée <strong>{fmtQty(pesageQty)}</strong></span>
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
