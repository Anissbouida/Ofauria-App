import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { salesApi } from '../../api/sales.api';
import { customersApi } from '../../api/customers.api';
import { ordersApi } from '../../api/orders.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { productionApi } from '../../api/production.api';
import { returnsApi } from '../../api/returns.api';
import api from '../../api/client';
import { ORDER_STATUS_LABELS, ROLE_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Minus, Plus, Trash2, Search, User, Lock, Unlock, AlertTriangle, CheckCircle, XCircle, ShoppingCart, ClipboardList, Phone, Package, Factory, LogOut, RotateCcw, ArrowLeftRight, Lightbulb, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import ReceiptModal from './ReceiptModal';
import OrderFormModal from '../../components/orders/OrderFormModal';
import { useAuth } from '../../context/AuthContext';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
}

interface ReceiptData {
  saleNumber: string;
  date: string;
  cashierName: string;
  customerName?: string;
  items: { name: string; quantity: number; unitPrice: number; subtotal: number }[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentMethod: string;
  cashGiven?: number;
  changeAmount?: number;
}

type PosTab = 'sell' | 'orders' | 'returns';

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  in_production: 'bg-yellow-100 text-yellow-700',
  ready: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function POSPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [posTab, setPosTab] = useState<PosTab>('sell');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [showPayment, setShowPayment] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [cashGiven, setCashGiven] = useState<number | null>(null);

  // Cash register state
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [actualAmount, setActualAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeStep, setCloseStep] = useState<'inventory' | 'input' | 'result'>('inventory');
  const [closeResult, setCloseResult] = useState<Record<string, unknown> | null>(null);
  const [inventoryItems, setInventoryItems] = useState<Record<string, unknown>[]>([]);
  const [inventoryQtys, setInventoryQtys] = useState<Record<string, number>>({});
  const [inventoryDone, setInventoryDone] = useState(false);

  // Order form state
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');

  // Production request state
  const [showProductionForm, setShowProductionForm] = useState(false);

  // Transfers confirmation state
  const [showTransfers, setShowTransfers] = useState(false);
  const [transferReceptionItems, setTransferReceptionItems] = useState<Record<string, Record<string, { qtyReceived: number; notes: string }>>>({});
  const [confirmingTransferId, setConfirmingTransferId] = useState<string | null>(null);

