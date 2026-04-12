import { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi } from '../../api/sales.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import { returnsApi } from '../../api/returns.api';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Receipt, Lock, AlertTriangle, CheckCircle, XCircle, LayoutGrid, ShoppingBag,
  User, CreditCard, FileText, Download, Eye, RotateCcw, ArrowLeftRight, Package,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, Banknote, TrendingUp, Hash, Clock, ClipboardList,
  Upload,
} from 'lucide-react';
import DateRangePicker from '../../components/DateRangePicker';
import ReceiptModal from '../pos/ReceiptModal';
import EmittedInvoicesTab from './EmittedInvoicesTab';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur', manager: 'Gérant', cashier: 'Caissier', baker: 'Boulanger',
  pastry_chef: 'Pâtissier', viennoiserie: 'Viennoiserie', beldi_sale: 'Beldi & Salé', saleswoman: 'Vendeuse',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces', card: 'Carte bancaire',
};

type SalesView = 'receipt' | 'category' | 'product' | 'cashier' | 'payment';

const viewTabs: { key: SalesView; label: string; icon: typeof Receipt }[] = [
  { key: 'receipt', label: 'Par reçu', icon: FileText },
  { key: 'category', label: 'Par catégorie', icon: LayoutGrid },
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
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' DH';
}

function parseCSVFiles(files: FileList): Promise<{ date: string; items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[] }[]> {
  return Promise.all(Array.from(files).map(file => {
    return new Promise<{ date: string; items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[] }>((resolve) => {
      // Extract date from filename: item-sales-summary-YYYY-MM-DD-YYYY-MM-DD.csv
      const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : format(new Date(), 'yyyy-MM-dd');

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(l => l.trim());
        const items = lines.slice(1).map(line => {
          const cols = line.split(',');
          const quantity = parseFloat(cols[3]) || 0;
          const netSales = parseFloat(cols[8]) || 0;
          const unitPrice = quantity > 0 ? netSales / quantity : 0;
          return {
            productName: cols[0]?.trim() || '',
            sku: cols[1]?.trim() || '',
            quantity,
            unitPrice: Math.round(unitPrice * 100) / 100,
            netSales,
            costOfGoods: parseFloat(cols[9]) || 0,
          };
        }).filter(i => i.quantity > 0 && i.productName);
        resolve({ date, items });
      };
      reader.readAsText(file);
    });
  }));
}

