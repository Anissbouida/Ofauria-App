import { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { salesApi } from '../../api/sales.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import { returnsApi } from '../../api/returns.api';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { getApiErrorMessage } from '../../utils/api-error';
import {
  Receipt, Lock, AlertTriangle, CheckCircle, XCircle, LayoutGrid, ShoppingBag,
  User, CreditCard, FileText, Download, Eye, RotateCcw, ArrowLeftRight, Package,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, Banknote, TrendingUp, Hash, Clock, ClipboardList,
  Upload, ArrowUpDown, ArrowUp, ArrowDown,
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

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right';
}) {
  const active = currentKey === sk;
  return (
    <th onClick={() => onSort(sk)} style={{ textAlign: align }}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </th>
  );
}

export default function SalesPage() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<'sales' | 'sessions' | 'returns' | 'invoices'>('sales');
  const [view, setView] = useState<SalesView>('receipt');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [importResults, setImportResults] = useState<Record<string, any>[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);
  const [paySaleTarget, setPaySaleTarget] = useState<Record<string, any> | null>(null);
  const [payPaymentMethod, setPayPaymentMethod] = useState<'cash' | 'card'>('cash');
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
      items: (sale.items || []).map((item: Record<string, any>) => ({
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

  // Receipt list query — quand on filtre "Impayes uniquement", on ignore la
  // fenetre de date pour ne pas masquer un impaye plus ancien.
  const { data, isLoading } = useQuery({
    queryKey: ['sales', { dateFrom, dateTo, unpaid: showUnpaidOnly }],
    queryFn: () => salesApi.list(
      showUnpaidOnly
        ? { paymentStatus: 'unpaid', limit: '500' }
        : { dateFrom, dateTo, limit: '500' }
    ),
    enabled: mainTab === 'sales' && view === 'receipt',
  });

  const paySaleMutation = useMutation({
    mutationFn: ({ id, paymentMethod }: { id: string; paymentMethod: string }) =>
      salesApi.pay(id, { paymentMethod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      notify.success('Encaissement enregistré');
      setPaySaleTarget(null);
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, "Erreur lors de l'encaissement")),
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
    .filter((r: Record<string, any>) => r.type === 'return')
    .reduce((sum: number, r: Record<string, any>) => sum + parseFloat(r.refund_amount as string), 0);

  // Sort toggle
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'total' || key === 'total_revenue' || key === 'total_quantity' || key === 'sale_count' ? 'desc' : 'asc'); }
  };

  // Search filter for receipts
  const filteredSales = useMemo(() => {
    if (!searchQuery.trim()) return sales;
    const q = searchQuery.toLowerCase();
    return sales.filter((s: Record<string, any>) =>
      (s.sale_number as string)?.toLowerCase().includes(q) ||
      `${s.customer_first_name || ''} ${s.customer_last_name || ''}`.toLowerCase().includes(q) ||
      `${s.cashier_first_name || ''} ${s.cashier_last_name || ''}`.toLowerCase().includes(q)
    );
  }, [sales, searchQuery]);

  // Sorted sales
  const sortedSales = useMemo(() => {
    const arr = [...filteredSales];
    arr.sort((a: Record<string, any>, b: Record<string, any>) => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case 'sale_number': va = (a.sale_number as string) || ''; vb = (b.sale_number as string) || ''; break;
        case 'customer': va = `${a.customer_first_name || ''} ${a.customer_last_name || ''}`.trim().toLowerCase(); vb = `${b.customer_first_name || ''} ${b.customer_last_name || ''}`.trim().toLowerCase(); break;
        case 'cashier': va = `${a.cashier_first_name || ''} ${a.cashier_last_name || ''}`.trim().toLowerCase(); vb = `${b.cashier_first_name || ''} ${b.cashier_last_name || ''}`.trim().toLowerCase(); break;
        case 'payment_method': va = (a.payment_method as string) || ''; vb = (b.payment_method as string) || ''; break;
        case 'total': va = parseFloat(a.total as string) || 0; vb = parseFloat(b.total as string) || 0; break;
        case 'created_at': default: va = (a.created_at as string) || ''; vb = (b.created_at as string) || ''; break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredSales, sortKey, sortDir]);

  // Sorted summary
  const sortedSummary = useMemo(() => {
    const arr = [...summary];
    arr.sort((a: Record<string, any>, b: Record<string, any>) => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case 'label': va = ((a.label as string) || '').toLowerCase(); vb = ((b.label as string) || '').toLowerCase(); break;
        case 'category_name': va = ((a.category_name as string) || '').toLowerCase(); vb = ((b.category_name as string) || '').toLowerCase(); break;
        case 'total_quantity': va = parseFloat(a.total_quantity as string) || 0; vb = parseFloat(b.total_quantity as string) || 0; break;
        case 'sale_count': va = parseFloat(a.sale_count as string) || 0; vb = parseFloat(b.sale_count as string) || 0; break;
        case 'total_revenue': default: va = parseFloat(a.total_revenue as string) || 0; vb = parseFloat(b.total_revenue as string) || 0; break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [summary, sortKey, sortDir]);

  const handleExport = () => {
    const date = `${dateFrom}_${dateTo}`;
    if (mainTab === 'sessions') {
      exportCSV(`sessions_${date}.csv`,
        ['Employé', 'Ouverture', 'Fermeture', 'Fond de caisse', 'CA ventes', 'Avances', 'Montant attendu', 'Montant saisi', 'Écart', 'Statut'],
        sessions.map((s: Record<string, any>) => [
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
        returns.map((r: Record<string, any>) => [
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
        sales.map((s: Record<string, any>) => [
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
        summary.map((r: Record<string, any>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, r.total_quantity as string, r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'product') {
      exportCSV(`ventes_articles_${date}.csv`,
        ['Article', 'Catégorie', 'Qté vendue', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, any>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, (r.category_name as string) || '', r.total_quantity as string, r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'cashier') {
      exportCSV(`ventes_vendeuses_${date}.csv`,
        ['Vendeuse / Caissier', 'Rôle', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, any>) => {
          const rev = parseFloat(r.total_revenue as string);
          return [r.label as string, ROLE_LABELS[r.role as string] || (r.role as string), r.sale_count as string, rev.toFixed(2), totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0%'];
        })
      );
    } else if (view === 'payment') {
      exportCSV(`ventes_paiement_${date}.csv`,
        ['Mode de paiement', 'Nb ventes', 'CA (DH)', '% du CA'],
        summary.map((r: Record<string, any>) => {
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
    ? sales.reduce((sum: number, s: Record<string, any>) => sum + parseFloat(s.total as string), 0)
    : summary.reduce((sum: number, s: Record<string, any>) => sum + parseFloat(s.total_revenue as string || '0'), 0);
  const totalRevenue = view === 'receipt' ? grossRevenue - totalRefunds : grossRevenue;
  const totalCount = view === 'receipt'
    ? sales.length
    : summary.reduce((sum: number, s: Record<string, any>) => sum + parseInt(s.sale_count as string || '0'), 0);
  const returnsCount = salesReturns.filter((r: Record<string, any>) => r.type === 'return').length;

  const mainTabs = [
    { key: 'sales' as const, label: 'Ventes', icon: Receipt },
    { key: 'returns' as const, label: 'Retours & Échanges', icon: RotateCcw },
    { key: 'sessions' as const, label: 'Périodes de travail', icon: Lock },
    { key: 'invoices' as const, label: 'Factures émises', icon: FileText },
  ];

  const currentMainTab = mainTabs.find(t => t.key === mainTab);

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <Receipt size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Ventes</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{currentMainTab?.label}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => {
            const from = parseISO(dateFrom);
            const to = parseISO(dateTo);
            const span = Math.max(differenceInDays(to, from), 0) + 1;
            setDateFrom(format(addDays(from, -span), 'yyyy-MM-dd'));
            setDateTo(format(addDays(to, -span), 'yyyy-MM-dd'));
          }}
          className="odoo-pager-btn" title="Période précédente">
          <ChevronLeft size={14} />
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
          className="odoo-pager-btn" title="Période suivante">
          <ChevronRight size={14} />
        </button>
        <button onClick={() => setShowUnpaidOnly(v => !v)}
          title={showUnpaidOnly ? 'Afficher toutes les ventes' : 'Afficher uniquement les ventes en paiement reporté'}
          className={showUnpaidOnly ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Clock size={13} /> Impayés
        </button>
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} /> Exporter
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" multiple onChange={handleImportCSV} className="hidden" />
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}
          className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Upload size={13} /> {importing ? 'Import...' : 'Importer CSV'}
        </button>
      </div>

      {/* Import results modal */}
      {importResults && (
        <ModalBackdrop onClose={() => setImportResults(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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
        </ModalBackdrop>
      )}

      {/* Main tabs */}
      <div className="odoo-tabs">
        {mainTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.key} onClick={() => setMainTab(tab.key)}
              className={`odoo-tab ${mainTab === tab.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* View sub-tabs (only for sales) */}
      {mainTab === 'sales' && (
        <div className="odoo-search-panel">
          <div style={{ display: 'inline-flex', gap: 4 }}>
            {viewTabs.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => { setView(t.key); setSortKey(t.key === 'receipt' ? 'created_at' : 'total_revenue'); setSortDir('desc'); }}
                  className="odoo-filter-dropdown"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    backgroundColor: view === t.key ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
                    color: view === t.key ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
                    fontWeight: view === t.key ? 600 : 400,
                  }}>
                  <Icon size={11} />
                  {t.label}
                </button>
              );
            })}
          </div>
          {view === 'receipt' && (
            <>
              <div style={{ flex: 1 }} />
              <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher n°, client, caissier..."
                className="odoo-search-input"
                style={{ minWidth: 220 }}
              />
            </>
          )}
        </div>
      )}

      {/* ═══════════ SALES TAB ═══════════ */}
      {mainTab === 'sales' && (
        <>
          {/* KPI stat tiles */}
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />CA net</div>
              <div className="odoo-stat-card-value">{formatCurrency(totalRevenue)}</div>
              <div className="odoo-stat-card-sub">{totalRefunds > 0 ? `Brut ${formatCurrency(grossRevenue)}` : ' '}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><Hash size={11} style={{ display: 'inline', marginRight: 4 }} />Nombre de ventes</div>
              <div className="odoo-stat-card-value">{totalCount}</div>
              <div className="odoo-stat-card-sub">tickets</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><TrendingUp size={11} style={{ display: 'inline', marginRight: 4 }} />Panier moyen</div>
              <div className="odoo-stat-card-value">{formatCurrency(totalCount > 0 ? totalRevenue / totalCount : 0)}</div>
              <div className="odoo-stat-card-sub">par ticket</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><RotateCcw size={11} style={{ display: 'inline', marginRight: 4 }} />Retours</div>
              <div className="odoo-stat-card-value" style={{ color: totalRefunds > 0 ? '#dc3545' : undefined }}>
                {totalRefunds > 0 ? `-${formatCurrency(totalRefunds)}` : '0'}
              </div>
              <div className="odoo-stat-card-sub">{returnsCount > 0 ? `${returnsCount} retour${returnsCount > 1 ? 's' : ''}` : 'aucun'}</div>
            </div>
          </div>

          {/* ── Receipt view ── */}
          {view === 'receipt' && (
            isLoading ? <LoadingState /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <SortHeader label="N° Vente" sortKey="sale_number" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Client" sortKey="customer" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Caissier" sortKey="cashier" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Paiement" sortKey="payment_method" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Total" sortKey="total" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="Heure" sortKey="created_at" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <th style={{ textAlign: 'right', width: 140 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSales.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                        {searchQuery ? 'Aucun résultat pour cette recherche' : 'Aucune vente pour cette période'}
                      </td></tr>
                    ) : sortedSales.map((s: Record<string, any>) => {
                      const isUnpaid = s.payment_status === 'unpaid';
                      const beneficiary = s.customer_first_name
                        ? `${s.customer_first_name} ${s.customer_last_name}`
                        : (s.unpaid_customer_name as string) || 'Client de passage';
                      const dotClass = isUnpaid ? 'warning' : 'ok';
                      return (
                      <tr key={s.id as string} className={isUnpaid ? 'row-warning' : ''}>
                        <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{s.sale_number as string}</span>
                            {(s.sale_type === 'advance') && <span className="odoo-tag odoo-tag-orange">Avance</span>}
                            {(s.sale_type === 'delivery') && <span className="odoo-tag odoo-tag-blue">Solde liv.</span>}
                            {isUnpaid && <span className="odoo-tag odoo-tag-yellow">Impayé</span>}
                          </span>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--theme-text-muted)' }}>
                            <User size={11} /> {beneficiary}
                          </span>
                        </td>
                        <td style={{ color: 'var(--theme-text-muted)' }}>{s.cashier_first_name as string} {s.cashier_last_name as string}</td>
                        <td>
                          {isUnpaid ? (
                            <span className="odoo-tag odoo-tag-orange">
                              <Clock size={9} style={{ display: 'inline', marginRight: 2 }} /> À encaisser
                            </span>
                          ) : (
                            <span className={`odoo-tag ${s.payment_method === 'cash' ? 'odoo-tag-green' : 'odoo-tag-blue'}`}>
                              {s.payment_method === 'cash' ? <Banknote size={9} style={{ display: 'inline', marginRight: 2 }} /> : <CreditCard size={9} style={{ display: 'inline', marginRight: 2 }} />}
                              {PAYMENT_LABELS[s.payment_method as string] || String(s.payment_method)}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 700 }}>{formatCurrency(parseFloat(s.total as string))}</span>
                        </td>
                        <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                          {format(new Date(s.created_at as string), 'HH:mm', { locale: fr })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            {isUnpaid && (
                              <button onClick={() => { setPayPaymentMethod('cash'); setPaySaleTarget(s); }}
                                title="Encaisser le paiement"
                                className="odoo-btn-primary"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: '0.6875rem' }}>
                                <Banknote size={11} /> Encaisser
                              </button>
                            )}
                            <button onClick={() => openReceipt(s.id as string)}
                              className="odoo-pager-btn" title="Voir le reçu">
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Category view ── */}
          {view === 'category' && (
            summaryLoading ? <LoadingState /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <SortHeader label="Catégorie" sortKey="label" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Articles vendus" sortKey="total_quantity" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="Nb ventes" sortKey="sale_count" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="CA" sortKey="total_revenue" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <th style={{ textAlign: 'right' }}>Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSummary.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune donnée pour cette période</td></tr>
                    ) : sortedSummary.map((row: Record<string, any>) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                              <LayoutGrid size={11} style={{ color: 'var(--theme-accent)' }} />
                              {row.label as string}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.total_quantity as string}</td>
                          <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{row.sale_count as string}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(rev)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 60, height: 4, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', background: 'var(--theme-accent)', width: `${pct}%` }} />
                              </span>
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Product view ── */}
          {view === 'product' && (
            summaryLoading ? <LoadingState /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>#</th>
                      <SortHeader label="Article" sortKey="label" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Catégorie" sortKey="category_name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                      <SortHeader label="Qté vendue" sortKey="total_quantity" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="Nb ventes" sortKey="sale_count" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="CA" sortKey="total_revenue" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <th style={{ textAlign: 'right' }}>Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSummary.length === 0 ? (
                      <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune donnée pour cette période</td></tr>
                    ) : sortedSummary.map((row: Record<string, any>, idx: number) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      const rankTag = idx === 0 ? 'odoo-tag-yellow' : idx === 1 ? 'odoo-tag-grey' : idx === 2 ? 'odoo-tag-orange' : '';
                      return (
                        <tr key={row.id as string}>
                          <td style={{ color: 'var(--theme-text-muted)' }}>
                            {idx < 3 ? <span className={`odoo-tag ${rankTag}`}>{idx + 1}</span> : <span style={{ fontSize: '0.6875rem' }}>{idx + 1}</span>}
                          </td>
                          <td style={{ fontWeight: 500 }}>{row.label as string}</td>
                          <td>
                            {row.category_name ? (
                              <span className="odoo-tag odoo-tag-grey">{row.category_name as string}</span>
                            ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.total_quantity as string}</td>
                          <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{row.sale_count as string}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(rev)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 60, height: 4, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', background: 'var(--theme-accent)', width: `${pct}%` }} />
                              </span>
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Cashier view ── */}
          {view === 'cashier' && (
            summaryLoading ? <LoadingState /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Vendeuse / Caissier</th>
                      <th>Rôle</th>
                      <SortHeader label="Ventes" sortKey="sale_count" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="CA" sortKey="total_revenue" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <th style={{ textAlign: 'right' }}>Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune donnée pour cette période</td></tr>
                    ) : sortedSummary.map((row: Record<string, any>) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      return (
                        <tr key={row.id as string}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                              <User size={11} style={{ color: 'var(--theme-accent)' }} />
                              {row.label as string}
                            </span>
                          </td>
                          <td>
                            <span className="odoo-tag odoo-tag-grey">{ROLE_LABELS[row.role as string] || String(row.role)}</span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.sale_count as string}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(rev)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 60, height: 4, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', background: 'var(--theme-accent)', width: `${pct}%` }} />
                              </span>
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Payment view ── */}
          {view === 'payment' && (
            summaryLoading ? <LoadingState /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <th>Méthode</th>
                      <SortHeader label="Ventes" sortKey="sale_count" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="CA" sortKey="total_revenue" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                      <th style={{ textAlign: 'right' }}>Part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucune donnée pour cette période</td></tr>
                    ) : sortedSummary.map((row: Record<string, any>) => {
                      const rev = parseFloat(row.total_revenue as string);
                      const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                      const label = PAYMENT_LABELS[row.label as string] || row.label;
                      const isCash = row.label === 'cash';
                      return (
                        <tr key={row.label as string}>
                          <td>{isCash ? <Banknote size={13} style={{ color: '#28a745' }} /> : <CreditCard size={13} style={{ color: 'var(--theme-accent)' }} />}</td>
                          <td>
                            <span className={`odoo-tag ${isCash ? 'odoo-tag-green' : 'odoo-tag-blue'}`}>{label as string}</span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.sale_count as string}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(rev)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 80, height: 4, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', background: isCash ? '#28a745' : 'var(--theme-accent)', width: `${pct}%` }} />
                              </span>
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      {/* ═══════════ RETURNS TAB ═══════════ */}
      {mainTab === 'returns' && (
        returnsLoading ? <LoadingState /> : (
          <>
            {/* Returns summary tiles */}
            {(() => {
              const totalReturns = returns.filter((r: Record<string, any>) => r.type === 'return').length;
              const totalExchanges = returns.filter((r: Record<string, any>) => r.type === 'exchange').length;
              const totalRefund = returns
                .filter((r: Record<string, any>) => r.type === 'return')
                .reduce((sum: number, r: Record<string, any>) => sum + parseFloat(r.refund_amount as string), 0);
              return (
                <div className="odoo-stat-grid">
                  <div className="odoo-stat-card">
                    <div className="odoo-stat-card-label"><ArrowLeftRight size={11} style={{ display: 'inline', marginRight: 4 }} />Total opérations</div>
                    <div className="odoo-stat-card-value">{returns.length}</div>
                    <div className="odoo-stat-card-sub">retours + échanges</div>
                  </div>
                  <div className="odoo-stat-card">
                    <div className="odoo-stat-card-label"><RotateCcw size={11} style={{ display: 'inline', marginRight: 4 }} />Retours</div>
                    <div className="odoo-stat-card-value" style={{ color: totalReturns > 0 ? '#dc3545' : undefined }}>{totalReturns}</div>
                    <div className="odoo-stat-card-sub">remboursés</div>
                  </div>
                  <div className="odoo-stat-card">
                    <div className="odoo-stat-card-label"><ArrowLeftRight size={11} style={{ display: 'inline', marginRight: 4 }} />Échanges</div>
                    <div className="odoo-stat-card-value">{totalExchanges}</div>
                    <div className="odoo-stat-card-sub">croisés</div>
                  </div>
                  <div className="odoo-stat-card">
                    <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />Total remboursé</div>
                    <div className="odoo-stat-card-value" style={{ color: totalRefund > 0 ? '#dc3545' : undefined }}>{formatCurrency(totalRefund)}</div>
                    <div className="odoo-stat-card-sub">période</div>
                  </div>
                </div>
              );
            })()}

            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th style={{ width: 24 }}></th>
                    <th>N° Retour</th>
                    <th>Vente orig.</th>
                    <th>Type</th>
                    <th>Articles</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                    <th>Caissier</th>
                    <th>Date</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>Aucun retour ou échange pour cette période</td></tr>
                  ) : returns.map((r: Record<string, any>) => {
                    const items = (r.items || []) as Record<string, any>[];
                    const isReturn = r.type === 'return';
                    return (
                      <tr key={r.id as string}>
                        <td>{isReturn ? <RotateCcw size={13} style={{ color: '#dc3545' }} /> : <ArrowLeftRight size={13} style={{ color: 'var(--theme-accent)' }} />}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.return_number as string}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--theme-text-muted)' }}>{r.original_sale_number as string}</td>
                        <td><span className={`odoo-tag ${isReturn ? 'odoo-tag-red' : 'odoo-tag-blue'}`}>{isReturn ? 'Retour' : 'Échange'}</span></td>
                        <td style={{ color: 'var(--theme-text-muted)' }}>
                          {items.map((it, idx) => (
                            <div key={idx}>
                              {it.product_name as string} <span style={{ color: 'var(--theme-bg-separator)' }}>×{it.quantity as number}</span>
                            </div>
                          ))}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545' }}>{formatCurrency(parseFloat(r.refund_amount as string))}</td>
                        <td style={{ color: 'var(--theme-text-muted)' }}>{r.user_first_name as string} {r.user_last_name as string}</td>
                        <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{format(new Date(r.created_at as string), 'dd/MM HH:mm', { locale: fr })}</td>
                        <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(r.reason as string) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* ═══════════ SESSIONS TAB ═══════════ */}
      {mainTab === 'sessions' && (
        sessionsLoading ? <LoadingState /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sessions.map((s: Record<string, any>) => {
              const diff = s.difference !== null ? parseFloat(s.difference as string) : null;
              const isClosed = s.status === 'closed';
              const statusTag = !isClosed ? 'odoo-tag-yellow'
                : diff === null ? 'odoo-tag-grey'
                : diff === 0 ? 'odoo-tag-green'
                : diff > 0 ? 'odoo-tag-blue' : 'odoo-tag-red';
              const statusLabel = !isClosed ? 'En cours'
                : diff === null ? '—'
                : diff === 0 ? 'Caisse juste'
                : diff > 0 ? `+${diff.toFixed(2)} DH` : `${diff.toFixed(2)} DH`;
              const dotClass = !isClosed ? 'warning'
                : diff === 0 ? 'ok'
                : (diff !== null && Math.abs(diff) > 5) ? 'danger' : 'neutral';
              return (
                <div key={s.id as string} className="odoo-section">
                  <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`odoo-status-dot ${dotClass}`} />
                    <Lock size={13} style={{ color: 'var(--theme-text-muted)' }} />
                    <strong>{s.first_name as string} {s.last_name as string}</strong>
                    <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>
                      · {format(new Date(s.opened_at as string), 'dd/MM/yyyy HH:mm', { locale: fr })}
                      {s.closed_at as unknown as boolean && <> — {format(new Date(s.closed_at as string), 'HH:mm', { locale: fr })}</>}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className={`odoo-tag ${statusTag}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {!isClosed ? <Clock size={9} /> : diff === 0 ? <CheckCircle size={9} /> : diff !== null && diff > 0 ? <AlertTriangle size={9} /> : <XCircle size={9} />}
                      {statusLabel}
                    </span>
                  </div>

                  {isClosed && (
                    <div style={{ padding: '12px 16px' }}>
                      <table className="odoo-table" style={{ margin: 0, boxShadow: 'none' }}>
                        <tbody>
                          <tr>
                            <td style={{ color: 'var(--theme-text-muted)' }}>Fond de caisse</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(s.opening_amount as string))}</td>
                            <td style={{ color: 'var(--theme-text-muted)' }}>CA encaissé</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#28a745' }}>
                              {formatCurrency(parseFloat(s.total_revenue as string))}
                              <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontSize: '0.6875rem', fontWeight: 400 }}>
                                · {s.total_sales as number} op.
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td style={{ color: 'var(--theme-text-muted)' }}>Attendu</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(s.expected_cash as string))}</td>
                            <td style={{ color: 'var(--theme-text-muted)' }}>Saisi</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(s.actual_amount as string))}</td>
                          </tr>
                          <tr>
                            <td style={{ color: 'var(--theme-text-muted)' }}>
                              <Banknote size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Espèces
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(s.cash_revenue as string))}</td>
                            <td style={{ color: 'var(--theme-text-muted)' }}>
                              <CreditCard size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--theme-accent)' }} />Carte
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(parseFloat(s.card_revenue as string))}</td>
                          </tr>
                          {(parseFloat(s.total_advances as string || '0') > 0) && (
                            <tr>
                              <td style={{ color: 'var(--theme-text-muted)' }}>
                                <ClipboardList size={11} style={{ display: 'inline', marginRight: 4, color: '#b85d1a' }} />Avances reçues
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: '#b85d1a' }}>{formatCurrency(parseFloat(s.total_advances as string || '0'))}</td>
                              <td style={{ color: 'var(--theme-text-muted)' }}>Commandes en attente</td>
                              <td style={{ textAlign: 'right' }}>{parseInt(String(s.pending_orders ?? s.total_orders ?? 0))}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isClosed && (
                    s.inv_total_replenished !== null ||
                    s.inv_total_sold !== null ||
                    s.inv_total_remaining !== null ||
                    s.inv_total_discrepancy !== null
                  ) && (
                    <InventoryBilan session={s} />
                  )}

                  {s.notes && (
                    <div style={{ padding: '8px 16px', color: 'var(--theme-text-muted)', fontSize: '0.75rem', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={11} /> {s.notes as string}
                    </div>
                  )}
                </div>
              );
            })}
            {sessions.length === 0 && (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
                <p style={{ fontSize: '0.8125rem' }}>Aucune période de travail pour cette période</p>
              </div>
            )}
          </div>
        )
      )}

      {/* ═══════════ INVOICES TAB ═══════════ */}
      {mainTab === 'invoices' && <EmittedInvoicesTab />}

      </div>{/* close padded content */}

      {/* Receipt Modal */}
      {receiptData && (
        <ReceiptModal receipt={receiptData} onClose={() => setReceiptData(null)} />
      )}

      {/* Modal d'encaissement d'une vente impayée */}
      {paySaleTarget && (
        <ModalBackdrop onClose={() => setPaySaleTarget(null)} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center">
                <Banknote size={20} className="text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Encaisser la vente</h2>
                <p className="text-xs text-gray-500 font-mono">{paySaleTarget.sale_number as string}</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Bénéficiaire</span>
                <span className="font-medium text-gray-800">
                  {paySaleTarget.customer_first_name
                    ? `${paySaleTarget.customer_first_name} ${paySaleTarget.customer_last_name}`
                    : (paySaleTarget.unpaid_customer_name as string) || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Montant à encaisser</span>
                <span className="text-xl font-bold text-primary-700">{formatCurrency(parseFloat(paySaleTarget.total as string))}</span>
              </div>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mb-5">
              <button onClick={() => setPayPaymentMethod('cash')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-semibold transition-all ${
                  payPaymentMethod === 'cash' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
                }`}>
                <Banknote size={15} /> Espèces
              </button>
              <button onClick={() => setPayPaymentMethod('card')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-semibold transition-all ${
                  payPaymentMethod === 'card' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
                }`}>
                <CreditCard size={15} /> Carte
              </button>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setPaySaleTarget(null)} className="btn-secondary flex-1">Annuler</button>
              <button onClick={() => paySaleMutation.mutate({ id: paySaleTarget.id as string, paymentMethod: payPaymentMethod })}
                disabled={paySaleMutation.isPending}
                className="btn-primary flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40">
                {paySaleMutation.isPending ? 'En cours...' : 'Encaisser'}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

// ═══ Loading State ═══
function LoadingState() {
  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--theme-bg-separator)', borderTopColor: 'var(--theme-accent)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
      <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
    </div>
  );
}

// ═══ Inventory Bilan per session ═══
function InventoryBilan({ session }: { session: Record<string, any> }) {
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

  const ecartTag = totalDiscrepancy === 0 ? 'odoo-tag-green'
    : totalDiscrepancy > 0 ? 'odoo-tag-red' : 'odoo-tag-blue';
  const ecartLabel = totalDiscrepancy === 0 ? 'Aucun écart'
    : totalDiscrepancy > 0 ? `−${totalDiscrepancy} manquant` : `+${Math.abs(totalDiscrepancy)} surplus`;

  return (
    <div style={{ margin: '0 16px 12px', borderTop: '1px solid var(--theme-bg-separator)' }}>
      <button onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.8125rem' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--theme-text)' }}>
          <Package size={13} style={{ color: 'var(--theme-accent)' }} />
          <strong>Bilan des produits</strong>
          <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>
            · {totalRep} approv. · {totalSold} vendus · {totalRemaining} restants
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={`odoo-tag ${ecartTag}`}>{ecartLabel}</span>
          {expanded ? <ChevronUp size={13} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        </span>
      </button>

      {expanded && items && items.length > 0 && (
        <table className="odoo-table" style={{ margin: '0 0 12px', boxShadow: 'none' }}>
          <thead>
            <tr>
              <th>Produit</th>
              <th style={{ textAlign: 'right' }}>Approv.</th>
              <th style={{ textAlign: 'right' }}>Vendu</th>
              <th style={{ textAlign: 'right' }}>Restant</th>
              <th style={{ textAlign: 'right' }}>Écart</th>
            </tr>
          </thead>
          <tbody>
            {(items as Record<string, any>[]).map((it, idx) => {
              const rep = parseInt(it.replenished_qty as string) || 0;
              const sold = parseInt(it.sold_qty as string) || 0;
              const rem = parseInt(it.remaining_qty as string) || 0;
              const disc = parseInt(it.discrepancy as string) || 0;
              const rowClass = disc > 0 ? 'row-danger' : disc < 0 ? '' : '';
              return (
                <tr key={idx} className={rowClass}>
                  <td>{it.product_name as string}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rep}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{sold}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rem}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: disc > 0 ? '#dc3545' : disc < 0 ? 'var(--theme-accent)' : '#28a745' }}>
                    {disc === 0 ? '✓' : disc > 0 ? `−${disc}` : `+${Math.abs(disc)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {expanded && items && items.length === 0 && (
        <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', textAlign: 'center', padding: '8px 0' }}>Aucun détail d'inventaire disponible</p>
      )}
    </div>
  );
}