  // Return/Exchange state
  const [returnSearch, setReturnSearch] = useState('');
  const [returnSale, setReturnSale] = useState<Record<string, unknown> | null>(null);
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});
  const [returnType, setReturnType] = useState<'return' | 'exchange'>('return');
  const [returnReason, setReturnReason] = useState('');
  const [returnStep, setReturnStep] = useState<'search' | 'select' | 'confirm'>('search');
  // Exchange: map of saleItemId -> replacement productId
  const [exchangeProducts, setExchangeProducts] = useState<Record<string, string>>({});
  const [exchangeSearch, setExchangeSearch] = useState('');

  // Deliver state
  const [deliverOrder, setDeliverOrder] = useState<Record<string, unknown> | null>(null);
  const [deliverAmount, setDeliverAmount] = useState('');
  const [deliverPayment, setDeliverPayment] = useState<'cash' | 'card'>('cash');

  // Active session query
  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: ['cash-register-session'],
    queryFn: cashRegisterApi.currentSession,
  });

  const { data: productsData } = useQuery({
    queryKey: ['pos-products', { categoryId: selectedCategory, search, isAvailable: 'true' }],
    queryFn: () => productsApi.list({ categoryId: selectedCategory, search, isAvailable: 'true', limit: '500' }),
    enabled: !!activeSession,
  });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const { data: customersData } = useQuery({
    queryKey: ['customers-search', customerSearch],
    queryFn: () => customersApi.list({ search: customerSearch, limit: '5' }),
    enabled: customerSearch.length >= 2,
  });

  // Orders query for the orders tab
  const { data: ordersData } = useQuery({
    queryKey: ['pos-orders', orderSearch],
    queryFn: () => ordersApi.list({ limit: '50' }),
    enabled: !!activeSession && posTab === 'orders',
  });

  // Pending transfers for cashier confirmation
  const { data: pendingTransfers = [] } = useQuery({
    queryKey: ['pending-transfers'],
    queryFn: replenishmentApi.pendingTransfers,
    enabled: !!activeSession,
    refetchInterval: 30000, // Auto-refresh every 30s
  });

  // Pending production transfers
  const { data: pendingProductionTransfers = [] } = useQuery({
    queryKey: ['pending-production-transfers'],
    queryFn: productionApi.pendingTransfers,
    enabled: !!activeSession,
    refetchInterval: 30000,
  });

  const confirmTransferMutation = useMutation({
    mutationFn: ({ id, items }: { id: string; items: { itemId: string; qtyReceived: number; notes?: string }[] }) =>
      replenishmentApi.confirmReception(id, items),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pending-transfers'] });
      setConfirmingTransferId(null);
      if (data?.status === 'closed_with_discrepancy') {
        toast('Reception confirmee avec ecart', { icon: '⚠️' });
      } else {
        toast.success('Reception confirmee');
      }
    },
    onError: () => toast.error('Erreur lors de la confirmation'),
  });

  const confirmProductionTransferMutation = useMutation({
    mutationFn: ({ transferId, items }: { transferId: string; items: { itemId: string; qtyReceived: number; notes?: string }[] }) =>
      productionApi.confirmTransferReception(transferId, items),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pending-production-transfers'] });
      setConfirmingTransferId(null);
      if (data?.data?.status === 'received_with_discrepancy') {
        toast('Reception production confirmee avec ecart', { icon: '⚠️' });
      } else {
        toast.success('Reception production confirmee');
      }
      if (data?.data?.planCompleted) {
        toast.success('Plan de production termine — tous les articles recus !');
      }
    },
    onError: () => toast.error('Erreur lors de la confirmation'),
  });

  const openMutation = useMutation({
    mutationFn: (amount: number) => cashRegisterApi.open(amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-register-session'] });
      setShowOpenModal(false);
      setOpeningAmount('0');
      toast.success('Caisse ouverte !');
    },
    onError: () => toast.error('Erreur lors de l\'ouverture'),
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const data = await cashRegisterApi.close();
      // Load replenished items for inventory check (Rule 3)
      let invItems: Record<string, unknown>[] = [];
      try { invItems = await replenishmentApi.closingInventory() || []; } catch { /* no items */ }
      return { data, invItems };
    },
    onSuccess: ({ data, invItems }) => {
      setCloseResult(data);
      if (invItems.length > 0) {
        setInventoryItems(invItems);
        // Pre-fill remaining qty = replenished - sold (suggestion)
        const qtys: Record<string, number> = {};
        for (const it of invItems) {
          const rep = parseInt(it.replenished_qty as string) || 0;
          const sold = parseInt(it.sold_qty as string) || 0;
          qtys[it.product_id as string] = Math.max(0, rep - sold);
        }
        setInventoryQtys(qtys);
        setCloseStep('inventory');
        setInventoryDone(false);
      } else {
        setCloseStep('input');
        setInventoryDone(true);
      }
      setShowCloseModal(true);
    },
    onError: () => toast.error('Erreur lors de la fermeture'),
  });

  const submitAmountMutation = useMutation({
    mutationFn: () => cashRegisterApi.submitAmount(closeResult!.id as string, {
      actualAmount: parseFloat(actualAmount),
      notes: closeNotes || undefined,
    }),
    onSuccess: (data) => {
      setCloseResult(data);
      setCloseStep('result');
      // Don't invalidate here — wait until user clicks "Terminer"
      // Otherwise activeSession becomes null and the result screen is hidden
    },
    onError: () => toast.error('Erreur'),
  });

  const checkoutMutation = useMutation({
    mutationFn: salesApi.checkout,
    onSuccess: (sale: Record<string, unknown>) => {
      const receipt: ReceiptData = {
        saleNumber: sale.sale_number as string,
        date: sale.created_at as string,
        cashierName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
        customerName: customerSearch.length >= 2 ? customerSearch : undefined,
        items: cart.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.price, subtotal: i.price * i.quantity })),
        subtotal,
        discountAmount: 0,
        total,
        paymentMethod,
        cashGiven: paymentMethod === 'cash' && cashGiven !== null ? cashGiven : undefined,
        changeAmount: paymentMethod === 'cash' && cashGiven !== null && cashGiven >= total ? cashGiven - total : undefined,
      };
      setReceiptData(receipt);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setCart([]); setCustomerId(''); setCustomerSearch(''); setShowPayment(false); setCashGiven(null);
      toast.success('Vente enregistree !');
    },
    onError: () => toast.error('Erreur lors de la vente'),
  });


  const deliverMutation = useMutation({
    mutationFn: ({ id, amountPaid, paymentMethod }: { id: string; amountPaid: number; paymentMethod: string }) => ordersApi.deliver(id, { amountPaid, paymentMethod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setDeliverOrder(null);
      setDeliverAmount('');
      setDeliverPayment('cash');
      toast.success('Commande livree et vente enregistree !');
    },
    onError: (err: Error & { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message || 'Erreur lors de la livraison');
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ordersApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const searchSaleMutation = useMutation({
    mutationFn: (saleNumber: string) => returnsApi.searchSale(saleNumber),
    onSuccess: (sale: Record<string, unknown>) => {
      setReturnSale(sale);
      setReturnItems({});
      setReturnStep('select');
    },
  });

  const [returnResult, setReturnResult] = useState<Record<string, unknown> | null>(null);
  const createReturnMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => returnsApi.create(data),
    onSuccess: (data) => {
      setReturnResult(data);
      setReturnStep('confirm');
      setReturnItems({});
      setExchangeProducts({});
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });

  const products = productsData?.data || [];
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal;

  const orders = (ordersData?.data || []).filter((o: Record<string, unknown>) => {
    if (!orderSearch) return o.status !== 'completed' && o.status !== 'cancelled';
    const q = orderSearch.toLowerCase();
    const name = `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.toLowerCase();
    const num = (o.order_number as string || '').toLowerCase();
    const phone = (o.customer_phone as string || '').toLowerCase();
    return (name.includes(q) || num.includes(q) || phone.includes(q)) && o.status !== 'completed' && o.status !== 'cancelled';
  });

  const addToCart = (product: Record<string, unknown>) => {
    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      setCart(cart.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setCart([...cart, {
        productId: product.id as string,
        name: product.name as string,
        price: parseFloat(product.price as string),
        quantity: 1,
        imageUrl: product.image_url as string | undefined,
      }]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(cart.map(i => {
      if (i.productId === productId) {
        const newQty = i.quantity + delta;
        return newQty <= 0 ? null! : { ...i, quantity: newQty };
      }
      return i;
    }).filter(Boolean));
  };

  const handleCheckout = () => {
    checkoutMutation.mutate({
      customerId: customerId || undefined,
      items: cart.map(i => ({ productId: i.productId, quantity: i.quantity })),
      paymentMethod,
    });
  };


  const isCashierRole = user && ['cashier', 'saleswoman'].includes(user.role);

  if (sessionLoading) {
    return <div className={`flex items-center justify-center ${isCashierRole ? 'h-screen' : 'h-[calc(100vh-7rem)]'}`}><p className="text-gray-400">Chargement...</p></div>;
  }

  // No active session - show open register screen
  if (!activeSession) {
    return (
      <>
        <div className={`flex items-center justify-center ${isCashierRole ? 'h-screen' : 'h-[calc(100vh-7rem)]'}`}>
          <div className="text-center space-y-6">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
              <Lock size={40} className="text-gray-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Caisse fermee</h2>
              <p className="text-gray-500 mt-2">
                {isCashierRole && <span className="block text-lg text-gray-700 font-medium mb-1">Bonjour {user?.firstName} !</span>}
                Ouvrez la caisse pour commencer a vendre
              </p>
            </div>
            <button onClick={() => setShowOpenModal(true)} className="btn-primary px-8 py-3 text-lg">
              <Unlock size={20} className="inline mr-2" />
              Ouvrir la caisse
            </button>
            {isCashierRole && (
              <button onClick={logout} className="block mx-auto text-sm text-gray-400 hover:text-gray-600 transition-colors mt-4">
                <LogOut size={16} className="inline mr-1" />
                Deconnexion
              </button>
            )}
          </div>
        </div>
        {showOpenModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
              <h2 className="text-xl font-bold mb-4">Ouverture de caisse</h2>
              <label className="block text-sm font-medium text-gray-700 mb-2">Fond de caisse (DH)</label>
              <input type="number" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)}
                className="input text-center text-2xl font-bold mb-6" min="0" step="0.01" autoFocus />
              <div className="flex gap-3">
                <button onClick={() => setShowOpenModal(false)} className="btn-secondary flex-1">Annuler</button>
                <button onClick={() => openMutation.mutate(parseFloat(openingAmount) || 0)}
                  disabled={openMutation.isPending} className="btn-primary flex-1">
                  {openMutation.isPending ? 'En cours...' : 'Ouvrir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`flex gap-4 ${isCashierRole ? 'h-screen p-4' : 'h-[calc(100vh-7rem)]'}`}>
      {/* Left sidebar */}
      <div className="w-44 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden shrink-0">
        {/* Cashier identity header */}
        {isCashierRole && (
          <div className="p-3 border-b bg-primary-50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-bold">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{user?.firstName}</p>
                <p className="text-xs text-gray-500">Caisse</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="p-2 border-b space-y-1">
          <button onClick={() => setPosTab('sell')}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              posTab === 'sell' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            <ShoppingCart size={16} /> Vente
          </button>
          <button onClick={() => setPosTab('orders')}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              posTab === 'orders' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            <ClipboardList size={16} /> Commandes
          </button>
          <button onClick={() => { setPosTab('returns'); setReturnStep('search'); setReturnSale(null); setReturnSearch(''); }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              posTab === 'returns' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            <RotateCcw size={16} /> Retours
          </button>
        </div>

        {/* Categories (only in sell tab) */}
        {posTab === 'sell' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1.5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Categories</h3>
            </div>
            <button onClick={() => setSelectedCategory('')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                !selectedCategory ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
              }`}>
              Tous
            </button>
            {categories.map((c: { id: number; name: string }) => (
              <button key={c.id} onClick={() => setSelectedCategory(String(c.id))}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategory === String(c.id) ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
                }`}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Orders sidebar content */}
        {posTab === 'orders' && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button onClick={() => setShowOrderForm(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
              <Plus size={16} /> Nouvelle commande
            </button>
            <div className="px-2 py-1.5 mt-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Filtrer</h3>
            </div>
            <p className="px-2 text-xs text-gray-400">{orders.length} commande{orders.length > 1 ? 's' : ''} en cours</p>
          </div>
        )}

        {/* Bottom actions */}
        <div className="p-2 border-t space-y-1">
          {/* Pending transfers — always visible */}
          {(() => {
            const repCount = (pendingTransfers as Record<string, unknown>[]).length;
            const prodCount = (pendingProductionTransfers as Record<string, unknown>[]).length;
            const totalCount = repCount + prodCount;
            return (
              <button onClick={() => setShowTransfers(true)}
                className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  totalCount > 0
                    ? 'bg-purple-50 text-purple-700 hover:bg-purple-100 border-2 border-purple-300 animate-pulse font-bold'
                    : 'text-purple-600 hover:bg-purple-50'
                }`}>
                <Truck size={16} />
                <span className="flex-1 text-left">Reception transferts</span>
                {totalCount > 0 && (
                  <span className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[11px] font-bold">
                    {totalCount}
                  </span>
                )}
              </button>
            );
          })()}

          {/* Replenishment request */}
          <button onClick={() => setShowProductionForm(true)}
            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-2">
            <Package size={16} />
            Approvisionnement
          </button>

          {/* Close register */}
          <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}
            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2">
            <Lock size={16} />
            Fermer la caisse
          </button>

          {/* Logout for cashier */}
          {isCashierRole && (
            <button onClick={logout}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors flex items-center gap-2">
              <LogOut size={16} />
              Deconnexion
            </button>
          )}
        </div>
      </div>

      {/* ═══════════ SELL TAB ═══════════ */}
      {posTab === 'sell' && (
        <>
          {/* Center: Product Grid */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="mb-3">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 grid gap-2 content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(4.5cm, 1fr))', gridAutoRows: '5cm' }}>
              {products.map((p: Record<string, unknown>) => (
                <button key={p.id as string} onClick={() => addToCart(p)} className="bg-white rounded-xl p-1.5 text-left hover:shadow-md hover:border-primary-300 transition-all border border-gray-100 flex flex-col">
                  <div className="flex-1 w-full rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden">
                    {p.image_url ? (
                      <img src={p.image_url as string} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-2xl">🥖</span>
                    )}
                  </div>
                  <span className="font-medium text-xs line-clamp-2 leading-tight mt-1">{p.name as string}</span>
                  <span className="text-primary-600 font-bold text-xs pt-0.5">{parseFloat(p.price as string).toFixed(2)} DH</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Cart */}
          <div className="w-96 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
            <div className="p-4 border-b">
              <h2 className="font-bold text-lg">Panier</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <p className="text-center text-gray-400 py-8">Le panier est vide</p>
              ) : cart.map((item) => (
                <div key={item.productId} className="flex items-center gap-3 py-2 border-b border-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.name}</p>
                    <p className="text-primary-600 text-sm">{item.price.toFixed(2)} DH</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQuantity(item.productId, -1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                      <Minus size={14} />
                    </button>
                    <span className="w-6 text-center font-medium text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.productId, 1)} className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center hover:bg-primary-200">
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="text-sm font-semibold w-16 text-right">{(item.price * item.quantity).toFixed(2)} DH</span>
                  <button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))} className="text-red-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t">
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Client (optionnel)..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className="input pl-9 text-sm py-1.5" />
              </div>
              {customersData?.data?.length > 0 && customerSearch.length >= 2 && (
                <div className="mt-1 bg-white border rounded-lg shadow-lg max-h-32 overflow-y-auto">
                  {customersData.data.map((c: Record<string, unknown>) => (
                    <button key={c.id as string} onClick={() => { setCustomerId(c.id as string); setCustomerSearch(`${c.first_name} ${c.last_name}`); }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">{c.first_name as string} {c.last_name as string}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t space-y-3">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-primary-600">{total.toFixed(2)} DH</span>
              </div>
              <button onClick={() => setShowPayment(true)} disabled={cart.length === 0} className="btn-primary w-full py-3 text-lg">
                Encaisser
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══════════ ORDERS TAB ═══════════ */}
      {posTab === 'orders' && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="mb-3">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Rechercher par nom, telephone ou n° commande..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="input pl-10" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3">
            {orders.length === 0 && <p className="text-center py-12 text-gray-400">Aucune commande en cours</p>}
            {orders.map((o: Record<string, unknown>) => {
              const totalAmt = parseFloat(o.total as string);
              const advanceAmt = parseFloat(o.advance_amount as string || '0');
              const remaining = totalAmt - advanceAmt;
              return (
                <div key={o.id as string} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold">{o.order_number as string}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[o.status as string]}`}>
                        {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS]}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      {o.customer_first_name && (
                        <span className="flex items-center gap-1">
                          <User size={13} /> {o.customer_first_name as string} {o.customer_last_name as string}
                        </span>
                      )}
                      {o.customer_phone && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Phone size={12} /> {o.customer_phone as string}
                        </span>
                      )}
                      {o.pickup_date && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Package size={12} /> {format(new Date(o.pickup_date as string), 'dd MMM', { locale: fr })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold">{totalAmt.toFixed(2)} DH</p>
                    {advanceAmt > 0 && (
                      <p className="text-xs text-gray-400">Avance: {advanceAmt.toFixed(2)} | Reste: {remaining.toFixed(2)}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {o.status === 'pending' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'confirmed' })}
                        className="text-xs bg-blue-600 text-white hover:bg-blue-700 py-1.5 px-3 rounded-lg">Confirmer</button>
                    )}
                    {o.status === 'confirmed' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'in_production' })}
                        className="text-xs bg-indigo-600 text-white hover:bg-indigo-700 py-1.5 px-3 rounded-lg">En production</button>
                    )}
                    {o.status === 'ready' && (
                      <button onClick={() => { setDeliverOrder(o); setDeliverAmount(String(remaining.toFixed(2))); }}
                        className="text-xs btn-primary py-1.5 px-3">Livrer</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════ RETURNS TAB ═══════════ */}
      {posTab === 'returns' && (
        <div className="flex-1 flex flex-col min-w-0">
          {returnStep === 'search' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 w-full max-w-md px-4">
                <RotateCcw size={48} className="mx-auto text-gray-300" />
                <h2 className="text-xl font-bold text-gray-700">Retour ou Echange</h2>
                <p className="text-sm text-gray-400">Recherchez la vente par son numero de ticket</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={returnSearch}
                    onChange={(e) => setReturnSearch(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter' && returnSearch) searchSaleMutation.mutate(returnSearch); }}
                    placeholder="Ex: VNT-20260404-0001"
                    className="input flex-1 text-center font-mono"
                    autoFocus
                  />
                  <button
                    onClick={() => returnSearch && searchSaleMutation.mutate(returnSearch)}
                    disabled={!returnSearch || searchSaleMutation.isPending}
                    className="btn-primary px-6">
                    {searchSaleMutation.isPending ? '...' : 'Rechercher'}
                  </button>
                </div>
                {searchSaleMutation.isError && (
                  <p className="text-red-500 text-sm">Vente non trouvee. Verifiez le numero.</p>
                )}
              </div>
            </div>
          )}

          {returnStep === 'confirm' && returnResult && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4 max-w-sm">
                <CheckCircle size={64} className="mx-auto text-green-500" />
                <h3 className="text-2xl font-bold text-gray-800">
                  {returnResult.type === 'exchange' ? 'Echange effectue' : 'Retour effectue'}
                </h3>
                <p className="text-gray-500">N° {returnResult.return_number as string}</p>
                {returnResult.type === 'return' && (
                  <p className="text-lg font-semibold text-red-600">
                    Remboursement : {parseFloat(returnResult.refund_amount as string).toFixed(2)} DH
                  </p>
                )}
                {returnResult.type === 'exchange' && returnResult.price_difference !== undefined && (
                  <div className="space-y-1">
                    {(returnResult.price_difference as number) > 0 && (
                      <p className="text-lg font-semibold text-orange-600">
                        Le client a paye : {(returnResult.price_difference as number).toFixed(2)} DH en plus
                      </p>
                    )}
                    {(returnResult.price_difference as number) < 0 && (
                      <p className="text-lg font-semibold text-blue-600">
                        Rendu au client : {Math.abs(returnResult.price_difference as number).toFixed(2)} DH
                      </p>
                    )}
                    {(returnResult.price_difference as number) === 0 && (
                      <p className="text-lg font-semibold text-green-600">Echange sans ecart de prix</p>
                    )}
                  </div>
                )}
                <button
                  onClick={() => {
                    setReturnResult(null);
                    setReturnSale(null);
                    setReturnSearch('');
                    setReturnReason('');
                    setReturnStep('search');
                  }}
                  className="mt-4 px-6 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors">
                  Nouvelle operation
                </button>
              </div>
            </div>
          )}

          {returnStep === 'select' && returnSale && (() => {
            const saleItems = (returnSale.items || []) as Record<string, unknown>[];
            const returnableItems = saleItems.filter(it => (it.returnable_quantity as number) > 0);
            const allReturned = returnableItems.length === 0;
            const selectedCount = Object.values(returnItems).filter(q => q > 0).length;
            const refundTotal = saleItems.reduce((sum, it) => {
              const qty = returnItems[it.id as string] || 0;
              return sum + qty * parseFloat(it.unit_price as string);
            }, 0);

            // Exchange: calculate new product total
            const allProducts = (productsData?.data || []) as Record<string, unknown>[];
            let exchangeNewTotal = 0;
            const selectedExchangeItems = Object.entries(returnItems).filter(([, q]) => q > 0);
            for (const [itemId] of selectedExchangeItems) {
              const newProdId = exchangeProducts[itemId];
              if (newProdId) {
                const newProd = allProducts.find(p => p.id === newProdId);
                if (newProd) exchangeNewTotal += parseFloat(newProd.price as string) * returnItems[itemId];
              }
            }
            const exchangeDiff = exchangeNewTotal - refundTotal;
            const exchangeReady = returnType === 'exchange' && selectedCount > 0 &&
              selectedExchangeItems.every(([itemId]) => !!exchangeProducts[itemId]);

            return (
              <div className="flex-1 flex flex-col">
                {/* Sale header */}
                <div className="bg-white rounded-xl p-4 mb-3 border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-lg">{returnSale.sale_number as string}</p>
                      <p className="text-sm text-gray-500">
                        {format(new Date(returnSale.created_at as string), "dd MMM yyyy 'a' HH:mm", { locale: fr })}
                        {' — '}{returnSale.cashier_first_name as string} {returnSale.cashier_last_name as string}
                      </p>
                      <p className="text-sm font-semibold text-primary-600 mt-1">Total: {parseFloat(returnSale.total as string).toFixed(2)} DH</p>
                    </div>
                    <button onClick={() => { setReturnStep('search'); setReturnSale(null); setReturnItems({}); setExchangeProducts({}); }}
                      className="text-sm text-gray-400 hover:text-gray-600">Autre vente</button>
                  </div>
                </div>

                {allReturned ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <CheckCircle size={48} className="mx-auto text-green-400" />
                      <p className="text-lg font-semibold text-gray-600">Tous les articles ont deja ete retournes</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Return type */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <button onClick={() => { setReturnType('return'); setExchangeProducts({}); }}
                        className={`p-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                          returnType === 'return' ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600'
                        }`}>
                        <RotateCcw size={18} /> Retour (remboursement)
                      </button>
                      <button onClick={() => setReturnType('exchange')}
                        className={`p-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                          returnType === 'exchange' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'
                        }`}>
                        <ArrowLeftRight size={18} /> Echange
                      </button>
                    </div>

                    {/* Items selection */}
                    <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-100 shadow-sm">
                      <div className="p-3 border-b bg-gray-50">
                        <p className="text-sm font-semibold text-gray-600">
                          Selectionnez les articles a {returnType === 'return' ? 'retourner' : 'echanger'}
                        </p>
                      </div>
                      <div className="divide-y">
                        {returnableItems.map((item) => {
                          const itemId = item.id as string;
                          const qty = returnItems[itemId] || 0;
                          const maxQty = item.returnable_quantity as number;
                          const alreadyReturned = item.returned_quantity as number;
                          const selectedNewProd = exchangeProducts[itemId];
                          const newProd = selectedNewProd ? allProducts.find(p => p.id === selectedNewProd) : null;

                          return (
                            <div key={itemId} className={`p-3 ${qty > 0 ? (returnType === 'return' ? 'bg-red-50/50' : 'bg-blue-50/50') : ''}`}>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm">{item.product_name as string}</p>
                                  <p className="text-xs text-gray-400">
                                    {parseFloat(item.unit_price as string).toFixed(2)} DH x {item.quantity as number}
                                    {alreadyReturned > 0 && (
                                      <span className="text-orange-500 ml-1">({alreadyReturned} deja retourne{alreadyReturned > 1 ? 's' : ''})</span>
                                    )}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setReturnItems(prev => ({ ...prev, [itemId]: Math.max(0, (prev[itemId] || 0) - 1) }))}
                                    className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 text-sm font-bold"
                                    disabled={qty === 0}>−</button>
                                  <span className={`w-8 text-center font-bold text-sm ${qty > 0 ? (returnType === 'return' ? 'text-red-600' : 'text-blue-600') : 'text-gray-300'}`}>{qty}</span>
                                  <button onClick={() => setReturnItems(prev => ({ ...prev, [itemId]: Math.min(maxQty, (prev[itemId] || 0) + 1) }))}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                      returnType === 'return' ? 'bg-red-100 hover:bg-red-200 text-red-600' : 'bg-blue-100 hover:bg-blue-200 text-blue-600'
                                    }`}
                                    disabled={qty >= maxQty}>+</button>
                                </div>
                              </div>

                              {/* Exchange: product replacement picker */}
                              {returnType === 'exchange' && qty > 0 && (
                                <div className="mt-2 ml-0 p-2 bg-blue-50 rounded-lg border border-blue-100">
                                  <p className="text-xs font-medium text-blue-700 mb-1.5">Remplacer par :</p>
                                  {newProd ? (
                                    <div className="flex items-center justify-between bg-white rounded-lg p-2 border border-blue-200">
                                      <div>
                                        <p className="text-sm font-medium">{newProd.name as string}</p>
                                        <p className="text-xs text-gray-500">{parseFloat(newProd.price as string).toFixed(2)} DH</p>
                                      </div>
                                      <button onClick={() => setExchangeProducts(prev => { const n = { ...prev }; delete n[itemId]; return n; })}
                                        className="text-xs text-red-500 hover:text-red-700 font-medium">Changer</button>
                                    </div>
                                  ) : (
                                    <div>
                                      <input
                                        type="text"
                                        value={exchangeSearch}
                                        onChange={(e) => setExchangeSearch(e.target.value)}
                                        placeholder="Rechercher le produit..."
                                        className="input text-xs py-1.5 w-full mb-1"
                                      />
                                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                                        {allProducts
                                          .filter(p => !exchangeSearch || (p.name as string).toLowerCase().includes(exchangeSearch.toLowerCase()))
                                          .slice(0, 20)
                                          .map(p => (
                                            <button key={p.id as string}
                                              onClick={() => { setExchangeProducts(prev => ({ ...prev, [itemId]: p.id as string })); setExchangeSearch(''); }}
                                              className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-blue-100 flex justify-between items-center">
                                              <span className="truncate">{p.name as string}</span>
                                              <span className="font-semibold text-primary-600 shrink-0 ml-2">{parseFloat(p.price as string).toFixed(2)} DH</span>
                                            </button>
                                          ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Reason */}
                    <div className="mt-3">
                      <input type="text" value={returnReason} onChange={(e) => setReturnReason(e.target.value)}
                        placeholder="Motif (optionnel)..."
                        className="input text-sm w-full" />
                    </div>

                    {/* Footer */}
                    <div className="mt-3 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">{selectedCount} article(s) selectionne(s)</p>
                          {returnType === 'return' && refundTotal > 0 && (
                            <p className="text-lg font-bold text-red-600">Rembourser : {refundTotal.toFixed(2)} DH</p>
                          )}
                          {returnType === 'exchange' && exchangeReady && (
                            <>
                              {exchangeDiff === 0 && (
                                <p className="text-lg font-bold text-green-600">Echange sans ecart</p>
                              )}
                              {exchangeDiff > 0 && (
                                <p className="text-lg font-bold text-orange-600">Le client doit payer : {exchangeDiff.toFixed(2)} DH</p>
                              )}
                              {exchangeDiff < 0 && (
                                <p className="text-lg font-bold text-blue-600">Rendre au client : {Math.abs(exchangeDiff).toFixed(2)} DH</p>
                              )}
                            </>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            const returnItemsList = returnableItems
                              .filter(it => (returnItems[it.id as string] || 0) > 0)
                              .map(it => ({
                                saleItemId: it.id,
                                productId: it.product_id,
                                quantity: returnItems[it.id as string],
                                unitPrice: parseFloat(it.unit_price as string),
                                subtotal: returnItems[it.id as string] * parseFloat(it.unit_price as string),
                              }));
                            const exchangeData: Record<string, unknown> = {
                              originalSaleId: returnSale.id,
                              type: returnType,
                              reason: returnReason || undefined,
                              items: returnItemsList,
                            };
                            if (returnType === 'exchange') {
                              exchangeData.exchangeProducts = Object.entries(exchangeProducts)
                                .filter(([itemId]) => (returnItems[itemId] || 0) > 0)
                                .map(([itemId, productId]) => ({
                                  saleItemId: itemId,
                                  newProductId: productId,
                                  quantity: returnItems[itemId],
                                }));
                            }
                            createReturnMutation.mutate(exchangeData);
                          }}
                          disabled={
                            selectedCount === 0 || createReturnMutation.isPending ||
                            (returnType === 'exchange' && !exchangeReady)
                          }
                          className={`px-6 py-3 rounded-xl font-semibold text-white transition-colors disabled:opacity-50 ${
                            returnType === 'return' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                          }`}>
                          {createReturnMutation.isPending ? 'En cours...' : returnType === 'return' ? 'Confirmer le retour' : 'Confirmer l\'echange'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══════════ MODALS ═══════════ */}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold mb-4">Paiement</h2>
            <p className="text-3xl font-bold text-primary-600 text-center mb-4">{total.toFixed(2)} DH</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {(['cash', 'card'] as const).map(m => (
                <button key={m} onClick={() => { setPaymentMethod(m); if (m !== 'cash') setCashGiven(null); }}
                  className={`py-3 rounded-xl text-sm font-medium transition-colors ${paymentMethod === m ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {m === 'cash' ? 'Especes' : 'Carte bancaire'}
                </button>
              ))}
            </div>

            {/* Cash change calculator */}
            {paymentMethod === 'cash' && (
              <div className="mb-4 p-4 bg-gray-50 rounded-xl space-y-3">
                <p className="text-sm font-medium text-gray-600">Montant donne par le client</p>
                <div className="grid grid-cols-4 gap-2">
                  {[20, 50, 100, 200].map(amount => (
                    <button key={amount} onClick={() => setCashGiven(cashGiven === amount ? null : amount)}
                      className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${cashGiven === amount ? 'bg-primary-600 text-white ring-2 ring-primary-300' : 'bg-white border border-gray-200 text-gray-700 hover:border-primary-400'}`}>
                      {amount} DH
                    </button>
                  ))}
                </div>
                {cashGiven !== null && (
                  <div className={`p-3 rounded-lg text-center ${cashGiven >= total ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    {cashGiven >= total ? (
                      <>
                        <p className="text-sm text-green-700">Monnaie a rendre</p>
                        <p className="text-2xl font-bold text-green-700">{(cashGiven - total).toFixed(2)} DH</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-red-600">Montant insuffisant</p>
                        <p className="text-lg font-bold text-red-600">Il manque {(total - cashGiven).toFixed(2)} DH</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setShowPayment(false); setCashGiven(null); }} className="btn-secondary flex-1">Annuler</button>
              <button onClick={handleCheckout} disabled={checkoutMutation.isPending || (paymentMethod === 'cash' && cashGiven !== null && cashGiven < total)} className="btn-primary flex-1">
                {checkoutMutation.isPending ? 'En cours...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Order Modal — same interface as pre-orders */}
      {showOrderForm && (
        <OrderFormModal
          onClose={() => setShowOrderForm(false)}
          onSaved={() => {
            setShowOrderForm(false);
            queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
          }}
        />
      )}

      {/* Deliver Order Modal */}
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
                  {deliverMutation.isPending ? 'En cours...' : 'Confirmer'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Close Register Modal */}
      {showCloseModal && closeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* ═══ RULE 3: Inventory step ═══ */}
            {closeStep === 'inventory' ? (
              <>
                <h2 className="text-xl font-bold mb-1">Saisie des invendus en vitrine</h2>
                <p className="text-sm text-gray-500 mb-4">Saisissez les quantités restantes en vitrine pour chaque article approvisionné aujourd'hui.</p>
                <div className="space-y-2 mb-4">
                  <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-500 border-b pb-2">
                    <span className="col-span-1">Produit</span>
                    <span className="text-center">Approvisionné</span>
                    <span className="text-center">Vendu</span>
                    <span className="text-center">Restant</span>
                  </div>
                  {inventoryItems.map((it) => {
                    const pid = it.product_id as string;
                    const rep = parseInt(it.replenished_qty as string) || 0;
                    const sold = parseInt(it.sold_qty as string) || 0;
                    const remaining = inventoryQtys[pid] ?? 0;
                    const discrepancy = rep - sold - remaining;
                    return (
                      <div key={pid} className={`grid grid-cols-4 gap-2 items-center py-2 px-2 rounded-lg ${discrepancy !== 0 ? 'bg-amber-50' : ''}`}>
                        <span className="text-sm font-medium truncate" title={it.product_name as string}>
                          {it.product_name as string}
                        </span>
                        <span className="text-center text-sm font-semibold text-blue-700">{rep}</span>
                        <span className="text-center text-sm font-semibold text-green-700">{sold}</span>
                        <input type="number" min={0} max={rep}
                          value={remaining}
                          onChange={(e) => setInventoryQtys(prev => ({ ...prev, [pid]: Math.max(0, parseInt(e.target.value) || 0) }))}
                          className="input text-center py-1 text-sm font-bold" />
                      </div>
                    );
                  })}
                </div>
                {/* Summary */}
                {(() => {
                  let totalDiscrepancy = 0;
                  inventoryItems.forEach((it) => {
                    const pid = it.product_id as string;
                    const rep = parseInt(it.replenished_qty as string) || 0;
                    const sold = parseInt(it.sold_qty as string) || 0;
                    const remaining = inventoryQtys[pid] ?? 0;
                    totalDiscrepancy += rep - sold - remaining;
                  });
                  if (totalDiscrepancy !== 0) {
                    return (
                      <div className={`rounded-xl p-3 mb-4 flex items-center gap-2 text-sm ${totalDiscrepancy > 0 ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                        <AlertTriangle size={16} className={totalDiscrepancy > 0 ? 'text-red-500' : 'text-blue-500'} />
                        <span className={totalDiscrepancy > 0 ? 'text-red-700' : 'text-blue-700'}>
                          {totalDiscrepancy > 0
                            ? `Écart : ${totalDiscrepancy} unité(s) non justifiée(s) (perte/casse)`
                            : `Écart : ${Math.abs(totalDiscrepancy)} unité(s) en surplus`}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="rounded-xl p-3 mb-4 flex items-center gap-2 text-sm bg-green-50 border border-green-200">
                      <CheckCircle size={16} className="text-green-500" />
                      <span className="text-green-700">Inventaire cohérent — aucun écart.</span>
                    </div>
                  );
                })()}
                <div className="flex gap-3">
                  <button onClick={() => { setShowCloseModal(false); setActualAmount(''); setCloseNotes(''); }}
                    className="btn-secondary flex-1">Annuler</button>
                  <button onClick={async () => {
                    try {
                      const items = inventoryItems.map((it) => ({
                        productId: it.product_id as string,
                        productName: it.product_name as string,
                        replenishedQty: parseInt(it.replenished_qty as string) || 0,
                        soldQty: parseInt(it.sold_qty as string) || 0,
                        remainingQty: inventoryQtys[it.product_id as string] ?? 0,
                      }));
                      await replenishmentApi.saveInventoryCheck({
                        sessionId: closeResult?.id as string,
                        items,
                      });
                      toast.success('Inventaire enregistré');
                    } catch {
                      toast.error('Erreur lors de l\'enregistrement de l\'inventaire');
                    }
                    setInventoryDone(true);
                    setCloseStep('input');
                  }}
                    className="btn-primary flex-1">
                    Valider l'inventaire
                  </button>
                </div>
              </>
            ) : closeStep === 'input' ? (
              <>
                <h2 className="text-xl font-bold mb-2">Fermeture de caisse</h2>
                <p className="text-sm text-gray-500 mb-6">Comptez l'argent dans la caisse et saisissez le montant trouve.</p>
                <label className="block text-sm font-medium text-gray-700 mb-2">Montant trouve dans la caisse (DH)</label>
                <input type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)}
                  className="input text-center text-2xl font-bold mb-4" min="0" step="0.01" placeholder="0.00" autoFocus />
                <label className="block text-sm font-medium text-gray-700 mb-2">Observations (optionnel)</label>
                <textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)}
                  className="input mb-6" rows={2} placeholder="Remarques..." />
                <div className="flex gap-3">
                  <button onClick={() => { setShowCloseModal(false); setActualAmount(''); setCloseNotes(''); }}
                    className="btn-secondary flex-1">Annuler</button>
                  <button onClick={() => submitAmountMutation.mutate()}
                    disabled={!actualAmount || submitAmountMutation.isPending} className="btn-primary flex-1">
                    {submitAmountMutation.isPending ? 'En cours...' : 'Valider'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold mb-6 text-center">Resultat de la caisse</h2>
                <div className="space-y-4 mb-6">
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Fond de caisse</span>
                      <span className="font-medium">{parseFloat(closeResult.opening_amount as string).toFixed(2)} DH</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Ventes en especes</span>
                      <span className="font-medium">{parseFloat(closeResult.cash_revenue as string).toFixed(2)} DH</span>
                    </div>
                    {parseFloat(closeResult.total_advances as string) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avances commandes ({closeResult.total_orders as number})</span>
                        <span className="font-medium">{parseFloat(closeResult.total_advances as string).toFixed(2)} DH</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold border-t pt-2">
                      <span>Montant attendu</span>
                      <span>{parseFloat(closeResult.expected_cash as string).toFixed(2)} DH</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>Montant trouve</span>
                      <span>{parseFloat(closeResult.actual_amount as string).toFixed(2)} DH</span>
                    </div>
                  </div>
                  {(() => {
                    const diff = parseFloat(closeResult.difference as string);
                    if (diff === 0) {
                      return (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                          <CheckCircle size={24} className="text-green-500 shrink-0" />
                          <div>
                            <p className="font-semibold text-green-800">Caisse juste</p>
                            <p className="text-sm text-green-600">Le montant correspond parfaitement.</p>
                          </div>
                        </div>
                      );
                    } else if (diff > 0) {
                      return (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                          <AlertTriangle size={24} className="text-blue-500 shrink-0" />
                          <div>
                            <p className="font-semibold text-blue-800">Excedent de +{diff.toFixed(2)} DH</p>
                            <p className="text-sm text-blue-600">Il y a plus d'argent que prevu dans la caisse.</p>
                          </div>
                        </div>
                      );
                    } else {
                      return (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
                          <XCircle size={24} className="text-red-500 shrink-0" />
                          <div>
                            <p className="font-semibold text-red-800">Deficit de {diff.toFixed(2)} DH</p>
                            <p className="text-sm text-red-600">Il manque de l'argent dans la caisse.</p>
                          </div>
                        </div>
                      );
                    }
                  })()}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total ventes</span>
                      <span className="font-medium">{closeResult.total_sales as number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">CA total (tous moyens)</span>
                      <span className="font-semibold text-green-600">{parseFloat(closeResult.total_revenue as string).toFixed(2)} DH</span>
                    </div>
                  </div>

                  {/* ═══ Bilan produits : Approvisionné / Vendu / Restant / Écart ═══ */}
                  {inventoryItems.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-4 text-sm">
                      <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <Package size={16} className="text-indigo-500" />
                        Bilan des produits
                      </h3>
                      <div className="grid grid-cols-5 gap-1 text-xs font-medium text-gray-500 border-b pb-2 mb-2">
                        <span className="col-span-1">Produit</span>
                        <span className="text-center">Approv.</span>
                        <span className="text-center">Vendu</span>
                        <span className="text-center">Restant</span>
                        <span className="text-center">Écart</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {inventoryItems.map((it) => {
                          const pid = it.product_id as string;
                          const rep = parseInt(it.replenished_qty as string) || 0;
                          const sold = parseInt(it.sold_qty as string) || 0;
                          const remaining = inventoryQtys[pid] ?? 0;
                          const ecart = rep - sold - remaining;
                          return (
                            <div key={pid} className={`grid grid-cols-5 gap-1 items-center py-1.5 px-1 rounded ${ecart !== 0 ? (ecart > 0 ? 'bg-red-50' : 'bg-blue-50') : ''}`}>
                              <span className="text-xs font-medium truncate" title={it.product_name as string}>
                                {it.product_name as string}
                              </span>
                              <span className="text-center text-xs font-semibold text-blue-700">{rep}</span>
                              <span className="text-center text-xs font-semibold text-green-700">{sold}</span>
                              <span className="text-center text-xs font-semibold text-gray-700">{remaining}</span>
                              <span className={`text-center text-xs font-bold ${ecart > 0 ? 'text-red-600' : ecart < 0 ? 'text-blue-600' : 'text-green-600'}`}>
                                {ecart === 0 ? '✓' : ecart > 0 ? `-${ecart}` : `+${Math.abs(ecart)}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Totaux */}
                      {(() => {
                        let totalRep = 0, totalSold = 0, totalRemaining = 0, totalEcart = 0;
                        inventoryItems.forEach((it) => {
                          const pid = it.product_id as string;
                          const rep = parseInt(it.replenished_qty as string) || 0;
                          const sold = parseInt(it.sold_qty as string) || 0;
                          const remaining = inventoryQtys[pid] ?? 0;
                          totalRep += rep; totalSold += sold; totalRemaining += remaining;
                          totalEcart += rep - sold - remaining;
                        });
                        return (
                          <>
                            <div className="grid grid-cols-5 gap-1 items-center py-2 px-1 border-t mt-2 font-semibold text-xs">
                              <span>Total</span>
                              <span className="text-center text-blue-700">{totalRep}</span>
                              <span className="text-center text-green-700">{totalSold}</span>
                              <span className="text-center text-gray-700">{totalRemaining}</span>
                              <span className={`text-center font-bold ${totalEcart > 0 ? 'text-red-600' : totalEcart < 0 ? 'text-blue-600' : 'text-green-600'}`}>
                                {totalEcart === 0 ? '✓' : totalEcart > 0 ? `-${totalEcart}` : `+${Math.abs(totalEcart)}`}
                              </span>
                            </div>
                            {totalEcart !== 0 && (
                              <div className={`mt-2 rounded-lg p-2 flex items-center gap-2 ${totalEcart > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                <AlertTriangle size={14} />
                                <span className="text-xs font-medium">
                                  {totalEcart > 0
                                    ? `${totalEcart} unité(s) manquante(s) — perte/casse à justifier`
                                    : `${Math.abs(totalEcart)} unité(s) en surplus`}
                                </span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <button onClick={() => {
                  setShowCloseModal(false);
                  setCloseResult(null);
                  setActualAmount('');
                  setCloseNotes('');
                  setCloseStep('input');
                  queryClient.invalidateQueries({ queryKey: ['cash-register-session'] });
                  toast.success('Caisse fermée avec succès !');
                }} className="btn-primary w-full py-3">
                  Terminer
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Replenishment Request Modal */}
      {showProductionForm && (
        <ReplenishmentRequestModal
          onClose={() => setShowProductionForm(false)}
          onCreated={() => {
            setShowProductionForm(false);
            toast.success('Demande envoyee !');
          }}
        />
      )}

      {/* Transfers Confirmation Modal */}
      {showTransfers && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between bg-purple-50 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <Truck size={22} className="text-purple-600" />
                <div>
                  <h2 className="text-lg font-bold text-gray-800">Transferts en attente de confirmation</h2>
                  <p className="text-xs text-gray-500">{(pendingTransfers as Record<string, unknown>[]).length + (pendingProductionTransfers as Record<string, unknown>[]).length} transfert(s) a confirmer</p>
                </div>
              </div>
              <button onClick={() => { setShowTransfers(false); setConfirmingTransferId(null); }}
                className="p-2 hover:bg-gray-100 rounded-lg"><XCircle size={20} className="text-gray-400" /></button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {(pendingTransfers as Record<string, unknown>[]).map((transfer) => {
                const tId = transfer.id as string;
                const allItems = (transfer.items || []) as Record<string, unknown>[];
                const items = allItems.filter(i => i.status === 'ready');
                const isConfirming = confirmingTransferId === tId;
                const roleSuffix = (transfer.assigned_role as string) || '';
                const ROLE_LABELS_MAP: Record<string, string> = { baker: 'Boulanger', pastry_chef: 'Patissier', viennoiserie: 'Viennoiserie', beldi_sale: 'Beldi & Sale', general: 'General' };
                const ROLE_COLORS_MAP: Record<string, string> = { baker: 'border-amber-300 bg-amber-50', pastry_chef: 'border-pink-300 bg-pink-50', viennoiserie: 'border-orange-300 bg-orange-50', beldi_sale: 'border-green-300 bg-green-50', general: 'border-gray-300 bg-gray-50' };

                return (
                  <div key={tId} className={`border-2 rounded-xl overflow-hidden ${ROLE_COLORS_MAP[roleSuffix] || 'border-gray-200 bg-white'}`}>
                    {/* Transfer header */}
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-gray-800">{ROLE_LABELS_MAP[roleSuffix] || roleSuffix}</span>
                          <span className="text-xs text-gray-400">#{transfer.request_number as string}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Transfere par {transfer.transferred_by_name as string || '—'}
                          {transfer.transferred_at ? ` le ${format(new Date(transfer.transferred_at as string), 'dd/MM HH:mm', { locale: fr })}` : ''}
                        </p>
                      </div>
                      {!isConfirming ? (
                        <button onClick={() => {
                          setConfirmingTransferId(tId);
                          // Pre-fill with expected quantities
                          const presets: Record<string, { qtyReceived: number; notes: string }> = {};
                          for (const item of items) {
                            presets[item.id as string] = { qtyReceived: (item.qty_to_store as number) || 0, notes: '' };
                          }
                          setTransferReceptionItems(prev => ({ ...prev, [tId]: presets }));
                        }}
                          className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition flex items-center gap-2">
                          <CheckCircle size={16} /> Confirmer
                        </button>
                      ) : (
                        <button onClick={() => setConfirmingTransferId(null)}
                          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-50">
                          Annuler
                        </button>
                      )}
                    </div>

                    {/* Items table */}
                    <table className="w-full">
                      <thead className="bg-white/60 border-t">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Produit</th>
                          <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Attendu</th>
                          {isConfirming && (
                            <>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Recu</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Ecart</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Note</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.map((item) => {
                          const itemId = item.id as string;
                          const expected = (item.qty_to_store as number) || 0;
                          const receptionData = transferReceptionItems[tId]?.[itemId];
                          const received = receptionData?.qtyReceived ?? expected;
                          const diff = received - expected;

                          return (
                            <tr key={itemId} className={isConfirming && diff !== 0 ? 'bg-red-50/40' : ''}>
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                                <div className="text-[11px] text-gray-400">{item.category_name as string}</div>
                              </td>
                              <td className="text-center px-3 py-2.5 text-sm font-semibold text-gray-700">{expected}</td>
                              {isConfirming && (
                                <>
                                  <td className="text-center px-3 py-2.5">
                                    <input type="number" min={0} value={received}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setTransferReceptionItems(prev => ({
                                          ...prev,
                                          [tId]: { ...prev[tId], [itemId]: { ...(prev[tId]?.[itemId] || { qtyReceived: 0, notes: '' }), qtyReceived: val } }
                                        }));
                                      }}
                                      className={`input text-sm py-1.5 w-16 text-center ${diff !== 0 ? 'border-red-300 bg-red-50' : ''}`} />
                                  </td>
                                  <td className="text-center px-3 py-2.5">
                                    {diff === 0 ? <CheckCircle size={16} className="mx-auto text-green-500" /> :
                                      <span className={`text-sm font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>{diff > 0 ? '+' : ''}{diff}</span>}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <input type="text" placeholder="..." value={receptionData?.notes || ''}
                                      onChange={(e) => {
                                        setTransferReceptionItems(prev => ({
                                          ...prev,
                                          [tId]: { ...prev[tId], [itemId]: { ...(prev[tId]?.[itemId] || { qtyReceived: expected, notes: '' }), notes: e.target.value } }
                                        }));
                                      }}
                                      className="input text-sm py-1.5 w-full" />
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Confirm button */}
                    {isConfirming && (
                      <div className="px-4 py-3 border-t bg-white/80 flex justify-end">
                        <button
                          onClick={() => {
                            const receptionData = transferReceptionItems[tId] || {};
                            const itemsToSend = items.map((item) => {
                              const itemId = item.id as string;
                              const r = receptionData[itemId] || { qtyReceived: (item.qty_to_store as number) || 0, notes: '' };
                              return { itemId, qtyReceived: r.qtyReceived, notes: r.notes || undefined };
                            });
                            confirmTransferMutation.mutate({ id: tId, items: itemsToSend });
                          }}
                          disabled={confirmTransferMutation.isPending}
                          className="px-6 py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition flex items-center gap-2">
                          <CheckCircle size={16} />
                          {confirmTransferMutation.isPending ? 'Confirmation...' : 'Valider la reception'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ═══ Production transfers ═══ */}
              {(pendingProductionTransfers as Record<string, unknown>[]).length > 0 && (
                <div className="mt-2">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <Factory size={14} /> Transferts de production
                  </h3>
                </div>
              )}
              {(pendingProductionTransfers as Record<string, unknown>[]).map((transfer) => {
                const tId = `prod_${transfer.id as string}`;
                const transferId = transfer.id as string;
                const prodItems = (transfer.items || []) as Record<string, unknown>[];
                const isConfirming = confirmingTransferId === tId;
                const ROLE_LABELS_MAP: Record<string, string> = { baker: 'Boulanger', pastry_chef: 'Patissier', viennoiserie: 'Viennoiserie', beldi_sale: 'Beldi & Sale' };
                const ROLE_COLORS_MAP: Record<string, string> = { baker: 'border-amber-300 bg-amber-50', pastry_chef: 'border-pink-300 bg-pink-50', viennoiserie: 'border-orange-300 bg-orange-50', beldi_sale: 'border-green-300 bg-green-50' };
                const targetRole = (transfer.target_role as string) || '';

                return (
                  <div key={tId} className={`border-2 rounded-xl overflow-hidden ${ROLE_COLORS_MAP[targetRole] || 'border-blue-200 bg-blue-50'}`}>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Factory size={14} className="text-blue-600" />
                          <span className="font-bold text-sm text-gray-800">Production — {ROLE_LABELS_MAP[targetRole] || targetRole || 'General'}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Transfere par {transfer.transferred_by_name as string || '—'}
                          {transfer.transferred_at ? ` le ${format(new Date(transfer.transferred_at as string), 'dd/MM HH:mm', { locale: fr })}` : ''}
                        </p>
                      </div>
                      {!isConfirming ? (
                        <button onClick={() => {
                          setConfirmingTransferId(tId);
                          const presets: Record<string, { qtyReceived: number; notes: string }> = {};
                          for (const item of prodItems) {
                            presets[item.id as string] = { qtyReceived: (item.transferred_quantity as number) || 0, notes: '' };
                          }
                          setTransferReceptionItems(prev => ({ ...prev, [tId]: presets }));
                        }}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition flex items-center gap-2">
                          <CheckCircle size={16} /> Confirmer
                        </button>
                      ) : (
                        <button onClick={() => setConfirmingTransferId(null)}
                          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-50">
                          Annuler
                        </button>
                      )}
                    </div>

                    <table className="w-full">
                      <thead className="bg-white/60 border-t">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Produit</th>
                          <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Attendu</th>
                          {isConfirming && (
                            <>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Recu</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Ecart</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Note</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {prodItems.map((item) => {
                          const itemId = item.id as string;
                          const expected = (item.transferred_quantity as number) || 0;
                          const receptionData = transferReceptionItems[tId]?.[itemId];
                          const received = receptionData?.qtyReceived ?? expected;
                          const diff = received - expected;

                          return (
                            <tr key={itemId} className={isConfirming && diff !== 0 ? 'bg-red-50/40' : ''}>
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-sm text-gray-800">{item.product_name as string}</div>
                              </td>
                              <td className="text-center px-3 py-2.5 text-sm font-semibold text-gray-700">{expected}</td>
                              {isConfirming && (
                                <>
                                  <td className="text-center px-3 py-2.5">
                                    <input type="number" min={0} value={received}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setTransferReceptionItems(prev => ({
                                          ...prev,
                                          [tId]: { ...prev[tId], [itemId]: { ...(prev[tId]?.[itemId] || { qtyReceived: 0, notes: '' }), qtyReceived: val } }
                                        }));
                                      }}
                                      className={`input text-sm py-1.5 w-16 text-center ${diff !== 0 ? 'border-red-300 bg-red-50' : ''}`} />
                                  </td>
                                  <td className="text-center px-3 py-2.5">
                                    {diff === 0 ? <CheckCircle size={16} className="mx-auto text-green-500" /> :
                                      <span className={`text-sm font-bold ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>{diff > 0 ? '+' : ''}{diff}</span>}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <input type="text" placeholder="..." value={receptionData?.notes || ''}
                                      onChange={(e) => {
                                        setTransferReceptionItems(prev => ({
                                          ...prev,
                                          [tId]: { ...prev[tId], [itemId]: { ...(prev[tId]?.[itemId] || { qtyReceived: expected, notes: '' }), notes: e.target.value } }
                                        }));
                                      }}
                                      className="input text-sm py-1.5 w-full" />
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {isConfirming && (
                      <div className="px-4 py-3 border-t bg-white/80 flex justify-end">
                        <button
                          onClick={() => {
                            const receptionData = transferReceptionItems[tId] || {};
                            const itemsToSend = prodItems.map((item) => {
                              const itemId = item.id as string;
                              const r = receptionData[itemId] || { qtyReceived: (item.transferred_quantity as number) || 0, notes: '' };
                              return { itemId, qtyReceived: r.qtyReceived, notes: r.notes || undefined };
                            });
                            confirmProductionTransferMutation.mutate({ transferId, items: itemsToSend });
                          }}
                          disabled={confirmProductionTransferMutation.isPending}
                          className="px-6 py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition flex items-center gap-2">
                          <CheckCircle size={16} />
                          {confirmProductionTransferMutation.isPending ? 'Confirmation...' : 'Valider la reception'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {(pendingTransfers as Record<string, unknown>[]).length === 0 && (pendingProductionTransfers as Record<string, unknown>[]).length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Truck size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Aucun transfert en attente</p>
                  <p className="text-sm mt-1">Tous les transferts ont ete confirmes.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {receiptData && (
        <ReceiptModal receipt={receiptData} onClose={() => setReceiptData(null)} autoPrintTriggered />
      )}
    </div>
  );
}

function ReplenishmentRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'suggestions' | 'catalog'>('suggestions');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('normal');
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [validationDone, setValidationDone] = useState(false);
  const [blockedItems, setBlockedItems] = useState<Array<{ productId: string; productName: string; unsoldQty: number; message: string }>>([]);

  // ═══ RULE 1: Check which products are already requested today ═══
  const { data: todayCheck } = useQuery({
    queryKey: ['replenishment-check-today'],
    queryFn: () => replenishmentApi.checkToday(),
  });
  const alreadyRequestedIds: string[] = todayCheck?.alreadyRequestedProductIds || [];

  const MARGIN = 1.10; // +10% margin

  const getDayName = () => {
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return days[new Date().getDay()];
  };

  // Fetch recommendations
  const { data: recommendations, isLoading: recoLoading } = useQuery({
    queryKey: ['replenishment-recommendations'],
    queryFn: () => replenishmentApi.recommendations(),
  });

  // Fetch all products for catalog mode
  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const products = (productsData?.data || []) as Record<string, unknown>[];

  // Auto-populate from recommendations on first load
  useEffect(() => {
    if (suggestionsLoaded) return;
    const recos = recommendations as Record<string, unknown>[] | undefined;
    if (!recos) return;

    const auto: Record<string, number> = {};

    if (recos.length > 0) {
      // Suggestions basées sur l'historique + 10% marge
      for (const r of recos) {
        const sold = parseInt(r.last_week_qty as string) || 0;
        const stock = parseFloat(r.current_stock as string) || 0;
        const suggested = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
        if (suggested > 0) {
          auto[r.product_id as string] = suggested;
        }
      }
    } else {
      // Pas de données historiques → suggestions aléatoires pour tester
      const available = products.filter(p => p.is_available !== false);
      const shuffled = [...available].sort(() => Math.random() - 0.5).slice(0, 15);
      for (const p of shuffled) {
        auto[p.id as string] = Math.floor(Math.random() * 10) + 2;
      }
    }

    if (Object.keys(auto).length > 0) {
      setSelected(auto);
      setSuggestionsLoaded(true);
      // Expand all categories by default
      const cats: Record<string, boolean> = {};
      const recos = recommendations as Record<string, unknown>[] | undefined;
      if (recos) for (const r of recos) cats[(r.category_name as string) || 'Autre'] = true;
      setExpandedCats(cats);
    }
  }, [recommendations, products, suggestionsLoaded]);

  const toggleCat = (cat: string) => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }));
  const selectAllCat = (items: Record<string, unknown>[]) => {
    const next = { ...selected };
    for (const item of items) {
      const pid = (item.product_id || item.id) as string;
      const sold = parseInt((item.last_week_qty as string) || '0') || 0;
      const stock = parseFloat((item.current_stock as string) || '0') || 0;
      const need = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
      next[pid] = need;
    }
    setSelected(next);
  };
  const deselectAllCat = (items: Record<string, unknown>[]) => {
    const next = { ...selected };
    for (const item of items) delete next[(item.product_id || item.id) as string];
    setSelected(next);
  };

  const categories = Array.from(
    new Map(
      products.filter((p) => p.category_name)
        .map((p) => [p.category_id as number, p.category_name as string])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filteredProducts = products.filter((p) => {
    if (activeCategory && String(p.category_id) !== activeCategory) return false;
    if (search && !(p.name as string).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const setQty = (productId: string, qty: number) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const totalSelected = Object.keys(selected).length;
  const totalQty = Object.values(selected).reduce((s, q) => s + q, 0);

  const createMutation = useMutation({
    mutationFn: replenishmentApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      onCreated();
    },
    onError: (error: unknown) => {
      const errData = (error as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
      const data = errData?.data as Record<string, unknown> | undefined;
      const err = data?.error as Record<string, unknown> | undefined;
      if (err?.code === 'ALL_PRODUCTS_ALREADY_REQUESTED') {
        toast.error(err.message as string);
      } else {
        toast.error('Erreur lors de la création de la demande');
      }
    },
  });

  const handleSubmit = async () => {
    const productIds = Object.keys(selected);
    if (!productIds.length) { toast.error('Sélectionnez au moins un produit'); return; }

    // ═══ RULE 2: Show unsold items warning (informative, not blocking) ═══
    if (!validationDone) {
      setSubmitting(true);
      try {
        const result = await replenishmentApi.checkItems(productIds);
        if (result.blockedItems?.length > 0) {
          setBlockedItems(result.blockedItems);
          setValidationDone(true);
          setSubmitting(false);
          return;
        }
      } catch (err) {
        console.error('Erreur de vérification des articles:', err);
        toast.error('Erreur lors de la vérification des articles');
        setSubmitting(false);
        return;
      }
    }

    const items = Object.entries(selected).map(([productId, requestedQuantity]) => ({ productId, requestedQuantity }));
    if (!items.length) { toast.error('Aucun article éligible à envoyer'); return; }
    setBlockedItems([]);
    setValidationDone(false);
    setSubmitting(false);
    createMutation.mutate({ priority, notes: notes || undefined, items });
  };

  // Group recommendations by category
  const recosByCategory = ((recommendations || []) as Record<string, unknown>[]).reduce((groups: Record<string, Record<string, unknown>[]>, item) => {
    const cat = (item.category_name as string) || 'Autre';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
    return groups;
  }, {});

  // For random suggestions when no history
  const hasHistory = ((recommendations || []) as Record<string, unknown>[]).length > 0;
  const randomByCategory = !hasHistory ? products.reduce((groups: Record<string, Record<string, unknown>[]>, p) => {
    const cat = (p.category_name as string) || 'Autre';
    if (!groups[cat]) groups[cat] = [];
    if (selected[p.id as string]) groups[cat].push(p);
    return groups;
  }, {}) : {};

  const displayCategories = hasHistory ? recosByCategory : randomByCategory;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white w-full h-full sm:rounded-2xl flex flex-col sm:m-4 sm:h-[calc(100vh-2rem)] sm:max-w-5xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-gradient-to-r from-indigo-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Package size={22} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">Approvisionnement</h2>
              <p className="text-xs text-gray-500">{hasHistory ? `Basé sur les ventes de ${getDayName()} dernier (+10%)` : 'Suggestions aléatoires — aucun historique'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* Rule 1: Warning if request already exists today */}
        {alreadyRequestedIds.length > 0 && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 shrink-0">
            <div className="flex items-center gap-2 text-blue-800">
              <Package size={16} className="text-blue-600 shrink-0" />
              <p className="text-xs">
                {alreadyRequestedIds.length} produit(s) deja demande(s) aujourd'hui — ils ne seront pas inclus.
              </p>
            </div>
          </div>
        )}

        {/* Unsold items info banner */}
        {blockedItems.length > 0 && (
          <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 shrink-0">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle size={16} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">Attention : {blockedItems.length} article(s) avec du stock non vendu</p>
                <p className="text-xs text-amber-600 mt-1">Ces articles ont encore du stock depuis le dernier approvisionnement. Vous pouvez quand meme les envoyer si necessaire.</p>
                <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                  {blockedItems.slice(0, 10).map(bi => (
                    <p key={bi.productId} className="text-xs text-amber-700">• {bi.productName} — {bi.unsoldQty} unite(s) restante(s)</p>
                  ))}
                  {blockedItems.length > 10 && <p className="text-xs text-amber-700 font-medium">... et {blockedItems.length - 10} autre(s)</p>}
                </div>
                <p className="text-xs text-amber-700 font-medium mt-2">Cliquez sur « Confirmer l'envoi » pour continuer malgre tout.</p>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="px-6 py-3 border-b bg-white shrink-0">
          <div className="flex items-center gap-3">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="input py-2 text-sm w-36">
              <option value="normal">🟢 Normale</option>
              <option value="high">🟠 Haute</option>
              <option value="urgent">🔴 Urgente</option>
            </select>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit..." className="input py-2 text-sm pl-9 w-full" />
            </div>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optionnel)" className="input py-2 text-sm w-56" />
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setMode('suggestions')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'suggestions' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>
                <Lightbulb size={13} className="inline -mt-0.5 mr-1" />Suggestions
              </button>
              <button onClick={() => setMode('catalog')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'catalog' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500'}`}>
                <Package size={13} className="inline -mt-0.5 mr-1" />Catalogue
              </button>
            </div>
          </div>
        </div>

        {/* ══════ SUGGESTIONS MODE ══════ */}
        {mode === 'suggestions' && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {recoLoading ? (
              <div className="text-center py-16 text-gray-400">
                <div className="animate-spin w-8 h-8 border-2 border-primary-200 border-t-primary-600 rounded-full mx-auto mb-3" />
                Chargement des suggestions...
              </div>
            ) : Object.keys(displayCategories).length > 0 ? (
              Object.entries(displayCategories).map(([catName, items]) => {
                const filtered = search ? (items as Record<string, unknown>[]).filter(i => ((i.product_name || i.name) as string).toLowerCase().includes(search.toLowerCase())) : (items as Record<string, unknown>[]);
                if (!filtered.length) return null;
                const isExpanded = expandedCats[catName] !== false;
                const catSelectedCount = filtered.filter(i => selected[((i.product_id || i.id) as string)]).length;

                return (
                  <div key={catName} className="border-b last:border-b-0">
                    <div onClick={() => toggleCat(catName)}
                      className="w-full flex items-center justify-between px-6 py-3 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer select-none">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${catSelectedCount > 0 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                          {catSelectedCount}
                        </span>
                        <span className="font-semibold text-sm text-gray-700">{catName}</span>
                        <span className="text-xs text-gray-400">{filtered.length} produit{filtered.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {catSelectedCount < filtered.length ? (
                          <button onClick={() => selectAllCat(filtered)} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 hover:bg-blue-50 rounded">
                            Tout sélectionner
                          </button>
                        ) : (
                          <button onClick={() => deselectAllCat(filtered)} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded">
                            Tout retirer
                          </button>
                        )}
                        <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="divide-y divide-gray-50">
                        {filtered.map((item) => {
                          const pid = (item.product_id || item.id) as string;
                          const sold = parseInt((item.last_week_qty as string) || '0') || 0;
                          const stock = parseFloat((item.current_stock as string) || '0') || 0;
                          const suggested = hasHistory ? Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock))) : (selected[pid] || 1);
                          const qty = selected[pid] || 0;
                          const isSelected = qty > 0;

                          return (
                            <div key={pid} className={`flex items-center gap-4 px-6 py-2.5 transition-colors ${isSelected ? 'bg-primary-50/50' : 'hover:bg-gray-50'}`}>
                              <button onClick={() => isSelected ? setQty(pid, 0) : setQty(pid, suggested)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300 hover:border-primary-400'}`}>
                                {isSelected && <CheckCircle size={14} className="text-white" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <span className={`text-sm ${isSelected ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                                  {(item.product_name || item.name) as string}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {hasHistory && (
                                  <>
                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600" title="Vendu">📊 {sold}</span>
                                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${stock > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`} title="Stock">📦 {Math.floor(stock)}</span>
                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium" title="Suggéré">💡 {suggested}</span>
                                  </>
                                )}
                              </div>
                              {isSelected ? (
                                <div className="flex items-center bg-white rounded-lg border border-primary-200 shrink-0 shadow-sm">
                                  <button onClick={() => setQty(pid, qty - 1)}
                                    className="w-8 h-8 flex items-center justify-center text-primary-600 font-bold hover:bg-primary-50 rounded-l-lg">−</button>
                                  <input type="number" min={1} value={qty}
                                    onChange={e => setQty(pid, parseInt(e.target.value) || 0)}
                                    className="w-12 text-center text-sm font-bold h-8 border-x border-primary-200 focus:outline-none focus:bg-primary-50" />
                                  <button onClick={() => setQty(pid, qty + 1)}
                                    className="w-8 h-8 flex items-center justify-center text-primary-600 font-bold hover:bg-primary-50 rounded-r-lg">+</button>
                                </div>
                              ) : (
                                <button onClick={() => setQty(pid, suggested)}
                                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-primary-100 hover:text-primary-700 transition-colors shrink-0">
                                  + Ajouter
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-16 text-gray-400">
                <Lightbulb size={40} className="mx-auto mb-3 opacity-30" />
                <p>Aucune suggestion disponible</p>
                <button onClick={() => setMode('catalog')} className="mt-3 text-primary-600 text-sm font-medium hover:underline">
                  → Sélectionner manuellement depuis le catalogue
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════ CATALOG MODE ══════ */}
        {mode === 'catalog' && (
          <div className="flex flex-1 min-h-0">
            <div className="w-44 shrink-0 border-r bg-gray-50 overflow-y-auto py-3 px-2 flex flex-col gap-1.5">
              <button type="button" onClick={() => setActiveCategory('')}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  !activeCategory ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                Tous
              </button>
              {categories.map(([id, name]) => (
                <button key={id} type="button" onClick={() => setActiveCategory(String(id))}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeCategory === String(id) ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  {name}
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-5 py-2 shrink-0">
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un produit..."
                  className="input text-base py-2.5 w-full" />
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredProducts.map((p) => {
                    const pid = p.id as string;
                    const qty = selected[pid] || 0;
                    const isSelected = qty > 0;
                    return (
                      <div key={pid}
                        className={`rounded-xl border-2 p-3 transition-all select-none ${
                          isSelected ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white active:border-gray-300'
                        }`}>
                        <div className="text-sm font-semibold text-gray-800 mb-1 leading-tight h-[2.5rem]" title={p.name as string}>
                          <span className="line-clamp-2">{p.name as string}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-3">
                          <span className="text-xs text-gray-400">{p.category_name as string}</span>
                        </div>
                        {!isSelected ? (
                          <button type="button" onClick={() => setQty(pid, 1)}
                            className="w-full py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium active:bg-primary-700 transition-colors">
                            <Plus size={16} className="inline -mt-0.5 mr-1" /> Ajouter
                          </button>
                        ) : (
                          <div className="flex items-center justify-between bg-white rounded-lg border border-primary-200 overflow-hidden">
                            <button type="button" onClick={() => setQty(pid, qty - 1)}
                              className="w-12 h-11 flex items-center justify-center text-xl font-bold text-primary-600 active:bg-primary-50">
                              {qty === 1 ? <Trash2 size={16} className="text-red-400" /> : '−'}
                            </button>
                            <input type="number" min={1} value={qty}
                              onChange={(e) => setQty(pid, parseInt(e.target.value) || 0)}
                              className="w-14 text-center text-lg font-bold border-x border-primary-200 h-11 focus:outline-none" />
                            <button type="button" onClick={() => setQty(pid, qty + 1)}
                              className="w-12 h-11 flex items-center justify-center text-xl font-bold text-primary-600 active:bg-primary-50">
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {filteredProducts.length === 0 && (
                  <div className="text-center py-8 text-gray-400">Aucun produit trouvé</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t bg-white px-6 py-3 shrink-0 rounded-b-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">
                {totalSelected > 0 ? (
                  <><strong className="text-primary-600">{totalSelected}</strong> produit{totalSelected > 1 ? 's' : ''} — <strong className="text-primary-600">{totalQty}</strong> unités</>
                ) : 'Aucun produit sélectionné'}
              </span>
              {totalSelected > 0 && (
                <button onClick={() => setSelected({})} className="text-xs text-red-500 hover:text-red-700 font-medium">
                  Tout vider
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary px-5 py-2.5">Annuler</button>
              <button type="button" onClick={handleSubmit} disabled={createMutation.isPending || submitting || !totalSelected}
                className="btn-primary px-6 py-2.5 disabled:opacity-50">
                {createMutation.isPending || submitting ? 'Vérification...' : validationDone ? 'Confirmer l\'envoi' : 'Envoyer la demande'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
