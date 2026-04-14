import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { salesApi } from '../../api/sales.api';
import { customersApi } from '../../api/customers.api';
import { ordersApi } from '../../api/orders.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import { replenishmentApi } from '../../api/replenishment.api';
import { unsoldDecisionApi } from '../../api/unsold-decision.api';
import { productionApi } from '../../api/production.api';
import { returnsApi } from '../../api/returns.api';
import api, { serverUrl } from '../../api/client';
import { ORDER_STATUS_LABELS, ROLE_LABELS } from '@ofauria/shared';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Minus, Plus, Trash2, Search, User, Lock, Unlock, AlertTriangle, CheckCircle, XCircle, ShoppingCart, ClipboardList, Phone, Package, Factory, LogOut, RotateCcw, ArrowLeftRight, Lightbulb, Truck, Printer, Banknote, CreditCard, Coins, Layers } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ReceiptModal from './ReceiptModal';
import OrderFormModal from '../../components/orders/OrderFormModal';
import LossDeclarationModal from './LossDeclarationModal';
import { useAuth } from '../../context/AuthContext';
import { getApiErrorMessage } from '../../utils/api-error';

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
  advanceAmount?: number;
  advanceDate?: string;
  orderTotal?: number;
  isAdvanceReceipt?: boolean;
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
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [cashGiven, setCashGiven] = useState<number | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);

  // Correction 1: Auto-scroll cart to last added item
  const cartEndRef = useRef<HTMLDivElement>(null);
  const cartScrollTrigger = useRef(0);

  // Correction 2: Numpad for quantity editing
  const [numpadItem, setNumpadItem] = useState<{ productId: string; name: string } | null>(null);
  const [numpadValue, setNumpadValue] = useState('');

  // Cash register state
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [actualAmount, setActualAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeStep, setCloseStep] = useState<'choose-type' | 'inventory' | 'input' | 'result'>('choose-type');
  const [closeType, setCloseType] = useState<'passation' | 'fin_journee'>('fin_journee');
  const DENOMINATIONS = [
    { value: 0.5, label: '0.50', type: 'coin', img: '/images/money/coin-050.svg' },
    { value: 1, label: '1', type: 'coin', img: '/images/money/coin-1.svg' },
    { value: 2, label: '2', type: 'coin', img: '/images/money/coin-2.svg' },
    { value: 5, label: '5', type: 'coin', img: '/images/money/coin-5.svg' },
    { value: 10, label: '10', type: 'coin', img: '/images/money/coin-10.svg' },
    { value: 20, label: '20', type: 'bill', img: '/images/money/bill-20.svg' },
    { value: 50, label: '50', type: 'bill', img: '/images/money/bill-50.svg' },
    { value: 100, label: '100', type: 'bill', img: '/images/money/bill-100.svg' },
    { value: 200, label: '200', type: 'bill', img: '/images/money/bill-200.svg' },
  ] as const;
  const [denomCounts, setDenomCounts] = useState<Record<number, number>>(
    () => Object.fromEntries(DENOMINATIONS.map(d => [d.value, 0]))
  );
  const denomTotal = DENOMINATIONS.reduce((sum, d) => sum + d.value * (denomCounts[d.value] || 0), 0);
  const [closeInputMode, setCloseInputMode] = useState<'direct' | 'counting'>('direct');
  // Keep actualAmount synced with denomination total when in counting mode
  useEffect(() => {
    if (closeStep === 'input' && closeInputMode === 'counting') setActualAmount(denomTotal.toString());
  }, [denomTotal, closeStep, closeInputMode]);
  const [closeResult, setCloseResult] = useState<Record<string, unknown> | null>(null);
  const [inventoryItems, setInventoryItems] = useState<Record<string, unknown>[]>([]);
  const [inventoryQtys, setInventoryQtys] = useState<Record<string, number>>({});
  const [inventoryDestinations, setInventoryDestinations] = useState<Record<string, string>>({});
  const [inventoryDone, setInventoryDone] = useState(false);

  // Loss declaration state
  const [showLossModal, setShowLossModal] = useState(false);

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

  // Last closed session amount (for pre-filling opening amount)
  const { data: lastClosedData } = useQuery({
    queryKey: ['last-closed-amount'],
    queryFn: cashRegisterApi.lastClosedAmount,
    enabled: !activeSession && !sessionLoading,
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
        notify('Reception confirmee avec ecart', { icon: '⚠️' });
      } else {
        notify.success('Reception confirmee');
      }
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la confirmation')),
  });

  const confirmProductionTransferMutation = useMutation({
    mutationFn: ({ transferId, items }: { transferId: string; items: { itemId: string; qtyReceived: number; notes?: string }[] }) =>
      productionApi.confirmTransferReception(transferId, items),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pending-production-transfers'] });
      setConfirmingTransferId(null);
      if (data?.data?.status === 'received_with_discrepancy') {
        notify('Reception production confirmee avec ecart', { icon: '⚠️' });
      } else {
        notify.success('Reception production confirmee');
      }
      if (data?.data?.planCompleted) {
        notify.success('Plan de production termine — tous les articles recus !');
      }
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la confirmation')),
  });

  const openMutation = useMutation({
    mutationFn: (amount: number) => cashRegisterApi.open(amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-register-session'] });
      setShowOpenModal(false);
      setOpeningAmount('0');
      notify.success('Caisse ouverte !');
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de l\'ouverture')),
  });

  const closeMutation = useMutation({
    mutationFn: async (type: 'passation' | 'fin_journee') => {
      const data = await cashRegisterApi.close(type);
      // Load unsold items with intelligent suggestions
      let invItems: Record<string, unknown>[] = [];
      try { invItems = await unsoldDecisionApi.suggestions() || []; } catch { /* no items */ }
      return { data, invItems, type };
    },
    onSuccess: ({ data, invItems, type }) => {
      setCloseResult(data);
      setCloseType(type);
      if (invItems.length > 0) {
        setInventoryItems(invItems);
        // Pre-fill remaining qty = 0 (caissière doit saisir le comptage réel)
        const qtys: Record<string, number> = {};
        for (const it of invItems) {
          qtys[it.product_id as string] = 0;
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
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la fermeture')),
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
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la soumission')),
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
      setLastReceipt(receipt);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setCart([]); setCustomerId(''); setCustomerSearch(''); setCashGiven(null);
      notify.success('Vente enregistree !');
    },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la vente')),
  });


  const deliverMutation = useMutation({
    mutationFn: async ({ id, amountPaid, paymentMethod }: { id: string; amountPaid: number; paymentMethod: string }) => {
      const res = await ordersApi.deliver(id, { amountPaid, paymentMethod });
      // Fetch full order with items for receipt
      const fullOrder = await ordersApi.getById(id);
      return { ...res, _order: fullOrder, _paymentMethod: paymentMethod };
    },
    onSuccess: (data: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });

      // Show delivery receipt with full order data (including items)
      const order = data._order as Record<string, unknown>;
      const orderItems = (order.items || []) as Record<string, unknown>[];
      const orderSubtotal = parseFloat(order.subtotal as string) || 0;
      const discount = parseFloat(order.discount_amount as string) || 0;
      const orderTotal = parseFloat(order.total as string) || (orderSubtotal - discount);
      const advanceAmt = parseFloat(order.advance_amount as string || '0');

      setReceiptData({
        saleNumber: order.order_number as string,
        date: new Date().toISOString(),
        cashierName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
        customerName: (order.customer_first_name as string) || (order.customer_name as string) || undefined,
        items: orderItems.map((it: Record<string, unknown>) => ({
          name: (it.product_name as string) || 'Produit',
          quantity: parseInt(String(it.quantity)) || 1,
          unitPrice: parseFloat(it.unit_price as string),
          subtotal: parseFloat(it.subtotal as string),
        })),
        subtotal: orderSubtotal,
        discountAmount: discount,
        total: orderTotal,
        paymentMethod: data._paymentMethod as string,
        advanceAmount: advanceAmt > 0 ? advanceAmt : undefined,
        advanceDate: advanceAmt > 0 ? (order.created_at as string) : undefined,
      });

      setDeliverOrder(null);
      setDeliverAmount('');
      setDeliverPayment('cash');
      notify.success('Commande livree et vente enregistree !');
    },
    onError: (err: Error & { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err.response?.data?.error?.message || 'Erreur lors de la livraison');
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

  const products = (productsData?.data || []).filter((p: Record<string, unknown>) => Number(p.stock_quantity || 0) > 0);
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

  const [stockAlert, setStockAlert] = useState<{ productId: string; message: string } | null>(null);

  useEffect(() => {
    if (stockAlert) {
      const timer = setTimeout(() => setStockAlert(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [stockAlert]);

  const showStockAlert = (productId: string, stock: number) => {
    setStockAlert({ productId, message: `Max ${Math.floor(stock)} en stock` });
  };

  const getProductStock = (productId: string) => {
    const p = products.find((p: Record<string, unknown>) => p.id === productId);
    return p ? parseFloat(p.stock_quantity as string) || 0 : 0;
  };

  const addToCart = (product: Record<string, unknown>) => {
    const stock = parseFloat(product.stock_quantity as string) || 0;
    if (stock <= 0) return;
    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      if (existing.quantity >= stock) { showStockAlert(product.id as string, stock); return; }
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
    cartScrollTrigger.current++;
  };

  // Correction 1: Scroll to bottom on add
  useEffect(() => {
    if (cartScrollTrigger.current > 0) {
      cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cart]);

  // Correction 2: Numpad handlers
  const openNumpad = useCallback((productId: string, name: string, currentQty: number) => {
    setNumpadItem({ productId, name });
    setNumpadValue(String(currentQty));
  }, []);

  const closeNumpad = useCallback(() => {
    setNumpadItem(null);
    setNumpadValue('');
  }, []);

  const confirmNumpad = useCallback(() => {
    if (!numpadItem) return;
    const qty = parseInt(numpadValue) || 0;
    if (qty <= 0) {
      setCart(prev => prev.filter(i => i.productId !== numpadItem.productId));
    } else {
      const stock = getProductStock(numpadItem.productId);
      const finalQty = Math.min(qty, stock);
      if (qty > stock) showStockAlert(numpadItem.productId, stock);
      setCart(prev => prev.map(i => i.productId === numpadItem.productId ? { ...i, quantity: finalQty } : i));
    }
    closeNumpad();
  }, [numpadItem, numpadValue, closeNumpad]);

  const updateQuantity = (productId: string, delta: number) => {
    setCart(cart.map(i => {
      if (i.productId === productId) {
        const newQty = i.quantity + delta;
        if (newQty <= 0) return null!;
        if (delta > 0) {
          const stock = getProductStock(productId);
          if (newQty > stock) { showStockAlert(productId, stock); return i; }
        }
        return { ...i, quantity: newQty };
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
            <button onClick={() => { setOpeningAmount(''); setShowOpenModal(true); }}
              className="mx-auto flex flex-col items-center gap-1.5 px-8 py-4 bg-primary-50 text-primary-700 rounded-xl font-bold text-lg hover:bg-primary-100 transition-colors">
              <Unlock size={24} />
              <span>Ouvrir la caisse</span>
            </button>
            {isCashierRole && (
              <button onClick={logout} className="flex flex-col items-center gap-1 mx-auto px-4 py-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors mt-4">
                <LogOut size={18} />
                <span className="text-[10px] font-medium">Déconnexion</span>
              </button>
            )}
          </div>
        </div>
        {showOpenModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
              <h2 className="text-xl font-bold mb-2">Ouverture de caisse</h2>
              <p className="text-sm text-gray-500 mb-4">Saisissez le montant du fond de caisse.</p>
              <label className="block text-sm font-medium text-gray-700 mb-2">Fond de caisse (DH)</label>
              <input type="number" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)}
                className="input text-center text-2xl font-bold mb-6" min="0" step="0.01" placeholder="0.00" autoFocus />
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
    <div className={`flex flex-col ${isCashierRole ? 'h-screen' : 'h-[calc(100vh-7rem)]'}`} style={{ backgroundColor: 'var(--theme-bg-page)' }}>
      {/* ═══ Top Bar: Cashier + Tabs + Actions ═══ */}
      <div className="px-3 py-2 flex items-center gap-3 shrink-0" style={{ backgroundColor: 'var(--theme-bg-card)', borderBottom: '1px solid var(--theme-bg-separator)' }}>
        {/* Cashier identity */}
        {isCashierRole && (
          <div className="flex items-center gap-2 pr-3" style={{ borderRight: '1px solid var(--theme-bg-separator)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-cta-text)' }}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="hidden sm:block min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--theme-text-strong)' }}>{user?.firstName}</p>
              <p className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>Caisse</p>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setPosTab('sell')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
              posTab === 'sell' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <ShoppingCart size={15} /> Vente
          </button>
          <button onClick={() => setPosTab('orders')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
              posTab === 'orders' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <ClipboardList size={15} /> Commandes
          </button>
          <button onClick={() => { setPosTab('returns'); setReturnStep('search'); setReturnSale(null); setReturnSearch(''); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${
              posTab === 'returns' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <RotateCcw size={15} /> Retours
          </button>
        </div>

        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-1">
          {(() => {
            const repCount = (pendingTransfers as Record<string, unknown>[]).length;
            const prodCount = (pendingProductionTransfers as Record<string, unknown>[]).length;
            const totalCount = repCount + prodCount;
            return (
              <button onClick={() => setShowTransfers(true)}
                className={`relative flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-colors ${totalCount > 0 ? 'text-purple-700 bg-purple-50 animate-pulse' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}>
                <Truck size={17} />
                <span className="text-[9px] font-medium">Transferts</span>
                {totalCount > 0 && <span className="absolute -top-0.5 -right-0.5 bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">{totalCount}</span>}
              </button>
            );
          })()}
          <button onClick={() => setShowProductionForm(true)} className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <Package size={17} />
            <span className="text-[9px] font-medium">Approv.</span>
          </button>
          <button onClick={() => setShowLossModal(true)} className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-orange-400 hover:bg-orange-50 hover:text-orange-600 transition-colors">
            <Trash2 size={17} />
            <span className="text-[9px] font-medium">Perte</span>
          </button>
          <button onClick={() => { setCloseStep('choose-type'); setShowCloseModal(true); }} disabled={closeMutation.isPending} className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-colors ${closeMutation.isPending ? 'text-red-600 bg-red-50 animate-pulse' : 'text-red-400 hover:bg-red-50 hover:text-red-500'}`}>
            {closeMutation.isPending ? <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" /> : <Lock size={17} />}
            <span className="text-[9px] font-medium">{closeMutation.isPending ? 'Fermeture...' : 'Fermer'}</span>
          </button>
          {isCashierRole && (
            <button onClick={logout} className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <LogOut size={17} />
              <span className="text-[9px] font-medium">Sortir</span>
            </button>
          )}
        </div>
      </div>

      {/* ═══════════ SELL TAB ═══════════ */}
      {posTab === 'sell' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar: Categories */}
          <div className="hidden md:flex w-44 bg-white border-r border-gray-200 flex-col shrink-0">
            <div className="px-3 py-2.5 border-b border-gray-100">
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Catégories</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button onClick={() => setSelectedCategory('')}
                className={`w-full text-left px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
                  !selectedCategory ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-200' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                Tous
              </button>
              {categories.map((c: { id: number; name: string }) => (
                <button key={c.id} onClick={() => setSelectedCategory(String(c.id))}
                  className={`w-full text-left px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
                    selectedCategory === String(c.id) ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-200' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Center: Products */}
          <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
            {/* Mobile: horizontal categories */}
            <div className="md:hidden bg-white border-b border-gray-200 px-3 py-2 shrink-0">
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                <button onClick={() => setSelectedCategory('')}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    !selectedCategory ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200 shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}>Tous</button>
                {categories.map((c: { id: number; name: string }) => (
                  <button key={c.id} onClick={() => setSelectedCategory(String(c.id))}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      selectedCategory === String(c.id) ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200 shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}>{c.name}</button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="px-3 py-2 shrink-0">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400" />
              </div>
            </div>

            {/* Product Grid */}
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              <div className="grid gap-2 content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                {products.filter((p: Record<string, unknown>) => Number(p.stock_quantity || 0) > 0).map((p: Record<string, unknown>) => {
                  const stock = parseFloat(p.stock_quantity as string) || 0;
                  const outOfStock = stock <= 0;
                  const isAlerted = stockAlert?.productId === p.id;
                  if (outOfStock) return null;
                  return (
                    <button key={p.id as string} onClick={() => !outOfStock && addToCart(p)}
                      disabled={outOfStock}
                      className={`rounded-xl p-2 text-left transition-all border flex flex-col relative h-[140px] ${
                        outOfStock
                          ? 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed'
                          : isAlerted
                            ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200'
                            : 'bg-white border-gray-100 hover:shadow-lg hover:border-primary-300 hover:scale-[1.02] active:scale-[0.98]'
                      }`}>
                      {outOfStock && (
                        <span className="absolute top-1 right-1 text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full z-10">Rupture</span>
                      )}
                      {isAlerted && (
                        <span className="absolute inset-0 flex items-center justify-center z-20 animate-pulse">
                          <span className="bg-amber-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-lg">
                            {stockAlert?.message}
                          </span>
                        </span>
                      )}
                      <div className="flex-1 w-full rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden">
                        {p.image_url ? (
                          <img src={serverUrl(p.image_url as string)} alt="" className={`h-full w-full object-contain ${outOfStock ? 'grayscale' : ''}`} />
                        ) : (
                          <span className="text-3xl">🥖</span>
                        )}
                      </div>
                      <span className="font-medium text-xs line-clamp-2 leading-tight mt-1.5">{p.name as string}</span>
                      <span className={`font-bold text-sm mt-0.5 ${outOfStock ? 'text-gray-400' : 'text-primary-600'}`}>{parseFloat(p.price as string).toFixed(2)} DH</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Cart Panel */}
          <div className="w-full md:w-[380px] bg-white border-l border-gray-200 flex flex-col shrink-0">
            {/* Cart header */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-base text-gray-800">Panier</h2>
                {cart.length > 0 && (
                  <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{cart.reduce((s, i) => s + i.quantity, 0)} article{cart.reduce((s, i) => s + i.quantity, 0) > 1 ? 's' : ''}</span>
                )}
              </div>
            </div>

            {/* Cart items - scrollable */}
            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-300">
                  <ShoppingCart size={40} className="mb-2" />
                  <p className="text-sm">Le panier est vide</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {cart.map((item) => {
                    const itemStock = getProductStock(item.productId);
                    const atMax = item.quantity >= itemStock;
                    const isItemAlerted = stockAlert?.productId === item.productId;
                    return (
                      <div key={item.productId} className={`px-4 py-3 transition-colors ${isItemAlerted ? 'bg-amber-50' : 'hover:bg-gray-50/50'}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-gray-800 truncate">{item.name}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{item.price.toFixed(2)} DH / unité</p>
                            {isItemAlerted && (
                              <p className="text-amber-600 text-[10px] font-semibold mt-0.5 animate-pulse">{stockAlert?.message}</p>
                            )}
                          </div>
                          <span className="font-bold text-sm text-gray-800 shrink-0">{(item.price * item.quantity).toFixed(2)} DH</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center bg-gray-100 rounded-lg">
                            <button onClick={() => updateQuantity(item.productId, -1)}
                              className="w-8 h-8 rounded-l-lg flex items-center justify-center hover:bg-gray-200 transition-colors text-gray-600">
                              <Minus size={14} />
                            </button>
                            <button onClick={() => openNumpad(item.productId, item.name, item.quantity)}
                              className={`w-10 text-center font-semibold text-sm ${atMax ? 'text-amber-600' : 'text-gray-800'} hover:bg-primary-50 rounded transition-colors`}>{item.quantity}</button>
                            <button onClick={() => updateQuantity(item.productId, 1)}
                              className={`w-8 h-8 rounded-r-lg flex items-center justify-center transition-colors ${
                                atMax ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-200 text-gray-600'
                              }`}>
                              <Plus size={14} />
                            </button>
                          </div>
                          <div className="flex-1" />
                          <button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={cartEndRef} />
                </div>
              )}
            </div>

            {/* Cart footer — contextual: elements appear only when relevant */}
            <div className="border-t border-gray-200 shrink-0">

              {/* Customer search — only visible when toggled */}
              {showCustomerSearch && (
                <div className="px-4 py-2 border-b border-gray-100 animate-in slide-in-from-top">
                  <div className="relative">
                    <User size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Rechercher un client..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-8 pr-8 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
                      autoFocus />
                    <button onClick={() => { setShowCustomerSearch(false); if (!customerId) setCustomerSearch(''); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                      <XCircle size={16} />
                    </button>
                  </div>
                  {customersData?.data?.length > 0 && customerSearch.length >= 2 && (
                    <div className="mt-1 bg-white border rounded-lg shadow-lg max-h-32 overflow-y-auto">
                      {customersData.data.map((c: Record<string, unknown>) => (
                        <button key={c.id as string} onClick={() => { setCustomerId(c.id as string); setCustomerSearch(`${c.first_name} ${c.last_name}`); setShowCustomerSearch(false); }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">{c.first_name as string} {c.last_name as string}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Quick actions bar — only shows buttons that are relevant */}
              {(lastReceipt || cart.length > 0 || customerId) && (
                <div className="px-4 py-2 border-b border-gray-100">
                  <div className="flex items-center gap-1.5">
                    {/* Imprimer — only if there's a receipt */}
                    {lastReceipt && (
                      <button onClick={() => setReceiptData({ ...lastReceipt })}
                        className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-primary-600 transition-colors">
                        <Printer size={17} />
                        <span className="text-[9px] font-medium">Imprimer</span>
                      </button>
                    )}

                    {/* Client — toggle search or show selected */}
                    {customerId ? (
                      <button onClick={() => { setCustomerId(''); setCustomerSearch(''); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary-50 text-primary-700 ring-1 ring-primary-200 transition-colors">
                        <User size={15} />
                        <span className="text-[10px] font-semibold truncate max-w-[80px]">{customerSearch}</span>
                        <XCircle size={12} className="text-primary-400 shrink-0" />
                      </button>
                    ) : (
                      <button onClick={() => setShowCustomerSearch(!showCustomerSearch)}
                        className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-colors ${
                          showCustomerSearch ? 'bg-primary-50 text-primary-700' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                        }`}>
                        <User size={17} />
                        <span className="text-[9px] font-medium">Client</span>
                      </button>
                    )}

                    <div className="flex-1" />

                    {/* Payment method — only when cart has items */}
                    {cart.length > 0 && (
                      <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                        <button onClick={() => setPaymentMethod('cash')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                            paymentMethod === 'cash' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
                          }`}>
                          <Banknote size={14} /> Espèces
                        </button>
                        <button onClick={() => setPaymentMethod('card')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                            paymentMethod === 'card' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
                          }`}>
                          <CreditCard size={14} /> Carte
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Correction 2: Numpad overlay — replaces payment section when active */}
              {numpadItem && (
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-600 truncate">{numpadItem.name}</p>
                    <button onClick={closeNumpad} className="text-gray-400 hover:text-gray-600 text-xs font-medium">Annuler</button>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-4 py-2 mb-2 text-center">
                    <span className="text-2xl font-bold text-gray-800">{numpadValue || '0'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[1,2,3,4,5,6,7,8,9].map(n => (
                      <button key={n} onClick={() => setNumpadValue(prev => prev === '0' ? String(n) : prev + n)}
                        className="py-3 rounded-lg bg-white border border-gray-200 text-lg font-bold text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors">{n}</button>
                    ))}
                    <button onClick={() => setNumpadValue(prev => prev.slice(0, -1) || '0')}
                      className="py-3 rounded-lg bg-white border border-gray-200 text-sm font-bold text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors">Effacer</button>
                    <button onClick={() => setNumpadValue(prev => prev === '0' ? '0' : prev + '0')}
                      className="py-3 rounded-lg bg-white border border-gray-200 text-lg font-bold text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors">0</button>
                    <button onClick={confirmNumpad}
                      className="py-3 rounded-lg bg-primary-500 text-white text-sm font-bold hover:bg-primary-600 active:bg-primary-700 transition-colors">Valider</button>
                  </div>
                </div>
              )}

              {/* Cash change calculator — only when cash + cart has items + no numpad */}
              {!numpadItem && paymentMethod === 'cash' && cart.length > 0 && (
                <div className="px-4 py-2.5 border-b border-gray-100">
                  {/* Correction 3: Hide quick bills when total > 200 DH */}
                  {total <= 200 && (
                    <>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Billet donné</p>
                      <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                        {[20, 50, 100, 200].map(amount => (
                          <button key={amount} onClick={() => setCashGiven(cashGiven === amount ? null : amount)}
                            className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-md text-sm font-bold transition-all ${
                              cashGiven === amount
                                ? 'bg-white text-primary-700 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}>
                            <Banknote size={14} className={cashGiven === amount ? 'text-primary-600' : 'text-gray-400'} />
                            <span>{amount}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {cashGiven !== null && cashGiven >= total && (
                    <div className="mt-2 flex items-center justify-center gap-2 bg-green-50 rounded-xl py-2.5 px-3 ring-1 ring-green-200">
                      <Banknote size={18} className="text-green-600" />
                      <div className="text-center">
                        <p className="text-[10px] font-medium text-green-600">Monnaie à rendre</p>
                        <p className="text-lg font-bold text-green-700">{(cashGiven - total).toFixed(2)} DH</p>
                      </div>
                    </div>
                  )}
                  {cashGiven !== null && cashGiven < total && (
                    <div className="mt-2 flex items-center justify-center gap-2 bg-red-50 rounded-xl py-2.5 px-3 ring-1 ring-red-200">
                      <AlertTriangle size={16} className="text-red-500" />
                      <p className="text-xs font-semibold text-red-600">Insuffisant — il manque {(total - cashGiven).toFixed(2)} DH</p>
                    </div>
                  )}
                </div>
              )}

              {/* Totals + Actions — only when cart has items and numpad is closed */}
              {!numpadItem && cart.length > 0 ? (
                <>
                  <div className="px-4 py-3 space-y-1">
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Articles</span>
                      <span>{cart.reduce((s, i) => s + i.quantity, 0)}</span>
                    </div>
                    <div className="flex justify-between text-xl font-bold text-gray-800 pt-1">
                      <span>Total</span>
                      <span className="text-primary-600">{total.toFixed(2)} DH</span>
                    </div>
                  </div>
                  <div className="px-4 pb-4 flex gap-2">
                    <button onClick={() => { setCart([]); setCashGiven(null); }}
                      className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={18} />
                      <span className="text-[10px] font-semibold">Vider</span>
                    </button>
                    <button onClick={handleCheckout}
                      disabled={checkoutMutation.isPending || (paymentMethod === 'cash' && cashGiven !== null && cashGiven < total)}
                      className="flex-1 flex flex-col items-center justify-center gap-1 py-3 bg-primary-50 text-primary-700 rounded-xl font-bold text-base hover:bg-primary-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-[0.98]">
                      <ShoppingCart size={20} />
                      <span className="text-sm">{checkoutMutation.isPending ? 'En cours...' : 'Encaisser'}</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-gray-300">Ajoutez des produits pour commencer</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ ORDERS TAB ═══════════ */}
      {posTab === 'orders' && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="p-3 shrink-0 bg-white border-b border-gray-200 flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Rechercher par nom, téléphone ou n° commande..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
            <button onClick={() => setShowOrderForm(true)}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors shrink-0">
              <Plus size={17} />
              <span className="text-[10px] font-semibold">Commande</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
                  <div className="flex gap-1.5 shrink-0">
                    {o.status === 'pending' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'confirmed' })}
                        className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                        <CheckCircle size={16} />
                        <span className="text-[10px] font-semibold">Confirmer</span>
                      </button>
                    )}
                    {o.status === 'confirmed' && (
                      <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'in_production' })}
                        className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors">
                        <Factory size={16} />
                        <span className="text-[10px] font-semibold">Production</span>
                      </button>
                    )}
                    {o.status === 'ready' && (
                      <button onClick={() => { setDeliverOrder(o); setDeliverAmount(String(remaining.toFixed(2))); }}
                        className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
                        <Truck size={16} />
                        <span className="text-[10px] font-semibold">Livrer</span>
                      </button>
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
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50">
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
                  className="mt-4 flex flex-col items-center gap-1 px-6 py-3 bg-primary-50 text-primary-700 rounded-xl font-semibold hover:bg-primary-100 transition-colors">
                  <RotateCcw size={20} />
                  <span className="text-sm">Nouvelle opération</span>
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
                      className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                      <Search size={15} />
                      <span className="text-[10px] font-medium">Autre vente</span>
                    </button>
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
                    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mb-3">
                      <button onClick={() => { setReturnType('return'); setExchangeProducts({}); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-all ${
                          returnType === 'return' ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}>
                        <RotateCcw size={16} /> Retour
                      </button>
                      <button onClick={() => setReturnType('exchange')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-all ${
                          returnType === 'exchange' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}>
                        <ArrowLeftRight size={16} /> Echange
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
      {/* Payment popup removed — checkout is now inline in the cart panel */}

      {/* New Order Modal — same interface as pre-orders */}
      {showOrderForm && (
        <OrderFormModal
          onClose={() => setShowOrderForm(false)}
          onSaved={(createdOrder?: Record<string, unknown>) => {
            setShowOrderForm(false);
            queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['sales'] });
            // Show advance receipt if an advance was paid
            if (createdOrder?.advanceReceipt) {
              const adv = createdOrder.advanceReceipt as Record<string, unknown>;
              const orderItems = (createdOrder.items as { productId: string; quantity: number; unitPrice: number; subtotal: number }[]) || [];
              const allProds = (productsData?.data || []) as Record<string, unknown>[];
              const orderSubtotal = parseFloat(createdOrder.subtotal as string) || 0;
              const orderDiscount = parseFloat(createdOrder.discount_amount as string) || 0;
              const orderTotal = parseFloat(adv.total as string) || (orderSubtotal - orderDiscount);
              const advanceAmount = parseFloat(adv.advanceAmount as string) || 0;

              setReceiptData({
                saleNumber: adv.orderNumber as string,
                date: adv.date as string,
                cashierName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
                customerName: (createdOrder.customer_name as string) || (createdOrder.customerName as string) || undefined,
                items: orderItems.map(it => {
                  const prod = allProds.find((p: Record<string, unknown>) => String(p.id) === String(it.productId));
                  return { name: (prod?.name as string) || 'Produit', quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.quantity * it.unitPrice };
                }),
                subtotal: orderSubtotal,
                discountAmount: orderDiscount,
                total: advanceAmount,
                paymentMethod: adv.paymentMethod as string,
                orderTotal: orderTotal,
                isAdvanceReceipt: true,
              });
            }
          }}
        />
      )}

      {/* Deliver Order Modal */}
      {deliverOrder && (() => {
        const totalAmt = parseFloat(deliverOrder.total as string);
        const advanceAmt = parseFloat(deliverOrder.advance_amount as string || '0');
        const remaining = totalAmt - advanceAmt;
        const isDeferred = deliverOrder.payment_method === 'deferred';
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
                {isDeferred ? (
                  <div className="flex justify-between items-center font-bold border-t pt-2 text-base">
                    <span>Paiement</span>
                    <span className="text-blue-600 text-sm px-3 py-1 bg-blue-50 rounded-full">Reporte — Facture emise</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Avance versee</span>
                      <span className="font-semibold text-green-600">{advanceAmt.toFixed(2)} DH</span>
                    </div>
                    <div className="flex justify-between font-bold border-t pt-2 text-base">
                      <span>Reste a payer</span>
                      <span className="text-primary-600">{remaining.toFixed(2)} DH</span>
                    </div>
                  </>
                )}
              </div>
              {!isDeferred && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Montant encaisse (DH)</label>
                  <input type="number" value={deliverAmount} onChange={(e) => setDeliverAmount(e.target.value)}
                    className="input text-center text-xl font-bold mb-4" min="0" step="0.01" autoFocus />
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mb-6">
                    <button onClick={() => setDeliverPayment('cash')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-all ${
                        deliverPayment === 'cash' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
                      }`}>
                      <Banknote size={16} /> Espèces
                    </button>
                    <button onClick={() => setDeliverPayment('card')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-all ${
                        deliverPayment === 'card' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
                      }`}>
                      <CreditCard size={16} /> Carte
                    </button>
                  </div>
                </>
              )}
              <div className="flex gap-3">
                <button onClick={() => { setDeliverOrder(null); setDeliverAmount(''); }} className="btn-secondary flex-1">Annuler</button>
                <button onClick={() => deliverMutation.mutate({ id: deliverOrder.id as string, amountPaid: isDeferred ? 0 : (parseFloat(deliverAmount) || 0), paymentMethod: isDeferred ? 'deferred' : deliverPayment })}
                  disabled={deliverMutation.isPending} className="btn-primary flex-1">
                  {deliverMutation.isPending ? 'En cours...' : isDeferred ? 'Confirmer la livraison' : 'Confirmer'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Close Register Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`bg-white rounded-2xl p-6 w-full ${closeStep === 'choose-type' ? 'max-w-md max-h-[90vh]' : closeStep === 'inventory' ? 'max-w-5xl max-h-[95vh]' : closeStep === 'input' ? (closeInputMode === 'counting' ? 'max-w-2xl h-[95vh]' : 'max-w-lg max-h-[90vh]') : 'max-w-lg max-h-[90vh]'} overflow-y-auto transition-all flex flex-col`}>

            {/* ═══ Choix du type de fermeture ═══ */}
            {closeStep === 'choose-type' ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">Type de fermeture</h2>
                <p className="text-sm text-gray-500 mb-6 text-center">Choisissez le type de cloture de cette session.</p>

                <div className="space-y-3 mb-6">
                  <button
                    onClick={() => { setCloseType('passation'); closeMutation.mutate('passation'); }}
                    disabled={closeMutation.isPending}
                    className="w-full text-left p-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center">
                        <ArrowLeftRight size={20} className="text-blue-700" />
                      </div>
                      <div>
                        <div className="font-bold text-blue-900">Passation de shift</div>
                        <div className="text-xs text-blue-600 mt-0.5">Inventaire uniquement — pas de decisions sur les produits</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => { setCloseType('fin_journee'); closeMutation.mutate('fin_journee'); }}
                    disabled={closeMutation.isPending}
                    className="w-full text-left p-4 rounded-xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center">
                        <Lock size={20} className="text-amber-700" />
                      </div>
                      <div>
                        <div className="font-bold text-amber-900">Fin de journee</div>
                        <div className="text-xs text-amber-600 mt-0.5">Inventaire + decisions produits (vitrine, recyclage, perte)</div>
                      </div>
                    </div>
                  </button>
                </div>

                {closeMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-4">
                    <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                    Calcul en cours...
                  </div>
                )}

                <button onClick={() => { setShowCloseModal(false); }}
                  className="btn-secondary w-full py-3">Annuler</button>
              </>
            ) : closeStep === 'inventory' && closeResult ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {closeType === 'passation' ? 'Inventaire de passation' : 'Inventaire de fin de journee'}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {closeType === 'passation'
                        ? 'Comptez les quantites restantes en vitrine pour le prochain shift.'
                        : 'Verifiez les quantites et decidez du devenir de chaque produit invendu.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Package size={18} />
                    <span className="font-semibold">{inventoryItems.length} articles</span>
                  </div>
                </div>

                {/* Summary bar */}
                {(() => {
                  let totalReplenished = 0, totalSold = 0, totalTheoreticalRemaining = 0, totalCounted = 0, totalDiscrepancySum = 0;
                  let totalKeep = 0, totalRecycle = 0, totalDestroy = 0;
                  inventoryItems.forEach((it) => {
                    const pid = it.product_id as string;
                    const replenished = parseInt(it.replenished_today_qty as string) || 0;
                    const sold = parseInt(it.sold_qty as string) || 0;
                    const theoretical = replenished - sold;
                    const counted = inventoryQtys[pid] ?? 0;
                    totalReplenished += replenished;
                    totalSold += sold;
                    totalTheoreticalRemaining += Math.max(0, theoretical);
                    totalCounted += counted;
                    totalDiscrepancySum += Math.max(0, theoretical) - counted;
                    if (counted > 0) {
                      const dest = inventoryDestinations[pid] || (it.suggested_destination as string) || 'waste';
                      if (dest === 'reexpose') totalKeep += counted;
                      else if (dest === 'recycle') totalRecycle += counted;
                      else totalDestroy += counted;
                    }
                  });
                  return (
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
                      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
                        <div className="text-2xl font-bold text-indigo-700">{totalReplenished}</div>
                        <div className="text-xs text-indigo-600 font-medium">Approvisionne</div>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                        <div className="text-2xl font-bold text-blue-700">{totalSold}</div>
                        <div className="text-xs text-blue-600 font-medium">Vendus</div>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
                        <div className="text-2xl font-bold text-purple-700">{totalTheoreticalRemaining}</div>
                        <div className="text-xs text-purple-600 font-medium">Theorique</div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
                        <div className="text-2xl font-bold text-gray-700">{totalCounted}</div>
                        <div className="text-xs text-gray-600 font-medium">Saisi</div>
                      </div>
                      <div className={`rounded-xl p-3 text-center border ${
                        closeType === 'passation'
                          ? 'bg-blue-50 border-blue-200'
                          : totalDiscrepancySum === 0 ? 'bg-green-50 border-green-200' : totalDiscrepancySum > 0 ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200'
                      }`}>
                        <div className={`text-2xl font-bold ${
                          closeType === 'passation'
                            ? 'text-blue-700'
                            : totalDiscrepancySum === 0 ? 'text-green-700' : totalDiscrepancySum > 0 ? 'text-orange-700' : 'text-red-700'
                        }`}>{closeType === 'passation' ? totalCounted : totalDiscrepancySum}</div>
                        <div className={`text-xs font-medium ${
                          closeType === 'passation'
                            ? 'text-blue-600'
                            : totalDiscrepancySum === 0 ? 'text-green-600' : totalDiscrepancySum > 0 ? 'text-orange-600' : 'text-red-600'
                        }`}>{closeType === 'passation' ? 'Reste' : 'Ecart'}</div>
                      </div>
                      {closeType !== 'passation' && (totalKeep > 0 || totalRecycle > 0 || totalDestroy > 0) && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                          <div className="text-2xl font-bold text-amber-700">{totalKeep + totalRecycle + totalDestroy}</div>
                          <div className="text-xs text-amber-600 font-medium">Invendus</div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Items grouped by category */}
                {(() => {
                  const destStyles: Record<string, { bg: string; text: string; label: string; icon: string }> = {
                    reexpose: { bg: 'bg-green-100 border-green-300', text: 'text-green-800', label: 'Vitrine J+1', icon: '✓' },
                    recycle: { bg: 'bg-cyan-100 border-cyan-300', text: 'text-cyan-800', label: 'Recycler', icon: '♻' },
                    waste: { bg: 'bg-red-100 border-red-300', text: 'text-red-800', label: 'Detruire', icon: '✗' },
                  };
                  // Group items by category
                  const grouped: Record<string, typeof inventoryItems> = {};
                  inventoryItems.forEach((it) => {
                    const cat = (it.category_name as string) || 'Sans categorie';
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(it);
                  });
                  const categoryNames = Object.keys(grouped).sort();

                  return (
                    <div className="space-y-3 mb-4 max-h-[50vh] overflow-y-auto">
                      {categoryNames.map((catName) => {
                        const catItems = grouped[catName];
                        const catCount = catItems.reduce((sum, it) => {
                          const pid = it.product_id as string;
                          return sum + (inventoryQtys[pid] ?? 0);
                        }, 0);

                        return (
                          <div key={catName} className="border border-gray-200 rounded-xl overflow-hidden">
                            {/* Category header */}
                            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-800">{catName}</span>
                                <span className="text-[11px] font-medium text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">{catItems.length} article{catItems.length > 1 ? 's' : ''}</span>
                              </div>
                              <span className="text-xs font-semibold text-gray-500">{catCount} restant{catCount > 1 ? 's' : ''}</span>
                            </div>

                            {/* Column headers */}
                            <div className={`grid ${closeType === 'passation' ? 'grid-cols-8' : 'grid-cols-12'} gap-2 px-4 py-2 bg-gray-50/50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider`}>
                              <span className="col-span-2">Produit</span>
                              <span className="col-span-1 text-center">Approv.</span>
                              <span className="col-span-1 text-center">Vendu</span>
                              <span className="col-span-1 text-center">Theor.</span>
                              <span className="col-span-2 text-center">Saisi</span>
                              <span className="col-span-1 text-center">{closeType === 'passation' ? 'Reste' : 'Ecart'}</span>
                              {closeType !== 'passation' && <span className="col-span-4 text-center">Decision</span>}
                            </div>

                            {/* Items */}
                            <div className="divide-y divide-gray-100">
                              {catItems.map((it) => {
                                const pid = it.product_id as string;
                                const replenished = parseInt(it.replenished_today_qty as string) || 0;
                                const sold = parseInt(it.sold_qty as string) || 0;
                                const theoreticalRemaining = Math.max(0, replenished - sold);
                                const counted = inventoryQtys[pid] ?? 0;
                                const discrepancy = theoreticalRemaining - counted;

                                const sugDest = (it.suggested_destination as string) || 'waste';
                                const sugReason = (it.suggested_reason as string) || '';
                                const finalDest = inventoryDestinations[pid] || sugDest;
                                const isOverride = finalDest !== sugDest;

                                if (counted > 0 && !inventoryDestinations[pid]) {
                                  inventoryDestinations[pid] = sugDest;
                                }

                                return (
                                  <div key={pid} className={`grid ${closeType === 'passation' ? 'grid-cols-8' : 'grid-cols-12'} gap-2 items-center px-4 py-3 transition-colors ${
                                    closeType !== 'passation' && finalDest === 'waste' ? 'bg-red-50/30' : closeType !== 'passation' && finalDest === 'recycle' ? 'bg-cyan-50/30' : discrepancy !== 0 ? 'bg-amber-50/50' : 'hover:bg-gray-50'
                                  }`}>
                                    {/* Product */}
                                    <div className="col-span-2 min-w-0">
                                      <span className="text-sm font-semibold text-gray-900 truncate block" title={it.product_name as string}>
                                        {it.product_name as string}
                                      </span>
                                      {sugReason && counted > 0 && (
                                        <span className="text-[10px] text-blue-500 block mt-0.5 truncate" title={sugReason}>{sugReason}</span>
                                      )}
                                    </div>
                                    {/* Approvisionné */}
                                    <div className="col-span-1 text-center">
                                      <span className="text-sm font-bold text-indigo-700">{replenished}</span>
                                    </div>
                                    {/* Vendu */}
                                    <div className="col-span-1 text-center">
                                      <span className="text-sm font-bold text-blue-700">{sold}</span>
                                    </div>
                                    {/* Restant théorique */}
                                    <div className="col-span-1 text-center">
                                      <span className="text-sm font-bold text-purple-700">{theoreticalRemaining}</span>
                                    </div>
                                    {/* Restant saisi */}
                                    <div className="col-span-2 flex justify-center">
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => setInventoryQtys(prev => ({ ...prev, [pid]: Math.max(0, (prev[pid] ?? 0) - 1) }))}
                                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold">
                                          <Minus size={12} />
                                        </button>
                                        <input type="number" min={0} value={counted}
                                          onChange={(e) => setInventoryQtys(prev => ({ ...prev, [pid]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                          className="w-14 h-7 text-center text-sm font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500" />
                                        <button onClick={() => setInventoryQtys(prev => ({ ...prev, [pid]: (prev[pid] ?? 0) + 1 }))}
                                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold">
                                          <Plus size={12} />
                                        </button>
                                      </div>
                                    </div>
                                    {/* Passation: Reste (saisi) | Fin journée: Écart (théorique - saisi) */}
                                    <div className="col-span-1 text-center">
                                      {closeType === 'passation' ? (
                                        <span className={`text-sm font-bold ${counted > 0 ? 'text-blue-700' : 'text-gray-400'}`}>{counted}</span>
                                      ) : discrepancy !== 0 ? (
                                        <span className={`text-sm font-bold ${discrepancy > 0 ? 'text-orange-600' : 'text-red-600'}`}>
                                          {discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                                        </span>
                                      ) : <span className="text-sm text-green-500">0</span>}
                                    </div>
                                    {/* Decision buttons — hidden in passation mode */}
                                    {closeType !== 'passation' && (
                                    <div className="col-span-4">
                                      {counted > 0 ? (
                                        <div className="flex items-center gap-1 justify-center">
                                          {(['reexpose', 'recycle', 'waste'] as const).map(d => {
                                            const dConf = destStyles[d];
                                            const isActive = finalDest === d;
                                            const canReexpose = it.is_reexposable || sugDest === 'reexpose';
                                            const canRecycle = it.is_recyclable && it.recycle_ingredient_id;
                                            const disabled = (d === 'reexpose' && !canReexpose) || (d === 'recycle' && !canRecycle);
                                            return (
                                              <button key={d}
                                                onClick={() => !disabled && setInventoryDestinations(prev => ({ ...prev, [pid]: d }))}
                                                disabled={disabled as boolean}
                                                title={d === 'reexpose' && disabled ? 'Non re-exposable' : d === 'recycle' && disabled ? 'Non recyclable' : dConf.label}
                                                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                                                  isActive ? `${dConf.bg} ${dConf.text} ring-2 ring-offset-1 ${d === 'reexpose' ? 'ring-green-400' : d === 'recycle' ? 'ring-cyan-400' : 'ring-red-400'}` :
                                                  disabled ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed' :
                                                  'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                                                }`}>
                                                {dConf.icon} {dConf.label}
                                              </button>
                                            );
                                          })}
                                          {isOverride && <span className="text-amber-500 text-[10px] font-semibold ml-1">modifie</span>}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-gray-300 text-center block">Tout vendu</span>
                                      )}
                                    </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Discrepancy / Remaining alert */}
                {(() => {
                  let totalDiscrepancy = 0;
                  let totalCounted = 0;
                  inventoryItems.forEach((it) => {
                    const pid = it.product_id as string;
                    const replenished = parseInt(it.replenished_today_qty as string) || 0;
                    const sold = parseInt(it.sold_qty as string) || 0;
                    const theoretical = Math.max(0, replenished - sold);
                    const counted = inventoryQtys[pid] ?? 0;
                    totalDiscrepancy += theoretical - counted;
                    totalCounted += counted;
                  });

                  if (closeType === 'passation') {
                    return (
                      <div className="rounded-xl p-4 flex items-center gap-3 text-sm mb-4 bg-blue-50 border border-blue-200">
                        <Package size={20} className="text-blue-500" />
                        <span className="text-blue-700 font-medium">
                          {totalCounted > 0
                            ? `${totalCounted} article(s) restant(s) a transmettre au prochain shift.`
                            : 'Aucun article restant — vitrine vide.'}
                        </span>
                      </div>
                    );
                  }

                  return totalDiscrepancy !== 0 ? (
                    <div className={`rounded-xl p-4 flex items-center gap-3 text-sm mb-4 ${totalDiscrepancy > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-red-50 border border-red-200'}`}>
                      <AlertTriangle size={20} className={totalDiscrepancy > 0 ? 'text-orange-500' : 'text-red-500'} />
                      <span className={`font-medium ${totalDiscrepancy > 0 ? 'text-orange-700' : 'text-red-700'}`}>
                        {totalDiscrepancy > 0
                          ? `Ecart : ${totalDiscrepancy} unite(s) manquante(s) (perte/casse)`
                          : `Ecart : ${Math.abs(totalDiscrepancy)} unite(s) en surplus (anomalie)`}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-xl p-4 flex items-center gap-3 text-sm mb-4 bg-green-50 border border-green-200">
                      <CheckCircle size={20} className="text-green-500" />
                      <span className="text-green-700 font-medium">Inventaire coherent — aucun ecart.</span>
                    </div>
                  );
                })()}

                <div className="flex gap-3">
                  <button onClick={() => { setShowCloseModal(false); setActualAmount(''); setCloseNotes(''); setCloseInputMode('direct'); setDenomCounts(Object.fromEntries(DENOMINATIONS.map(d => [d.value, 0]))); }}
                    className="btn-secondary flex-1 py-3 text-base">Annuler</button>
                  <button onClick={async () => {
                    try {
                      // Build decisions/inventory data
                      const decisions = inventoryItems
                        .filter(it => {
                          const pid = it.product_id as string;
                          const counted = inventoryQtys[pid] ?? 0;
                          return counted > 0;
                        })
                        .map((it) => {
                          const pid = it.product_id as string;
                          const counted = inventoryQtys[pid] ?? 0;
                          const replenished = parseInt(it.replenished_today_qty as string) || 0;
                          const soldQty = parseInt(it.sold_qty as string) || 0;
                          const sugDest = (it.suggested_destination as string) || 'waste';
                          // En passation, pas de destination finale — on met 'reexpose' par defaut (stock inchange)
                          const finalDest = closeType === 'passation' ? 'reexpose' : (inventoryDestinations[pid] || sugDest);
                          const isOvr = finalDest !== sugDest;

                          return {
                            productId: pid,
                            productName: it.product_name as string,
                            categoryName: (it.category_name as string) || undefined,
                            initialQty: replenished,
                            soldQty: soldQty,
                            remainingQty: counted,
                            suggestedDestination: sugDest,
                            suggestedReason: (it.suggested_reason as string) || '',
                            finalDestination: finalDest,
                            overrideReason: isOvr ? 'Decision operateur' : undefined,
                            shelfLifeDays: it.shelf_life_days as number | undefined,
                            displayLifeHours: it.display_life_hours as number | undefined,
                            isReexposable: it.is_reexposable as boolean | undefined,
                            maxReexpositions: it.max_reexpositions as number | undefined,
                            currentReexpositionCount: (it.reexposition_count as number) || 0,
                            isRecyclable: it.is_recyclable as boolean | undefined,
                            recycleIngredientId: (it.recycle_ingredient_id as string) || undefined,
                            saleType: (it.sale_type as string) || undefined,
                            displayExpiresAt: (it.display_expires_at as string) || undefined,
                            expiresAt: (it.expires_at as string) || undefined,
                            producedAt: (it.produced_at as string) || undefined,
                            unitCost: parseFloat(String(it.cost_price)) || 0,
                          };
                        });

                      if (decisions.length > 0) {
                        await unsoldDecisionApi.save({
                          sessionId: closeResult?.id as string,
                          closeType,
                          decisions,
                        });
                        notify.success(closeType === 'passation'
                          ? `Inventaire passation enregistre (${decisions.length} articles)`
                          : `${decisions.length} decisions invendus enregistrees`);
                      } else {
                        notify.success('Aucun invendu a traiter');
                      }
                    } catch (err: unknown) {
                      console.error('Erreur sauvegarde invendus:', err);
                      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Erreur lors de l\'enregistrement';
                      notify.error(msg);
                    }
                    setInventoryDone(true);
                    setCloseStep('input');
                  }}
                    className="btn-primary flex-1 py-3 text-base font-semibold">
                    {closeType === 'passation' ? 'Valider l\'inventaire' : 'Valider les decisions'}
                  </button>
                </div>
              </>
            ) : closeStep === 'input' ? (
              <>
                <h2 className="text-xl font-bold mb-1">Fermeture de caisse</h2>
                <p className="text-sm text-gray-500 mb-4">Saisissez le montant trouve dans la caisse.</p>

                {/* Mode toggle: Direct / Counting */}
                <div className="bg-gray-100 rounded-lg p-0.5 flex mb-4">
                  <button onClick={() => { setCloseInputMode('direct'); setDenomCounts(Object.fromEntries(DENOMINATIONS.map(d => [d.value, 0]))); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all ${closeInputMode === 'direct' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    <Banknote size={15} />
                    Saisie directe
                  </button>
                  <button onClick={() => { setCloseInputMode('counting'); setActualAmount(''); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all ${closeInputMode === 'counting' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    <Coins size={15} />
                    Comptage detaille
                  </button>
                </div>

                {closeInputMode === 'direct' ? (
                  <>
                    {/* Direct amount input */}
                    <label className="block text-sm font-medium text-gray-700 mb-2">Montant total trouve (DH)</label>
                    <input type="number" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)}
                      className="input text-center text-2xl font-bold mb-4" min="0" step="0.01" placeholder="0.00" autoFocus />
                  </>
                ) : (
                  <>
                    {/* Denomination counter – full-width */}
                    <div className="space-y-2 mb-3 flex-1">
                      {/* Coins – 4 columns (one row) */}
                      <div className="bg-amber-50 rounded-xl p-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-2">
                          <Coins size={13} />
                          <span>Pieces</span>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {DENOMINATIONS.filter(d => d.type === 'coin').map(d => {
                            const count = denomCounts[d.value] || 0;
                            const subtotal = d.value * count;
                            return (
                              <div key={d.value} className="flex flex-col items-center gap-1 bg-white rounded-lg py-2 px-1 ring-1 ring-amber-100">
                                <img src={d.img} alt={`${d.label} DH`} className="w-12 h-12 object-contain" />
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => setDenomCounts(prev => ({ ...prev, [d.value]: Math.max(0, (prev[d.value] || 0) - 1) }))}
                                    className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors">
                                    <Minus size={11} />
                                  </button>
                                  <input type="number" min="0" value={count || ''}
                                    onChange={(e) => setDenomCounts(prev => ({ ...prev, [d.value]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                    className="w-10 h-6 text-center text-xs font-semibold border border-gray-200 rounded focus:ring-2 focus:ring-primary-300 focus:border-primary-400 outline-none"
                                    placeholder="0" />
                                  <button onClick={() => setDenomCounts(prev => ({ ...prev, [d.value]: (prev[d.value] || 0) + 1 }))}
                                    className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors">
                                    <Plus size={11} />
                                  </button>
                                </div>
                                <span className={`text-[10px] font-medium ${subtotal > 0 ? 'text-amber-800' : 'text-gray-300'}`}>
                                  {subtotal.toFixed(2)} DH
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Bills – 5 columns (one row) + overflow */}
                      <div className="bg-green-50 rounded-xl p-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700 mb-2">
                          <Banknote size={13} />
                          <span>Billets</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {DENOMINATIONS.filter(d => d.type === 'bill').map(d => {
                            const count = denomCounts[d.value] || 0;
                            const subtotal = d.value * count;
                            return (
                              <div key={d.value} className="flex flex-col items-center gap-1 bg-white rounded-lg py-2 px-1 ring-1 ring-green-100">
                                <img src={d.img} alt={`${d.label} DH`} className="w-16 h-10 object-contain" />
                                <div className="flex items-center gap-0.5">
                                  <button onClick={() => setDenomCounts(prev => ({ ...prev, [d.value]: Math.max(0, (prev[d.value] || 0) - 1) }))}
                                    className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors">
                                    <Minus size={11} />
                                  </button>
                                  <input type="number" min="0" value={count || ''}
                                    onChange={(e) => setDenomCounts(prev => ({ ...prev, [d.value]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                    className="w-10 h-6 text-center text-xs font-semibold border border-gray-200 rounded focus:ring-2 focus:ring-primary-300 focus:border-primary-400 outline-none"
                                    placeholder="0" />
                                  <button onClick={() => setDenomCounts(prev => ({ ...prev, [d.value]: (prev[d.value] || 0) + 1 }))}
                                    className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors">
                                    <Plus size={11} />
                                  </button>
                                </div>
                                <span className={`text-[10px] font-medium ${subtotal > 0 ? 'text-green-800' : 'text-gray-300'}`}>
                                  {subtotal.toFixed(2)} DH
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Counting total */}
                    <div className="bg-gray-900 text-white rounded-xl p-3 mb-3 flex justify-between items-center">
                      <span className="text-sm font-medium">Total trouve dans la caisse</span>
                      <span className="text-2xl font-bold">{denomTotal.toFixed(2)} DH</span>
                    </div>
                  </>
                )}

                <label className="block text-xs font-medium text-gray-700 mb-1">Observations (optionnel)</label>
                <textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)}
                  className="input mb-3" rows={1} placeholder="Remarques..." />
                <div className="flex gap-3">
                  <button onClick={() => { setShowCloseModal(false); setActualAmount(''); setCloseNotes(''); setCloseInputMode('direct'); setDenomCounts(Object.fromEntries(DENOMINATIONS.map(d => [d.value, 0]))); }}
                    className="btn-secondary flex-1">Annuler</button>
                  <button onClick={() => submitAmountMutation.mutate()}
                    disabled={
                      (closeInputMode === 'direct' ? !actualAmount || parseFloat(actualAmount) < 0 : denomTotal <= 0)
                      || submitAmountMutation.isPending
                    }
                    className="btn-primary flex-1">
                    {submitAmountMutation.isPending ? 'En cours...' : 'Valider'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold mb-6 text-center">
                  {closeType === 'passation' ? 'Resultat — Passation de shift' : 'Resultat de la caisse'}
                </h2>
                <div className="space-y-4 mb-6">
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Fond de caisse</span>
                      <span className="font-medium">{parseFloat(closeResult.opening_amount as string).toFixed(2)} DH</span>
                    </div>

                    {/* Breakdown by sale type */}
                    {(closeResult.standard_count as number) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ventes directes ({closeResult.standard_count as number})</span>
                        <span className="font-medium">{parseFloat(String(closeResult.standard_revenue || 0)).toFixed(2)} DH</span>
                      </div>
                    )}
                    {(closeResult.advance_count as number) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avances commandes ({closeResult.advance_count as number})</span>
                        <span className="font-medium text-orange-600">+{parseFloat(String(closeResult.advance_revenue || 0)).toFixed(2)} DH</span>
                      </div>
                    )}
                    {(closeResult.delivery_count as number) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Soldes livraisons ({closeResult.delivery_count as number})</span>
                        <span className="font-medium text-blue-600">+{parseFloat(String(closeResult.delivery_revenue || 0)).toFixed(2)} DH</span>
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

                  {/* ═══ Bilan produits : Approvisionné / Vendu / Théorique / Saisi / Écart ═══ */}
                  {inventoryItems.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-4 text-sm">
                      <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <Package size={16} className="text-indigo-500" />
                        Bilan des produits
                      </h3>
                      <div className="grid grid-cols-6 gap-1 text-xs font-medium text-gray-500 border-b pb-2 mb-2">
                        <span className="col-span-1">Produit</span>
                        <span className="text-center">Approv.</span>
                        <span className="text-center">Vendu</span>
                        <span className="text-center">Theor.</span>
                        <span className="text-center">Saisi</span>
                        <span className="text-center">Ecart</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {inventoryItems.map((it) => {
                          const pid = it.product_id as string;
                          const replenished = parseInt(it.replenished_today_qty as string) || 0;
                          const sold = parseInt(it.sold_qty as string) || 0;
                          const theoretical = Math.max(0, replenished - sold);
                          const counted = inventoryQtys[pid] ?? 0;
                          const ecart = theoretical - counted;
                          return (
                            <div key={pid} className={`grid grid-cols-6 gap-1 items-center py-1.5 px-1 rounded ${ecart !== 0 ? (ecart > 0 ? 'bg-orange-50' : 'bg-red-50') : ''}`}>
                              <span className="text-xs font-medium truncate" title={it.product_name as string}>
                                {it.product_name as string}
                              </span>
                              <span className="text-center text-xs font-semibold text-indigo-700">{replenished}</span>
                              <span className="text-center text-xs font-semibold text-blue-700">{sold}</span>
                              <span className="text-center text-xs font-semibold text-purple-700">{theoretical}</span>
                              <span className="text-center text-xs font-semibold text-gray-700">{counted}</span>
                              <span className={`text-center text-xs font-bold ${ecart > 0 ? 'text-orange-600' : ecart < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {ecart === 0 ? '0' : ecart > 0 ? `+${ecart}` : ecart}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Totaux */}
                      {(() => {
                        let totalReplenished = 0, totalSold = 0, totalTheoretical = 0, totalCounted = 0, totalEcart = 0;
                        inventoryItems.forEach((it) => {
                          const pid = it.product_id as string;
                          const replenished = parseInt(it.replenished_today_qty as string) || 0;
                          const sold = parseInt(it.sold_qty as string) || 0;
                          const theoretical = Math.max(0, replenished - sold);
                          const counted = inventoryQtys[pid] ?? 0;
                          totalReplenished += replenished; totalSold += sold; totalTheoretical += theoretical; totalCounted += counted;
                          totalEcart += theoretical - counted;
                        });
                        return (
                          <>
                            <div className="grid grid-cols-6 gap-1 items-center py-2 px-1 border-t mt-2 font-semibold text-xs">
                              <span>Total</span>
                              <span className="text-center text-indigo-700">{totalReplenished}</span>
                              <span className="text-center text-blue-700">{totalSold}</span>
                              <span className="text-center text-purple-700">{totalTheoretical}</span>
                              <span className="text-center text-gray-700">{totalCounted}</span>
                              <span className={`text-center font-bold ${totalEcart > 0 ? 'text-orange-600' : totalEcart < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {totalEcart === 0 ? '0' : totalEcart > 0 ? `+${totalEcart}` : totalEcart}
                              </span>
                            </div>
                            {totalEcart !== 0 && (
                              <div className={`mt-2 rounded-lg p-2 flex items-center gap-2 ${totalEcart > 0 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                <AlertTriangle size={14} />
                                <span className="text-xs font-medium">
                                  {totalEcart > 0
                                    ? `${totalEcart} unite(s) manquante(s) — perte/casse a justifier`
                                    : `${Math.abs(totalEcart)} unite(s) en surplus (anomalie)`}
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
                  setCloseStep('choose-type');
                  setCloseType('fin_journee');
                  setCloseInputMode('direct');
                  setDenomCounts(Object.fromEntries(DENOMINATIONS.map(d => [d.value, 0])));
                  queryClient.invalidateQueries({ queryKey: ['cash-register-session'] });
                  notify.success('Caisse fermée avec succès !');
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
            notify.success('Demande envoyee !');
          }}
        />
      )}

      {/* Loss Declaration Modal */}
      {showLossModal && (
        <LossDeclarationModal
          onClose={() => setShowLossModal(false)}
          sessionId={activeSession?.id}
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
                          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors">
                          <CheckCircle size={17} />
                          <span className="text-[10px] font-semibold">Confirmer</span>
                        </button>
                      ) : (
                        <button onClick={() => setConfirmingTransferId(null)}
                          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                          <XCircle size={17} />
                          <span className="text-[10px] font-medium">Annuler</span>
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
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Reçu</th>
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
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-50 text-green-700 text-sm font-bold hover:bg-green-100 transition-colors">
                          <CheckCircle size={16} />
                          {confirmTransferMutation.isPending ? 'Confirmation...' : 'Valider la réception'}
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
                          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                          <CheckCircle size={17} />
                          <span className="text-[10px] font-semibold">Confirmer</span>
                        </button>
                      ) : (
                        <button onClick={() => setConfirmingTransferId(null)}
                          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                          <XCircle size={17} />
                          <span className="text-[10px] font-medium">Annuler</span>
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
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-50 text-green-700 text-sm font-bold hover:bg-green-100 transition-colors">
                          <CheckCircle size={16} />
                          {confirmProductionTransferMutation.isPending ? 'Confirmation...' : 'Valider la réception'}
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
  const alreadyRequestedDetails: Record<string, { last_requested_at: string; store_stock: number }> = {};
  for (const d of (todayCheck?.alreadyRequestedDetails || []) as Array<{ product_id: string; last_requested_at: string; store_stock: number }>) {
    alreadyRequestedDetails[d.product_id] = d;
  }

  const MARGIN = 1.10; // +10% margin

  const getTargetDayName = () => {
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return days[(new Date().getDay() + 1) % 7];
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
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la création de la demande')),
  });

  const handleSubmit = async () => {
    const productIds = Object.keys(selected);
    if (!productIds.length) { notify.error('Sélectionnez au moins un produit'); return; }

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
        notify.error('Erreur lors de la vérification des articles');
        setSubmitting(false);
        return;
      }
    }

    const items = Object.entries(selected).map(([productId, requestedQuantity]) => ({ productId, requestedQuantity }));
    if (!items.length) { notify.error('Aucun article éligible à envoyer'); return; }
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
              <p className="text-xs text-gray-500">{hasHistory ? `Suggestions pour ${getTargetDayName()} basees sur l'historique du meme jour (+10%)` : 'Aucun historique — saisie manuelle'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/80 rounded-lg text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* Per-item warnings are shown inline below each product */}

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
                          const refType = (item.reference_type as string) || 'j7';
                          const refLabel = (item.reference_label as string) || '';
                          const suggested = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
                          const qty = selected[pid] || 0;
                          const isSelected = qty > 0;

                          const refBadge = refType === 'j7'
                            ? { bg: 'bg-green-50 text-green-700 border-green-200', label: 'J-7' }
                            : refType === 'j14'
                              ? { bg: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: 'J-14' }
                              : { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Moy.' };

                          const reqDetail = alreadyRequestedDetails[pid];
                          const showWarning = reqDetail && reqDetail.store_stock > 0;

                          return (
                            <div key={pid} className={`px-6 py-2.5 transition-colors ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}>
                              <div className="flex items-center gap-4">
                                <button onClick={() => isSelected ? setQty(pid, 0) : setQty(pid, suggested)}
                                  className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 hover:border-indigo-400'}`}>
                                  {isSelected && <CheckCircle size={14} className="text-white" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <span className={`text-sm ${isSelected ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                                    {(item.product_name || item.name) as string}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border font-semibold ${refBadge.bg}`} title={refLabel}>
                                    {refBadge.label}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-gray-100 text-gray-600" title={`Vendu: ${refLabel}`}>
                                    <Layers size={10} /> {sold}
                                  </span>
                                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg ${stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`} title="Stock actuel">
                                    <Package size={10} /> {Math.floor(stock)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-medium" title={`Suggere (${refLabel} x1.10)`}>
                                    <Lightbulb size={10} /> {suggested}
                                  </span>
                                </div>
                                {isSelected ? (
                                  <div className="flex items-center bg-white rounded-xl border border-indigo-200 shrink-0 shadow-sm overflow-hidden">
                                    <button onClick={() => setQty(pid, qty - 1)}
                                      className="w-8 h-8 flex items-center justify-center text-indigo-600 font-bold hover:bg-indigo-50">-</button>
                                    <input type="number" min={1} value={qty}
                                      onChange={e => setQty(pid, parseInt(e.target.value) || 0)}
                                      className="w-12 text-center text-sm font-bold h-8 border-x border-indigo-200 focus:outline-none focus:bg-indigo-50" />
                                    <button onClick={() => setQty(pid, qty + 1)}
                                      className="w-8 h-8 flex items-center justify-center text-indigo-600 font-bold hover:bg-indigo-50">+</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setQty(pid, suggested)}
                                    className="px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600 text-xs font-medium hover:bg-indigo-100 hover:text-indigo-700 transition-colors shrink-0">
                                    + Ajouter
                                  </button>
                                )}
                              </div>
                              {showWarning && (
                                <p className="ml-9 mt-1 text-[11px] text-amber-600 flex items-center gap-1">
                                  <AlertTriangle size={11} className="shrink-0" />
                                  Cet article a déjà été approvisionné aujourd'hui le {new Date(reqDetail.last_requested_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Il est encore disponible en vitrine ({reqDetail.store_stock} unité(s)).
                                </p>
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
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs text-gray-400">{p.category_name as string}</span>
                        </div>
                        {(() => { const rd = alreadyRequestedDetails[pid]; return rd && rd.store_stock > 0 ? (
                          <p className="text-[10px] text-amber-600 mb-1.5 leading-tight flex items-start gap-0.5">
                            <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                            Approvisionné — encore {rd.store_stock} en vitrine
                          </p>
                        ) : null; })()}
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
