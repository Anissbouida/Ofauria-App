import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, Search, Pencil, Trash2, AlertTriangle, X, TrendingUp, Package, Recycle } from 'lucide-react';
import { packagingApi } from '../../api/packaging.api';
import { expenseCategoriesApi } from '../../api/accounting.api';
import CategoryCascadeSelector, { CONSUMABLE_ROOT_IDS } from '../../components/CategoryCascadeSelector';
import { notify } from '../../components/ui/InlineNotification';

interface PackagingItem {
  id: string;
  name: string;
  format: string | null;
  unit: string;
  unit_cost: string | number;
  supplier: string | null;
  category: string;
  category_id: string | null;
  category_name?: string | null;
  is_recyclable: boolean;
  is_compostable: boolean;
  is_food_safe: boolean;
  is_active: boolean;
  notes: string | null;
  stock_quantity?: string | number;
  stock_min_threshold?: string | number;
}

/** Construit les options de filtre (feuilles du référentiel) groupées par racine
 *  consommable. Une feuille = catégorie sans enfant. */
function useConsumableLeafOptions() {
  const { data: cats = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => expenseCategoriesApi.list(),
  });
  return useMemo(() => {
    const all = cats as Record<string, any>[];
    const hasChild = new Set(all.map(c => String(c.parent_id)).filter(Boolean));
    const rootOf = (c: Record<string, any>): string | null => {
      let cur: Record<string, any> | undefined = c;
      while (cur && cur.parent_id) cur = all.find(x => String(x.id) === String(cur!.parent_id));
      return cur ? String(cur.id) : null;
    };
    const rootName = (id: string) => all.find(c => String(c.id) === id)?.name as string | undefined;
    const groups = CONSUMABLE_ROOT_IDS.map(rid => ({
      rootId: rid,
      label: rootName(rid) || '',
      leaves: all
        .filter(c => !hasChild.has(String(c.id)) && rootOf(c) === rid)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    })).filter(g => g.leaves.length > 0);
    return groups;
  }, [cats]);
}

