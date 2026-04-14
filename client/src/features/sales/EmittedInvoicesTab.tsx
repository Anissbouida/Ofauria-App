import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesApi, paymentsApi } from '../../api/accounting.api';
import { customersApi } from '../../api/customers.api';
import { ordersApi } from '../../api/orders.api';
import { productsApi } from '../../api/products.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, X, Check, Download, ChevronRight,
  ShoppingCart, Receipt, Loader2, Search, Coins,
  BarChart3, Users, Banknote,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useReferentiel } from '../../hooks/useReferentiel';

function n(val: number): string {
  return val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══ Composant recherche produit intelligent ═══ */
function ProductSearchInput({ products, value, onSelect, onChange }: {
  products: Record<string, unknown>[]; value: string;
  onSelect: (product: Record<string, unknown>) => void; onChange: (val: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query || query.length < 1) return products.slice(0, 10);
    const q = query.toLowerCase();
    return products.filter(p => {
      const name = (p.name as string || '').toLowerCase();
      const cat = (p.category_name as string || '').toLowerCase();
      return name.includes(q) || cat.includes(q);
    }).slice(0, 10);
  }, [query, products]);

  const handleSelect = (product: Record<string, unknown>) => { setQuery(product.name as string); setIsOpen(false); onSelect(product); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlightIdx]) { e.preventDefault(); handleSelect(filtered[highlightIdx]); }
    else if (e.key === 'Escape') { setIsOpen(false); }
  };

  return (
    <div ref={wrapperRef} className="flex-1 relative">
      <div className="relative">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input ref={inputRef} type="text" placeholder="Rechercher un produit..." value={query}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setIsOpen(true); setHighlightIdx(0); }}
          onFocus={() => setIsOpen(true)} onKeyDown={handleKeyDown}
          className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((p, i) => (
            <button key={p.id as string} type="button" onClick={() => handleSelect(p)} onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${i === highlightIdx ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{p.name as string}</p>
                {p.category_name && <p className="text-[10px] text-gray-400">{p.category_name as string}</p>}
              </div>
              <span className="text-sm font-bold text-blue-600 ml-2 flex-shrink-0">{n(parseFloat(p.price as string) || 0)} DH</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Factures émises (clients) ═══ */
export default function EmittedInvoicesTab() {
  const queryClient = useQueryClient();
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState<'order' | 'manual'>('order');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showPayModal, setShowPayModal] = useState<Record<string, unknown> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualItems, setManualItems] = useState<{ productId: string; description: string; quantity: number; unitPrice: number }[]>([
    { productId: '', description: '', quantity: 1, unitPrice: 0 },
  ]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', 'emitted', statusFilter],
    queryFn: () => invoicesApi.list({ invoiceType: 'emitted', ...(statusFilter ? { status: statusFilter } : {}) }),
  });

  const { data: customersData } = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const customers = ((customersData as Record<string, unknown>)?.data || customersData || []) as Record<string, unknown>[];

  const { data: ordersData } = useQuery({
    queryKey: ['orders-for-invoice'],
    queryFn: () => ordersApi.list(),
    enabled: showCreateModal,
  });
  const orders = ((ordersData as Record<string, unknown>)?.data || ordersData || []) as Record<string, unknown>[];

  const createFromOrderMutation = useMutation({
    mutationFn: (orderId: string) => invoicesApi.createFromOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success('Facture émise créée');
      setShowCreateModal(false);
      setSelectedOrderId('');
    },
    onError: () => notify.error('Erreur lors de la création'),
  });

  const createManualMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => invoicesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success('Facture émise créée');
      setShowCreateModal(false);
      resetManualForm();
    },
    onError: () => notify.error('Erreur lors de la création'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture annulée'); },
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Encaissement enregistré');
      setShowPayModal(null);
    },
    onError: () => notify.error('Erreur'),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-for-invoice'],
    queryFn: () => productsApi.list({ limit: '500' }),
    enabled: showCreateModal && createMode === 'manual',
  });
  const products = ((productsData as Record<string, unknown>)?.data || productsData || []) as Record<string, unknown>[];

  const resetManualForm = () => {
    setManualCustomerId('');
    setManualNotes('');
    setManualItems([{ productId: '', description: '', quantity: 1, unitPrice: 0 }]);
  };

  const addManualItem = () => setManualItems([...manualItems, { productId: '', description: '', quantity: 1, unitPrice: 0 }]);
  const removeManualItem = (idx: number) => setManualItems(manualItems.filter((_, i) => i !== idx));
  const updateManualItem = (idx: number, field: string, value: string | number) => {
    const updated = [...manualItems];
    (updated[idx] as Record<string, unknown>)[field] = value;
    setManualItems(updated);
  };

  const manualTotal = manualItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0);

  const handleCreateManual = () => {
    if (!manualCustomerId) { notify.error('Veuillez sélectionner un client'); return; }
    if (manualItems.some(it => !it.description || it.unitPrice <= 0)) { notify.error('Veuillez remplir tous les articles'); return; }
    createManualMutation.mutate({
      invoiceType: 'emitted',
      customerId: manualCustomerId,
      invoiceDate: format(new Date(), 'yyyy-MM-dd'),
      amount: manualTotal,
      taxAmount: 0,
      totalAmount: manualTotal,
      notes: manualNotes,
      items: manualItems.map(it => ({
        productId: it.productId || undefined,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.quantity * it.unitPrice,
      })),
    });
  };

  const allInvoices = invoices as Record<string, unknown>[];
  const totalFacture = allInvoices.reduce((s, inv) => s + parseFloat(inv.total_amount as string), 0);
  const totalEncaisse = allInvoices.reduce((s, inv) => s + parseFloat(inv.paid_amount as string), 0);
  const totalToCollect = allInvoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string), 0);
  const countByStatus = {
    pending: allInvoices.filter(inv => inv.status === 'pending').length,
    partial: allInvoices.filter(inv => inv.status === 'partial').length,
    paid: allInvoices.filter(inv => inv.status === 'paid').length,
    cancelled: allInvoices.filter(inv => inv.status === 'cancelled').length,
  };
  const tauxEncaissement = totalFacture > 0 ? Math.round((totalEncaisse / totalFacture) * 100) : 0;

  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return allInvoices;
    const q = searchQuery.toLowerCase();
    return allInvoices.filter(inv => {
      const num = (inv.invoice_number as string || '').toLowerCase();
      const customer = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.toLowerCase();
      const orderRef = (inv.order_number_ref as string || '').toLowerCase();
      return num.includes(q) || customer.includes(q) || orderRef.includes(q);
    });
  }, [allInvoices, searchQuery]);

  const handleDownloadPdf = async (inv: Record<string, unknown>) => {
    try {
      const response = await invoicesApi.downloadDocx(inv.id as string);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { notify.error('Erreur lors du téléchargement'); }
  };

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-blue-500/5 to-indigo-500/10 rounded-bl-[40px]" />
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><Receipt size={15} className="text-blue-500" /></div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total facturé</span>
          </div>
          <p className="text-2xl font-bold text-gray-800">{n(totalFacture)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{allInvoices.length} facture{allInvoices.length > 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-amber-500/5 to-orange-500/10 rounded-bl-[40px]" />
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><Coins size={15} className="text-amber-500" /></div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">À encaisser</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{n(totalToCollect)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{countByStatus.pending + countByStatus.partial} en cours</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-green-500/5 to-emerald-500/10 rounded-bl-[40px]" />
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center"><Check size={15} className="text-green-500" /></div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Encaissé</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{n(totalEncaisse)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{countByStatus.paid} soldée{countByStatus.paid > 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-indigo-500/5 to-purple-500/10 rounded-bl-[40px]" />
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center"><BarChart3 size={15} className="text-indigo-500" /></div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Taux encaissement</span>
          </div>
          <p className="text-2xl font-bold text-indigo-600">{tauxEncaissement}%</p>
          <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-purple-500 transition-all duration-500" style={{ width: `${tauxEncaissement}%` }} />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input type="text" placeholder="Rechercher par N°, client, commande..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-gray-50/50 placeholder:text-gray-300" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setStatusFilter('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!statusFilter ? 'bg-gray-800 text-white shadow-sm' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
              Tous <span className="ml-1 opacity-60">{allInvoices.length}</span>
            </button>
            <button onClick={() => setStatusFilter(statusFilter === 'pending' ? '' : 'pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${statusFilter === 'pending' ? 'bg-amber-500 text-white shadow-sm' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'pending' ? 'bg-white' : 'bg-amber-400'}`} /> En attente <span className="opacity-60">{countByStatus.pending}</span>
            </button>
            <button onClick={() => setStatusFilter(statusFilter === 'partial' ? '' : 'partial')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${statusFilter === 'partial' ? 'bg-blue-500 text-white shadow-sm' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'partial' ? 'bg-white' : 'bg-blue-400'}`} /> Partiel <span className="opacity-60">{countByStatus.partial}</span>
            </button>
            <button onClick={() => setStatusFilter(statusFilter === 'paid' ? '' : 'paid')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${statusFilter === 'paid' ? 'bg-green-500 text-white shadow-sm' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'paid' ? 'bg-white' : 'bg-green-400'}`} /> Encaissée <span className="opacity-60">{countByStatus.paid}</span>
            </button>
          </div>
          <button onClick={() => { setShowCreateModal(true); setCreateMode('order'); }}
            className="ml-auto px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 text-sm whitespace-nowrap">
            <Plus size={16} /> Nouvelle facture
          </button>
        </div>
      </div>

      {/* Invoice Table */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20">
          <Loader2 className="animate-spin text-blue-400 mb-3" size={24} />
          <p className="text-sm text-gray-400">Chargement des factures...</p>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center mb-4">
            <Receipt size={28} className="text-blue-300" />
          </div>
          <p className="text-gray-500 font-medium">{searchQuery ? 'Aucun résultat' : 'Aucune facture émise'}</p>
          {!searchQuery && (
            <button onClick={() => { setShowCreateModal(true); setCreateMode('order'); }}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-2">
              <Plus size={14} /> Créer une facture
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_140px_100px_120px_100px] gap-3 px-5 py-3 border-b border-gray-50 bg-gray-50/50">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Facture / Client</span>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Date</span>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Statut</span>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Montant</span>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</span>
          </div>
          <div className="divide-y divide-gray-50">
            {filteredInvoices.map(inv => {
              const total = parseFloat(inv.total_amount as string);
              const paid = parseFloat(inv.paid_amount as string);
              const remaining = total - paid;
              const progressPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
              const isExpanded = expandedId === inv.id;
              const customerName = inv.customer_first_name ? `${inv.customer_first_name} ${inv.customer_last_name || ''}` : 'Client inconnu';
              const statusConfig: Record<string, { dot: string; bg: string; text: string; label: string }> = {
                pending: { dot: 'bg-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', label: 'En attente' },
                partial: { dot: 'bg-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', label: 'Partiel' },
                paid: { dot: 'bg-green-400', bg: 'bg-green-50', text: 'text-green-700', label: 'Soldée' },
                overdue: { dot: 'bg-red-400', bg: 'bg-red-50', text: 'text-red-700', label: 'En retard' },
                cancelled: { dot: 'bg-gray-300', bg: 'bg-gray-50', text: 'text-gray-500', label: 'Annulée' },
              };
              const st = statusConfig[inv.status as string] || statusConfig.pending;
              return (
                <div key={inv.id as string}>
                  <div className={`group grid grid-cols-1 md:grid-cols-[1fr_140px_100px_120px_100px] gap-2 md:gap-3 px-5 py-3.5 items-center cursor-pointer transition-all ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-gray-50/50'}`}
                    onClick={() => setExpandedId(isExpanded ? null : inv.id as string)}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${inv.status === 'paid' ? 'bg-gradient-to-br from-green-400 to-emerald-500' : inv.status === 'cancelled' ? 'bg-gray-200' : 'bg-gradient-to-br from-blue-400 to-indigo-500'}`}>
                        <Receipt size={14} className="text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-gray-800 font-mono">{inv.invoice_number as string}</span>
                          {inv.order_number_ref && <span className="hidden sm:inline px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-500 text-[10px] font-mono">CMD {inv.order_number_ref as string}</span>}
                          <ChevronRight size={14} className={`text-gray-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5"><Users size={10} className="inline mr-1 relative -top-px" />{customerName}</p>
                      </div>
                    </div>
                    <div className="hidden md:block"><p className="text-sm text-gray-600">{format(new Date(inv.invoice_date as string), 'dd MMM yyyy', { locale: fr })}</p></div>
                    <div className="hidden md:block">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${st.bg} ${st.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                      </span>
                    </div>
                    <div className="hidden md:block text-right">
                      <p className="text-sm font-bold text-gray-800">{n(total)} <span className="text-[10px] font-normal text-gray-400">DH</span></p>
                      {remaining > 0 && inv.status !== 'cancelled' && <p className="text-[10px] text-amber-500 font-medium mt-0.5">Reste {n(remaining)} DH</p>}
                    </div>
                    <div className="hidden md:flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDownloadPdf(inv)} className="p-1.5 rounded-lg text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 transition-all opacity-0 group-hover:opacity-100" title="Télécharger PDF"><Download size={15} /></button>
                      {inv.status !== 'cancelled' && inv.status !== 'paid' && remaining > 0 && (
                        <button onClick={() => { setShowPayModal(inv); setPayMethod('cash'); }} className="p-1.5 rounded-lg text-gray-300 hover:text-green-600 hover:bg-green-50 transition-all opacity-0 group-hover:opacity-100" title="Encaisser"><Banknote size={15} /></button>
                      )}
                      {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                        <button onClick={() => cancelMutation.mutate(inv.id as string)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100" title="Annuler"><X size={14} /></button>
                      )}
                    </div>
                    <div className="flex md:hidden items-center justify-between">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${st.bg} ${st.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                      </span>
                      <p className="text-sm font-bold text-gray-800">{n(total)} DH</p>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-5 pb-4 bg-gradient-to-b from-blue-50/30 to-white">
                      <div className="ml-12 space-y-3">
                        {inv.status !== 'cancelled' && (
                          <div className="bg-white rounded-xl border border-gray-100 p-3">
                            <div className="flex items-center justify-between mb-2 text-xs">
                              <span className="text-gray-500 font-medium">Progression encaissement</span>
                              <span className="font-bold text-gray-700">{Math.round(progressPct)}%</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-500 ${progressPct >= 100 ? 'bg-gradient-to-r from-green-400 to-emerald-500' : progressPct > 0 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' : 'bg-gray-200'}`} style={{ width: `${progressPct}%` }} />
                            </div>
                            <div className="flex justify-between mt-2 text-[11px]">
                              <span className="text-green-600 font-medium">Encaissé: {n(paid)} DH</span>
                              {remaining > 0 && <span className="text-amber-600 font-medium">Reste: {n(remaining)} DH</span>}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                          <div className="bg-white rounded-xl border border-gray-100 p-2.5">
                            <span className="text-gray-400 block mb-0.5">Client</span>
                            <span className="text-gray-700 font-medium">{customerName}</span>
                          </div>
                          <div className="bg-white rounded-xl border border-gray-100 p-2.5">
                            <span className="text-gray-400 block mb-0.5">Date</span>
                            <span className="text-gray-700 font-medium">{format(new Date(inv.invoice_date as string), 'dd MMMM yyyy', { locale: fr })}</span>
                          </div>
                          {inv.order_number_ref && (
                            <div className="bg-white rounded-xl border border-gray-100 p-2.5">
                              <span className="text-gray-400 block mb-0.5">Commande</span>
                              <span className="text-indigo-600 font-mono font-medium">{inv.order_number_ref as string}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex md:hidden gap-2">
                          <button onClick={() => handleDownloadPdf(inv)} className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1.5"><Download size={14} /> Télécharger</button>
                          {inv.status !== 'cancelled' && inv.status !== 'paid' && remaining > 0 && (
                            <button onClick={() => { setShowPayModal(inv); setPayMethod('cash'); }} className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition-colors flex items-center justify-center gap-1.5"><Banknote size={14} /> Encaisser</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/30 flex items-center justify-between">
            <p className="text-xs text-gray-400">{filteredInvoices.length} facture{filteredInvoices.length > 1 ? 's' : ''}{searchQuery && ` pour "${searchQuery}"`}</p>
            <p className="text-xs font-semibold text-gray-600">Total: {n(filteredInvoices.reduce((s, inv) => s + parseFloat(inv.total_amount as string), 0))} DH</p>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setShowCreateModal(false); resetManualForm(); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center"><Receipt size={18} className="text-white" /></div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Nouvelle facture</h3>
                    <p className="text-xs text-gray-400">Créez une facture client</p>
                  </div>
                </div>
                <button onClick={() => { setShowCreateModal(false); resetManualForm(); }} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><X size={18} className="text-gray-400" /></button>
              </div>
              <div className="flex gap-1 mt-4 bg-gray-100 rounded-xl p-1">
                <button onClick={() => setCreateMode('order')} className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${createMode === 'order' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <ShoppingCart size={14} className="inline mr-1.5" />Depuis commande
                </button>
                <button onClick={() => setCreateMode('manual')} className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${createMode === 'manual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Pencil size={14} className="inline mr-1.5" />Saisie manuelle
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {createMode === 'order' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sélectionner une commande</label>
                    <select value={selectedOrderId} onChange={e => setSelectedOrderId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                      <option value="">-- Choisir une commande --</option>
                      {(orders as Record<string, unknown>[]).filter(o => o.status === 'completed' || o.status === 'delivered' || o.status === 'confirmed' || o.status === 'ready').map(o => (
                        <option key={o.id as string} value={o.id as string}>
                          {o.order_number as string} — {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}` : 'Client direct'} — {n(parseFloat(o.total as string))} DH
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedOrderId && (() => {
                    const sel = (orders as Record<string, unknown>[]).find(o => o.id === selectedOrderId);
                    return sel ? (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-blue-800">Commande {sel.order_number as string}</p>
                            <p className="text-xs text-blue-600 mt-0.5">{sel.customer_first_name ? `${sel.customer_first_name} ${sel.customer_last_name || ''}` : 'Client direct'}</p>
                          </div>
                          <p className="text-xl font-bold text-blue-800">{n(parseFloat(sel.total as string))} <span className="text-xs font-normal">DH</span></p>
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <button onClick={() => { if (selectedOrderId) createFromOrderMutation.mutate(selectedOrderId); }}
                    disabled={!selectedOrderId || createFromOrderMutation.isPending}
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {createFromOrderMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Générer la facture
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                    <select value={manualCustomerId} onChange={e => setManualCustomerId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                      <option value="">-- Sélectionner un client --</option>
                      {customers.map(c => (<option key={c.id as string} value={c.id as string}>{c.first_name as string} {c.last_name as string || ''}</option>))}
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Articles</label>
                      <button onClick={addManualItem} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium"><Plus size={12} /> Ajouter</button>
                    </div>
                    <div className="space-y-2">
                      {manualItems.map((item, idx) => (
                        <div key={idx} className="bg-gray-50 rounded-xl p-2.5 space-y-2 border border-gray-100">
                          <div className="flex items-center gap-2">
                            <ProductSearchInput products={products} value={item.description}
                              onSelect={(product) => { const updated = [...manualItems]; updated[idx] = { ...updated[idx], productId: product.id as string, description: product.name as string, unitPrice: parseFloat(product.price as string) || 0 }; setManualItems(updated); }}
                              onChange={(val) => { const updated = [...manualItems]; updated[idx] = { ...updated[idx], description: val, productId: '' }; setManualItems(updated); }} />
                            {manualItems.length > 1 && <button onClick={() => removeManualItem(idx)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 flex-shrink-0"><X size={14} /></button>}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-1 text-xs text-gray-400">
                              {item.productId && <Check size={12} className="text-green-500" />}
                              {item.productId ? <span className="text-green-600">Produit lié</span> : <span>Saisie libre</span>}
                            </div>
                            <input type="number" placeholder="Qté" value={item.quantity || ''} onChange={e => updateManualItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                              className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30" min="1" />
                            <input type="number" placeholder="Prix" value={item.unitPrice || ''} onChange={e => updateManualItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/30" min="0" step="0.01" />
                            <span className="text-xs text-gray-700 w-20 text-right font-bold">{n(item.quantity * item.unitPrice)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                    <input type="text" value={manualNotes} onChange={e => setManualNotes(e.target.value)} placeholder="Notes ou référence..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
                  </div>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-700">Total</span>
                    <span className="text-xl font-bold text-blue-800">{n(manualTotal)} <span className="text-xs font-normal">DH</span></span>
                  </div>
                  <button onClick={handleCreateManual} disabled={createManualMutation.isPending}
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {createManualMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Créer la facture
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {showPayModal && (() => {
        const inv = showPayModal;
        const total = parseFloat(inv.total_amount as string);
        const paid = parseFloat(inv.paid_amount as string);
        const remaining = total - paid;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPayModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center"><Banknote size={18} className="text-white" /></div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">Encaisser</h3>
                      <p className="text-xs text-gray-400 font-mono">{inv.invoice_number as string}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowPayModal(null)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><X size={18} className="text-gray-400" /></button>
                </div>
              </div>
              <form className="p-5 space-y-4" onSubmit={e => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const amount = parseFloat(fd.get('amount') as string);
                if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
                if (amount > remaining) { notify.error(`Le montant dépasse le reste à encaisser (${n(remaining)} DH)`); return; }
                payMutation.mutate({
                  invoiceId: inv.id as string, type: 'income', amount, paymentMethod: payMethod,
                  description: `Encaissement facture ${inv.invoice_number}`,
                  ...(payMethod === 'check' ? { checkNumber: fd.get('checkNumber') as string, checkDate: fd.get('checkDate') as string } : {}),
                });
              }}>
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-green-600">Total facture</span><span className="font-bold text-green-800">{n(total)} DH</span></div>
                  <div className="flex justify-between text-sm"><span className="text-green-600">Déjà encaissé</span><span className="font-medium text-green-700">{n(paid)} DH</span></div>
                  <div className="flex justify-between text-sm pt-2 border-t border-green-200/50"><span className="text-green-700 font-semibold">Reste à encaisser</span><span className="font-bold text-green-900 text-base">{n(remaining)} DH</span></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Montant</label>
                  <input name="amount" type="number" step="0.01" defaultValue={remaining} max={remaining}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 text-lg font-semibold text-center" /></div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
                  <div className="flex gap-2">
                    {(['cash', 'bank', 'check'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setPayMethod(m)}
                        className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${payMethod === m ? 'bg-green-500 text-white border-green-500 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {getPaymentLabel(m)}
                      </button>
                    ))}
                  </div>
                </div>
                {payMethod === 'check' && (
                  <div className="space-y-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">N° du chèque</label>
                      <input name="checkNumber" type="text" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Date du chèque</label>
                      <input name="checkDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" /></div>
                  </div>
                )}
                <button type="submit" disabled={payMutation.isPending}
                  className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {payMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Confirmer l'encaissement
                </button>
              </form>
            </div>
          </div>
        );
      })()}
    </>
  );
}
