import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../api/sales.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Receipt } from 'lucide-react';

export default function SalesPage() {
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data, isLoading } = useQuery({
    queryKey: ['sales', { dateFrom, dateTo }],
    queryFn: () => salesApi.list({ dateFrom, dateTo }),
  });

  const sales = data?.data || [];
  const totalRevenue = sales.reduce((sum: number, s: Record<string, unknown>) => sum + parseFloat(s.total as string), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Ventes</h1>
        <div className="flex gap-3 items-center">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input w-auto" />
          <span className="text-gray-400">a</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input w-auto" />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-sm text-gray-500">Nombre de ventes</p>
          <p className="text-2xl font-bold">{sales.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-gray-500">Chiffre d'affaires</p>
          <p className="text-2xl font-bold text-green-600">{totalRevenue.toFixed(2)} DH</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-gray-500">Panier moyen</p>
          <p className="text-2xl font-bold text-primary-600">{sales.length > 0 ? (totalRevenue / sales.length).toFixed(2) : '0.00'} DH</p>
        </div>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">N° Vente</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Client</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Caissier</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Paiement</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Total</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Heure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sales.map((s: Record<string, unknown>) => (
                <tr key={s.id as string} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <Receipt size={16} className="text-gray-400" />
                      {s.sale_number as string}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {s.customer_first_name ? `${s.customer_first_name} ${s.customer_last_name}` : 'Client de passage'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{s.cashier_first_name as string} {s.cashier_last_name as string}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                      {s.payment_method === 'cash' ? 'Especes' : s.payment_method === 'card' ? 'Carte' : 'Mobile'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold">{parseFloat(s.total as string).toFixed(2)} DH</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {format(new Date(s.created_at as string), 'HH:mm', { locale: fr })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales.length === 0 && <p className="text-center py-8 text-gray-400">Aucune vente pour cette periode</p>}
        </div>
      )}
    </div>
  );
}