export default function PackagingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryIdFilter, setCategoryIdFilter] = useState<string>('');
  const [editingItem, setEditingItem] = useState<PackagingItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [stockDialog, setStockDialog] = useState<PackagingItem | null>(null);

  const leafGroups = useConsumableLeafOptions();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['packaging-items', search, categoryIdFilter],
    queryFn: () => packagingApi.list({
      search: search || undefined,
      categoryId: categoryIdFilter || undefined,
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => packagingApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packaging-items'] });
      notify.success('Consommable supprimé');
    },
    onError: () => notify.error('Erreur lors de la suppression'),
  });

  const totalItems = items.length;
  const totalLowStock = items.filter((it: PackagingItem) =>
    parseFloat(String(it.stock_quantity || 0)) <= parseFloat(String(it.stock_min_threshold || 0))
    && parseFloat(String(it.stock_min_threshold || 0)) > 0
  ).length;
  const totalRupture = items.filter((it: PackagingItem) =>
    parseFloat(String(it.stock_quantity || 0)) <= 0
  ).length;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        {!embedded ? (
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Package size={24} className="text-blue-600" /> Consommables
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Emballages, produits & matériel de nettoyage, petit matériel jetable...
            </p>
          </div>
        ) : <div />}
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
          <Plus size={16} /> Nouveau consommable
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-500 mb-1">Total consommables</div>
          <div className="text-2xl font-bold text-gray-800">{totalItems}</div>
        </div>
        <div className="bg-white rounded-xl border border-orange-100 p-4">
          <div className="text-xs text-orange-600 mb-1 flex items-center gap-1">
            <AlertTriangle size={12} /> Stock bas
          </div>
          <div className="text-2xl font-bold text-orange-700">{totalLowStock}</div>
        </div>
        <div className="bg-white rounded-xl border border-red-100 p-4">
          <div className="text-xs text-red-600 mb-1 flex items-center gap-1">
            <AlertTriangle size={12} /> Rupture
          </div>
          <div className="text-2xl font-bold text-red-700">{totalRupture}</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un consommable..."
            className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={categoryIdFilter} onChange={(e) => setCategoryIdFilter(e.target.value)}
          className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
          <option value="">Toutes les catégories</option>
          {leafGroups.map(g => (
            <optgroup key={g.rootId} label={g.label}>
              {g.leaves.map(leaf => (
                <option key={String(leaf.id)} value={String(leaf.id)}>{String(leaf.name)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <Box size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">Aucun consommable trouvé</p>
          <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium">
            Ajouter un premier consommable
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Article</th>
                <th className="text-left px-4 py-3">Categorie</th>
                <th className="text-left px-4 py-3">Format</th>
                <th className="text-right px-4 py-3">Cout unitaire</th>
                <th className="text-right px-4 py-3">Stock</th>
                <th className="text-left px-4 py-3">Fournisseur</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it: PackagingItem) => {
                const stock = parseFloat(String(it.stock_quantity || 0));
                const threshold = parseFloat(String(it.stock_min_threshold || 0));
                const isRupture = stock <= 0;
                const isLow = !isRupture && threshold > 0 && stock <= threshold;
                return (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 flex items-center gap-2">
                        {it.name}
                        {it.is_recyclable && <Recycle size={12} className="text-green-600" />}
                      </div>
                      {it.notes && <div className="text-xs text-gray-400 truncate max-w-xs">{it.notes}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {it.category_name ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-50 text-slate-700 border-slate-200">
                          {it.category_name}
                        </span>
                      ) : <span className="text-xs text-gray-300">Non catégorisé</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{it.format || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-700">
                      {parseFloat(String(it.unit_cost)).toFixed(2)} DH<span className="text-xs text-gray-400 ml-1">/ {it.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setStockDialog(it)}
                        className={`font-bold ${isRupture ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-gray-700'} hover:underline`}>
                        {stock.toFixed(0)} {it.unit}
                      </button>
                      {isRupture && <span className="block text-[10px] text-red-500 font-semibold">Rupture</span>}
                      {isLow && <span className="block text-[10px] text-orange-500 font-semibold">Stock bas</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{it.supplier || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setStockDialog(it)} title="Mouvement de stock"
                          className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600">
                          <TrendingUp size={14} />
                        </button>
                        <button onClick={() => setEditingItem(it)} title="Modifier"
                          className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => {
                          if (confirm(`Supprimer "${it.name}" ?`)) deleteMutation.mutate(it.id);
                        }} title="Supprimer"
                          className="p-1.5 hover:bg-red-50 rounded-lg text-red-400">
                          <Trash2 size={14} />
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

      {/* Modal create/edit */}
      {(showCreate || editingItem) && (
        <PackagingFormModal
          item={editingItem}
          onClose={() => { setShowCreate(false); setEditingItem(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['packaging-items'] });
            setShowCreate(false); setEditingItem(null);
          }}
        />
      )}

      {/* Modal mouvement stock */}
      {stockDialog && (
        <StockAdjustModal
          item={stockDialog}
          onClose={() => setStockDialog(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['packaging-items'] });
            setStockDialog(null);
          }}
        />
      )}
    </div>
  );
}

function PackagingFormModal({ item, onClose, onSaved }: { item: PackagingItem | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name || '',
    format: item?.format || '',
    unit: item?.unit || 'piece',
    unit_cost: String(item?.unit_cost || ''),
    supplier: item?.supplier || '',
    category_id: item?.category_id || '',
    is_recyclable: item?.is_recyclable ?? false,
    is_compostable: item?.is_compostable ?? false,
    is_food_safe: item?.is_food_safe ?? true,
    notes: item?.notes || '',
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) => isEdit
      ? packagingApi.update(item!.id, data)
      : packagingApi.create(data),
    onSuccess: () => {
      notify.success(isEdit ? 'Consommable mis à jour' : 'Consommable créé');
      onSaved();
    },
    onError: () => notify.error('Erreur lors de la sauvegarde'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...form,
      unit_cost: parseFloat(form.unit_cost) || 0,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Modifier consommable' : 'Nouveau consommable'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <form onSubmit={onSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nom</label>
            <input type="text" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Caissette alvéolée brownie"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Catégorie</label>
            <CategoryCascadeSelector
              value={form.category_id}
              onChange={(cid) => setForm({ ...form, category_id: cid })}
              rootIds={CONSUMABLE_ROOT_IDS}
              type="expense"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Format</label>
              <input type="text" value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value })}
                placeholder="24cm rond..."
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Unite</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500">
                <option value="piece">piece (unite)</option>
                <option value="m">m (metre)</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Cout unitaire (DH)</label>
              <input type="number" step="0.01" min="0" required value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                placeholder="0.30"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Fournisseur</label>
            <input type="text" value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              placeholder="Nom du fournisseur"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={form.is_recyclable}
                onChange={(e) => setForm({ ...form, is_recyclable: e.target.checked })} />
              Recyclable
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={form.is_compostable}
                onChange={(e) => setForm({ ...form, is_compostable: e.target.checked })} />
              Compostable
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={form.is_food_safe}
                onChange={(e) => setForm({ ...form, is_food_safe: e.target.checked })} />
              Food safe
            </label>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notes</label>
            <textarea value={form.notes} rows={2}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200">
              Annuler
            </button>
            <button type="submit" disabled={saveMutation.isPending}
              className="flex-1 py-2.5 px-4 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saveMutation.isPending ? 'Enregistrement...' : isEdit ? 'Mettre a jour' : 'Creer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StockAdjustModal({ item, onClose, onSaved }: { item: PackagingItem; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'reception' | 'adjustment' | 'waste'>('reception');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState(String(item.unit_cost || ''));
  const [note, setNote] = useState('');

  const adjustMutation = useMutation({
    mutationFn: () => packagingApi.adjustStock(item.id, {
      quantity: parseFloat(quantity) * (type === 'reception' ? 1 : type === 'waste' ? -1 : 1),
      type,
      note,
      unitCost: type === 'reception' ? parseFloat(unitCost) || undefined : undefined,
    }),
    onSuccess: () => {
      notify.success('Mouvement enregistre');
      onSaved();
    },
    onError: () => notify.error('Erreur'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Mouvement de stock</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <div className="text-sm font-semibold text-blue-900">{item.name}</div>
            <div className="text-xs text-blue-700">Stock actuel : {parseFloat(String(item.stock_quantity || 0)).toFixed(0)} {item.unit}</div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Type de mouvement</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: 'reception', label: '+ Reception', color: 'bg-green-100 text-green-700 border-green-300' },
                { v: 'adjustment', label: '± Ajustement', color: 'bg-blue-100 text-blue-700 border-blue-300' },
                { v: 'waste', label: '- Perte', color: 'bg-red-100 text-red-700 border-red-300' },
              ] as const).map(opt => (
                <button key={opt.v} type="button" onClick={() => setType(opt.v)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${type === opt.v ? opt.color + ' ring-2 ring-offset-1' : 'bg-white border-gray-200 text-gray-500'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Quantite</label>
            <input type="number" step="0.01" min="0" value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
          </div>

          {type === 'reception' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Prix unitaire (mise a jour catalogue)</label>
              <input type="number" step="0.01" min="0" value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Note</label>
            <input type="text" value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: BC-2026-XXX, ajustement inventaire..."
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200">
              Annuler
            </button>
            <button onClick={() => adjustMutation.mutate()}
              disabled={adjustMutation.isPending || !quantity}
              className="flex-1 py-2.5 px-4 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
