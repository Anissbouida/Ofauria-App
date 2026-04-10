import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { usersApi } from '../../api/users.api';
import { recipesApi } from '../../api/recipes.api';
import { Plus, Pencil, Trash2, Search, Upload, X, Camera, ChefHat, Package, AlertTriangle, Factory, Clock, Eye, EyeOff, ShoppingBag, TrendingUp, LayoutGrid, List, Filter, BookOpen } from 'lucide-react';
import { ROLE_LABELS } from '@ofauria/shared';
import type { Role } from '@ofauria/shared';
import toast from 'react-hot-toast';

type ViewMode = 'grid' | 'table';

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Record<string, unknown> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [stockFilter, setStockFilter] = useState<'all' | 'available' | 'low' | 'out'>('all');

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', { search, categoryId: categoryFilter }],
    queryFn: () => productsApi.list({ search, categoryId: categoryFilter, limit: '500' }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const deleteMutation = useMutation({
    mutationFn: productsApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); toast.success('Produit supprimé définitivement'); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      toast.error(msg || 'Erreur lors de la suppression');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: productsApi.toggleAvailability,
    onSuccess: (product: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(product.is_available ? 'Produit activé' : 'Produit désactivé');
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ data, imageFile }: { data: Record<string, unknown>; imageFile?: File | null }) => {
      const result = editingProduct
        ? await productsApi.update(editingProduct.id as string, data)
        : await productsApi.create(data);
      const productId = editingProduct ? (editingProduct.id as string) : (result as Record<string, unknown>).id as string;
      if (imageFile && productId) {
        await productsApi.uploadImage(productId, imageFile);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(editingProduct ? 'Produit mis à jour' : 'Produit créé');
      setShowForm(false); setEditingProduct(null);
    },
  });

  const products = productsData?.data || [];

  // Stats
  const totalProducts = products.length;
  const availableCount = products.filter((p: Record<string, unknown>) => p.is_available).length;
  const lowStockCount = products.filter((p: Record<string, unknown>) => {
    const stock = parseFloat((p.stock_quantity as string) || '0');
    const threshold = parseFloat((p.stock_min_threshold as string) || '0');
    return threshold > 0 && stock <= threshold && stock > 0;
  }).length;
  const outOfStockCount = products.filter((p: Record<string, unknown>) => parseFloat((p.stock_quantity as string) || '0') <= 0).length;

  // Apply stock filter
  const filteredProducts = products.filter((p: Record<string, unknown>) => {
    if (stockFilter === 'all') return true;
    const stock = parseFloat((p.stock_quantity as string) || '0');
    const threshold = parseFloat((p.stock_min_threshold as string) || '0');
    if (stockFilter === 'out') return stock <= 0;
    if (stockFilter === 'low') return threshold > 0 && stock <= threshold && stock > 0;
    if (stockFilter === 'available') return p.is_available as boolean;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Produits</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {stockFilter !== 'all' ? `${filteredProducts.length} sur ${totalProducts} produits` : `${totalProducts} produits au catalogue`}
          </p>
        </div>
        <button onClick={() => { setEditingProduct(null); setShowForm(true); }} className="btn-primary flex items-center gap-2 shadow-md hover:shadow-lg transition-shadow">
          <Plus size={18} /> Nouveau produit
        </button>
      </div>

      {/* Stats cards — clickable as filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div onClick={() => setStockFilter(stockFilter === 'all' ? 'all' : 'all')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            stockFilter === 'all' ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200' : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <ShoppingBag size={20} className="text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{totalProducts}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
          </div>
        </div>
        <div onClick={() => setStockFilter(stockFilter === 'available' ? 'all' : 'available')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            stockFilter === 'available' ? 'bg-green-50 border-green-300 ring-2 ring-green-200' : 'bg-white border-gray-100 hover:border-green-200 hover:bg-green-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <Eye size={20} className="text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-green-700">{availableCount}</div>
              <div className="text-xs text-gray-500">Disponibles</div>
            </div>
          </div>
        </div>
        <div onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            stockFilter === 'low' ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200' : 'bg-white border-gray-100 hover:border-amber-200 hover:bg-amber-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <TrendingUp size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700">{lowStockCount}</div>
              <div className="text-xs text-gray-500">Stock bas</div>
            </div>
          </div>
        </div>
        <div onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}
          className={`rounded-xl border p-4 shadow-sm cursor-pointer transition-all ${
            stockFilter === 'out' ? 'bg-red-50 border-red-300 ring-2 ring-red-200' : 'bg-white border-gray-100 hover:border-red-200 hover:bg-red-50/50'
          }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-red-700">{outOfStockCount}</div>
              <div className="text-xs text-gray-500">Rupture</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white transition-colors" />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={16} className="text-gray-400" />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
              className="py-2.5 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-w-[180px]">
              <option value="">Toutes les catégories</option>
              {categories.map((c: { id: number; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {stockFilter !== 'all' && (
            <button onClick={() => setStockFilter('all')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                stockFilter === 'available' ? 'bg-green-50 text-green-700 border-green-200' :
                stockFilter === 'low' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-red-50 text-red-700 border-red-200'
              }`}>
              {stockFilter === 'available' ? 'Disponibles' : stockFilter === 'low' ? 'Stock bas' : 'Rupture'}
              <X size={14} />
            </button>
          )}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}>
              <LayoutGrid size={18} />
            </button>
            <button onClick={() => setViewMode('table')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}>
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full" />
        </div>
      ) : viewMode === 'grid' ? (
        /* ═══ Grid View ═══ */
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" style={{ maxHeight: 'calc(100vh - 22rem)', overflowY: 'auto' }}>
          {filteredProducts.map((p: Record<string, unknown>) => {
            const stock = parseFloat((p.stock_quantity as string) || '0');
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
                    <img src={p.image_url as string} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
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
                    <span className="text-sm font-bold text-amber-700 whitespace-nowrap">{parseFloat(p.price as string).toFixed(2)} <span className="text-xs font-normal">DH</span></span>
                  </div>
                  {/* Bottom row: stock + responsible */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                    <div className="flex items-center gap-1 text-xs">
                      <Package size={12} className="text-gray-400" />
                      <span className={`font-semibold ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-600'}`}>
                        {stock}
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
          {filteredProducts.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-400">
              <ShoppingBag size={48} className="mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucun produit trouve</p>
              <p className="text-sm mt-1">Essayez de modifier vos filtres</p>
            </div>
          )}
        </div>
      ) : (
        /* ═══ Table View ═══ */
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto" style={{ maxHeight: 'calc(100vh - 22rem)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Produit</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Catégorie</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Responsable</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Prix</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cycle de vie</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredProducts.map((p: Record<string, unknown>) => {
                const stock = parseFloat((p.stock_quantity as string) || '0');
                const threshold = parseFloat((p.stock_min_threshold as string) || '0');
                const isLow = threshold > 0 && stock <= threshold && stock > 0;
                const isOut = stock <= 0;

                return (
                  <tr key={p.id as string} className="hover:bg-amber-50/30 transition-colors cursor-pointer" onClick={() => { setEditingProduct(p); setShowForm(true); }}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          <img src={p.image_url as string} alt="" className="w-11 h-11 rounded-xl object-cover border border-gray-100" />
                        ) : (
                          <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-xl border border-amber-100">🥖</div>
                        )}
                        <div className="min-w-0">
                          <span className="font-semibold text-gray-900 text-sm block truncate">{p.name as string}</span>
                          {p.description && (
                            <span className="text-xs text-gray-400 truncate block max-w-[200px]">{p.description as string}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{p.category_name as string}</span>
                    </td>
                    <td className="px-5 py-3">
                      {p.responsible_first_name ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                            <ChefHat size={12} className="text-amber-600" />
                          </div>
                          <span className="text-sm text-gray-700">{p.responsible_first_name as string} {(p.responsible_last_name as string)?.[0]}.</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm font-bold text-gray-900">{parseFloat(p.price as string).toFixed(2)}</span>
                      <span className="text-xs text-gray-400 ml-0.5">DH</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {isOut ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 inline-flex items-center gap-1">
                          <AlertTriangle size={11} /> Rupture
                        </span>
                      ) : isLow ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                          <AlertTriangle size={11} /> {stock}
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-gray-700">{stock}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {p.is_available ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 inline-flex items-center gap-1">
                          <Eye size={11} /> Actif
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 inline-flex items-center gap-1">
                          <EyeOff size={11} /> Inactif
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {p.shelf_life_days && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title={`DLV: ${p.shelf_life_days} jour(s)`}>DLV {p.shelf_life_days as number}j</span>
                        )}
                        {p.is_recyclable && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-100 text-cyan-700" title="Recyclable">REC</span>
                        )}
                        {p.display_life_hours && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700" title={`Exposition: ${p.display_life_hours}h`}>{p.display_life_hours as number}h</span>
                        )}
                        {!p.shelf_life_days && !p.is_recyclable && !p.display_life_hours && (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditingProduct(p); setShowForm(true); }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Modifier">
                          <Pencil size={15} className="text-gray-500" />
                        </button>
                        <button onClick={() => toggleMutation.mutate(p.id as string)}
                          className="p-2 hover:bg-amber-50 rounded-lg transition-colors" title={p.is_available ? 'Désactiver' : 'Activer'}>
                          {p.is_available ? <EyeOff size={15} className="text-amber-500 hover:text-amber-600" /> : <Eye size={15} className="text-green-500 hover:text-green-600" />}
                        </button>
                        <button onClick={() => { if (confirm('Supprimer définitivement ce produit ? Cette action est irréversible.')) deleteMutation.mutate(p.id as string); }}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer">
                          <Trash2 size={15} className="text-red-400 hover:text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <ShoppingBag size={48} className="mb-3 text-gray-300" />
              <p className="text-lg font-medium">Aucun produit trouve</p>
              <p className="text-sm mt-1">Essayez de modifier vos filtres</p>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          onClose={() => { setShowForm(false); setEditingProduct(null); }}
          onSave={(data, imageFile) => saveMutation.mutate({ data, imageFile })}
          isLoading={saveMutation.isPending}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Product Form Modal — Redesigned with tabs
   ═══════════════════════════════════════════════════════════════════════════ */

type FormTab = 'general' | 'production' | 'lifecycle';

function ProductFormModal({ product, categories, onClose, onSave, isLoading }: {
  product: Record<string, unknown> | null;
  categories: { id: number; name: string }[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>, imageFile?: File | null) => void;
  isLoading: boolean;
}) {
  const [activeTab, setActiveTab] = useState<FormTab>('general');
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
    hasDLV: (product?.is_reexposable as boolean) || false,
    isRecyclable: (product?.is_recyclable as boolean) || false,
    recipeId: '',
  });

  // Fetch all recipes
  const { data: allRecipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: recipesApi.list });
  const allRecipesList = allRecipes as Record<string, unknown>[];
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

  // Smart recipe search state
  const [recipeSearch, setRecipeSearch] = useState('');
  const [recipeDropdownOpen, setRecipeDropdownOpen] = useState(false);
  const [recipeHighlight, setRecipeHighlight] = useState(0);
  const recipeInputRef = useRef<HTMLInputElement>(null);
  const recipeDropdownRef = useRef<HTMLDivElement>(null);

  // Selected recipe object
  const selectedRecipe = form.recipeId
    ? (allRecipes as Record<string, unknown>[]).find(r => r.id === form.recipeId) || null
    : null;

  // Smart search: fuzzy match on recipe name, normalize accents
  const normalizeStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const searchFilter = (r: Record<string, unknown>) => {
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
  const chefUsers = allUsers.filter((u: Record<string, unknown>) => chefRoles.includes(u.role as string) && u.isActive !== false);
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
        toast.error('Image trop volumineuse (max 5 Mo)');
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

  const startCamera = useCallback(async () => {
    try {
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
      toast.error('Impossible d\'acceder a la camera');
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
      toast.error('Veuillez sélectionner une recette. Créez d\'abord la recette dans le module Recettes.');
      return;
    }
    const { recipeId, ...rest } = form;
    onSave(
      {
        ...rest,
        price: parseFloat(rest.price),
        costPrice: rest.costPrice ? parseFloat(rest.costPrice) : undefined,
        responsibleUserId: rest.responsibleUserId || null,
        stockMinThreshold: parseFloat(rest.stockMinThreshold) || 0,
        minProductionQuantity: parseInt(rest.minProductionQuantity) || 0,
        shelfLifeDays: parseInt(rest.shelfLifeDays) || null,
        displayLifeHours: parseInt(rest.displayLifeHours) || null,
        isReexposable: rest.hasDLV,
        isRecyclable: rest.isRecyclable,
        ...(recipeId ? { recipeId } : {}),
      },
      imageFile
    );
  };

  const tabs: { key: FormTab; label: string; icon: React.ReactNode }[] = [
    { key: 'general', label: 'General', icon: <ShoppingBag size={16} /> },
    { key: 'production', label: 'Production', icon: <Factory size={16} /> },
    { key: 'lifecycle', label: 'Cycle de vie', icon: <Clock size={16} /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Modal header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {imagePreview ? (
              <img src={imagePreview} alt="" className="w-12 h-12 rounded-xl object-cover border border-gray-200" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-2xl">🥖</div>
            )}
            <div>
              <h2 className="text-lg font-bold text-gray-900">{product ? 'Modifier le produit' : 'Nouveau produit'}</h2>
              {product && <p className="text-xs text-gray-400 mt-0.5">{product.name as string}</p>}
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
              }`}>
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
                    <input type="number" step="0.01"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 font-bold"
                      value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="0.00" />
                  </div>
                </div>

                {/* Cost price + Responsible */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Prix de revient (DH)</label>
                    <input type="number" step="0.01"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="Optionnel" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                      <ChefHat size={14} className="text-amber-500" /> Responsable
                    </label>
                    <select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={form.responsibleUserId} onChange={(e) => setForm({ ...form, responsibleUserId: e.target.value })}>
                      <option value="">Aucun responsable</option>
                      {chefUsers.map((u: Record<string, unknown>) => (
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
                        <span className="text-sm font-bold text-gray-900">{parseFloat((product.stock_quantity as string) || '0')}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Seuil alerte</span>
                        <span className="text-sm font-bold text-gray-900">{parseFloat((product.stock_min_threshold as string) || '0')}</span>
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
                      <p className="text-xs text-purple-600 mt-0.5">Gérez la durée de conservation, d'exposition et les retours en fin de journée</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Duree de vie (jours)</label>
                    <input type="number" step="1" min="0"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={form.shelfLifeDays} onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })} placeholder="Ex: 7" />
                    <p className="text-xs text-gray-400 mt-1.5 ml-1">Depuis la production (stockable congele a -18C)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Duree d'exposition (heures)</label>
                    <input type="number" step="1" min="0"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      value={form.displayLifeHours} onChange={(e) => setForm({ ...form, displayLifeHours: e.target.value })} placeholder="Ex: 24" />
                    <p className="text-xs text-gray-400 mt-1.5 ml-1">Depuis le transfert en vitrine</p>
                  </div>
                </div>

                {/* DLV toggle */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                        <Eye size={18} className="text-green-600" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-gray-900">DLV</span>
                        <p className="text-xs text-gray-400">Peut etre conserve pour la vente le lendemain</p>
                      </div>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${form.hasDLV ? 'bg-green-500' : 'bg-gray-300'}`}
                      onClick={() => setForm({ ...form, hasDLV: !form.hasDLV })}>
                      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                        style={{ transform: form.hasDLV ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                    </div>
                  </div>
                </div>

                {/* Recyclable toggle */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center">
                        <span className="text-lg">♻️</span>
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-gray-900">Recyclable</span>
                        <p className="text-xs text-gray-400">Peut etre transforme en ingredient</p>
                      </div>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${form.isRecyclable ? 'bg-cyan-500' : 'bg-gray-300'}`}
                      onClick={() => setForm({ ...form, isRecyclable: !form.isRecyclable })}>
                      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                        style={{ transform: form.isRecyclable ? 'translateX(22px)' : 'translateX(0)', left: '2px' }} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer actions */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={isLoading}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2">
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enregistrement...
                </>
              ) : (
                'Enregistrer'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
