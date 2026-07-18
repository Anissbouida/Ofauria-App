import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { salesChannelsApi, type SalesChannel } from '../../api/sales-channels.api';
import { contenantsApi } from '../../api/contenants.api';
import { serverUrl } from '../../api/client';
import { categoriesApi } from '../../api/categories.api';
import { usersApi } from '../../api/users.api';
import { recipesApi } from '../../api/recipes.api';
import { Plus, Pencil, Trash2, Search, Upload, X, Camera, ChefHat, Package, AlertTriangle, Factory, Clock, Eye, EyeOff, ShoppingBag, TrendingUp, LayoutGrid, List, Filter, BookOpen, GitBranch, Layers, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { ROLE_LABELS } from '@ofauria/shared';
import type { Role } from '@ofauria/shared';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import ProductPipelineTab from '../pipeline/ProductPipelinePage';
import ProductionProfileTab from './ProductionProfileTab';
import SemiFinisTab from './SemiFinisTab';
import ExpiredProductLotsBanner from './ExpiredProductLotsBanner';
import type { ProfileFormData } from './ProductionProfileTab';
import { mapLoyverseCsv } from './loyverse-csv';

type ViewMode = 'grid' | 'table';

export default function ProductsPage() {
  const [activeTab, setActiveTab] = useState<'catalogue' | 'pipeline' | 'semi-finis'>('pipeline');

  const tabLabel = activeTab === 'pipeline' ? 'Pipeline'
    : activeTab === 'catalogue' ? 'Catalogue' : 'Produits de base';

  return (
    <div className="odoo-scope">
      {/* ══════ CONTROL BAR ══════ */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ShoppingBag size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Produits</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{tabLabel}</span>
        </div>
      </div>

      {/* ══════ TABS Odoo ══════ */}
      <div className="odoo-tabs">
        <button onClick={() => setActiveTab('pipeline')}
          className={`odoo-tab ${activeTab === 'pipeline' ? 'active' : ''}`}>
          <GitBranch size={13} /> Pipeline
        </button>
        <button onClick={() => setActiveTab('semi-finis')}
          className={`odoo-tab ${activeTab === 'semi-finis' ? 'active' : ''}`}>
          <Layers size={13} /> Produits de base
        </button>
        <button onClick={() => setActiveTab('catalogue')}
          className={`odoo-tab ${activeTab === 'catalogue' ? 'active' : ''}`}>
          <ShoppingBag size={13} /> Catalogue
        </button>
      </div>

      {activeTab === 'catalogue' ? (
        <>
          {/* Bandeau alerte lots produits expires (DLC ou DLV) — lie au catalogue */}
          <ExpiredProductLotsBanner />
          <CatalogueTab />
        </>
      ) : activeTab === 'semi-finis' ? (
        <SemiFinisTab />
      ) : (
        <div style={{ padding: '1rem' }}><ProductPipelineTab /></div>
      )}
    </div>
  );
}

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th onClick={() => onSort(sk)} style={{ textAlign: align }}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </th>
  );
}

function CatalogueTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Record<string, any> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [stockFilter, setStockFilter] = useState<'all' | 'available' | 'low' | 'out'>('all');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const csvInputRef = useRef<HTMLInputElement>(null);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'price' || key === 'stock_quantity' ? 'desc' : 'asc'); }
  };

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', { search, categoryId: categoryFilter }],
    queryFn: () => productsApi.list({ search, categoryId: categoryFilter, limit: '500' }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const deleteMutation = useMutation({
    mutationFn: productsApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); notify.success('Produit supprimé définitivement'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de la suppression');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: productsApi.bulkDelete,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedIds(new Set());
      if (result.failed.length === 0) {
        notify.success(`${result.deleted} produit${result.deleted > 1 ? 's' : ''} supprimé${result.deleted > 1 ? 's' : ''}`);
      } else {
        notify.error(`${result.deleted} supprimé${result.deleted > 1 ? 's' : ''}, ${result.failed.length} échec${result.failed.length > 1 ? 's' : ''} (produits utilisés dans des ventes/commandes/plans)`);
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de la suppression en masse');
    },
  });

  const importMutation = useMutation({
    mutationFn: productsApi.importProducts,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      let msg = `Import terminé : ${result.created} créé${result.created > 1 ? 's' : ''}`;
      if (result.skipped > 0) msg += `, ${result.skipped} ignoré${result.skipped > 1 ? 's' : ''} (déjà existants)`;
      if (result.errors.length > 0) {
        msg += `, ${result.errors.length} erreur${result.errors.length > 1 ? 's' : ''}`;
        console.warn('Erreurs import produits :', result.errors);
      }
      (result.errors.length > 0 ? notify.error : notify.success)(msg);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de l\'import');
    },
  });

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-selectionner le meme fichier
    if (!file) return;
    try {
      const text = await file.text();
      const { items, ignored } = mapLoyverseCsv(text);
      if (items.length === 0) {
        notify.error('Aucun produit importable dans ce fichier');
        return;
      }
      if (ignored.length > 0) {
        console.warn('Lignes CSV ignorées :', ignored);
        notify.error(`${ignored.length} ligne${ignored.length > 1 ? 's' : ''} ignorée${ignored.length > 1 ? 's' : ''} (prix « variable », doublons...) — détail en console`);
      }
      if (!confirm(`Importer ${items.length} produit${items.length > 1 ? 's' : ''} depuis « ${file.name} » ?\nLes produits déjà existants (même nom) seront ignorés.`)) return;
      importMutation.mutate(items);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Fichier CSV illisible');
    }
  };

  const toggleMutation = useMutation({
    mutationFn: productsApi.toggleAvailability,
    onSuccess: (product: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      notify.success(product.is_available ? 'Produit activé' : 'Produit désactivé');
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ data, imageFile, pendingProfile }: { data: Record<string, any>; imageFile?: File | null; pendingProfile?: ProfileFormData | null }) => {
      const result = editingProduct
        ? await productsApi.update(editingProduct.id as string, data)
        : await productsApi.create(data);
      const productId = editingProduct ? (editingProduct.id as string) : (result as Record<string, any>).id as string;
      if (imageFile && productId) {
        await productsApi.uploadImage(productId, imageFile);
      }
      // Save pending production profile after product creation/update
      if (pendingProfile && productId) {
        await contenantsApi.upsertProfile(productId, pendingProfile as unknown as Record<string, any>);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Le lien produit<->recette vit dans la table recipes (colonne product_id),
      // donc il faut aussi invalider le cache des recettes pour que ProductFormModal
      // voie la nouvelle association a la reouverture (sinon le champ parait vide).
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      notify.success(editingProduct ? 'Produit mis à jour' : 'Produit créé');
      setShowForm(false); setEditingProduct(null);
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string; details?: Record<string, string[]> } } }; message?: string };
      const details = e?.response?.data?.error?.details;
      let msg = e?.response?.data?.error?.message || e?.message || 'Erreur lors de l\'enregistrement';
      if (details) {
        const first = Object.entries(details)[0];
        if (first) msg = `${first[0]}: ${first[1].join(', ')}`;
      }
      notify.error(msg);
    },
  });

  const products = productsData?.data || [];

  // Stats
  const totalProducts = products.length;
  const availableCount = products.filter((p: Record<string, any>) => p.is_available).length;
  const lowStockCount = products.filter((p: Record<string, any>) => {
    const stock = parseFloat((p.stock_quantity as string) || '0');
    const threshold = parseFloat((p.stock_min_threshold as string) || '0');
    return threshold > 0 && stock <= threshold && stock > 0;
  }).length;
  const outOfStockCount = products.filter((p: Record<string, any>) => parseFloat((p.stock_quantity as string) || '0') <= 0).length;

  // Apply stock filter
  const filteredProducts = products.filter((p: Record<string, any>) => {
    if (stockFilter === 'all') return true;
    const stock = parseFloat((p.stock_quantity as string) || '0');
    const threshold = parseFloat((p.stock_min_threshold as string) || '0');
    if (stockFilter === 'out') return stock <= 0;
    if (stockFilter === 'low') return threshold > 0 && stock <= threshold && stock > 0;
    if (stockFilter === 'available') return p.is_available as boolean;
    return true;
  });

  // Sort products
  const sortedProducts = useMemo(() => {
    const arr = [...filteredProducts];
    arr.sort((a: Record<string, any>, b: Record<string, any>) => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case 'name': va = ((a.name as string) || '').toLowerCase(); vb = ((b.name as string) || '').toLowerCase(); break;
        case 'category_name': va = ((a.category_name as string) || '').toLowerCase(); vb = ((b.category_name as string) || '').toLowerCase(); break;
        case 'responsible': va = `${a.responsible_first_name || ''} ${a.responsible_last_name || ''}`.trim().toLowerCase(); vb = `${b.responsible_first_name || ''} ${b.responsible_last_name || ''}`.trim().toLowerCase(); break;
        case 'price': va = parseFloat(a.price as string) || 0; vb = parseFloat(b.price as string) || 0; break;
        case 'stock_quantity': va = parseFloat(a.stock_quantity as string) || 0; vb = parseFloat(b.stock_quantity as string) || 0; break;
        case 'is_available': va = a.is_available ? 1 : 0; vb = b.is_available ? 1 : 0; break;
        default: va = ((a.name as string) || '').toLowerCase(); vb = ((b.name as string) || '').toLowerCase(); break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredProducts, sortKey, sortDir]);

  // ─── Selection multiple (vue liste) ───
  const visibleIds = sortedProducts.map((p: Record<string, any>) => p.id as string);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const handleBulkDelete = () => {
    const n = selectedIds.size;
    if (n === 0) return;
    if (!confirm(`Supprimer définitivement ${n} produit${n > 1 ? 's' : ''} ?\nCette action est irréversible. Les produits utilisés dans des ventes/commandes/plans ne seront pas supprimés.`)) return;
    bulkDeleteMutation.mutate([...selectedIds]);
  };

  return (
    <>
      {/* ══════ Action sub-bar (Nouveau produit + import + pager + view switcher) ══════ */}
      <div className="odoo-control-bar" style={{ borderTop: '1px solid var(--theme-bg-separator)' }}>
        <button onClick={() => { setEditingProduct(null); setShowForm(true); }} className="odoo-btn-primary">
          <Plus size={14} /> Nouveau
        </button>
        <button onClick={() => csvInputRef.current?.click()} className="odoo-btn-secondary"
          disabled={importMutation.isPending} title="Importer des produits depuis un export CSV Loyverse">
          <Upload size={14} /> {importMutation.isPending ? 'Import...' : 'Importer CSV'}
        </button>
        <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{ display: 'none' }} />
        {selectedIds.size > 0 && (
          <>
            <span className="odoo-pager" style={{ marginLeft: 8 }}>
              <strong>{selectedIds.size}</strong> sélectionné{selectedIds.size > 1 ? 's' : ''}
            </span>
            <button onClick={handleBulkDelete} className="odoo-btn-danger" disabled={bulkDeleteMutation.isPending}>
              <Trash2 size={14} /> {bulkDeleteMutation.isPending ? 'Suppression...' : 'Supprimer'}
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="odoo-btn-secondary" title="Annuler la sélection">
              <X size={14} />
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span className="odoo-pager">
          <strong>{filteredProducts.length}</strong> / {totalProducts}
        </span>
        <div className="odoo-view-switcher">
          <button onClick={() => setViewMode('table')} className={viewMode === 'table' ? 'active' : ''} title="Vue liste">
            <List size={14} />
          </button>
          <button onClick={() => setViewMode('grid')} className={viewMode === 'grid' ? 'active' : ''} title="Vue kanban">
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>

      {/* ══════ STAT TILES (sober) ══════ */}
      <div className="odoo-stat-grid">
        <button onClick={() => setStockFilter('all')}
          className={`odoo-stat-card ${stockFilter === 'all' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <ShoppingBag size={11} style={{ display: 'inline', marginRight: 4 }} />Total produits
          </div>
          <div className="odoo-stat-card-value">{totalProducts}</div>
        </button>
        <button onClick={() => setStockFilter(stockFilter === 'available' ? 'all' : 'available')}
          className={`odoo-stat-card ${stockFilter === 'available' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <Eye size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Disponibles
          </div>
          <div className="odoo-stat-card-value">{availableCount}</div>
        </button>
        <button onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
          className={`odoo-stat-card ${stockFilter === 'low' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <TrendingUp size={11} style={{ display: 'inline', marginRight: 4, color: '#b85d1a' }} />Stock bas
          </div>
          <div className="odoo-stat-card-value" style={{ color: lowStockCount > 0 ? '#b85d1a' : undefined }}>{lowStockCount}</div>
        </button>
        <button onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}
          className={`odoo-stat-card ${stockFilter === 'out' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4, color: '#dc3545' }} />Rupture
          </div>
          <div className="odoo-stat-card-value" style={{ color: outOfStockCount > 0 ? '#dc3545' : undefined }}>{outOfStockCount}</div>
        </button>
      </div>

      {/* ══════ SEARCH PANEL ══════ */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher un produit..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="odoo-search-input" />
        {search && (
          <span className="odoo-filter-chip">
            Recherche: {search}
            <span className="odoo-filter-chip-remove" onClick={() => setSearch('')}>×</span>
          </span>
        )}
        {categoryFilter && (
          <span className="odoo-filter-chip">
            {(categories as Array<{ id: number; name: string }>).find(c => String(c.id) === categoryFilter)?.name || 'Catégorie'}
            <span className="odoo-filter-chip-remove" onClick={() => setCategoryFilter('')}>×</span>
          </span>
        )}
        {stockFilter !== 'all' && (
          <span className="odoo-filter-chip">
            {stockFilter === 'available' ? 'Disponibles' : stockFilter === 'low' ? 'Stock bas' : 'Rupture'}
            <span className="odoo-filter-chip-remove" onClick={() => setStockFilter('all')}>×</span>
          </span>
        )}
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="odoo-filter-dropdown"
          style={{ border: 'none', backgroundColor: 'transparent', outline: 'none' }}>
          <option value="">▾ Catégorie</option>
          {categories.map((c: { id: number; name: string }) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem' }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--theme-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : viewMode === 'grid' ? (
        /* ═══ Grid View (kanban Odoo) ═══ */
        <div className="odoo-kanban">
        <div className="odoo-kanban-grid">
          {filteredProducts.map((p: Record<string, any>) => {
            const stock = parseFloat((p.stock_quantity as string) || '0');
            const vitrine = parseFloat((p.vitrine_quantity as string) || '0');
            const backroom = parseFloat((p.backroom_quantity as string) || '0');
            const threshold = parseFloat((p.stock_min_threshold as string) || '0');
            const isLow = threshold > 0 && stock <= threshold && stock > 0;
            const isOut = stock <= 0;
            const isAvailable = p.is_available as boolean;

            return (
              <div key={p.id as string}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden group hover:shadow-md transition-all cursor-pointer ${
                  !isAvailable ? 'border-gray-200 opacity-60' : isOut ? 'border-red-200' : isLow ? 'border-amber-200' : 'border-gray-100'
                }`}
                onClick={() => { setEditingProduct(p); setShowForm(true); }}
              >
                {/* Image */}
                <div className="relative aspect-square bg-gray-50 overflow-hidden">
                  {p.image_url ? (
                    <img src={serverUrl(p.image_url as string)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">🥖</div>
                  )}
                  {/* Status badge */}
                  <div className="absolute top-2 left-2">
                    {!isAvailable ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-800/70 text-white backdrop-blur-sm flex items-center gap-1">
                        <EyeOff size={10} /> Indisponible
                      </span>
                    ) : isOut ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/90 text-white backdrop-blur-sm flex items-center gap-1">
                        <AlertTriangle size={10} /> Rupture
                      </span>
                    ) : isLow ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/90 text-white backdrop-blur-sm flex items-center gap-1">
                        <AlertTriangle size={10} /> Stock bas
                      </span>
                    ) : null}
                  </div>
                  {/* Quick actions overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); setEditingProduct(p); setShowForm(true); }}
                      className="w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-lg flex items-center justify-center hover:bg-white transition-colors" title="Modifier">
                      <Pencil size={14} className="text-gray-700" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleMutation.mutate(p.id as string); }}
                      className="w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-lg flex items-center justify-center hover:bg-amber-50 transition-colors"
                      title={p.is_available ? 'Désactiver' : 'Activer'}>
                      {p.is_available ? <EyeOff size={14} className="text-amber-600" /> : <Eye size={14} className="text-green-600" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer définitivement ce produit ? Cette action est irréversible.')) deleteMutation.mutate(p.id as string); }}
                      className="w-9 h-9 rounded-full bg-white/90 backdrop-blur shadow-lg flex items-center justify-center hover:bg-red-50 transition-colors" title="Supprimer">
                      <Trash2 size={14} className="text-red-500" />
                    </button>
                  </div>
                </div>
                {/* Info */}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900 truncate" title={p.name as string}>{p.name as string}</h3>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{p.category_name as string}</p>
                    </div>
                    <span className="text-sm font-bold text-amber-700 whitespace-nowrap">{parseFloat(p.price as string).toFixed(2)} <span className="text-xs font-normal">{p.sale_unit === 'weight' ? 'DH/kg' : 'DH'}</span></span>
                  </div>
                  {/* Bottom row: stock + responsible */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                    <div className="flex items-center gap-1 text-xs" title={`Reserve production : ${backroom} — En magasin (gere par caissieres) : ${vitrine}`}>
                      <Package size={12} className="text-gray-400" />
                      <span className={`font-semibold ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-600'}`}>
                        {p.sale_unit === 'weight' ? `${(backroom / 1000).toFixed(2)} kg` : backroom}
                      </span>
                    </div>
                    {p.responsible_first_name && (
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <ChefHat size={12} className="text-amber-400" />
                        <span className="truncate max-w-[80px]">{p.responsible_first_name as string}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
          {filteredProducts.length === 0 && (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <ShoppingBag size={48} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
              <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>Aucun produit trouvé</p>
              <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Essayez de modifier vos filtres</p>
            </div>
          )}
        </div>
      ) : (
        /* ═══ Table View (Odoo dense) ═══ */
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 28, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll}
                    title="Tout sélectionner" style={{ cursor: 'pointer', accentColor: 'var(--theme-accent)' }} />
                </th>
                <th style={{ width: 24 }}></th>
                <SortHeader label="Produit" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Catégorie" sortKey="category_name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Responsable" sortKey="responsible" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Prix" sortKey="price" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Stock" sortKey="stock_quantity" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Statut" sortKey="is_available" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th>Cycle de vie</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedProducts.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                  Aucun produit trouvé
                </td></tr>
              ) : sortedProducts.map((p: Record<string, any>) => {
                const stock = parseFloat((p.stock_quantity as string) || '0');
                const threshold = parseFloat((p.stock_min_threshold as string) || '0');
                const isLow = threshold > 0 && stock <= threshold && stock > 0;
                const isOut = stock <= 0;
                const dotClass = isOut ? 'danger' : isLow ? 'warning' : 'ok';

                return (
                  <tr key={p.id as string} onClick={() => { setEditingProduct(p); setShowForm(true); }}>
                    <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(p.id as string)}
                        onChange={() => toggleSelect(p.id as string)}
                        style={{ cursor: 'pointer', accentColor: 'var(--theme-accent)' }} />
                    </td>
                    <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        {p.image_url ? (
                          <img src={serverUrl(p.image_url as string)} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                        ) : (
                          <ShoppingBag size={13} style={{ color: 'var(--theme-accent)' }} />
                        )}
                        {p.name as string}
                      </span>
                    </td>
                    <td>
                      {p.category_name ? (
                        <span className="odoo-tag odoo-tag-grey">{p.category_name as string}</span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>
                      {p.responsible_first_name ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ChefHat size={11} /> {p.responsible_first_name as string} {(p.responsible_last_name as string)?.[0]}.
                        </span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 600 }}>{parseFloat(p.price as string).toFixed(2)}</span>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>{p.sale_unit === 'weight' ? 'DH/kg' : 'DH'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isOut ? (
                        <span className="odoo-tag odoo-tag-red">Rupture</span>
                      ) : isLow ? (
                        <span className="odoo-tag odoo-tag-orange">{p.sale_unit === 'weight' ? `${(stock / 1000).toFixed(2)} kg` : stock}</span>
                      ) : (
                        <span style={{ fontWeight: 500 }}>{p.sale_unit === 'weight' ? `${(stock / 1000).toFixed(2)} kg` : stock}</span>
                      )}
                    </td>
                    <td>
                      {p.is_available ? (
                        <span className="odoo-tag odoo-tag-green">Actif</span>
                      ) : (
                        <span className="odoo-tag odoo-tag-grey">Inactif</span>
                      )}
                    </td>
                    <td>
                      {/* Audit P1.5 : un seul badge de synthese, derive de sale_type.
                          Fini les cumuls contradictoires (JOUR + DLV nj + DDE nh).
                          Details (RE / REC / DDE) en badges secondaires optionnels. */}
                      {(() => {
                        const shelfDays = Number(p.shelf_life_days) || 0;
                        const displayHours = Number(p.display_life_hours) || 0;
                        const saleType = (p.sale_type as string) || 'jour';
                        return (
                          <div style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                            {saleType === 'jour' && (
                              <span className="odoo-tag odoo-tag-yellow" title="Vente du jour — invendu = perte ou recyclage">JOUR</span>
                            )}
                            {saleType === 'dlv' && (
                              <span className="odoo-tag odoo-tag-green" title={`DLV — ${shelfDays > 0 ? `${shelfDays} j depuis production` : 'DLV non configurée'}`}>
                                DLV{shelfDays > 0 ? ` ${shelfDays}j` : ''}
                              </span>
                            )}
                            {saleType === 'commande' && (
                              <span className="odoo-tag odoo-tag-blue" title="Sur commande — pas de stock vitrine">CMD</span>
                            )}
                            {saleType !== 'commande' && displayHours > 0 && (
                              <span className="odoo-tag odoo-tag-orange" title={`DDE : ${displayHours} h depuis transfert vitrine`}>
                                +DDE {displayHours}h
                              </span>
                            )}
                            {saleType !== 'commande' && Boolean(p.is_reexposable) && (
                              <span className="odoo-tag odoo-tag-purple" title={`Re-exposable${p.max_reexpositions ? ` (max ${p.max_reexpositions})` : ''}`}>RE</span>
                            )}
                            {saleType !== 'commande' && Boolean(p.is_recyclable) && (
                              <span className="odoo-tag odoo-tag-blue" title="Recyclable">REC</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 2 }}>
                        <button onClick={() => { setEditingProduct(p); setShowForm(true); }}
                          className="odoo-pager-btn" title="Modifier">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => toggleMutation.mutate(p.id as string)}
                          className="odoo-pager-btn" title={p.is_available ? 'Désactiver' : 'Activer'}>
                          {p.is_available ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button onClick={() => { if (confirm('Supprimer définitivement ce produit ? Cette action est irréversible.')) deleteMutation.mutate(p.id as string); }}
                          className="odoo-pager-btn" title="Supprimer"
                          style={{ color: '#dc3545' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          onClose={() => { setShowForm(false); setEditingProduct(null); }}
          onSave={(data, imageFile, pendingProfile) => saveMutation.mutate({ data, imageFile, pendingProfile })}
          isLoading={saveMutation.isPending}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Product Form Modal — Redesigned with tabs
   ═══════════════════════════════════════════════════════════════════════════ */

type FormTab = 'general' | 'production' | 'lifecycle';

function ProductFormModal({ product, categories, onClose, onSave, isLoading }: {
  product: Record<string, any> | null;
  categories: { id: number; name: string }[];
  onClose: () => void;
  onSave: (data: Record<string, any>, imageFile?: File | null, pendingProfile?: ProfileFormData | null) => void;
  isLoading: boolean;
}) {
  const [activeTab, setActiveTab] = useState<FormTab>('general');
  const [pendingProfile, setPendingProfile] = useState<ProfileFormData | null>(null);
  const [form, setForm] = useState({
    name: (product?.name as string) || '',
    categoryId: (product?.category_id as number) || categories[0]?.id || 1,
    price: (product?.price as string) || '',
    costPrice: (product?.cost_price as string) || '',
    description: (product?.description as string) || '',
    isAvailable: product?.is_available !== false,
    isCustomOrderable: (product?.is_custom_orderable as boolean) || false,
    responsibleUserId: (product?.responsible_user_id as string) || '',
    stockMinThreshold: (product?.stock_min_threshold as string) || '0',
    minProductionQuantity: (product?.min_production_quantity as string) || '0',
    shelfLifeDays: (product?.shelf_life_days as string) || '',
    displayLifeHours: (product?.display_life_hours as string) || '',
    // Audit P1.6 : renomme depuis 'hasDLV' (variable mensongere : c'etait en
    // realite is_reexposable). Alignement stricte avec le champ DB.
    isReexposable: (product?.is_reexposable as boolean) || false,
    isRecyclable: (product?.is_recyclable as boolean) || false,
    // Audit P1.4 : plafond editable, defaut 1 quand reexposable.
    maxReexpositions: String((product?.max_reexpositions as number | undefined) ?? ''),
    saleType: (product?.sale_type as string) || 'jour',
    recipeId: '',
  });

  // Audit P1.1 : change de type = purge les champs incoherents cote UI.
  // 'commande' n'a jamais de stock vitrine : on annule DLV/DDE/reexpose/recycle
  // pour ne pas afficher (ni sauvegarder) des flags fantomes. La ceinture DB
  // (mig 245 CHECK) rejette de toute facon les combos incoherents.
  const setSaleType = (nextType: string) => {
    setForm(prev => {
      if (nextType === prev.saleType) return prev;
      if (nextType === 'commande') {
        return {
          ...prev,
          saleType: nextType,
          shelfLifeDays: '',
          displayLifeHours: '',
          isReexposable: false,
          isRecyclable: false,
          maxReexpositions: '',
        };
      }
      // jour ou dlv : on garde ce qui est saisi (au cas ou l'utilisateur alterne).
      return { ...prev, saleType: nextType };
    });
  };

  // Fetch all recipes
  const { data: allRecipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list });
  const allRecipesList = allRecipes as Record<string, any>[];
  // Available = no product linked OR linked to the current product being edited
  const availableRecipes = allRecipesList.filter(r => {
    if (!r.product_id) return true;
    if (product && r.product_id === product.id) return true;
    return false;
  });
  // Already linked to another product
  const linkedRecipes = allRecipesList.filter(r => {
    if (!r.product_id) return false;
    if (product && r.product_id === product.id) return false;
    return true;
  });
  // Find the recipe currently linked to this product (for display info only)
  const currentRecipe = product ? allRecipesList.find(r => r.product_id === product.id) : null;

  // Pre-remplir le champ recipeId a l'ouverture du modal en edition.
  // Sans ce useEffect, le form affichait "recipeId: ''" a l'ouverture meme si le produit
  // avait deja une recette liee, donc le champ apparaissait vide dans l'UI.
  useEffect(() => {
    if (currentRecipe?.id && form.recipeId !== currentRecipe.id) {
      setForm(f => ({ ...f, recipeId: currentRecipe.id as string }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRecipe?.id]);

  // Prevent backdrop click from closing the modal on mount (mobile touch event propagation)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);

  // Smart recipe search state
  const [recipeSearch, setRecipeSearch] = useState('');
  const [recipeDropdownOpen, setRecipeDropdownOpen] = useState(false);
  const [recipeHighlight, setRecipeHighlight] = useState(0);
  const recipeInputRef = useRef<HTMLInputElement>(null);
  const recipeDropdownRef = useRef<HTMLDivElement>(null);

  // Selected recipe object
  const selectedRecipe = form.recipeId
    ? (allRecipes as Record<string, any>[]).find(r => r.id === form.recipeId) || null
    : null;

  // Auto-remplit le prix de vente et le cout de revient depuis la recette selectionnee.
  // - cost_per_unit = recipe.total_cost / yield_quantity
  // - prix_vente = cost_per_unit * margin_multiplier
  // On override toujours quand recipeId change (la recette est la source de verite).
  useEffect(() => {
    if (!selectedRecipe) return;
    const totalCost = parseFloat((selectedRecipe.total_cost as string) || '0');
    const yieldQty = parseFloat((selectedRecipe.yield_quantity as string) || '1') || 1;
    const margin = parseFloat(String(selectedRecipe.margin_multiplier ?? '3')) || 3;
    const costPerUnit = totalCost / yieldQty;
    const suggestedPrice = costPerUnit * margin;
    setForm(f => ({
      ...f,
      price: suggestedPrice > 0 ? suggestedPrice.toFixed(2) : f.price,
      costPrice: costPerUnit > 0 ? costPerUnit.toFixed(2) : f.costPrice,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecipe?.id, selectedRecipe?.total_cost, selectedRecipe?.margin_multiplier]);

  // Smart search: fuzzy match on recipe name, normalize accents
  const normalizeStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const searchFilter = (r: Record<string, any>) => {
    if (!recipeSearch.trim()) return true;
    const q = normalizeStr(recipeSearch);
    const name = normalizeStr(r.name as string);
    const words = q.split(/\s+/).filter(Boolean);
    return words.every(w => name.includes(w));
  };
  const filteredAvailable = availableRecipes.filter(searchFilter);
  const filteredLinked = linkedRecipes.filter(searchFilter);
  // Combined for keyboard navigation
  const filteredRecipes = [...filteredAvailable, ...filteredLinked];

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (recipeDropdownRef.current && !recipeDropdownRef.current.contains(e.target as Node)) {
        setRecipeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard navigation for recipe dropdown
  const handleRecipeKeyDown = (e: React.KeyboardEvent) => {
    if (!recipeDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setRecipeDropdownOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { setRecipeHighlight(h => Math.min(h + 1, filteredAvailable.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setRecipeHighlight(h => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter' && filteredAvailable[recipeHighlight]) {
      e.preventDefault();
      const r = filteredAvailable[recipeHighlight];
      setForm(f => ({ ...f, recipeId: r.id as string }));
      setRecipeSearch('');
      setRecipeDropdownOpen(false);
    }
    else if (e.key === 'Escape') { setRecipeDropdownOpen(false); }
  };

  // Reset highlight when search changes
  useEffect(() => { setRecipeHighlight(0); }, [recipeSearch]);

  const { data: allUsers = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const chefRoles = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];
  const chefUsers = allUsers.filter((u: Record<string, any>) => chefRoles.includes(u.role as string) && u.isActive !== false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>((product?.image_url as string) || null);
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        notify.error('Image trop volumineuse (max 5 Mo)');
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  }, []);

  const cameraInputRef = useRef<HTMLInputElement>(null);

  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('not supported');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      streamRef.current = stream;
      setShowCamera(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch {
      // getUserMedia requires HTTPS — fall back to native camera via file input
      cameraInputRef.current?.click();
    }
  }, []);

  const takePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
        setImageFile(file);
        setImagePreview(canvas.toDataURL('image/jpeg', 0.9));
      }
      stopCamera();
    }, 'image/jpeg', 0.9);
  }, [stopCamera]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Recipe is mandatory for new products
    if (!product && !form.recipeId) {
      notify.error('Veuillez sélectionner une recette. Créez d\'abord la recette dans le module Recettes.');
      return;
    }
    const { recipeId, ...rest } = form;

    // Audit P1.1 : purge finale cote client — le serveur (validator + CHECK
    // mig 245) refera la meme, mais on evite un aller-retour d'erreur.
    const saleType = rest.saleType || 'jour';
    const isCommande = saleType === 'commande';
    const isReexposable = isCommande ? false : Boolean(rest.isReexposable);
    const isRecyclable = isCommande ? false : Boolean(rest.isRecyclable);
    // max_reexpositions : entier positif si reexposable (defaut 1), sinon 0.
    const maxReexpositionsRaw = parseInt(rest.maxReexpositions);
    const maxReexpositions = isReexposable
      ? (Number.isFinite(maxReexpositionsRaw) && maxReexpositionsRaw >= 1 ? maxReexpositionsRaw : 1)
      : 0;

    onSave(
      {
        ...rest,
        price: parseFloat(rest.price),
        costPrice: rest.costPrice ? parseFloat(rest.costPrice) : undefined,
        responsibleUserId: rest.responsibleUserId || null,
        stockMinThreshold: parseFloat(rest.stockMinThreshold) || 0,
        minProductionQuantity: parseInt(rest.minProductionQuantity) || 0,
        shelfLifeDays: isCommande ? null : (parseInt(rest.shelfLifeDays) || null),
        displayLifeHours: isCommande ? null : (parseInt(rest.displayLifeHours) || null),
        isReexposable,
        isRecyclable,
        maxReexpositions,
        saleType,
        ...(recipeId ? { recipeId } : {}),
      },
      imageFile,
      pendingProfile || undefined
    );
  };

  const tabs: { key: FormTab; label: string; icon: React.ReactNode }[] = [
    { key: 'general', label: 'General', icon: <ShoppingBag size={16} /> },
    { key: 'production', label: 'Production', icon: <Factory size={16} /> },
    { key: 'lifecycle', label: 'Cycle de vie', icon: <Clock size={16} /> },
  ];

  return (
    <ModalBackdrop onClose={() => { if (mounted) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 720, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        {/* Control bar */}
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            {imagePreview ? (
              <img src={imagePreview} alt="" style={{ width: 18, height: 18, borderRadius: 3, objectFit: 'cover' }} />
            ) : (
              <ShoppingBag size={14} style={{ color: 'var(--theme-accent)' }} />
            )}
            <span>Produit</span>
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current">
              {product ? (product.name as string) : 'Nouveau produit'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        {/* Tabs Odoo */}
        <div className="odoo-tabs">
          {tabs.map(tab => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className={`odoo-tab ${activeTab === tab.key ? 'active' : ''}`}>
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* ═══ Tab: General ═══ */}
            {activeTab === 'general' && (
              <>
                {/* Image upload */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Photo du produit</label>
                  <div className="flex items-start gap-4">
                    {imagePreview ? (
                      <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-gray-200 shrink-0 group">
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                            <Upload size={14} className="text-gray-700" />
                          </button>
                          <button type="button" onClick={startCamera}
                            className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                            <Camera size={14} className="text-blue-600" />
                          </button>
                          <button type="button" onClick={removeImage}
                            className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                            <X size={14} className="text-red-500" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 shrink-0">
                        <div onClick={() => fileInputRef.current?.click()}
                          className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-colors">
                          <Upload size={24} className="text-gray-400 mb-2" />
                          <span className="text-xs text-gray-400 font-medium">Galerie</span>
                        </div>
                        <div onClick={startCamera}
                          className="w-32 h-32 rounded-xl border-2 border-dashed border-blue-300 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                          <Camera size={24} className="text-blue-400 mb-2" />
                          <span className="text-xs text-blue-400 font-medium">Camera</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} className="hidden" />
                  <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleImageChange} className="hidden" />
                  {showCamera && (
                    <div className="fixed inset-0 bg-black z-[60] flex flex-col">
                      <video ref={videoRef} autoPlay playsInline muted className="flex-1 object-cover w-full" />
                      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-6 pb-8 pt-4 bg-gradient-to-t from-black/70">
                        <button type="button" onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white">
                          <X size={28} />
                        </button>
                        <button type="button" onClick={takePhoto} className="w-20 h-20 rounded-full border-4 border-white bg-white/30 backdrop-blur flex items-center justify-center">
                          <div className="w-14 h-14 rounded-full bg-white" />
                        </button>
                        <div className="w-14" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Name */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nom du produit</label>
                  <input className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white transition-colors font-medium"
                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Croissant au beurre" />
                </div>

                {/* Recipe smart search — mandatory */}
                <div ref={recipeDropdownRef} className="relative">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <BookOpen size={14} className="text-amber-500" /> Recette <span className="text-red-500">*</span>
                  </label>
                  {allRecipesList.length === 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                      <AlertTriangle size={14} className="inline mr-1.5" />
                      Aucune recette dans le système. Veuillez d'abord créer une recette dans le module <strong>Recettes</strong> avant de pouvoir ajouter un produit.
                    </div>
                  ) : (
                    <>
                      {/* Search input — always visible */}
                      <div className="relative">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input ref={recipeInputRef} type="text"
                          className={`w-full pl-10 pr-10 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors ${
                            selectedRecipe ? 'bg-amber-50 border-amber-300 font-semibold text-amber-800' : 'bg-gray-50 border-gray-200'
                          }`}
                          placeholder="Tapez pour rechercher une recette..."
                          value={recipeDropdownOpen ? recipeSearch : (selectedRecipe ? (selectedRecipe.name as string) : recipeSearch)}
                          onChange={(e) => { setRecipeSearch(e.target.value); setRecipeDropdownOpen(true); if (form.recipeId) setForm(f => ({ ...f, recipeId: '' })); }}
                          onFocus={() => { setRecipeDropdownOpen(true); if (selectedRecipe) setRecipeSearch(''); }}
                          onKeyDown={handleRecipeKeyDown}
                          autoComplete="off" />
                        {(selectedRecipe || recipeSearch) && (
                          <button type="button" onClick={() => { setForm(f => ({ ...f, recipeId: '' })); setRecipeSearch(''); recipeInputRef.current?.focus(); }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-lg">
                            <X size={14} className="text-gray-400" />
                          </button>
                        )}
                      </div>

                      {/* Info de la recette actuellement liée (en mode edition) */}
                      {product && currentRecipe && !selectedRecipe && (
                        <p className="text-xs text-gray-400 mt-1.5">
                          Recette actuelle : <span className="font-medium text-gray-600">{currentRecipe.name as string}</span>
                        </p>
                      )}

                      {/* Dropdown results */}
                      {recipeDropdownOpen && (
                        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-y-auto">
                          {filteredRecipes.length === 0 ? (
                            <div className="px-4 py-6 text-center">
                              <BookOpen size={24} className="mx-auto mb-2 text-gray-300" />
                              <p className="text-sm text-gray-400">
                                {recipeSearch ? `Aucune recette trouvee pour "${recipeSearch}"` : 'Aucune recette disponible'}
                              </p>
                            </div>
                          ) : (
                            <>
                              {/* Available recipes */}
                              {filteredAvailable.length > 0 && (
                                <>
                                  <div className="px-3 py-2 border-b border-gray-100 bg-emerald-50/50">
                                    <p className="text-[10px] text-emerald-600 uppercase tracking-wide font-bold">{filteredAvailable.length} recette{filteredAvailable.length > 1 ? 's' : ''} disponible{filteredAvailable.length > 1 ? 's' : ''}</p>
                                  </div>
                                  {filteredAvailable.map((r, idx) => {
                                    const isHighlighted = idx === recipeHighlight;
                                    const cost = r.total_cost ? parseFloat(r.total_cost as string) : 0;
                                    return (
                                      <button type="button" key={r.id as string}
                                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                                          isHighlighted ? 'bg-amber-50' : 'hover:bg-gray-50'
                                        }`}
                                        onClick={() => {
                                          setForm(f => ({ ...f, recipeId: r.id as string }));
                                          setRecipeSearch('');
                                          setRecipeDropdownOpen(false);
                                        }}
                                        onMouseEnter={() => setRecipeHighlight(idx)}>
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                          r.is_base ? 'bg-gradient-to-br from-violet-500 to-purple-500' : 'bg-gradient-to-br from-amber-500 to-orange-500'
                                        }`}>
                                          <BookOpen size={14} className="text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-gray-700 truncate">{r.name as string}</p>
                                          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                                            {r.is_base && <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 text-[10px] font-bold">BASE</span>}
                                            {cost > 0 && <span>Cout: {cost.toFixed(2)} DH</span>}
                                            {r.yield_quantity && <span>Rend: {r.yield_quantity as number} unite{(r.yield_quantity as number) > 1 ? 's' : ''}</span>}
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </>
                              )}

                              {/* Linked recipes (already assigned to another product) */}
                              {filteredLinked.length > 0 && (
                                <>
                                  <div className="px-3 py-2 border-b border-t border-gray-100 bg-gray-50">
                                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">{filteredLinked.length} recette{filteredLinked.length > 1 ? 's' : ''} deja liee{filteredLinked.length > 1 ? 's' : ''} a un produit</p>
                                  </div>
                                  {filteredLinked.map((r, idx) => {
                                    const globalIdx = filteredAvailable.length + idx;
                                    const isHighlighted = globalIdx === recipeHighlight;
                                    const cost = r.total_cost ? parseFloat(r.total_cost as string) : 0;
                                    return (
                                      <div key={r.id as string}
                                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 opacity-50 cursor-not-allowed ${
                                          isHighlighted ? 'bg-gray-50' : ''
                                        }`}
                                        onMouseEnter={() => setRecipeHighlight(globalIdx)}>
                                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-300">
                                          <BookOpen size={14} className="text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-gray-500 truncate">{r.name as string}</p>
                                          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-500 text-[10px] font-bold">Liee a: {r.product_name as string}</span>
                                            {cost > 0 && <span>Cout: {cost.toFixed(2)} DH</span>}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Category + Price */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Catégorie</label>
                    <select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: parseInt(e.target.value) })}>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Prix de vente (DH)</label>
                    <input type="number" step="0.01" readOnly tabIndex={-1}
                      className="w-full px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 cursor-not-allowed"
                      value={form.price} placeholder="0.00" />
                    <p className="text-xs text-gray-400 mt-1">Calculé depuis la recette (coût × marge ou prix saisi)</p>
                  </div>
                </div>

                {/* Cost price + Responsible */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Prix de revient (DH)</label>
                    <input type="number" step="0.01" readOnly tabIndex={-1}
                      className="w-full px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-700 cursor-not-allowed"
                      value={form.costPrice} placeholder="Auto" />
                    <p className="text-xs text-gray-400 mt-1">Calculé depuis le coût des ingrédients de la recette</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                      <ChefHat size={14} className="text-amber-500" /> Responsable
                    </label>
                    <select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={form.responsibleUserId} onChange={(e) => setForm({ ...form, responsibleUserId: e.target.value })}>
                      <option value="">Aucun responsable</option>
                      {chefUsers.map((u: Record<string, any>) => (
                        <option key={u.id as string} value={u.id as string}>
                          {u.firstName as string} {u.lastName as string} — {ROLE_LABELS[(u.role as Role)] || u.role}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                  <textarea className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                    rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description optionnelle..." />
                </div>

                {/* Toggles */}
                <div className="flex gap-6">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${form.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                      onClick={() => setForm({ ...form, isAvailable: !form.isAvailable })}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form.isAvailable ? 'translate-x-5.5 left-[1px]' : 'left-[2px]'}`}
                        style={{ transform: form.isAvailable ? 'translateX(22px)' : 'translateX(0)' }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">Disponible a la vente</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${form.isCustomOrderable ? 'bg-blue-500' : 'bg-gray-300'}`}
                      onClick={() => setForm({ ...form, isCustomOrderable: !form.isCustomOrderable })}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform`}
                        style={{ transform: form.isCustomOrderable ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">Sur commande</span>
                  </label>
                </div>

                {/* Paliers tarifaires (mig 171) — visible uniquement pour les produits vendus au poids */}
                {product && product.sale_unit === 'weight' && (
                  <PricingTiersPanel productId={product.id as string} />
                )}

                {/* Prix par canal de vente (mig 173) — visible pour tous les produits existants */}
                {product && (
                  <ChannelPricingPanel
                    productId={product.id as string}
                    saleUnit={(product.sale_unit as string) || 'unit'}
                  />
                )}
              </>
            )}

            {/* ═══ Tab: Production ═══ */}
            {activeTab === 'production' && (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Factory size={20} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-amber-800">Parametres de production</h3>
                      <p className="text-xs text-amber-600 mt-0.5">Ces parametres influencent les plans de production automatiques</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <Package size={14} className="text-blue-500" /> Seuil d'alerte stock
                  </label>
                  <input type="number" step="1" min="0"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    value={form.stockMinThreshold} onChange={(e) => setForm({ ...form, stockMinThreshold: e.target.value })}
                    placeholder="0 = pas d'alerte" />
                  <p className="text-xs text-gray-400 mt-1.5 ml-1">Alerte quand le stock descend en dessous de ce seuil</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <Factory size={14} className="text-amber-500" /> Lot minimum de production
                  </label>
                  <input type="number" step="1" min="0"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    value={form.minProductionQuantity} onChange={(e) => setForm({ ...form, minProductionQuantity: e.target.value })}
                    placeholder="0 = pas de minimum" />
                  <p className="text-xs text-gray-400 mt-1.5 ml-1">Quantite minimale a produire a chaque lancement (le surplus reste en stock central)</p>
                </div>

                {/* Production summary info */}
                {product && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Informations actuelles</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Stock actuel</span>
                        <span className="text-sm font-bold text-gray-900">{product.sale_unit === 'weight' ? `${(parseFloat((product.stock_quantity as string) || '0') / 1000).toFixed(2)} kg` : parseFloat((product.stock_quantity as string) || '0')}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Seuil alerte</span>
                        <span className="text-sm font-bold text-gray-900">{product.sale_unit === 'weight' ? `${(parseFloat((product.stock_min_threshold as string) || '0') / 1000).toFixed(2)} kg` : parseFloat((product.stock_min_threshold as string) || '0')}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══ Tab: Cycle de vie ═══ */}
            {activeTab === 'lifecycle' && (
              <>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Clock size={20} className="text-purple-600 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-purple-800">Cycle de vie du produit</h3>
                      <p className="text-xs text-purple-600 mt-0.5">DLV, type de vente, exposition et recyclage</p>
                    </div>
                  </div>
                </div>

                {/* Type de vente (audit P1.1 : pilote de l'onglet) */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Type de vente</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'jour', label: 'Vente du jour', desc: 'Invendu = perte ou recyclage', color: 'amber', icon: '☀️' },
                      { value: 'dlv', label: 'DLV', desc: 'Vendable sur plusieurs jours', color: 'green', icon: '📅' },
                      { value: 'commande', label: 'Sur commande', desc: 'Pas de stock vitrine', color: 'blue', icon: '📋' },
                    ].map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => setSaleType(opt.value)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center ${
                          form.saleType === opt.value
                            ? `border-${opt.color}-400 bg-${opt.color}-50 ring-1 ring-${opt.color}-200`
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}>
                        <span className="text-xl">{opt.icon}</span>
                        <span className="text-xs font-semibold text-gray-800">{opt.label}</span>
                        <span className="text-[10px] text-gray-500 leading-tight">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bannière type=commande : rien d'autre à saisir */}
                {form.saleType === 'commande' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">📋</span>
                      <div>
                        <h4 className="text-sm font-semibold text-blue-800">Sur commande — pas de cycle de vie vitrine</h4>
                        <p className="text-xs text-blue-600 mt-0.5">
                          Le produit n&apos;est jamais expose : ni DLV, ni DDE, ni ré-exposition, ni recyclage.
                          Il est produit à la demande.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sections cycle de vie visibles uniquement pour jour/dlv */}
                {form.saleType !== 'commande' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                          DLV — Duree limite de vie (jours) {form.saleType === 'dlv' && <span className="text-red-500">*</span>}
                        </label>
                        <input type="number" step="1" min="0"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                          value={form.shelfLifeDays} onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })}
                          placeholder={form.saleType === 'dlv' ? 'Obligatoire (ex: 3)' : 'Optionnel — vide = jour même'}
                          required={form.saleType === 'dlv'} />
                        <p className="text-xs text-gray-400 mt-1.5 ml-1">
                          {form.saleType === 'jour'
                            ? 'Vente du jour : laisser vide (implicite = jour de production)'
                            : 'Compte à partir de la date de production, indep. du transfert vitrine'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">DDE — Duree d&apos;exposition vitrine (heures)</label>
                        <input type="number" step="1" min="0"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                          value={form.displayLifeHours} onChange={(e) => setForm({ ...form, displayLifeHours: e.target.value })} placeholder="Ex: 24" />
                        <p className="text-xs text-gray-400 mt-1.5 ml-1">Compte à partir du <strong>transfert en vitrine</strong>. Echeance effective = MIN(DLV, DDE)</p>
                      </div>
                    </div>

                    {/* Re-exposable toggle + max_reexpositions (audit P1.4) */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                            <Eye size={18} className="text-green-600" />
                          </div>
                          <div>
                            <span className="text-sm font-semibold text-gray-900">Re-exposable</span>
                            <p className="text-xs text-gray-400">Peut être remis en vitrine le lendemain</p>
                          </div>
                        </div>
                        <div className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${form.isReexposable ? 'bg-green-500' : 'bg-gray-300'}`}
                          onClick={() => {
                            const next = !form.isReexposable;
                            setForm({
                              ...form,
                              isReexposable: next,
                              // Aligne max_reexpositions sur le toggle
                              maxReexpositions: next
                                ? (form.maxReexpositions && parseInt(form.maxReexpositions) >= 1 ? form.maxReexpositions : '1')
                                : '',
                            });
                          }}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                            style={{ transform: form.isReexposable ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                        </div>
                      </div>
                      {form.isReexposable && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                            Nombre maximum de ré-expositions
                          </label>
                          <input type="number" step="1" min="1" max="10"
                            className="w-40 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            value={form.maxReexpositions}
                            onChange={(e) => setForm({ ...form, maxReexpositions: e.target.value })}
                            placeholder="1" />
                          <p className="text-xs text-gray-400 mt-1.5">
                            Combien de fois le produit peut être re-exposé (J+1, J+2…) avant destruction/recyclage.
                            Défaut : 1.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Recyclable toggle + gestion destinations (audit P1.3) */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center">
                            <span className="text-lg">♻️</span>
                          </div>
                          <div>
                            <span className="text-sm font-semibold text-gray-900">Recyclable</span>
                            <p className="text-xs text-gray-400">Peut être transformé en ingrédient (chapelure, pudding…)</p>
                          </div>
                        </div>
                        <div className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${form.isRecyclable ? 'bg-cyan-500' : 'bg-gray-300'}`}
                          onClick={() => setForm({ ...form, isRecyclable: !form.isRecyclable })}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                            style={{ transform: form.isRecyclable ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                        </div>
                      </div>
                      {form.isRecyclable && product && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <RecycleDestinationsPanel productId={product.id as string} />
                        </div>
                      )}
                      {form.isRecyclable && !product && (
                        <p className="mt-2 text-xs text-gray-500 italic">
                          Enregistrez d&apos;abord le produit, puis rouvrez la fiche pour configurer les destinations de recyclage.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer actions Odoo */}
          <div style={{
            position: 'sticky', bottom: 0,
            backgroundColor: 'var(--theme-bg-card)',
            borderTop: '1px solid var(--theme-bg-separator)',
            padding: '0.625rem 1rem',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem',
          }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">
              Annuler
            </button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">
              {isLoading ? (
                <>
                  <div style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Pencil size={13} /> {product ? 'Mettre à jour' : 'Créer le produit'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}

// ─── Paliers tarifaires (mig 171) ───
// Permet de definir N tranches min/max poids → prix/kg specifique.
// Le POS resout automatiquement le palier au moment de la vente.
function PricingTiersPanel({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const { data: existingTiers = [] } = useQuery({
    queryKey: ['product-pricing-tiers', productId],
    queryFn: () => productsApi.listPricingTiers(productId),
  });

  type TierRow = { min: string; max: string; prix: string };
  const [rows, setRows] = useState<TierRow[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialized || !existingTiers) return;
    setRows(
      existingTiers.length > 0
        ? existingTiers
            .sort((a, b) => a.min_grammes - b.min_grammes)
            .map(t => ({
              min: String(t.min_grammes),
              max: t.max_grammes !== null ? String(t.max_grammes) : '',
              prix: String(parseFloat(String(t.prix_per_kg))),
            }))
        : []
    );
    setInitialized(true);
  }, [existingTiers, initialized]);

  const addRow = () => setRows([...rows, { min: '', max: '', prix: '' }]);
  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: keyof TierRow, value: string) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleaned = rows
        .filter(r => r.min !== '' && r.prix !== '' && parseFloat(r.prix) > 0)
        .map((r, i) => ({
          min_grammes: parseInt(r.min, 10) || 0,
          max_grammes: r.max ? parseInt(r.max, 10) : null,
          prix_per_kg: parseFloat(r.prix),
          display_order: i,
        }));
      await productsApi.replacePricingTiers(productId, cleaned);
      await queryClient.invalidateQueries({ queryKey: ['product-pricing-tiers', productId] });
      notify.success('Paliers tarifaires enregistrés');
    } catch {
      notify.error('Erreur lors de la sauvegarde des paliers');
    } finally {
      setSaving(false);
    }
  };

  // Aperçu live : pour un poids 350g, quel palier matche ?
  const previewWeight = 350;
  const matchingRow = rows.find(r => {
    const min = parseInt(r.min || '0', 10);
    const max = r.max ? parseInt(r.max, 10) : Infinity;
    return previewWeight >= min && previewWeight < max && parseFloat(r.prix) > 0;
  });

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            🪙 Paliers tarifaires (vente au kg)
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Définit un prix au kg par tranche de poids. Au POS, le palier matchant est appliqué automatiquement.
          </p>
        </div>
        <button type="button" onClick={addRow}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
          <Plus size={12} /> Ajouter
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs text-gray-500 bg-white border border-dashed border-gray-300 rounded-lg p-3 text-center">
          Aucun palier — le POS utilisera le prix unique du produit (price_per_kg).
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-white border border-gray-200 rounded-lg p-2">
              <div className="col-span-3">
                <label className="block text-[10px] uppercase font-semibold text-gray-500 mb-0.5">À partir de (g)</label>
                <input type="number" min={0} step={1}
                  className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-xs text-right focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-bold"
                  value={row.min} onChange={e => updateRow(idx, 'min', e.target.value)} placeholder="0" />
              </div>
              <div className="col-span-3">
                <label className="block text-[10px] uppercase font-semibold text-gray-500 mb-0.5">Jusqu'à (g)</label>
                <input type="number" min={0} step={1}
                  className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-xs text-right focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-bold"
                  value={row.max} onChange={e => updateRow(idx, 'max', e.target.value)} placeholder="∞ (vide)" />
              </div>
              <div className="col-span-5">
                <label className="block text-[10px] uppercase font-semibold text-gray-500 mb-0.5">Prix au kg (DH)</label>
                <input type="number" min={0} step="0.01"
                  className="w-full px-2 py-1.5 bg-emerald-50 border border-emerald-300 rounded text-xs text-right focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-bold text-emerald-900"
                  value={row.prix} onChange={e => updateRow(idx, 'prix', e.target.value)} placeholder="80.00" />
              </div>
              <div className="col-span-1 flex justify-end">
                <button type="button" onClick={() => removeRow(idx)}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Supprimer">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Aperçu live */}
      {rows.length > 0 && (
        <div className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center justify-between">
          <span className="text-gray-500">Aperçu pour <strong>{previewWeight}g</strong> :</span>
          {matchingRow ? (
            <span className="font-bold text-emerald-700">
              {((previewWeight / 1000) * parseFloat(matchingRow.prix)).toFixed(2)} DH
              <span className="ml-2 text-gray-400 font-normal">({matchingRow.prix} DH/kg)</span>
            </span>
          ) : (
            <span className="text-gray-400 italic">Aucun palier ne matche — fallback sur le prix produit</span>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-60">
          {saving ? 'Enregistrement...' : 'Enregistrer les paliers'}
        </button>
      </div>
    </div>
  );
}

// ─── Destinations de recyclage (audit P1.3, mig 106+116) ───
// Un produit recyclable peut avoir N ingredients cibles avec un rendement
// (yield_ratio) chacun. Ex: baguette -> chapelure 0.7 (perte au sechage).
// Le POS et la page Invendus consomment ces destinations.
function RecycleDestinationsPanel({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const { data: existingDests = [] } = useQuery({
    queryKey: ['product-recycle-destinations', productId],
    queryFn: () => productsApi.listRecycleDestinations(productId),
  });
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients-for-recycle'],
    queryFn: async () => {
      const { ingredientsApi } = await import('../../api/inventory.api');
      return ingredientsApi.list();
    },
  });

  // Etat local : liste editable (ingredient_id, label, yield_ratio).
  // On synchronise depuis l'API a l'ouverture.
  type Row = { ingredientId: string; label: string; yieldRatio: string };
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const initial: Row[] = (existingDests as unknown as Record<string, unknown>[]).map(d => ({
      ingredientId: (d.ingredient_id as string) || (d.ingredientId as string),
      label: (d.label as string) || '',
      yieldRatio: String(d.yield_ratio ?? d.yieldRatio ?? 1),
    }));
    setRows(initial);
    setDirty(false);
  }, [existingDests]);

  const ingredientOptions = (ingredients as Record<string, unknown>[]).map(i => ({
    id: i.id as string,
    name: (i.name as string) || '',
    unit: (i.unit as string) || '',
  }));

  const mutation = useMutation({
    mutationFn: () => {
      const payload = rows
        .filter(r => r.ingredientId)
        .map((r, i) => ({
          ingredientId: r.ingredientId,
          label: r.label.trim() || null,
          displayOrder: i,
          yieldRatio: parseFloat(r.yieldRatio) || 1,
          isActive: true,
        }));
      return productsApi.replaceRecycleDestinations(productId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-recycle-destinations', productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      notify.success('Destinations de recyclage enregistrées');
      setDirty(false);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Erreur';
      notify.error(msg);
    },
  });

  const addRow = () => {
    setRows([...rows, { ingredientId: '', label: '', yieldRatio: '1' }]);
    setDirty(true);
  };
  const removeRow = (idx: number) => {
    setRows(rows.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
          Destinations de recyclage
        </h5>
        <button type="button" onClick={addRow}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 rounded-md hover:bg-cyan-100">
          <Plus size={12} /> Ajouter
        </button>
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-gray-500 italic py-2">
          Aucune destination. Ajoutez au moins un ingrédient cible pour rendre le recyclage opérationnel.
        </p>
      )}

      {rows.map((row, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-start">
          <div className="col-span-5">
            <select
              value={row.ingredientId}
              onChange={(e) => updateRow(idx, { ingredientId: e.target.value })}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white">
              <option value="">— Ingrédient cible —</option>
              {ingredientOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.name}{opt.unit ? ` (${opt.unit})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="col-span-4">
            <input type="text"
              value={row.label}
              onChange={(e) => updateRow(idx, { label: e.target.value })}
              placeholder="Libellé (ex: Vers chapelure)"
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" />
          </div>
          <div className="col-span-2">
            <input type="number" step="0.01" min="0.01" max="2"
              value={row.yieldRatio}
              onChange={(e) => updateRow(idx, { yieldRatio: e.target.value })}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white"
              title="Rendement : 1.0 = 100 %, 0.7 = 30 % de perte au séchage" />
          </div>
          <div className="col-span-1 flex justify-end">
            <button type="button" onClick={() => removeRow(idx)}
              className="p-1 text-red-500 hover:bg-red-50 rounded-md" title="Supprimer">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
        <p className="text-[11px] text-gray-500">
          Rendement : 1.0 = conversion complète, 0.7 = 30 % de perte
        </p>
        {dirty && (
          <button type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-3 py-1.5 text-xs font-semibold bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50">
            {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Prix par canal de vente (mig 173) ───
function ChannelPricingPanel({ productId, saleUnit }: { productId: string; saleUnit: string }) {
  const queryClient = useQueryClient();
  const { data: channels = [] } = useQuery({
    queryKey: ['sales-channels', 'active'],
    queryFn: salesChannelsApi.listActive,
  });
  const { data: existingOverrides = [] } = useQuery({
    queryKey: ['product-channel-pricing', productId],
    queryFn: () => productsApi.listChannelPricing(productId),
  });

  type RowState = Record<string, { price: string; priceKg: string }>; // par channel_id
  const [rows, setRows] = useState<RowState>({});
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialized || channels.length === 0) return;
    const init: RowState = {};
    for (const c of channels) {
      const ex = existingOverrides.find(o => o.channel_id === c.id);
      init[c.id] = {
        price: ex?.price_override ? String(parseFloat(String(ex.price_override))) : '',
        priceKg: ex?.price_per_kg_override ? String(parseFloat(String(ex.price_per_kg_override))) : '',
      };
    }
    setRows(init);
    setInitialized(true);
  }, [channels, existingOverrides, initialized]);

  const updateField = (channelId: string, field: 'price' | 'priceKg', value: string) =>
    setRows(prev => ({ ...prev, [channelId]: { ...prev[channelId], [field]: value } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const items = Object.entries(rows)
        .map(([channelId, vals]) => ({
          channel_id: channelId,
          price_override: vals.price && parseFloat(vals.price) > 0 ? parseFloat(vals.price) : null,
          price_per_kg_override: vals.priceKg && parseFloat(vals.priceKg) > 0 ? parseFloat(vals.priceKg) : null,
        }))
        .filter(it => it.price_override !== null || it.price_per_kg_override !== null);
      await productsApi.replaceChannelPricing(productId, items);
      await queryClient.invalidateQueries({ queryKey: ['product-channel-pricing', productId] });
      notify.success('Prix par canal enregistrés');
    } catch {
      notify.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (channels.length === 0) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        🎯 Prix par canal de vente
      </div>
      <p className="text-xs text-gray-500">
        Override le prix par défaut du produit pour un canal spécifique. Laisse vide pour utiliser le prix de catalogue (ou le palier tarifaire pour la vente au poids).
      </p>
      <div className="space-y-2">
        {channels.map((c: SalesChannel) => {
          const row = rows[c.id] || { price: '', priceKg: '' };
          const hasOverride = (saleUnit === 'weight' ? row.priceKg : row.price) !== '';
          return (
            <div key={c.id} className={`flex items-center gap-3 p-2 rounded-lg border ${hasOverride ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
              <div className="flex items-center gap-2 min-w-[160px]">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="text-sm font-medium text-gray-700">{c.label}</span>
                {c.is_default && <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded">défaut</span>}
              </div>
              {saleUnit === 'weight' ? (
                <div className="flex items-center gap-2 flex-1">
                  <input type="number" min={0} step="0.01"
                    className={`flex-1 px-3 py-1.5 rounded border text-sm text-right font-bold ${hasOverride ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-gray-50 border-gray-200'}`}
                    value={row.priceKg} onChange={e => updateField(c.id, 'priceKg', e.target.value)}
                    placeholder="auto (prix produit / palier)" />
                  <span className="text-xs text-gray-500 font-medium">DH/kg</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <input type="number" min={0} step="0.01"
                    className={`flex-1 px-3 py-1.5 rounded border text-sm text-right font-bold ${hasOverride ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-gray-50 border-gray-200'}`}
                    value={row.price} onChange={e => updateField(c.id, 'price', e.target.value)}
                    placeholder="auto (prix produit)" />
                  <span className="text-xs text-gray-500 font-medium">DH/pièce</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-60">
          {saving ? 'Enregistrement...' : 'Enregistrer les prix par canal'}
        </button>
      </div>
    </div>
  );
}
