import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { suppliersApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import { Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX, Truck } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

const STATUS_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  envoye: 'Envoye',
  livre_complet: 'Livre (complet)',
  livre_partiel: 'Livre (partiel)',
  non_livre: 'Non livre',
  annule: 'Annule',
};
const STATUS_COLORS: Record<string, string> = {
  en_attente: 'bg-yellow-100 text-yellow-700',
  envoye: 'bg-blue-100 text-blue-700',
  livre_complet: 'bg-green-100 text-green-700',
  livre_partiel: 'bg-orange-100 text-orange-700',
  non_livre: 'bg-red-100 text-red-700',
  annule: 'bg-gray-100 text-gray-500',
};

type POItem = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  ingredient_unit: string;
  quantity_ordered: string;
  quantity_delivered: string;
  unit_price: string;
};

export default function PurchaseOrdersTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showDelivery, setShowDelivery] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => purchaseOrdersApi.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const { data: overdue = [] } = useQuery({
    queryKey: ['purchase-orders-overdue'],
    queryFn: () => purchaseOrdersApi.overdue(),
  });

  const sendMutation = useMutation({
    mutationFn: purchaseOrdersApi.send,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Bon envoye au fournisseur'); },
  });

  const cancelMutation = useMutation({
    mutationFn: purchaseOrdersApi.cancel,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Bon annule'); },
  });

  const deleteMutation = useMutation({
    mutationFn: purchaseOrdersApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Bon supprime'); },
  });

  const notDeliveredMutation = useMutation({
    mutationFn: purchaseOrdersApi.markNotDelivered,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Marque comme non livre'); },
  });

  const statuses = ['', 'en_attente', 'envoye', 'livre_partiel', 'livre_complet', 'non_livre', 'annule'];

  return (
    <div className="space-y-4">
      {/* Overdue alerts */}
      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-2">
            <AlertTriangle size={18} /> {overdue.length} bon(s) de commande en retard
          </div>
          <div className="space-y-1">
            {(overdue as Record<string, unknown>[]).map((po) => (
              <div key={po.id as string} className="text-sm text-red-600">
                <strong>{po.order_number as string}</strong> — {po.supplier_name as string} — Attendu le {po.expected_delivery_date ? format(new Date(po.expected_delivery_date as string), 'dd/MM/yyyy') : '—'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {statuses.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s === '' ? 'Tous' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouveau bon
        </button>
      </div>

      {/* Table */}
      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">N° Bon</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Fournisseur</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Livraison prevue</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Articles</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Montant</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(orders as Record<string, unknown>[]).map((po) => (
                <tr key={po.id as string} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-sm">{po.order_number as string}</td>
                  <td className="px-4 py-3 text-sm">{po.supplier_name as string}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {format(new Date(po.order_date as string), 'dd/MM/yyyy')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {po.expected_delivery_date ? format(new Date(po.expected_delivery_date as string), 'dd/MM/yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">{po.item_count as number}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">
                    {parseFloat(po.total_amount as string).toFixed(2)} DH
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[po.status as string] || ''}`}>
                      {STATUS_LABELS[po.status as string] || po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setShowDetail(po.id as string)} title="Voir details"
                        className="p-1.5 hover:bg-gray-100 rounded-lg"><Eye size={16} className="text-gray-500" /></button>
                      {po.status === 'en_attente' && (
                        <>
                          <button onClick={() => sendMutation.mutate(po.id as string)} title="Envoyer"
                            className="p-1.5 hover:bg-blue-50 rounded-lg"><Send size={16} className="text-blue-500" /></button>
                          <button onClick={() => { if (confirm('Supprimer ce bon ?')) deleteMutation.mutate(po.id as string); }}
                            title="Supprimer" className="p-1.5 hover:bg-red-50 rounded-lg">
                            <Trash2 size={16} className="text-red-500" /></button>
                        </>
                      )}
                      {(po.status === 'envoye' || po.status === 'livre_partiel') && (
                        <>
                          <button onClick={() => setShowDelivery(po.id as string)} title="Confirmer reception"
                            className="p-1.5 hover:bg-green-50 rounded-lg"><PackageCheck size={16} className="text-green-600" /></button>
                          <button onClick={() => notDeliveredMutation.mutate(po.id as string)} title="Non livre"
                            className="p-1.5 hover:bg-red-50 rounded-lg"><PackageX size={16} className="text-red-500" /></button>
                        </>
                      )}
                      {!['livre_complet', 'annule'].includes(po.status as string) && (
                        <button onClick={() => cancelMutation.mutate(po.id as string)} title="Annuler"
                          className="p-1.5 hover:bg-gray-100 rounded-lg"><Ban size={16} className="text-gray-400" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(orders as unknown[]).length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Truck size={40} className="mx-auto mb-3 opacity-50" />
              <p>Aucun bon de commande</p>
            </div>
          )}
        </div>
      )}

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
      {showDetail && <PODetailModal poId={showDetail} onClose={() => setShowDetail(null)} />}
      {showDelivery && <DeliveryModal poId={showDelivery} onClose={() => setShowDelivery(null)} />}
    </div>
  );
}

/* ═══ Create PO Modal ═══ */
function CreatePOModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ ingredientId: string; quantityOrdered: number; unitPrice: number }[]>([
    { ingredientId: '', quantityOrdered: 0, unitPrice: 0 },
  ]);

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });

  const createMutation = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Bon de commande cree');
      onClose();
    },
    onError: () => toast.error('Erreur lors de la creation'),
  });

  const addItem = () => setItems([...items, { ingredientId: '', quantityOrdered: 0, unitPrice: 0 }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: unknown) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const totalAmount = items.reduce((sum, it) => sum + it.quantityOrdered * it.unitPrice, 0);
  const validItems = items.filter((it) => it.ingredientId && it.quantityOrdered > 0);

  const handleSubmit = () => {
    if (!supplierId) { toast.error('Selectionnez un fournisseur'); return; }
    if (validItems.length === 0) { toast.error('Ajoutez au moins un article'); return; }
    createMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDate || undefined,
      notes: notes || undefined,
      items: validItems,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Nouveau bon de commande</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
              <option value="">-- Choisir --</option>
              {(suppliers as Record<string, unknown>[]).filter((s) => s.is_active !== false).map((s) => (
                <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date de livraison prevue</label>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="input" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="Notes optionnelles..." />
          </div>
        </div>

        {/* Items */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">Articles</h3>
            <button onClick={addItem} className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
              <Plus size={16} /> Ajouter un article
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="text-left py-2 font-medium text-gray-500">Ingredient</th>
                <th className="text-right py-2 font-medium text-gray-500 w-28">Quantite</th>
                <th className="text-right py-2 font-medium text-gray-500 w-32">Prix unitaire</th>
                <th className="text-right py-2 font-medium text-gray-500 w-28">Sous-total</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, idx) => {
                const ing = (ingredients as Record<string, unknown>[]).find((i) => i.id === item.ingredientId);
                return (
                  <tr key={idx}>
                    <td className="py-2 pr-2">
                      <select value={item.ingredientId} onChange={(e) => {
                        const selected = (ingredients as Record<string, unknown>[]).find((i) => i.id === e.target.value);
                        updateItem(idx, 'ingredientId', e.target.value);
                        if (selected && !item.unitPrice) updateItem(idx, 'unitPrice', parseFloat(selected.unit_cost as string) || 0);
                      }} className="input text-sm py-1.5">
                        <option value="">-- Ingredient --</option>
                        {(ingredients as Record<string, unknown>[]).map((i) => (
                          <option key={i.id as string} value={i.id as string}>{i.name as string} ({i.unit as string})</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-1">
                      <input type="number" min={0} step="0.01" value={item.quantityOrdered || ''}
                        onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                        className="input text-sm py-1.5 text-right" placeholder={ing ? `en ${ing.unit}` : ''} />
                    </td>
                    <td className="py-2 px-1">
                      <input type="number" min={0} step="0.01" value={item.unitPrice || ''}
                        onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="input text-sm py-1.5 text-right" placeholder="DH" />
                    </td>
                    <td className="py-2 text-right font-medium">{(item.quantityOrdered * item.unitPrice).toFixed(2)} DH</td>
                    <td className="py-2 text-right">
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="p-1 hover:bg-red-50 rounded">
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-right mt-3 text-lg font-bold text-gray-800">
            Total: {totalAmount.toFixed(2)} DH
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={handleSubmit} disabled={createMutation.isPending}
            className="btn-primary">{createMutation.isPending ? 'Creation...' : 'Creer le bon'}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ PO Detail Modal ═══ */
function PODetailModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  if (isLoading) return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white p-8 rounded-xl">Chargement...</div></div>;
  if (!po) return null;

  const items = (po.items || []) as POItem[];
  const totalOrdered = items.reduce((s, it) => s + parseFloat(it.quantity_ordered) * parseFloat(it.unit_price), 0);
  const totalDelivered = items.reduce((s, it) => s + parseFloat(it.quantity_delivered) * parseFloat(it.unit_price), 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">{po.order_number}</h2>
            <p className="text-sm text-gray-500">{po.supplier_name} — Cree par {po.created_by_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[po.status] || ''}`}>
              {STATUS_LABELS[po.status] || po.status}
            </span>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-500">Date commande</p>
            <p className="font-medium">{format(new Date(po.order_date), 'dd MMMM yyyy', { locale: fr })}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-500">Livraison prevue</p>
            <p className="font-medium">{po.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'dd MMMM yyyy', { locale: fr }) : '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-500">Date livraison</p>
            <p className="font-medium">{po.delivery_date ? format(new Date(po.delivery_date), 'dd MMMM yyyy', { locale: fr }) : '—'}</p>
          </div>
        </div>

        {po.notes && <p className="text-sm text-gray-600 mb-4 italic">{po.notes}</p>}

        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 font-medium text-gray-500">Ingredient</th>
              <th className="text-left py-2 font-medium text-gray-500">Unite</th>
              <th className="text-right py-2 font-medium text-gray-500">Commande</th>
              <th className="text-right py-2 font-medium text-gray-500">Livre</th>
              <th className="text-right py-2 font-medium text-gray-500">Prix</th>
              <th className="text-right py-2 font-medium text-gray-500">Progression</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => {
              const ordered = parseFloat(item.quantity_ordered);
              const delivered = parseFloat(item.quantity_delivered);
              const pct = ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0;
              return (
                <tr key={item.id}>
                  <td className="py-2 font-medium">{item.ingredient_name}</td>
                  <td className="py-2 text-gray-500">{item.ingredient_unit}</td>
                  <td className="py-2 text-right">{ordered}</td>
                  <td className="py-2 text-right font-medium">{delivered}</td>
                  <td className="py-2 text-right">{parseFloat(item.unit_price).toFixed(2)} DH</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex justify-between mt-4 pt-4 border-t text-sm font-semibold">
          <span>Total commande: {totalOrdered.toFixed(2)} DH</span>
          <span className="text-green-700">Total livre: {totalDelivered.toFixed(2)} DH</span>
        </div>
      </div>
    </div>
  );
}

/* ═══ Delivery Confirmation Modal ═══ */
function DeliveryModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  const [deliveries, setDeliveries] = useState<Record<string, number>>({});

  const confirmMutation = useMutation({
    mutationFn: (data: { items: { itemId: string; quantityDelivered: number }[] }) =>
      purchaseOrdersApi.confirmDelivery(poId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Livraison confirmee — stock mis a jour et facture creee');
      onClose();
    },
    onError: () => toast.error('Erreur lors de la confirmation'),
  });

  if (isLoading) return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white p-8 rounded-xl">Chargement...</div></div>;
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  const handleSubmit = () => {
    const deliveredItems = Object.entries(deliveries)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantityDelivered]) => ({ itemId, quantityDelivered }));
    if (deliveredItems.length === 0) { toast.error('Saisissez les quantites livrees'); return; }
    confirmMutation.mutate({ items: deliveredItems });
  };

  // Pre-fill with remaining quantities
  const fillAll = () => {
    const filled: Record<string, number> = {};
    items.forEach((item) => {
      const remaining = parseFloat(item.quantity_ordered) - parseFloat(item.quantity_delivered);
      if (remaining > 0) filled[item.id] = remaining;
    });
    setDeliveries(filled);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <PackageCheck size={22} className="text-green-600" /> Confirmer la reception
            </h2>
            <p className="text-sm text-gray-500">{po.order_number} — {po.supplier_name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="flex justify-end mb-3">
          <button onClick={fillAll} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            Remplir tout (livraison complete)
          </button>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 font-medium text-gray-500">Ingredient</th>
              <th className="text-right py-2 font-medium text-gray-500">Commande</th>
              <th className="text-right py-2 font-medium text-gray-500">Deja livre</th>
              <th className="text-right py-2 font-medium text-gray-500">Restant</th>
              <th className="text-right py-2 font-medium text-gray-500 w-32">Qte livree</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => {
              const ordered = parseFloat(item.quantity_ordered);
              const alreadyDelivered = parseFloat(item.quantity_delivered);
              const remaining = ordered - alreadyDelivered;
              return (
                <tr key={item.id} className={remaining <= 0 ? 'opacity-50' : ''}>
                  <td className="py-2 font-medium">{item.ingredient_name} <span className="text-gray-400">({item.ingredient_unit})</span></td>
                  <td className="py-2 text-right">{ordered}</td>
                  <td className="py-2 text-right text-green-600">{alreadyDelivered}</td>
                  <td className="py-2 text-right font-medium">{remaining > 0 ? remaining : <span className="text-green-600">✓</span>}</td>
                  <td className="py-2">
                    {remaining > 0 ? (
                      <input type="number" min={0} max={remaining} step="0.01"
                        value={deliveries[item.id] ?? ''}
                        onChange={(e) => setDeliveries({ ...deliveries, [item.id]: parseFloat(e.target.value) || 0 })}
                        className="input text-sm py-1.5 text-right w-full" placeholder="0" />
                    ) : <span className="text-sm text-gray-400 text-right block">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={handleSubmit} disabled={confirmMutation.isPending}
            className="btn-primary flex items-center gap-2">
            <PackageCheck size={18} /> {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer la reception'}
          </button>
        </div>
      </div>
    </div>
  );
}
