import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, ingredientsApi } from '../../api/inventory.api';
import { AlertTriangle, Plus, Package } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [showRestock, setShowRestock] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [showAddIngredient, setShowAddIngredient] = useState(false);

  const { data: inventory = [], isLoading } = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });
  const { data: alerts = [] } = useQuery({ queryKey: ['inventory-alerts'], queryFn: inventoryApi.alerts });

  const restockMutation = useMutation({
    mutationFn: inventoryApi.restock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
      setShowRestock(null); setRestockQty('');
      toast.success('Stock mis a jour');
    },
  });

  const addIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setShowAddIngredient(false);
      toast.success('Ingredient ajoute');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Inventaire</h1>
        <button onClick={() => setShowAddIngredient(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Ajouter un ingredient
        </button>
      </div>

      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="text-amber-500" size={20} />
          <span className="text-amber-800 font-medium">{alerts.length} ingredient(s) en stock bas !</span>
        </div>
      )}

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Ingredient</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Stock actuel</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Seuil minimum</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Fournisseur</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inventory.map((item: Record<string, unknown>) => {
                const isLow = parseFloat(item.current_quantity as string) <= parseFloat(item.minimum_threshold as string);
                return (
                  <tr key={item.id as string} className={`hover:bg-gray-50 ${isLow ? 'bg-red-50/50' : ''}`}>
                    <td className="px-6 py-4 flex items-center gap-2">
                      <Package size={16} className="text-gray-400" />
                      <span className="font-medium">{item.ingredient_name as string}</span>
                    </td>
                    <td className="px-6 py-4 text-sm">{parseFloat(item.current_quantity as string).toFixed(2)} {item.unit as string}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{parseFloat(item.minimum_threshold as string).toFixed(2)} {item.unit as string}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${isLow ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {isLow ? 'Stock bas' : 'OK'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{(item.supplier as string) || '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => setShowRestock(item.ingredient_id as string)} className="text-xs btn-primary py-1 px-3">Restocker</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {inventory.length === 0 && <p className="text-center py-8 text-gray-400">Aucun ingredient en stock</p>}
        </div>
      )}

      {showRestock && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold mb-4">Restocker</h2>
            <input type="number" step="0.01" placeholder="Quantite a ajouter" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} className="input mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setShowRestock(null)} className="btn-secondary flex-1">Annuler</button>
              <button onClick={() => restockMutation.mutate({ ingredientId: showRestock, quantity: parseFloat(restockQty) })} disabled={!restockQty} className="btn-primary flex-1">Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {showAddIngredient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Nouvel ingredient</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              addIngredientMutation.mutate({
                name: fd.get('name') as string,
                unit: fd.get('unit') as string,
                unitCost: parseFloat(fd.get('unitCost') as string),
                supplier: fd.get('supplier') as string || undefined,
              });
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Nom</label><input name="name" className="input" required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Unite</label>
                  <select name="unit" className="input">
                    <option value="kg">Kilogramme</option><option value="g">Gramme</option><option value="l">Litre</option><option value="ml">Millilitre</option><option value="unit">Unite</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Cout unitaire (DH)</label><input name="unitCost" type="number" step="0.0001" className="input" required /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Fournisseur</label><input name="supplier" className="input" /></div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowAddIngredient(false)} className="btn-secondary">Annuler</button>
                <button type="submit" className="btn-primary">Ajouter</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
