import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { usersApi } from '../../api/users.api';
import { Plus, Pencil, Trash2, Search, Upload, X, Camera, ChefHat, Package, AlertTriangle } from 'lucide-react';
import { ROLE_LABELS } from '@ofauria/shared';
import type { Role } from '@ofauria/shared';
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
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Responsable</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Prix</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Stock</th>
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
                  <td className="px-6 py-4">
                    {p.responsible_first_name ? (
                      <div className="flex items-center gap-1.5">
                        <ChefHat size={14} className="text-amber-500" />
                        <span className="text-sm text-gray-700">{p.responsible_first_name as string} {(p.responsible_last_name as string)?.[0]}.</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold">{parseFloat(p.price as string).toFixed(2)} DH</td>
                  <td className="px-6 py-4">
                    {(() => {
                      const stock = parseFloat((p.stock_quantity as string) || '0');
                      const threshold = parseFloat((p.stock_min_threshold as string) || '0');
                      const isLow = threshold > 0 && stock <= threshold;
                      const isOut = stock <= 0;
                      return (
                        <div className="flex items-center gap-1.5">
                          {isOut ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 flex items-center gap-1">
                              <AlertTriangle size={12} /> Rupture
                            </span>
                          ) : isLow ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 flex items-center gap-1">
                              <AlertTriangle size={12} /> {stock}
                            </span>
                          ) : (
                            <span className="text-sm font-medium text-gray-700">{stock}</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
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
          onSave={(data, imageFile) => saveMutation.mutate({ data, imageFile })}
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
  onSave: (data: Record<string, unknown>, imageFile?: File | null) => void;
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
    responsibleUserId: (product?.responsible_user_id as string) || '',
    stockMinThreshold: (product?.stock_min_threshold as string) || '0',
  });

  // Fetch users (chefs) for the responsible selector
  const { data: allUsers = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const chefRoles = ['baker', 'pastry_chef', 'viennoiserie'];
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
      // Attach stream after state update renders the video element
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

  // Cleanup camera on unmount
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
    onSave(
      {
        ...form,
        price: parseFloat(form.price),
        costPrice: form.costPrice ? parseFloat(form.costPrice) : undefined,
        responsibleUserId: form.responsibleUserId || null,
        stockMinThreshold: parseFloat(form.stockMinThreshold) || 0,
      },
      imageFile
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">{product ? 'Modifier le produit' : 'Nouveau produit'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Image upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Photo du produit</label>
            <div className="flex items-center gap-4">
              {imagePreview ? (
                <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-200 shrink-0">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={removeImage}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 shadow-sm"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-3 shrink-0">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
                  >
                    <Upload size={20} className="text-gray-400 mb-1" />
                    <span className="text-xs text-gray-400">Galerie</span>
                  </div>
                  <div
                    onClick={startCamera}
                    className="w-24 h-24 rounded-xl border-2 border-dashed border-blue-300 flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  >
                    <Camera size={20} className="text-blue-400 mb-1" />
                    <span className="text-xs text-blue-400">Camera</span>
                  </div>
                </div>
              )}
              <div className="text-xs text-gray-400 space-y-1">
                <p>Formats : JPG, PNG, WebP</p>
                <p>Taille max : 5 Mo</p>
                {imagePreview && (
                  <div className="flex gap-3">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="text-primary-600 hover:underline font-medium">
                      Galerie
                    </button>
                    <button type="button" onClick={startCamera} className="text-blue-600 hover:underline font-medium">
                      Camera
                    </button>
                  </div>
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageChange}
              className="hidden"
            />

            {/* Camera live view */}
            {showCamera && (
              <div className="fixed inset-0 bg-black z-[60] flex flex-col">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="flex-1 object-cover w-full"
                />
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-6 pb-8 pt-4 bg-gradient-to-t from-black/70">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                  >
                    <X size={28} />
                  </button>
                  <button
                    type="button"
                    onClick={takePhoto}
                    className="w-20 h-20 rounded-full border-4 border-white bg-white/30 backdrop-blur flex items-center justify-center hover:bg-white/50 transition-colors"
                  >
                    <div className="w-14 h-14 rounded-full bg-white" />
                  </button>
                  <div className="w-14" />
                </div>
              </div>
            )}
          </div>

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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Prix de revient (DH)</label>
              <input type="number" step="0.01" className="input" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 flex items-center gap-1.5">
                <ChefHat size={14} className="text-amber-500" /> Responsable
              </label>
              <select
                className="input"
                value={form.responsibleUserId}
                onChange={(e) => setForm({ ...form, responsibleUserId: e.target.value })}
              >
                <option value="">Aucun responsable</option>
                {chefUsers.map((u: Record<string, unknown>) => (
                  <option key={u.id as string} value={u.id as string}>
                    {u.firstName as string} {u.lastName as string} — {ROLE_LABELS[(u.role as Role)] || u.role}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 flex items-center gap-1.5">
              <Package size={14} className="text-blue-500" /> Seuil d'alerte stock
            </label>
            <input type="number" step="1" min="0" className="input" value={form.stockMinThreshold}
              onChange={(e) => setForm({ ...form, stockMinThreshold: e.target.value })}
              placeholder="0 = pas d'alerte" />
            <p className="text-xs text-gray-400 mt-1">Alerte quand le stock descend en dessous de ce seuil</p>
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
