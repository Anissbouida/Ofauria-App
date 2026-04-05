import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { ClipboardList, Plus, Phone, Pencil } from 'lucide-react';
import OrderFormModal from '../../components/orders/OrderFormModal';

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  in_production: 'bg-yellow-100 text-yellow-700',
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
  const [editingOrder, setEditingOrder] = useState<Record<string, unknown> | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<Record<string, unknown> | null>(null);
  const [deliverAmount, setDeliverAmount] = useState('');
  const [deliverPayment, setDeliverPayment] = useState<'cash' | 'card'>('cash');

  const { data, isLoading } = useQuery({
    queryKey: ['orders', { status: statusFilter }],
    queryFn: () => ordersApi.list({ status: statusFilter }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ordersApi.updateStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success('Statut mis a jour'); },
  });

  const deliverMutation = useMutation({
    mutationFn: ({ id, amountPaid, paymentMethod }: { id: string; amountPaid: number; paymentMethod: string }) => ordersApi.deliver(id, { amountPaid, paymentMethod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setDeliverOrder(null);
      setDeliverAmount('');
      setDeliverPayment('cash');
      toast.success('Commande livree et vente enregistree !');
    },
    onError: () => toast.error('Erreur lors de la livraison'),
  });

  const orders = data?.data || [];
  const tabs = ['', 'pending', 'confirmed', 'in_production'];
  const tabLabels = ['Toutes', 'Brouillon', 'Confirmees', 'En production'];

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
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Avance</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((o: Record<string, unknown>) => {
                const advanceAmt = parseFloat((o.advance_amount as string) || '0');
                const totalAmt = parseFloat(o.total as string);
                const remaining = totalAmt - advanceAmt;
                return (
                  <tr key={o.id as string} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <ClipboardList size={16} className="text-gray-400" />
                        {o.order_number as string}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium">
                        {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name}` : '—'}
                      </div>
                      {o.customer_phone && (
                        <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Phone size={11} /> {o.customer_phone as string}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                        {typeLabels[o.type as string] || o.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {o.pickup_date ? format(new Date(o.pickup_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">{totalAmt.toFixed(2)} DH</td>
                    <td className="px-6 py-4 text-right">
                      {advanceAmt > 0 ? (
                        <div>
                          <div className="text-sm font-semibold text-green-600">{advanceAmt.toFixed(2)} DH</div>
                          <div className="text-xs text-gray-400">Reste: {remaining.toFixed(2)} DH</div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[o.status as string]}`}>
                        {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {/* Modifier: only pending or confirmed */}
                      {(o.status === 'pending' || o.status === 'confirmed') && (
                        <button onClick={() => setEditingOrder(o)}
                          className="text-xs bg-gray-50 text-gray-600 hover:bg-gray-100 py-1 px-3 rounded-lg inline-flex items-center gap-1">
                          <Pencil size={12} /> Modifier
                        </button>
                      )}
                      {/* Confirmer: pending → confirmed */}
                      {o.status === 'pending' && (
                        <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'confirmed' })}
                          className="text-xs btn-primary py-1 px-3">Confirmer</button>
                      )}
                      {/* Envoyer en production: confirmed → in_production */}
                      {o.status === 'confirmed' && (
                        <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'in_production' })}
                          className="text-xs bg-indigo-600 text-white hover:bg-indigo-700 py-1 px-3 rounded-lg">Envoyer en production</button>
                      )}
                      {/* Livrer: ready → completed (with remaining payment) */}
                      {o.status === 'ready' && (
                        <button onClick={() => { setDeliverOrder(o); setDeliverAmount(String((parseFloat(o.total as string) - parseFloat(o.advance_amount as string || '0')).toFixed(2))); }}
                          className="text-xs btn-primary py-1 px-3">Livrer</button>
                      )}
                      {/* Annuler: pending, confirmed or in_production */}
                      {(o.status === 'pending' || o.status === 'confirmed' || o.status === 'in_production') && (
                        <button onClick={() => { if (confirm('Voulez-vous vraiment annuler cette commande ?')) updateStatusMutation.mutate({ id: o.id as string, status: 'cancelled' }); }}
                          className="text-xs bg-red-50 text-red-600 hover:bg-red-100 py-1 px-3 rounded-lg">Annuler</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 0 && <p className="text-center py-8 text-gray-400">Aucune commande trouvee</p>}
        </div>
      )}

      {showForm && (
        <OrderFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['orders'] }); }}
        />
      )}

      {editingOrder && (
        <OrderFormModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => { setEditingOrder(null); queryClient.invalidateQueries({ queryKey: ['orders'] }); }}
        />
      )}

      {/* Deliver modal */}
      {deliverOrder && (() => {
        const totalAmt = parseFloat(deliverOrder.total as string);
        const advanceAmt = parseFloat(deliverOrder.advance_amount as string || '0');
        const remaining = totalAmt - advanceAmt;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
              <h2 className="text-xl font-bold mb-4">Livraison de commande</h2>
              <p className="text-sm text-gray-500 mb-1">Commande {deliverOrder.order_number as string}</p>
              {deliverOrder.customer_first_name && (
                <p className="text-sm text-gray-500 mb-4">Client : {deliverOrder.customer_first_name as string} {deliverOrder.customer_last_name as string}</p>
              )}

              <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total commande</span>
                  <span className="font-semibold">{totalAmt.toFixed(2)} DH</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Avance versee</span>
                  <span className="font-semibold text-green-600">{advanceAmt.toFixed(2)} DH</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-2 text-base">
                  <span>Reste a payer</span>
                  <span className="text-primary-600">{remaining.toFixed(2)} DH</span>
                </div>
              </div>

              <label className="block text-sm font-medium text-gray-700 mb-2">Montant encaisse (DH)</label>
              <input type="number" value={deliverAmount} onChange={(e) => setDeliverAmount(e.target.value)}
                className="input text-center text-xl font-bold mb-4" min="0" step="0.01" autoFocus />

              <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {(['cash', 'card'] as const).map(m => (
                  <button key={m} onClick={() => setDeliverPayment(m)}
                    className={`py-2 rounded-xl text-sm font-medium transition-colors ${deliverPayment === m ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {m === 'cash' ? 'Especes' : 'Carte bancaire'}
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setDeliverOrder(null); setDeliverAmount(''); }} className="btn-secondary flex-1">Annuler</button>
                <button onClick={() => deliverMutation.mutate({ id: deliverOrder.id as string, amountPaid: parseFloat(deliverAmount) || 0, paymentMethod: deliverPayment })}
                  disabled={deliverMutation.isPending} className="btn-primary flex-1">
                  {deliverMutation.isPending ? 'En cours...' : 'Confirmer la livraison'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
