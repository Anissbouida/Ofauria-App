import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../api/sales.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import { returnsApi } from '../../api/returns.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Receipt, Lock, AlertTriangle, CheckCircle, XCircle, LayoutGrid, ShoppingBag, User, CreditCard, FileText, Download, Eye, RotateCcw, ArrowLeftRight } from 'lucide-react';
import DateRangePicker from '../../components/DateRangePicker';
import ReceiptModal from '../pos/ReceiptModal';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur', manager: 'Gerant', cashier: 'Caissier', baker: 'Boulanger',
  pastry_chef: 'Patissier', viennoiserie: 'Viennoiserie', saleswoman: 'Vendeuse',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Especes', card: 'Carte bancaire',
};

type SalesView = 'receipt' | 'category' | 'product' | 'cashier' | 'payment';

const viewTabs: { key: SalesView; label: string; icon: typeof Receipt }[] = [
  { key: 'receipt', label: 'Par recu', icon: FileText },
  { key: 'category', label: 'Par categorie', icon: LayoutGrid },
  { key: 'product', label: 'Par article', icon: ShoppingBag },
  { key: 'cashier', label: 'Par vendeuse', icon: User },
  { key: 'payment', label: 'Par paiement', icon: CreditCard },
];

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '\uFEFF';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function SalesPage() {
  const [mainTab, setMainTab] = useState<'sales' | 'sessions' | 'returns'>('sales');
  const [view, setView] = useState<SalesView>('receipt');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [receiptData, setReceiptData] = useState<{
    saleNumber: string; date: string; cashierName: string; customerName?: string;
    items: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
    subtotal: number; discountAmount: number; total: number; paymentMethod: string;
  } | null>(null);

  const openReceipt = async (saleId: string) => {
    const sale = await salesApi.getById(saleId);
    if (!sale) return;
    setReceiptData({
      saleNumber: sale.sale_number,
      date: sale.created_at,
      cashierName: `${sale.cashier_first_name} ${sale.cashier_last_name}`,
      customerName: sale.customer_first_name ? `${sale.customer_first_name} ${sale.customer_last_name}` : undefined,
      items: (sale.items || []).map((item: Record<string, unknown>) => ({
        name: item.product_name as string,
        quantity: item.quantity as number,
        unitPrice: parseFloat(item.unit_price as string),
        subtotal: parseFloat(item.subtotal as string),
      })),
      subtotal: parseFloat(sale.subtotal),
      discountAmount: parseFloat(sale.discount_amount),
      total: parseFloat(sale.total),
      paymentMethod: sale.payment_method,
    });
  };

  // Receipt list query
  const { data, isLoading } = useQuery({
    queryKey: ['sales', { dateFrom, dateTo }],
    queryFn: () => salesApi.list({ dateFrom, dateTo, limit: '500' }),
    enabled: mainTab === 'sales' && view === 'receipt',
  });

  // Summary query (grouped views)
  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['sales-summary', { dateFrom, dateTo, groupBy: view }],
    queryFn: () => salesApi.summary({ dateFrom, dateTo, groupBy: view }),
    enabled: mainTab === 'sales' && view !== 'receipt',
  });

  // Sessions query
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['cash-register-sessions', { dateFrom, dateTo }],
    queryFn: () => cashRegisterApi.list({ dateFrom, dateTo }),
    enabled: mainTab === 'sessions',
  });

  // Returns query
  const { data: returnsData, isLoading: returnsLoading } = useQuery({
    queryKey: ['returns', { dateFrom, dateTo }],
    queryFn: () => returnsApi.list({ dateFrom, dateTo, limit: '500' }),
    enabled: mainTab === 'returns',
  });

  const sales = data?.data || [];
  const summary = summaryData || [];
  const sessions = sessionsData?.data || [];
  const returns = returnsData?.data || [];

  // Also fetch returns for the same period when viewing sales (to subtract from totals)
  const { data: salesReturnsData } = useQuery({
    queryKey: ['returns-for-sales', { dateFrom, dateTo }],
    queryFn: () => returnsApi.list({ dateFrom, dateTo, limit: '500' }),
    enabled: mainTab === 'sales',
  });
  const salesReturns = salesReturnsData?.data || [];
  const totalRefunds = salesReturns
    .filter((r: Record<string, unknown>) => r.type === 'return')
    .reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(r.refund_amount as string), 0);
  const handleExport = () => {
    const date = `${dateFrom}_${dateTo}`;
    if (mainTab === 'sessions') {
      exportCSV(`sessions_${date}.csv`,
        ['Employe', 'Ouverture', 'Fermeture', 'Fond de caisse', 'CA ventes', 'Avances', 'Montant attendu', 'Montant saisi', 'Ecart', 'Statut'],
        sessions.map((s: Record<string, unknown>) => [
          `${s.first_name} ${s.last_name}`,
          format(new Date(s.opened_at as string), 'dd/MM/yyyy HH:mm'),
          s.closed_at ? format(new Date(s.closed_at as string), 'dd/MM/yyyy HH:mm') : '',
          parseFloat(s.opening_amount as string).toFixed(2),
          parseFloat(s.total_revenue as string).toFixed(2),
          parseFloat(s.total_advances as string || '0').toFixed(2),
          s.expected_cash ? parseFloat(s.expected_cash as string).toFixed(2) : '',
          s.actual_amount ? parseFloat(s.actual_amount as string).toFixed(2) : '',
          s.difference !== null ? parseFloat(s.difference as string).toFixed(2) : '',
          s.status === 'closed' ? 'Ferme' : 'En cours',
        ])
      );
      return;
    }
    if (view === 'receipt') {
      exportCSV(`ventes_recus_${date}.csv`,
        ['N° Vente', 'Client', 'Caissier', 'Paiement', 'Total (DH)', 'Date/Heure'],
        sales.map((s: Record<string, unknown>) => [
          s.sale_number as string,
          s.customer_first_name ? `${s.customer_first_name} ${s.customer_last_name}` : 'Client de passage',
          `${s.cashier_first_name} ${s.cashier_last_name}`,
          PAYMENT_LABELS[s.payment_method as string] || (s.payment_method as string),
          parseFloat(s.total as string).toFixed(2),
          format(new Date(s.created_at as string), 'dd/MM/yyyy HH:mm'),
        ])
      );
    } else if (view === 'category') {
      exportCSV(`ventes_categories_${date}.csv`,
        ['Categorie', 'Articles vendus', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, unknown>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, r.total_quantity as string, r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'product') {
      exportCSV(`ventes_articles_${date}.csv`,
        ['Article', 'Categorie', 'Qte vendue', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, unknown>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, (r.category_name as string) || '', r.total_quantity as string, r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'cashier') {
      exportCSV(`ventes_vendeuses_${date}.csv`,
        ['Vendeuse / Caissier', 'Role', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, unknown>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, ROLE_LABELS[r.role as string] || (r.role as string), r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'payment') {
      exportCSV(`ventes_paiement_${date}.csv`,
        ['Mode de paiement', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, unknown>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [PAYMENT_LABELS[r.label as string] || (r.label as string), r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    }
  };

  const grossRevenue = view === 'receipt'
    ? sales.reduce((sum: number, s: Record<string, unknown>) => sum + parseFloat(s.total as string), 0)
    : summary.reduce((sum: number, s: Record<string, unknown>) => sum + parseFloat(s.total_revenue as string || '0'), 0);
  // For receipt view subtract refunds; for grouped views refunds are already subtracted by backend
  const totalRevenue = view === 'receipt' ? grossRevenue - totalRefunds : grossRevenue;
  const totalCount = view === 'receipt'
    ? sales.length
    : summary.reduce((sum: number, s: Record<string, unknown>) => sum + parseInt(s.sale_count as string || '0'), 0);
  const returnsCount = salesReturns.filter((r: Record<string, unknown>) => r.type === 'return').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Ventes</h1>
        <div className="flex items-center gap-3">
          <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
            <Download size={16} />
            Exporter
          </button>
        </div>
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button onClick={() => setMainTab('sales')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mainTab === 'sales' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Ventes
        </button>
        <button onClick={() => setMainTab('returns')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mainTab === 'returns' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Retours & Echanges
        </button>
        <button onClick={() => setMainTab('sessions')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mainTab === 'sessions' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Periode du travail
        </button>
      </div>

      {mainTab === 'returns' ? (
        /* ═══ Returns & Exchanges tab ═══ */
        returnsLoading ? <p className="text-gray-500">Chargement...</p> : (
          <>
            {/* Returns summary cards */}
            {(() => {
              const totalReturns = returns.filter((r: Record<string, unknown>) => r.type === 'return').length;
              const totalExchanges = returns.filter((r: Record<string, unknown>) => r.type === 'exchange').length;
              const totalRefund = returns
                .filter((r: Record<string, unknown>) => r.type === 'return')
                .reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(r.refund_amount as string), 0);
              return (
                <div className="grid grid-cols-3 gap-4">
                  <div className="card text-center">
                    <p className="text-sm text-gray-500">Total operations</p>
                    <p className="text-2xl font-bold">{returns.length}</p>
                  </div>
                  <div className="card text-center">
                    <div className="flex items-center justify-center gap-4">
                      <div>
                        <p className="text-sm text-gray-500">Retours</p>
                        <p className="text-2xl font-bold text-red-600">{totalReturns}</p>
                      </div>
                      <div className="w-px h-8 bg-gray-200" />
                      <div>
                        <p className="text-sm text-gray-500">Echanges</p>
                        <p className="text-2xl font-bold text-blue-600">{totalExchanges}</p>
                      </div>
                    </div>
                  </div>
                  <div className="card text-center">
                    <p className="text-sm text-gray-500">Total rembourse</p>
                    <p className="text-2xl font-bold text-red-600">{totalRefund.toFixed(2)} DH</p>
                  </div>
                </div>
              );
            })()}

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">N° Retour</th>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Vente originale</th>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Type</th>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Articles</th>
                    <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Montant</th>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Caissier</th>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Date</th>
                    <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Motif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {returns.map((r: Record<string, unknown>) => {
                    const items = (r.items || []) as Record<string, unknown>[];
                    return (
                      <tr key={r.id as string} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-mono text-sm font-medium">
                          <div className="flex items-center gap-2">
                            {r.type === 'return' ? (
                              <RotateCcw size={16} className="text-red-400" />
                            ) : (
                              <ArrowLeftRight size={16} className="text-blue-400" />
                            )}
                            {r.return_number as string}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-gray-600">{r.original_sale_number as string}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            r.type === 'return' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {r.type === 'return' ? 'Retour' : 'Echange'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {items.map((it, idx) => (
                            <div key={idx} className="text-gray-600">
                              {it.product_name as string} <span className="text-gray-400">x{it.quantity as number}</span>
                            </div>
                          ))}
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-red-600">
                          {parseFloat(r.refund_amount as string).toFixed(2)} DH
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {r.user_first_name as string} {r.user_last_name as string}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {format(new Date(r.created_at as string), 'dd/MM HH:mm', { locale: fr })}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-[200px] truncate">
                          {(r.reason as string) || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {returns.length === 0 && <p className="text-center py-8 text-gray-400">Aucun retour ou echange pour cette periode</p>}
            </div>
          </>
        )
      ) : mainTab === 'sales' ? (
        <>
          {/* View tabs */}
          <div className="flex gap-2 flex-wrap">
            {viewTabs.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => setView(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    view === t.key ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  <Icon size={15} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Summary cards */}
          <div className={`grid gap-4 ${totalRefunds > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Nombre de ventes</p>
              <p className="text-2xl font-bold">{totalCount}</p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Chiffre d'affaires net</p>
              <p className="text-2xl font-bold text-green-600">{totalRevenue.toFixed(2)} DH</p>
              {totalRefunds > 0 && (
                <p className="text-xs text-gray-400 mt-1">Brut: {grossRevenue.toFixed(2)} DH</p>
              )}
            </div>
            {totalRefunds > 0 && (
              <div className="card text-center">
                <p className="text-sm text-gray-500">Retours</p>
                <p className="text-2xl font-bold text-red-600">-{totalRefunds.toFixed(2)} DH</p>
                <p className="text-xs text-gray-400 mt-1">{returnsCount} retour{returnsCount > 1 ? 's' : ''}</p>
              </div>
            )}
            <div className="card text-center">
              <p className="text-sm text-gray-500">Panier moyen</p>
              <p className="text-2xl font-bold text-primary-600">{totalCount > 0 ? (totalRevenue / totalCount).toFixed(2) : '0.00'} DH</p>
            </div>
          </div>

          {/* ═══ Receipt view ═══ */}
          {view === 'receipt' && (
            isLoading ? <p className="text-gray-500">Chargement...</p> : (
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
                      <th className="text-center px-6 py-3 text-sm font-medium text-gray-500">Action</th>
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
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {PAYMENT_LABELS[s.payment_method as string] || s.payment_method}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-semibold">{parseFloat(s.total as string).toFixed(2)} DH</td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {format(new Date(s.created_at as string), 'HH:mm', { locale: fr })}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => openReceipt(s.id as string)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors">
                            <Eye size={14} /> Recu
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sales.length === 0 && <p className="text-center py-8 text-gray-400">Aucune vente pour cette periode</p>}
              </div>
            )
          )}

          {/* ═══ Category view ═══ */}
          {view === 'category' && (
            summaryLoading ? <p className="text-gray-500">Chargement...</p> : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Categorie</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Articles vendus</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Nb ventes</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">CA</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">% du CA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {summary.map((row: Record<string, unknown>) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <LayoutGrid size={16} className="text-primary-400" />
                              <span className="font-medium">{row.label as string}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">{row.total_quantity as string}</td>
                          <td className="px-6 py-4 text-right text-gray-500">{row.sale_count as string}</td>
                          <td className="px-6 py-4 text-right font-semibold">{rev.toFixed(2)} DH</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm text-gray-500">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {summary.length === 0 && <p className="text-center py-8 text-gray-400">Aucune donnee pour cette periode</p>}
              </div>
            )
          )}

          {/* ═══ Product view ═══ */}
          {view === 'product' && (
            summaryLoading ? <p className="text-gray-500">Chargement...</p> : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Article</th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Categorie</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Qte vendue</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Nb ventes</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">CA</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">% du CA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {summary.map((row: Record<string, unknown>) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <span className="font-medium">{row.label as string}</span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">{row.category_name as string || '—'}</td>
                          <td className="px-6 py-4 text-right font-semibold">{row.total_quantity as string}</td>
                          <td className="px-6 py-4 text-right text-gray-500">{row.sale_count as string}</td>
                          <td className="px-6 py-4 text-right font-semibold">{rev.toFixed(2)} DH</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm text-gray-500">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {summary.length === 0 && <p className="text-center py-8 text-gray-400">Aucune donnee pour cette periode</p>}
              </div>
            )
          )}

          {/* ═══ Cashier view ═══ */}
          {view === 'cashier' && (
            summaryLoading ? <p className="text-gray-500">Chargement...</p> : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Vendeuse / Caissier</th>
                      <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Role</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Nb ventes</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">CA</th>
                      <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">% du CA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {summary.map((row: Record<string, unknown>) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold">
                                {(row.label as string).charAt(0)}
                              </div>
                              <span className="font-medium">{row.label as string}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">{ROLE_LABELS[row.role as string] || row.role}</td>
                          <td className="px-6 py-4 text-right">{row.sale_count as string}</td>
                          <td className="px-6 py-4 text-right font-semibold">{rev.toFixed(2)} DH</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm text-gray-500">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {summary.length === 0 && <p className="text-center py-8 text-gray-400">Aucune donnee pour cette periode</p>}
              </div>
            )
          )}

          {/* ═══ Payment view ═══ */}
          {view === 'payment' && (
            summaryLoading ? <p className="text-gray-500">Chargement...</p> : (
              <div className="grid grid-cols-3 gap-4">
                {summary.map((row: Record<string, unknown>) => {
                  const rev = parseFloat(row.total_revenue as string);
                  const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                  const label = PAYMENT_LABELS[row.label as string] || row.label;
                  const colors: Record<string, { bg: string; text: string; bar: string }> = {
                    cash: { bg: 'bg-green-50', text: 'text-green-700', bar: 'bg-green-500' },
                    card: { bg: 'bg-blue-50', text: 'text-blue-700', bar: 'bg-blue-500' },
                  };
                  const c = colors[row.label as string] || { bg: 'bg-gray-50', text: 'text-gray-700', bar: 'bg-gray-500' };
                  return (
                    <div key={row.label as string} className={`${c.bg} rounded-xl p-6 border`}>
                      <div className="flex items-center gap-2 mb-4">
                        <CreditCard size={20} className={c.text} />
                        <h3 className={`text-lg font-bold ${c.text}`}>{label as string}</h3>
                      </div>
                      <p className="text-3xl font-bold mb-1">{rev.toFixed(2)} DH</p>
                      <p className="text-sm text-gray-500 mb-3">{row.sale_count as string} vente{parseInt(row.sale_count as string) > 1 ? 's' : ''}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 bg-white/50 rounded-full overflow-hidden">
                          <div className={`h-full ${c.bar} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-semibold">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
                {summary.length === 0 && (
                  <div className="col-span-3">
                    <p className="text-center py-8 text-gray-400">Aucune donnee pour cette periode</p>
                  </div>
                )}
              </div>
            )
          )}
        </>
      ) : (
        /* ═══ Sessions tab ═══ */
        sessionsLoading ? <p className="text-gray-500">Chargement...</p> : (
          <div className="space-y-4">
            {sessions.length === 0 && <p className="text-center py-8 text-gray-400">Aucune fermeture de caisse pour cette periode</p>}
            {sessions.map((s: Record<string, unknown>) => {
              const diff = s.difference !== null ? parseFloat(s.difference as string) : null;
              const isClosed = s.status === 'closed';
              return (
                <div key={s.id as string} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isClosed ? 'bg-gray-100' : 'bg-green-100'}`}>
                        <Lock size={18} className={isClosed ? 'text-gray-500' : 'text-green-600'} />
                      </div>
                      <div>
                        <p className="font-semibold">{s.first_name as string} {s.last_name as string}</p>
                        <p className="text-sm text-gray-500">
                          {format(new Date(s.opened_at as string), 'dd/MM/yyyy HH:mm', { locale: fr })}
                          {s.closed_at && <> — {format(new Date(s.closed_at as string), 'HH:mm', { locale: fr })}</>}
                        </p>
                      </div>
                    </div>
                    {isClosed && diff !== null && (
                      <div>
                        {diff === 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-green-50 text-green-700">
                            <CheckCircle size={16} /> Juste
                          </span>
                        ) : diff > 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-blue-50 text-blue-700">
                            <AlertTriangle size={16} /> +{diff.toFixed(2)} DH
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-50 text-red-700">
                            <XCircle size={16} /> {diff.toFixed(2)} DH
                          </span>
                        )}
                      </div>
                    )}
                    {!isClosed && (
                      <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-50 text-yellow-700">En cours</span>
                    )}
                  </div>

                  {isClosed && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Fond de caisse</p>
                        <p className="font-semibold">{parseFloat(s.opening_amount as string).toFixed(2)} DH</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">CA ventes</p>
                        <p className="font-semibold text-green-600">{parseFloat(s.total_revenue as string).toFixed(2)} DH</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {s.total_sales as number} vente{(s.total_sales as number) > 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Avances commandes</p>
                        <p className="font-semibold text-blue-600">{parseFloat(s.total_advances as string || '0').toFixed(2)} DH</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {s.total_orders as number || 0} commande{(s.total_orders as number) > 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Montant attendu</p>
                        <p className="font-semibold">{parseFloat(s.expected_cash as string).toFixed(2)} DH</p>
                        <p className="text-xs text-gray-400 mt-0.5">Fond + especes + avances</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">Montant saisi</p>
                        <p className="font-semibold">{parseFloat(s.actual_amount as string).toFixed(2)} DH</p>
                      </div>
                    </div>
                  )}

                  {isClosed && (
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-500">
                      <div className="flex justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <span>Especes</span>
                        <span className="font-medium text-gray-700">{parseFloat(s.cash_revenue as string).toFixed(2)} DH</span>
                      </div>
                      <div className="flex justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <span>Carte bancaire</span>
                        <span className="font-medium text-gray-700">{parseFloat(s.card_revenue as string).toFixed(2)} DH</span>
                      </div>
                    </div>
                  )}

                  {s.notes && (
                    <p className="mt-3 text-sm text-gray-500 italic">Note : {s.notes as string}</p>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
      {/* ═══ Receipt Modal ═══ */}
      {receiptData && (
        <ReceiptModal receipt={receiptData} onClose={() => setReceiptData(null)} />
      )}
    </div>
  );
}
