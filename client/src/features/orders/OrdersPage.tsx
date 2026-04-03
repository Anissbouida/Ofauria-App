import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { productsApi } from '../../api/products.api';
import { customersApi } from '../../api/customers.api';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { ClipboardList, Plus, Trash2, Search } from 'lucide-react';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  preparing: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

const typeLabels: Record<string, string> = {
  custom: 'Sur mesure',
  online: 'En ligne',
  event: 'Evenement',
};

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status: statusFilter }],
    queryFn: () => ordersApi.list({ status: statusFilter }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ordersApi.updateStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success('Statut mis a jour'); },
  });

  const orders = data?.data || [];
  const tabs = ['', 'pending', 'preparing', 'ready', 'completed', 'cancelled'];
  const tabLabels = ['Toutes', ...Object.values(ORDER_STATUS_LABELS)];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList size={28} className="text-bakery-chocolate" />
          <div>
            <h1 className="text-2xl font-bold text-bakery-chocolate">Commandes</h1>
            <p className="text-sm text-gray-500">Pre-commandes clients pour la production</p>
          </div>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouvelle commande
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === tab ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tabLabels[i]}
          </button>
        ))}
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">N° Commande</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Client</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Type</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Date de retrait</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Total</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((o: Record<string, unknown>) => (
                <tr key={o.id as string} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <ClipboardList size={16} className="text-gray-400" />
                      {o.order_number as string}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name}` : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                      {typeLabels[o.type as string] || o.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {o.pickup_date ? format(new Date(o.pickup_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold">{parseFloat(o.total as string).toFixed(2)} DH</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[o.status as string]}`}>
                      {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {o.status === 'pending' && (
                      <>
                        <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'preparing' })} className="text-xs btn-primary py-1 px-3">Preparer</button>
                        <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'cancelled' })} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 py-1 px-3 rounded-lg">Annuler</button>
                      </>
                    )}
                    {o.status === 'preparing' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'ready' })} className="text-xs btn-primary py-1 px-3">Pret</button>
                    )}
                    {o.status === 'ready' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'completed' })} className="text-xs btn-primary py-1 px-3">Terminer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="text-center py-8 text-gray-400">Aucune commande trouvee</p>}
        </div>
      )}

      {showForm && (
        <OrderFormModal
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['orders'] }); }}
        />
      )}
    </div>
  );
}

function OrderFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [pickupDate, setPickupDate] = useState(format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'));
  const [type, setType] = useState('custom');
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [items, setItems] = useState<{ productId: string; quantity: number; notes: string }[]>([
    { productId: '', quantity: 1, notes: '' },
  ]);

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '200' }),
  });
  const products = (productsData?.data || []) as Record<string, unknown>[];

  const { data: customersData } = useQuery({
    queryKey: ['customers-all'],
    queryFn: () => customersApi.list({ limit: '200' }),
  });
  const customers = (customersData?.data || []) as Record<string, unknown>[];

  const filteredCustomers = customerSearch
    ? customers.filter((c) => {
        const name = `${c.first_name} ${c.last_name}`.toLowerCase();
        const phone = (c.phone as string || '').toLowerCase();
        return name.includes(customerSearch.toLowerCase()) || phone.includes(customerSearch.toLowerCase());
      })
    : customers;

  const createMutation = useMutation({
    mutationFn: ordersApi.create,
    onSuccess: () => { toast.success('Commande creee avec succes'); onCreated(); },
    onError: () => { toast.error('Erreur lors de la creation'); },
  });

  const addItem = () => setItems([...items, { productId: '', quantity: 1, notes: '' }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: string | number) =>
    setItems(items.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const subtotal = items.reduce((sum, item) => {
    if (!item.productId) return sum;
    const prod = products.find((p) => p.id === item.productId);
    return sum + (prod ? parseFloat(prod.price as string) * item.quantity : 0);
  }, 0);
  const total = Math.max(0, subtotal - discountAmount);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) { toast.error('Selectionnez un client'); return; }
    const validItems = items.filter((it) => it.productId && it.quantity > 0);
    if (validItems.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    createMutation.mutate({
      customerId, type, pickupDate, paymentMethod, notes: notes || undefined,
      discountAmount,
      items: validItems.map((it) => ({ productId: it.productId, quantity: it.quantity, notes: it.notes || undefined })),
    });
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl flex flex-col" style={{ height: 'min(95vh, 850px)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-bakery-chocolate">Nouvelle pre-commande</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">
            {/* Client */}
            <div>
              <label className="block text-sm font-medium mb-2">Client</label>
              {selectedCustomer ? (
                <div className="flex items-center gap-3 p-3 bg-primary-50 border border-primary-200 rounded-xl">
                  <div className="flex-1">
                    <span className="font-medium">{selectedCustomer.first_name as string} {selectedCustomer.last_name as string}</span>
                    {selectedCustomer.phone && <span className="text-sm text-gray-500 ml-2">{selectedCustomer.phone as string}</span>}
                  </div>
                  <button type="button" onClick={() => setCustomerId('')}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium">Changer</button>
                </div>
              ) : (
                <div>
                  <div className="relative mb-2">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Rechercher un client par nom ou telephone..."
                      className="input pl-9 text-base py-2.5 w-full" />
                  </div>
                  <div className="max-h-32 overflow-y-auto border rounded-xl divide-y">
                    {filteredCustomers.slice(0, 10).map((c) => (
                      <button key={c.id as string} type="button" onClick={() => { setCustomerId(c.id as string); setCustomerSearch(''); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between">
                        <span className="font-medium text-sm">{c.first_name as string} {c.last_name as string}</span>
                        <span className="text-xs text-gray-400">{c.phone as string || ''}</span>
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <p className="px-4 py-3 text-sm text-gray-400 text-center">Aucun client trouve</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Date, type, paiement */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date de retrait</label>
                <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)}
                  className="input text-base py-2.5" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className="input text-base py-2.5">
                  <option value="custom">Sur mesure</option>
                  <option value="event">Evenement</option>
                  <option value="online">En ligne</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Paiement</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input text-base py-2.5">
                  <option value="cash">Especes</option>
                  <option value="card">Carte</option>
                  <option value="transfer">Virement</option>
                </select>
              </div>
            </div>

            {/* Produits */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Produits commandes</label>
                <button type="button" onClick={addItem}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                  <Plus size={14} /> Ajouter
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => {
                  const prod = products.find((p) => p.id === item.productId);
                  const lineTotal = prod ? parseFloat(prod.price as string) * item.quantity : 0;
                  return (
                    <div key={idx} className="flex gap-2 items-center bg-gray-50 rounded-xl p-2">
                      <select value={item.productId} onChange={(e) => updateItem(idx, 'productId', e.target.value)}
                        className="input flex-1 text-sm py-2" required>
                        <option value="">Selectionner...</option>
                        {products.map((p) => (
                          <option key={p.id as string} value={p.id as string}>
                            {p.name as string} — {parseFloat(p.price as string).toFixed(2)} DH
                          </option>
                        ))}
                      </select>
                      <input type="number" min="1" value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                        className="input w-20 text-center py-2" />
                      <span className="text-sm font-semibold w-20 text-right">{lineTotal.toFixed(2)} DH</span>
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(idx)}
                          className="p-1.5 text-red-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optionnel)</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="input text-base py-2.5 w-full" placeholder="Instructions speciales..." />
            </div>

            {/* Remise */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-500">Remise (DH)</label>
              <input type="number" min="0" step="0.01" value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                className="input w-28 py-2" />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="border-t px-5 py-4 shrink-0 rounded-b-2xl">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-500">
              Sous-total: <strong>{subtotal.toFixed(2)} DH</strong>
              {discountAmount > 0 && <span className="ml-3 text-red-500">Remise: -{discountAmount.toFixed(2)} DH</span>}
            </div>
            <div className="text-xl font-bold text-bakery-chocolate">{total.toFixed(2)} DH</div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5">Annuler</button>
            <button type="button" onClick={handleSubmit} disabled={createMutation.isPending}
              className="btn-primary flex-1 py-2.5 disabled:opacity-50">
              {createMutation.isPending ? 'Creation...' : 'Creer la commande'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