export default function SalesPage() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<'sales' | 'sessions' | 'returns' | 'invoices'>('sales');
  const [view, setView] = useState<SalesView>('receipt');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [searchQuery, setSearchQuery] = useState('');
  const [importResults, setImportResults] = useState<Record<string, unknown>[] | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [receiptData, setReceiptData] = useState<{
    saleNumber: string; date: string; cashierName: string; customerName?: string;
    items: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
    subtotal: number; discountAmount: number; total: number; paymentMethod: string;
    advanceAmount?: number; advanceDate?: string; orderTotal?: number; isAdvanceReceipt?: boolean;
  } | null>(null);

  const openReceipt = async (saleId: string) => {
    const sale = await salesApi.getById(saleId);
    if (!sale) return;

    const isAdvance = sale.sale_type === 'advance';
    const isDelivery = sale.sale_type === 'delivery';
    const hasOrderData = sale.order_total != null;

    setReceiptData({
      saleNumber: isAdvance && sale.order_number ? sale.order_number : sale.sale_number,
      date: sale.created_at,
      cashierName: `${sale.cashier_first_name} ${sale.cashier_last_name}`,
      customerName: sale.customer_first_name ? `${sale.customer_first_name} ${sale.customer_last_name}` : undefined,
      items: (sale.items || []).map((item: Record<string, unknown>) => ({
        name: item.product_name as string,
        quantity: parseInt(String(item.quantity)) || 0,
        unitPrice: parseFloat(item.unit_price as string),
        subtotal: parseFloat(item.subtotal as string),
      })),
      subtotal: hasOrderData ? parseFloat(sale.order_subtotal) : parseFloat(sale.subtotal),
      discountAmount: hasOrderData ? parseFloat(sale.order_discount || '0') : parseFloat(sale.discount_amount),
      total: isAdvance ? parseFloat(sale.total) : (hasOrderData ? parseFloat(sale.order_total) : parseFloat(sale.total)),
      paymentMethod: sale.payment_method,
      orderTotal: hasOrderData ? parseFloat(sale.order_total) : undefined,
      isAdvanceReceipt: isAdvance,
      advanceAmount: isDelivery && hasOrderData ? parseFloat(sale.order_advance || '0') : undefined,
      advanceDate: isDelivery ? (sale.advance_date || sale.created_at) : undefined,
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

  // Returns for sales period (to subtract from totals)
  const { data: salesReturnsData } = useQuery({
    queryKey: ['returns-for-sales', { dateFrom, dateTo }],
    queryFn: () => returnsApi.list({ dateFrom, dateTo, limit: '500' }),
    enabled: mainTab === 'sales',
  });
  const salesReturns = salesReturnsData?.data || [];
  const totalRefunds = salesReturns
    .filter((r: Record<string, unknown>) => r.type === 'return')
    .reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(r.refund_amount as string), 0);

  // Search filter for receipts
  const filteredSales = useMemo(() => {
    if (!searchQuery.trim()) return sales;
    const q = searchQuery.toLowerCase();
    return sales.filter((s: Record<string, unknown>) =>
      (s.sale_number as string)?.toLowerCase().includes(q) ||
      `${s.customer_first_name || ''} ${s.customer_last_name || ''}`.toLowerCase().includes(q) ||
      `${s.cashier_first_name || ''} ${s.cashier_last_name || ''}`.toLowerCase().includes(q)
    );
  }, [sales, searchQuery]);

  const handleExport = () => {
    const date = `${dateFrom}_${dateTo}`;
    if (mainTab === 'sessions') {
      exportCSV(`sessions_${date}.csv`,
        ['Employé', 'Ouverture', 'Fermeture', 'Fond de caisse', 'CA ventes', 'Avances', 'Montant attendu', 'Montant saisi', 'Écart', 'Statut'],
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
          s.status === 'closed' ? 'Fermé' : 'En cours',
        ])
      );
      return;
    }
    if (mainTab === 'returns') {
      exportCSV(`retours_${date}.csv`,
        ['N° Retour', 'Vente originale', 'Type', 'Montant', 'Caissier', 'Date', 'Motif'],
        returns.map((r: Record<string, unknown>) => [
          r.return_number as string,
          r.original_sale_number as string,
          r.type === 'return' ? 'Retour' : 'Échange',
          parseFloat(r.refund_amount as string).toFixed(2),
          `${r.user_first_name} ${r.user_last_name}`,
          format(new Date(r.created_at as string), 'dd/MM/yyyy HH:mm'),
          (r.reason as string) || '',
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
        ['Catégorie', 'Articles vendus', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, unknown>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, r.total_quantity as string, r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'product') {
      exportCSV(`ventes_articles_${date}.csv`,
        ['Article', 'Catégorie', 'Qté vendue', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, unknown>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, (r.category_name as string) || '', r.total_quantity as string, r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'cashier') {
      exportCSV(`ventes_vendeuses_${date}.csv`,
        ['Vendeuse / Caissier', 'Rôle', 'Nb ventes', 'CA (DH)', '% du CA'],
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

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const days = await parseCSVFiles(files);
      const results = await salesApi.importCSV({ days });
      setImportResults(results);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
    } catch (err) {
      setImportResults([{ date: '-', created: false, error: 'Erreur lors de l\'import' }]);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const grossRevenue = view === 'receipt'
    ? sales.reduce((sum: number, s: Record<string, unknown>) => sum + parseFloat(s.total as string), 0)
    : summary.reduce((sum: number, s: Record<string, unknown>) => sum + parseFloat(s.total_revenue as string || '0'), 0);
  const totalRevenue = view === 'receipt' ? grossRevenue - totalRefunds : grossRevenue;
  const totalCount = view === 'receipt'
    ? sales.length
    : summary.reduce((sum: number, s: Record<string, unknown>) => sum + parseInt(s.sale_count as string || '0'), 0);
  const returnsCount = salesReturns.filter((r: Record<string, unknown>) => r.type === 'return').length;

  const mainTabs = [
    { key: 'sales' as const, label: 'Ventes', icon: Receipt },
    { key: 'returns' as const, label: 'Retours & Échanges', icon: RotateCcw },
    { key: 'sessions' as const, label: 'Périodes de travail', icon: Lock },
    { key: 'invoices' as const, label: 'Factures émises', icon: FileText },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Ventes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Historique des ventes, retours et périodes de travail</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {
              const from = parseISO(dateFrom);
              const to = parseISO(dateTo);
              const span = Math.max(differenceInDays(to, from), 0) + 1;
              setDateFrom(format(addDays(from, -span), 'yyyy-MM-dd'));
              setDateTo(format(addDays(to, -span), 'yyyy-MM-dd'));
            }}
            className="p-2 bg-white border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors" title="Période précédente">
            <ChevronLeft size={18} />
          </button>
          <DateRangePicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
          <button onClick={() => {
              const todayStr = format(new Date(), 'yyyy-MM-dd');
              if (dateTo >= todayStr) return;
              const from = parseISO(dateFrom);
              const to = parseISO(dateTo);
              const span = Math.max(differenceInDays(to, from), 0) + 1;
              const newFrom = addDays(from, span);
              let newTo = addDays(to, span);
              if (format(newTo, 'yyyy-MM-dd') > todayStr) newTo = parseISO(todayStr);
              setDateFrom(format(newFrom, 'yyyy-MM-dd'));
              setDateTo(format(newTo, 'yyyy-MM-dd'));
            }}
            disabled={dateTo >= format(new Date(), 'yyyy-MM-dd')}
            className="p-2 bg-white border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Période suivante">
            <ChevronRight size={18} />
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={16} /> Exporter
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" multiple onChange={handleImportCSV} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
            <Upload size={16} /> {importing ? 'Import...' : 'Importer CSV'}
          </button>
        </div>
      </div>

      {/* Import results modal */}
      {importResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setImportResults(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Résultats de l'import</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {importResults.map((r, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${r.created ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  {r.created ? <CheckCircle size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" /> : <XCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{r.date as string}</p>
                    {r.created ? (
                      <>
                        <p className="text-xs text-gray-600">
                          {r.saleNumber as string} - {r.matchedCount as number} articles - {new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(r.total as number)} DH
                        </p>
                        {(r.unmatchedItems as string[])?.length > 0 && (
                          <p className="text-xs text-amber-600 mt-1">
                            <AlertTriangle size={11} className="inline mr-1" />
                            Non trouvés: {(r.unmatchedItems as string[]).join(', ')}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-red-600">
                        {(r.unmatchedItems as string[])?.length > 0
                          ? `Aucun produit trouvé: ${(r.unmatchedItems as string[]).slice(0, 5).join(', ')}${(r.unmatchedItems as string[]).length > 5 ? '...' : ''}`
                          : (r.error as string) || 'Aucun article importé'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setImportResults(null)}
              className="mt-4 w-full py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Main tabs */}
      <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
          {mainTabs.map((tab) => (
            <button key={tab.key} onClick={() => setMainTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                mainTab === tab.key
                  ? 'bg-white text-emerald-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}>
              <tab.icon size={15} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* View sub-tabs (only for sales) */}
        {mainTab === 'sales' && (
          <>
            <div className="w-px h-6 bg-gray-200" />
            <div className="flex items-center gap-1">
              {viewTabs.map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => setView(t.key)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      view === t.key
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                    }`}>
                    <Icon size={13} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Search for receipt view */}
        {mainTab === 'sales' && view === 'receipt' && (
          <>
            <div className="w-px h-6 bg-gray-200 hidden sm:block" />
            <div className="relative flex-1 min-w-[180px] ml-auto">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher n°, client, caissier..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
              />
            </div>
          </>
        )}
      </div>

      {/* ═══════════ SALES TAB ═══════════ */}
      {mainTab === 'sales' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <Banknote size={18} className="text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">CA net</p>
              {totalRefunds > 0 && (
                <p className="text-[11px] text-gray-300 mt-0.5">Brut: {formatCurrency(grossRevenue)}</p>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <Hash size={18} className="text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-800">{totalCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Nombre de ventes</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center">
                  <TrendingUp size={18} className="text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-800">
                {formatCurrency(totalCount > 0 ? totalRevenue / totalCount : 0)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Panier moyen</p>
            </div>
            {totalRefunds > 0 ? (
              <div className="bg-white rounded-xl border border-red-100 p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-400 to-red-500 flex items-center justify-center">
                    <RotateCcw size={18} className="text-white" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-red-600">-{formatCurrency(totalRefunds)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{returnsCount} retour{returnsCount > 1 ? 's' : ''}</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                    <CheckCircle size={18} className="text-white" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-emerald-600">0</p>
                <p className="text-xs text-gray-400 mt-0.5">Retours</p>
              </div>
            )}
          </div>

          {/* ── Receipt view ── */}
          {view === 'receipt' && (
            isLoading ? <LoadingState /> : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">N° Vente</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Client</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Caissier</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Paiement</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Total</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Heure</th>
                      <th className="text-center px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredSales.map((s: Record<string, unknown>) => (
                      <tr key={s.id as string} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-gray-700">{s.sale_number as string}</span>
                            {(s.sale_type === 'advance') && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-600 ring-1 ring-orange-200">Avance</span>
                            )}
                            {(s.sale_type === 'delivery') && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 ring-1 ring-blue-200">Solde livraison</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <User size={12} className="text-gray-400" />
                            </div>
                            <span className="text-sm text-gray-700">
                              {s.customer_first_name ? `${s.customer_first_name} ${s.customer_last_name}` : 'Client de passage'}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-500">{s.cashier_first_name as string} {s.cashier_last_name as string}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            s.payment_method === 'cash' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {s.payment_method === 'cash' ? <Banknote size={11} /> : <CreditCard size={11} />}
                            {PAYMENT_LABELS[s.payment_method as string] || s.payment_method}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm font-bold text-gray-800">{formatCurrency(parseFloat(s.total as string))}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock size={11} />
                            {format(new Date(s.created_at as string), 'HH:mm', { locale: fr })}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <button onClick={() => openReceipt(s.id as string)}
                            className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center text-emerald-600 transition-colors mx-auto">
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredSales.length === 0 && <EmptyState text={searchQuery ? 'Aucun résultat pour cette recherche' : 'Aucune vente pour cette période'} />}
              </div>
            )
          )}

          {/* ── Category view ── */}
          {view === 'category' && (
            summaryLoading ? <LoadingState /> : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Catégorie</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Articles vendus</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nb ventes</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">CA</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Part</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {summary.map((row: Record<string, unknown>, idx: number) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                <LayoutGrid size={14} className="text-emerald-500" />
                              </div>
                              <span className="text-sm font-medium text-gray-800">{row.label as string}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right text-sm font-semibold text-gray-700">{row.total_quantity as string}</td>
                          <td className="px-5 py-3.5 text-right text-sm text-gray-500">{row.sale_count as string}</td>
                          <td className="px-5 py-3.5 text-right text-sm font-bold text-gray-800">{formatCurrency(rev)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-gray-400 w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {summary.length === 0 && <EmptyState text="Aucune donnée pour cette période" />}
              </div>
            )
          )}

          {/* ── Product view ── */}
          {view === 'product' && (
            summaryLoading ? <LoadingState /> : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Article</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Catégorie</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Qté vendue</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Nb ventes</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">CA</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Part</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {summary.map((row: Record<string, unknown>, idx: number) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              {idx < 3 && (
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                  idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-gray-100 text-gray-600' : 'bg-orange-50 text-orange-600'
                                }`}>{idx + 1}</span>
                              )}
                              <span className="text-sm font-medium text-gray-800">{row.label as string}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{row.category_name as string || '—'}</span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-sm font-semibold text-gray-700">{row.total_quantity as string}</td>
                          <td className="px-5 py-3.5 text-right text-sm text-gray-500">{row.sale_count as string}</td>
                          <td className="px-5 py-3.5 text-right text-sm font-bold text-gray-800">{formatCurrency(rev)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-gray-400 w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {summary.length === 0 && <EmptyState text="Aucune donnée pour cette période" />}
              </div>
            )
          )}

          {/* ── Cashier view ── */}
          {view === 'cashier' && (
            summaryLoading ? <LoadingState /> : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {summary.map((row: Record<string, unknown>) => {
                  const rev = parseFloat(row.total_revenue as string);
                  const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                  return (
                    <div key={row.id as string} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                          {(row.label as string).charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">{row.label as string}</p>
                          <p className="text-xs text-gray-400">{ROLE_LABELS[row.role as string] || row.role}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-gray-50 rounded-lg p-2.5">
                          <p className="text-xs text-gray-400">Ventes</p>
                          <p className="text-lg font-bold text-gray-800">{row.sale_count as string}</p>
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-2.5">
                          <p className="text-xs text-emerald-500">CA</p>
                          <p className="text-lg font-bold text-emerald-700">{formatCurrency(rev)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-400">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
                {summary.length === 0 && (
                  <div className="col-span-full"><EmptyState text="Aucune donnée pour cette période" /></div>
                )}
              </div>
            )
          )}

          {/* ── Payment view ── */}
          {view === 'payment' && (
            summaryLoading ? <LoadingState /> : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {summary.map((row: Record<string, unknown>) => {
                  const rev = parseFloat(row.total_revenue as string);
                  const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                  const label = PAYMENT_LABELS[row.label as string] || row.label;
                  const isCash = row.label === 'cash';
                  return (
                    <div key={row.label as string}
                      className={`rounded-xl p-6 border ${isCash ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isCash ? 'bg-emerald-500' : 'bg-blue-500'}`}>
                          {isCash ? <Banknote size={22} className="text-white" /> : <CreditCard size={22} className="text-white" />}
                        </div>
                        <h3 className={`text-lg font-bold ${isCash ? 'text-emerald-800' : 'text-blue-800'}`}>{label as string}</h3>
                      </div>
                      <p className="text-3xl font-bold text-gray-800 mb-1">{formatCurrency(rev)}</p>
                      <p className="text-sm text-gray-500 mb-4">{row.sale_count as string} vente{parseInt(row.sale_count as string) > 1 ? 's' : ''}</p>
                      <div className="flex items-center gap-2">
                        <div className={`flex-1 h-3 rounded-full overflow-hidden ${isCash ? 'bg-emerald-200' : 'bg-blue-200'}`}>
                          <div className={`h-full rounded-full ${isCash ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-bold text-gray-600">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
                {summary.length === 0 && (
                  <div className="col-span-full"><EmptyState text="Aucune donnée pour cette période" /></div>
                )}
              </div>
            )
          )}
        </>
      )}

      {/* ═══════════ RETURNS TAB ═══════════ */}
      {mainTab === 'returns' && (
        returnsLoading ? <LoadingState /> : (
          <>
            {/* Returns summary */}
            {(() => {
              const totalReturns = returns.filter((r: Record<string, unknown>) => r.type === 'return').length;
              const totalExchanges = returns.filter((r: Record<string, unknown>) => r.type === 'exchange').length;
              const totalRefund = returns
                .filter((r: Record<string, unknown>) => r.type === 'return')
                .reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(r.refund_amount as string), 0);
              return (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center mb-2">
                      <ArrowLeftRight size={18} className="text-white" />
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{returns.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Total operations</p>
                  </div>
                  <div className="bg-white rounded-xl border border-red-100 p-4">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-400 to-red-500 flex items-center justify-center mb-2">
                      <RotateCcw size={18} className="text-white" />
                    </div>
                    <p className="text-2xl font-bold text-red-600">{totalReturns}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Retours</p>
                  </div>
                  <div className="bg-white rounded-xl border border-blue-100 p-4">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center mb-2">
                      <ArrowLeftRight size={18} className="text-white" />
                    </div>
                    <p className="text-2xl font-bold text-blue-600">{totalExchanges}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Echanges</p>
                  </div>
                  <div className="bg-white rounded-xl border border-red-100 p-4">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-400 to-rose-500 flex items-center justify-center mb-2">
                      <Banknote size={18} className="text-white" />
                    </div>
                    <p className="text-2xl font-bold text-red-600">{formatCurrency(totalRefund)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Total rembourse</p>
                  </div>
                </div>
              );
            })()}

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">N° Retour</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Vente orig.</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Articles</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Montant</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Caissier</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Motif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {returns.map((r: Record<string, unknown>) => {
                    const items = (r.items || []) as Record<string, unknown>[];
                    const isReturn = r.type === 'return';
                    return (
                      <tr key={r.id as string} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            {isReturn ? (
                              <RotateCcw size={14} className="text-red-400" />
                            ) : (
                              <ArrowLeftRight size={14} className="text-blue-400" />
                            )}
                            <span className="font-mono text-sm font-semibold text-gray-700">{r.return_number as string}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-mono text-gray-500">{r.original_sale_number as string}</td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            isReturn ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {isReturn ? 'Retour' : 'Echange'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm">
                          {items.map((it, idx) => (
                            <div key={idx} className="text-gray-600">
                              {it.product_name as string} <span className="text-gray-300">x{it.quantity as number}</span>
                            </div>
                          ))}
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold text-red-600">{formatCurrency(parseFloat(r.refund_amount as string))}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-500">{r.user_first_name as string} {r.user_last_name as string}</td>
                        <td className="px-5 py-3.5 text-xs text-gray-400">{format(new Date(r.created_at as string), 'dd/MM HH:mm', { locale: fr })}</td>
                        <td className="px-5 py-3.5 text-xs text-gray-400 max-w-[180px] truncate">{(r.reason as string) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {returns.length === 0 && <EmptyState text="Aucun retour ou échange pour cette période" />}
            </div>
          </>
        )
      )}

      {/* ═══════════ SESSIONS TAB ═══════════ */}
      {mainTab === 'sessions' && (
        sessionsLoading ? <LoadingState /> : (
          <div className="space-y-4">
            {sessions.length === 0 && <EmptyState text="Aucune période de travail pour cette période" />}
            {sessions.map((s: Record<string, unknown>) => {
              const diff = s.difference !== null ? parseFloat(s.difference as string) : null;
              const isClosed = s.status === 'closed';
              return (
                <div key={s.id as string} className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-sm transition-shadow">
                  {/* Session header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isClosed ? 'bg-gray-100' : 'bg-emerald-100'
                      }`}>
                        <Lock size={18} className={isClosed ? 'text-gray-500' : 'text-emerald-600'} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">{s.first_name as string} {s.last_name as string}</p>
                        <p className="text-xs text-gray-400">
                          {format(new Date(s.opened_at as string), 'dd/MM/yyyy HH:mm', { locale: fr })}
                          {s.closed_at && <> — {format(new Date(s.closed_at as string), 'HH:mm', { locale: fr })}</>}
                        </p>
                      </div>
                    </div>
                    {isClosed && diff !== null ? (
                      diff === 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                          <CheckCircle size={14} /> Caisse juste
                        </span>
                      ) : diff > 0 ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                          <AlertTriangle size={14} /> +{diff.toFixed(2)} DH
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-700">
                          <XCircle size={14} /> {diff.toFixed(2)} DH
                        </span>
                      )
                    ) : !isClosed ? (
                      <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> En cours
                      </span>
                    ) : null}
                  </div>

                  {isClosed && (
                    <div className="px-5 py-4 space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider mb-1">Fond de caisse</p>
                          <p className="font-bold text-gray-700">{formatCurrency(parseFloat(s.opening_amount as string))}</p>
                        </div>
                        <div className="bg-emerald-50 rounded-xl p-3">
                          <p className="text-[11px] text-emerald-500 font-medium uppercase tracking-wider mb-1">CA encaisse</p>
                          <p className="font-bold text-emerald-700">{formatCurrency(parseFloat(s.total_revenue as string))}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{s.total_sales as number} operation{(s.total_sales as number) > 1 ? 's' : ''}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider mb-1">Attendu</p>
                          <p className="font-bold text-gray-700">{formatCurrency(parseFloat(s.expected_cash as string))}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider mb-1">Saisi</p>
                          <p className="font-bold text-gray-700">{formatCurrency(parseFloat(s.actual_amount as string))}</p>
                        </div>
                      </div>

                      {/* Sale type breakdown */}
                      {(parseFloat(s.total_advances as string || '0') > 0) && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center justify-between bg-orange-50 rounded-xl px-4 py-2.5">
                            <span className="flex items-center gap-2 text-xs text-orange-600">
                              <ClipboardList size={14} /> Avances recues
                            </span>
                            <span className="text-sm font-semibold text-orange-700">{formatCurrency(parseFloat(s.total_advances as string || '0'))}</span>
                          </div>
                          <div className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-gray-400">
                            {parseInt(String(s.pending_orders ?? s.total_orders ?? 0))} commande{parseInt(String(s.pending_orders ?? s.total_orders ?? 0)) > 1 ? 's' : ''} en attente de livraison
                          </div>
                        </div>
                      )}

                      {/* Payment breakdown */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                          <span className="flex items-center gap-2 text-xs text-gray-500">
                            <Banknote size={14} className="text-emerald-500" /> Especes
                          </span>
                          <span className="text-sm font-semibold text-gray-700">{formatCurrency(parseFloat(s.cash_revenue as string))}</span>
                        </div>
                        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                          <span className="flex items-center gap-2 text-xs text-gray-500">
                            <CreditCard size={14} className="text-blue-500" /> Carte bancaire
                          </span>
                          <span className="text-sm font-semibold text-gray-700">{formatCurrency(parseFloat(s.card_revenue as string))}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inventory Bilan */}
                  {isClosed && s.inv_total_replenished !== null && parseInt(s.inv_total_replenished as string) > 0 && (
                    <InventoryBilan session={s} />
                  )}

                  {s.notes && (
                    <div className="px-5 pb-4">
                      <p className="text-sm text-gray-400 italic flex items-center gap-1.5">
                        <FileText size={13} /> {s.notes as string}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ═══════════ INVOICES TAB ═══════════ */}
      {mainTab === 'invoices' && (
        <div className="space-y-4">
          <EmittedInvoicesTab />
        </div>
      )}

      {/* Receipt Modal */}
      {receiptData && (
        <ReceiptModal receipt={receiptData} onClose={() => setReceiptData(null)} />
      )}
    </div>
  );
}

// ═══ Loading State ═══
function LoadingState() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
      <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-sm text-gray-400">Chargement...</p>
    </div>
  );
}

// ═══ Empty State ═══
function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-10">
      <Receipt size={36} className="text-gray-200 mx-auto mb-2" />
      <p className="text-gray-400 text-sm">{text}</p>
    </div>
  );
}

// ═══ Inventory Bilan per session ═══
function InventoryBilan({ session }: { session: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const totalRep = parseInt(session.inv_total_replenished as string) || 0;
  const totalSold = parseInt(session.inv_total_sold as string) || 0;
  const totalRemaining = parseInt(session.inv_total_remaining as string) || 0;
  const totalDiscrepancy = parseInt(session.inv_total_discrepancy as string) || 0;

  const { data: items } = useQuery({
    queryKey: ['session-inventory', session.id],
    queryFn: () => cashRegisterApi.getInventoryItems(session.id as string),
    enabled: expanded,
  });

  return (
    <div className="mx-5 mb-4 border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Package size={16} className="text-indigo-500" />
          <span className="text-sm font-semibold text-gray-700">Bilan des produits</span>
          <span className="text-xs text-gray-400">({totalRep} approv. / {totalSold} vendus / {totalRemaining} restants)</span>
        </div>
        <div className="flex items-center gap-2">
          {totalDiscrepancy !== 0 ? (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${totalDiscrepancy > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {totalDiscrepancy > 0 ? `-${totalDiscrepancy} manquant` : `+${Math.abs(totalDiscrepancy)} surplus`}
            </span>
          ) : (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Aucun ecart</span>
          )}
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-blue-50 rounded-xl p-2.5 text-center">
              <p className="text-[11px] text-blue-500 font-medium mb-0.5">Approvisionne</p>
              <p className="text-lg font-bold text-blue-700">{totalRep}</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-2.5 text-center">
              <p className="text-[11px] text-emerald-500 font-medium mb-0.5">Vendu</p>
              <p className="text-lg font-bold text-emerald-700">{totalSold}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5 text-center">
              <p className="text-[11px] text-gray-400 font-medium mb-0.5">Restant</p>
              <p className="text-lg font-bold text-gray-700">{totalRemaining}</p>
            </div>
            <div className={`rounded-xl p-2.5 text-center ${totalDiscrepancy > 0 ? 'bg-red-50' : totalDiscrepancy < 0 ? 'bg-blue-50' : 'bg-emerald-50'}`}>
              <p className={`text-[11px] font-medium mb-0.5 ${totalDiscrepancy > 0 ? 'text-red-500' : totalDiscrepancy < 0 ? 'text-blue-500' : 'text-emerald-500'}`}>Ecart</p>
              <p className={`text-lg font-bold ${totalDiscrepancy > 0 ? 'text-red-700' : totalDiscrepancy < 0 ? 'text-blue-700' : 'text-emerald-700'}`}>
                {totalDiscrepancy === 0 ? '0' : totalDiscrepancy > 0 ? `-${totalDiscrepancy}` : `+${Math.abs(totalDiscrepancy)}`}
              </p>
            </div>
          </div>

          {/* Items detail table */}
          {items && items.length > 0 && (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="grid grid-cols-5 gap-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 px-3 py-2">
                <span className="col-span-1">Produit</span>
                <span className="text-center">Approv.</span>
                <span className="text-center">Vendu</span>
                <span className="text-center">Restant</span>
                <span className="text-center">Ecart</span>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                {(items as Record<string, unknown>[]).map((it, idx) => {
                  const rep = parseInt(it.replenished_qty as string) || 0;
                  const sold = parseInt(it.sold_qty as string) || 0;
                  const rem = parseInt(it.remaining_qty as string) || 0;
                  const disc = parseInt(it.discrepancy as string) || 0;
                  return (
                    <div key={idx} className={`grid grid-cols-5 gap-1 items-center px-3 py-1.5 text-sm ${disc !== 0 ? (disc > 0 ? 'bg-red-50/50' : 'bg-blue-50/50') : ''}`}>
                      <span className="truncate text-xs font-medium" title={it.product_name as string}>{it.product_name as string}</span>
                      <span className="text-center text-xs font-semibold text-blue-700">{rep}</span>
                      <span className="text-center text-xs font-semibold text-emerald-700">{sold}</span>
                      <span className="text-center text-xs font-semibold text-gray-700">{rem}</span>
                      <span className={`text-center text-xs font-bold ${disc > 0 ? 'text-red-600' : disc < 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
                        {disc === 0 ? '✓' : disc > 0 ? `-${disc}` : `+${Math.abs(disc)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {items && items.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">Aucun detail d'inventaire disponible</p>
          )}
        </div>
      )}
    </div>
  );
}
