import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Record<string, unknown> | null>(null);

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', { search, categoryId: categoryFilter }],
    queryFn: () => productsApi.list({ search, categoryId: categoryFilter, limit: '500' }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const deleteMutation = useMutation({
    mutationFn: productsApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); toast.success('Produit supprime'); },
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editingProduct ? productsApi.update(editingProduct.id as string, data) : productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(editingProduct ? 'Produit mis a jour' : 'Produit cree');
      setShowForm(false); setEditingProduct(null);
    },
  });

  const products = productsData?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Produits</h1>
        <button onClick={() => { setEditingProduct(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Ajouter un produit
        </button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input w-48">
          <option value="">Toutes les categories</option>
          {categories.map((c: { id: number; name: string }) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Chargement...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto" style={{ maxHeight: 'calc(100vh - 14rem)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Produit</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Categorie</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Prix</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {products.map((p: Record<string, unknown>) => (
                <tr key={p.id as string} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        <img src={p.image_url as string} alt="" className="w-10 h-10 rounded-lg object-contain" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center text-lg">🥖</div>
                      )}
                      <span className="font-medium">{p.name as string}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{p.category_name as string}</td>
                  <td className="px-6 py-4 text-sm font-semibold">{parseFloat(p.price as string).toFixed(2)} DH</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${p.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {p.is_available ? 'Disponible' : 'Indisponible'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => { setEditingProduct(p); setShowForm(true); }} className="p-2 hover:bg-gray-100 rounded-lg">
                      <Pencil size={16} className="text-gray-500" />
                    </button>
                    <button onClick={() => deleteMutation.mutate(p.id as string)} className="p-2 hover:bg-red-50 rounded-lg ml-1">
                      <Trash2 size={16} className="text-red-500" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {products.length === 0 && <p className="text-center py-8 text-gray-400">Aucun produit trouve</p>}
        </div>
      )}

      {showForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          onClose={() => { setShowForm(false); setEditingProduct(null); }}
          onSave={(data) => saveMutation.mutate(data)}
          isLoading={saveMutation.isPending}
        />
      )}
    </div>
  );
}

function ProductFormModal({ product, categories, onClose, onSave, isLoading }: {
  product: Record<string, unknown> | null;
  categories: { id: number; name: string }[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    name: (product?.name as string) || '',
    categoryId: (product?.category_id as number) || categories[0]?.id || 1,
    price: (product?.price as string) || '',
    costPrice: (product?.cost_price as string) || '',
    description: (product?.description as string) || '',
    isAvailable: product?.is_available !== false,
    isCustomOrderable: (product?.is_custom_orderable as boolean) || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...form, price: parseFloat(form.price), costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-4">{product ? 'Modifier le produit' : 'Nouveau produit'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nom</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Categorie</label>
              <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: parseInt(e.target.value) })}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Prix (DH)</label>
              <input type="number" step="0.01" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Prix de revient (DH)</label>
            <input type="number" step="0.01" className="input" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })} />
              <span className="text-sm">Disponible</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isCustomOrderable} onChange={(e) => setForm({ ...form, isCustomOrderable: e.target.checked })} />
              <span className="text-sm">Sur commande</span>
            </label>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="btn-primary">{isLoading ? 'Enregistrement...' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
