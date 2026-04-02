import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports.api';
import { format, subDays } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function ReportsPage() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: salesData = [] } = useQuery({
    queryKey: ['reports-sales', startDate, endDate],
    queryFn: () => reportsApi.sales(startDate, endDate),
  });

  const { data: productData = [] } = useQuery({
    queryKey: ['reports-products', startDate, endDate],
    queryFn: () => reportsApi.products(startDate, endDate),
  });

  const chartData = salesData.map((d: { date: string; orders: string; revenue: string }) => ({
    date: format(new Date(d.date), 'dd/MM'),
    commandes: parseInt(d.orders),
    revenue: parseFloat(d.revenue),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Rapports</h1>
        <div className="flex gap-3">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input w-auto" />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input w-auto" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Chiffre d'affaires</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: number) => `${value.toFixed(2)} €`} />
              <Line type="monotone" dataKey="revenue" stroke="#d98a35" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Commandes par jour</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="commandes" fill="#d98a35" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Performance des produits</h2>
        <table className="w-full">
          <thead className="border-b">
            <tr>
              <th className="text-left py-2 text-sm font-medium text-gray-500">Produit</th>
              <th className="text-left py-2 text-sm font-medium text-gray-500">Categorie</th>
              <th className="text-right py-2 text-sm font-medium text-gray-500">Vendus</th>
              <th className="text-right py-2 text-sm font-medium text-gray-500">Revenus</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {productData.map((p: { id: string; name: string; category: string; total_sold: string; total_revenue: string }) => (
              <tr key={p.id}>
                <td className="py-3 font-medium">{p.name}</td>
                <td className="py-3 text-sm text-gray-500">{p.category}</td>
                <td className="py-3 text-right">{p.total_sold}</td>
                <td className="py-3 text-right font-semibold text-primary-600">{parseFloat(p.total_revenue).toFixed(2)} €</td>
              </tr>
            ))}
          </tbody>
        </table>
        {productData.length === 0 && <p className="text-center py-8 text-gray-400">Aucune donnee pour cette periode</p>}
      </div>
    </div>
  );
}
