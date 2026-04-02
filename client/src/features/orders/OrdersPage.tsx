import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  preparing: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');

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
      <h1 className="text-2xl font-bold text-bakery-chocolate">Commandes</h1>

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
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Total</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Date</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((o: Record<string, unknown>) => (
                <tr key={o.id as string} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono text-sm font-medium">{o.order_number as string}</td>
                  <td className="px-6 py-4 text-sm">
                    {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name}` : 'Client de passage'}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold">{parseFloat(o.total as string).toFixed(2)} €</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[o.status as string]}`}>
                      {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {format(new Date(o.created_at as string), 'dd MMM yyyy HH:mm', { locale: fr })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {o.status === 'pending' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'preparing' })} className="text-xs btn-primary py-1 px-3">Preparer</button>
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
    </div>
  );
}
