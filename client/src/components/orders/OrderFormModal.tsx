import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { customersApi } from '../../api/customers.api';
import { employeesApi } from '../../api/employees.api';
import { settingsApi } from '../../api/settings.api';
import { useReferentiel } from '../../hooks/useReferentiel';
import { useAuth } from '../../context/AuthContext';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../ui/InlineNotification';
import { Plus, Trash2, Search, Phone, User, Users, Check, UserCircle } from 'lucide-react';

/* ─── Step indicators ─── */
const STEPS = [
  { num: 1, label: 'Client' },
  { num: 2, label: 'Produits' },
  { num: 3, label: 'Paiement' },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-1 px-5 py-3 border-b bg-gray-50 shrink-0">
      {STEPS.map((step, i) => (
        <div key={step.num} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            current === step.num
              ? 'bg-primary-600 text-white'
              : current > step.num
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-400'
          }`}>
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
              {current > step.num ? '✓' : step.num}
            </span>
            <span className="hidden sm:inline">{step.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-0.5 mx-1 ${current > step.num ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

type ClientMode = 'known' | 'walkin' | null;

/* ─── Order form modal (multi-step) ─── */
export default function OrderFormModal({ order, onClose, onSaved }: {
  order?: Record<string, unknown>;
  onClose: () => void;
  onSaved: (createdOrder?: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const { entries: paymentMethods } = useReferentiel('payment_methods');
  const isEdit = !!order;
  const [step, setStep] = useState(1);
  const [detailLoaded, setDetailLoaded] = useState(!isEdit);

  // Staff discount settings
  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.get,
  });
  const staffDiscountPercent = companySettings?.staffDiscountPercent ?? 10;

  // Step 1: Client mode
  const [clientMode, setClientMode] = useState<ClientMode>(
    isEdit ? (order.customer_id ? 'known' : (order.type === 'staff' ? null : 'walkin')) : null
  );

  // Known client
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    isEdit && order.customer_id ? (order.customer_id as string) : null
  );
  const [customerSearch, setCustomerSearch] = useState('');

  // Walk-in client
  const [customerName, setCustomerName] = useState(
    isEdit ? `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() : ''
  );
  const [customerPhone, setCustomerPhone] = useState(
    isEdit ? (order.customer_phone as string || '') : ''
  );

  const [pickupDate, setPickupDate] = useState(
    isEdit && order.pickup_date ? format(new Date(order.pickup_date as string), 'yyyy-MM-dd') : format(new Date(Date.now() + 86400000), 'yyyy-MM-dd')
  );
  const [type, setType] = useState(isEdit ? (order.type as string || 'custom') : 'custom');

  // Step 2: Products
  const [items, setItems] = useState<{ productId: string; quantity: number; notes: string }[]>([
    { productId: '', quantity: 1, notes: '' },
  ]);

  // Step 3: Payment
  const [deferPayment, setDeferPayment] = useState(isEdit ? (order.payment_method === 'deferred') : false);
  const [paymentMethod, setPaymentMethod] = useState(isEdit ? (order.payment_method as string || 'cash') : 'cash');
  const [discountAmount, setDiscountAmount] = useState(isEdit ? (parseFloat(order.discount_amount as string) || 0) : 0);
  const [advanceAmount, setAdvanceAmount] = useState(isEdit ? (parseFloat(order.advance_amount as string) || 0) : 0);
  const [notes, setNotes] = useState(isEdit ? (order.notes as string || '') : '');

  // Load order details when editing
  const { data: orderDetail } = useQuery({
    queryKey: ['order-detail', order?.id],
    queryFn: () => ordersApi.getById(order!.id as string),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!orderDetail || detailLoaded) return;
    const o = orderDetail;
    if (o.customer_phone && !customerPhone) {
      setCustomerPhone(o.customer_phone);
    }
    if (o.items && o.items.length > 0) {
      setItems(o.items.map((it: Record<string, unknown>) => ({
        productId: it.product_id as string,
        quantity: it.quantity as number,
        notes: (it.notes as string) || '',
      })));
    }
    setDetailLoaded(true);
  }, [orderDetail, detailLoaded, customerPhone]);

  // Customers query
  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customersApi.list({ limit: '500' }),
    enabled: clientMode === 'known',
  });
  const customers = (customersData?.data || []) as Record<string, unknown>[];

  const filteredCustomers = customers.filter(c => {
    if (!customerSearch) return true;
    const q = customerSearch.toLowerCase();
    const name = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
    const phone = (c.phone as string || '').toLowerCase();
    return name.includes(q) || phone.includes(q);
  });

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Employees query (for staff orders)
  const { data: employeesData } = useQuery({
    queryKey: ['employees-list'],
    queryFn: employeesApi.list,
    enabled: type === 'staff',
  });
  const employees = (employeesData?.data || employeesData || []) as Record<string, unknown>[];
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const filteredEmployees = employees.filter(e => {
    if (!employeeSearch) return true;
    const q = employeeSearch.toLowerCase();
    const name = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
    return name.includes(q);
  });
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const products = (productsData?.data || []) as Record<string, unknown>[];

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });
  const categories = (categoriesData || []) as Record<string, unknown>[];

  const createMutation = useMutation({
    mutationFn: ordersApi.create,
    onSuccess: (data: Record<string, unknown>) => { notify.success('Commande creee avec succes'); onSaved(data); },
    onError: () => { notify.error('Erreur lors de la creation'); },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => ordersApi.update(order!.id as string, data),
    onSuccess: () => { notify.success('Commande modifiee avec succes'); onSaved(); },
    onError: () => { notify.error('Erreur lors de la modification'); },
  });

  const [productSearch, setProductSearch] = useState('');
  const [productCatFilter, setProductCatFilter] = useState('');

  const setItemQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setItems(items.filter(it => it.productId !== productId));
    } else {
      const existing = items.find(it => it.productId === productId);
      if (existing) {
        setItems(items.map(it => it.productId === productId ? { ...it, quantity: qty } : it));
      } else {
        const cleanItems = items.filter(it => it.productId);
        setItems([...cleanItems, { productId, quantity: qty, notes: '' }]);
      }
    }
  };

  const getItemQty = (productId: string) => {
    const item = items.find(it => it.productId === productId);
    return item ? item.quantity : 0;
  };

  const filteredOrderProducts = products.filter(p => {
    const matchSearch = !productSearch || (p.name as string).toLowerCase().includes(productSearch.toLowerCase());
    const matchCat = !productCatFilter || String(p.category_id) === productCatFilter;
    return matchSearch && matchCat;
  });

  const subtotal = items.reduce((sum, item) => {
    if (!item.productId) return sum;
    const prod = products.find((p) => p.id === item.productId);
    return sum + (prod ? parseFloat(prod.price as string) * item.quantity : 0);
  }, 0);
  // Auto-calculate staff discount
  const effectiveDiscount = type === 'staff' ? Math.round(subtotal * staffDiscountPercent) / 100 : discountAmount;
  const total = Math.max(0, subtotal - effectiveDiscount);

  const validItems = items.filter((it) => it.productId && it.quantity > 0);

  // Derive display name for recap
  const displayName = clientMode === 'known' && selectedCustomer
    ? `${selectedCustomer.first_name || ''} ${selectedCustomer.last_name || ''}`.trim()
    : customerName.trim();
  const displayPhone = clientMode === 'known' && selectedCustomer
    ? (selectedCustomer.phone as string || '')
    : customerPhone;

  const canNextStep1 = type === 'staff'
    ? !!selectedEmployeeId && !!pickupDate
    : clientMode === 'known'
      ? !!selectedCustomerId && !!pickupDate
      : clientMode === 'walkin'
        ? !!customerName.trim() && !!pickupDate
        : false;
  const canNextStep2 = validItems.length > 0;

  const handleNext = () => {
    if (step === 1 && !canNextStep1) {
      notify.error(clientMode === 'known' ? 'Selectionnez un client et la date' : 'Saisissez le nom du client et la date');
      return;
    }
    if (step === 2 && !canNextStep2) { notify.error('Ajoutez au moins un produit'); return; }
    setStep(step + 1);
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {
      type, pickupDate,
      paymentMethod: deferPayment ? 'deferred' : paymentMethod,
      notes: notes || undefined,
      discountAmount: effectiveDiscount,
      advanceAmount: deferPayment ? 0 : advanceAmount,
      deferPayment,
      items: validItems.map((it) => ({ productId: it.productId, quantity: it.quantity, notes: it.notes || undefined })),
    };
    if (type === 'staff' && selectedEmployee) {
      payload.customerName = `${selectedEmployee.first_name || ''} ${selectedEmployee.last_name || ''}`.trim();
      payload.customerPhone = (selectedEmployee.phone as string) || undefined;
      payload.notes = `Commande personnel — Remise ${staffDiscountPercent}%${notes ? ` | ${notes}` : ''}`;
    } else if (clientMode === 'known' && selectedCustomerId) {
      payload.customerId = selectedCustomerId;
      payload.customerName = displayName;
      payload.customerPhone = displayPhone || undefined;
    } else {
      payload.customerName = customerName.trim();
      payload.customerPhone = customerPhone.trim() || undefined;
    }
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isEdit && !detailLoaded) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
          <p className="text-gray-500 text-sm">Chargement de la commande...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white w-full h-full sm:rounded-2xl flex flex-col sm:m-4 sm:max-h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-bakery-chocolate">
            {isEdit ? 'Modifier la commande' : 'Nouvelle commande'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Step content */}
        <div className="flex-1 overflow-y-auto">
          {/* ── STEP 1: Client ── */}
          {step === 1 && (
            <div className="p-5 space-y-5">
              {/* Mode selector: 3 cards (Client / Passager / Personnel) */}
              {!clientMode && type !== 'staff' && (
                <div className="space-y-4">
                  <h3 className="text-center text-lg font-semibold text-gray-700">Type de commande</h3>
                  <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
                    {/* Known client card */}
                    <button type="button" onClick={() => { setClientMode('known'); setType('custom'); }}
                      className="group relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-blue-500 hover:bg-blue-50 transition-all">
                      <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                        <Users size={28} className="text-blue-600" />
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-800 text-base">Client</p>
                        <p className="text-xs text-gray-400 mt-1">Client enregistre dans la base</p>
                      </div>
                    </button>

                    {/* Walk-in client card */}
                    <button type="button" onClick={() => { setClientMode('walkin'); setType('custom'); }}
                      className="group relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-amber-500 hover:bg-amber-50 transition-all">
                      <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                        <User size={28} className="text-amber-600" />
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-800 text-base">Passager</p>
                        <p className="text-xs text-gray-400 mt-1">Client de passage</p>
                      </div>
                    </button>

                    {/* Staff card */}
                    <button type="button" onClick={() => { setType('staff'); setClientMode(null); setSelectedCustomerId(null); }}
                      className="group relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-purple-500 hover:bg-purple-50 transition-all">
                      <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                        <UserCircle size={28} className="text-purple-600" />
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-gray-800 text-base">Personnel</p>
                        <p className="text-xs text-gray-400 mt-1">Remise {staffDiscountPercent}% automatique</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Known client: search & select */}
              {clientMode === 'known' && type !== 'staff' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => { setClientMode(null); setSelectedCustomerId(null); setCustomerSearch(''); setType('custom'); }}
                      className="text-sm text-gray-400 hover:text-gray-600 transition-colors">&larr; Changer</button>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Users size={16} className="text-blue-600" />
                      </div>
                      <h3 className="text-sm font-semibold text-gray-700">Client connu</h3>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" autoFocus value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Rechercher par nom ou telephone..."
                      className="input text-base py-3 w-full pl-10" />
                  </div>

                  {/* Customer list */}
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {filteredCustomers.length === 0 ? (
                      <p className="text-center py-6 text-gray-400 text-sm">Aucun client trouve</p>
                    ) : filteredCustomers.map(c => {
                      const cId = c.id as string;
                      const isSelected = cId === selectedCustomerId;
                      const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim();
                      return (
                        <button key={cId} type="button"
                          onClick={() => {
                            setSelectedCustomerId(cId);
                            setCustomerName(fullName);
                            setCustomerPhone(c.phone as string || '');
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                            isSelected
                              ? 'bg-blue-50 border-2 border-blue-500 shadow-sm'
                              : 'bg-white border-2 border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                          }`}>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                            isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>{fullName}</p>
                            {c.phone && (
                              <p className="text-xs text-gray-400 flex items-center gap-1">
                                <Phone size={10} /> {c.phone as string}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                              <Check size={14} className="text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date de retrait *</label>
                    <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)}
                      className="input text-base py-3" required />
                  </div>
                </div>
              )}

              {/* Walk-in client: name + phone */}
              {clientMode === 'walkin' && type !== 'staff' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => { setClientMode(null); setCustomerName(''); setCustomerPhone(''); setType('custom'); }}
                      className="text-sm text-gray-400 hover:text-gray-600 transition-colors">&larr; Changer</button>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                        <User size={16} className="text-amber-600" />
                      </div>
                      <h3 className="text-sm font-semibold text-gray-700">Client passager</h3>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom du client *</label>
                    <input type="text" autoFocus value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Nom complet du client"
                      className="input text-base py-3 w-full" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Numero de telephone</label>
                    <div className="relative">
                      <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="06 XX XX XX XX"
                        className="input text-base py-3 w-full pl-10" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date de retrait *</label>
                    <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)}
                      className="input text-base py-3" required />
                  </div>
                </div>
              )}

              {/* Staff order: employee selection */}
              {type === 'staff' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => { setType('custom'); setSelectedEmployeeId(null); setEmployeeSearch(''); }}
                      className="text-sm text-gray-400 hover:text-gray-600 transition-colors">&larr; Changer</button>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                        <UserCircle size={16} className="text-purple-600" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700">Commande personnel</h3>
                        <p className="text-[11px] text-purple-600 font-medium">Remise automatique de {staffDiscountPercent}%</p>
                      </div>
                    </div>
                  </div>

                  {/* Date de retrait */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date de retrait *</label>
                    <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)}
                      className="input text-base py-3" required />
                  </div>

                  {/* Employee search */}
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" autoFocus value={employeeSearch} onChange={e => setEmployeeSearch(e.target.value)}
                      placeholder="Rechercher un employe..."
                      className="input text-base py-3 w-full pl-10" />
                  </div>

                  {/* Employee list */}
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {filteredEmployees.length === 0 ? (
                      <p className="text-center py-6 text-gray-400 text-sm">Aucun employe trouve</p>
                    ) : filteredEmployees.map(e => {
                      const eId = e.id as string;
                      const isSelected = eId === selectedEmployeeId;
                      const fullName = `${e.first_name || ''} ${e.last_name || ''}`.trim();
                      const role = (e.role as string) || '';
                      return (
                        <button key={eId} type="button"
                          onClick={() => setSelectedEmployeeId(eId)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                            isSelected
                              ? 'bg-purple-50 border-2 border-purple-500 shadow-sm'
                              : 'bg-white border-2 border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                          }`}>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                            isSelected ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium truncate ${isSelected ? 'text-purple-700' : 'text-gray-800'}`}>{fullName}</p>
                            <p className="text-xs text-gray-400 capitalize">{role.replace(/_/g, ' ')}</p>
                          </div>
                          {isSelected && (
                            <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                              <Check size={14} className="text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── STEP 2: Products (grid with category sidebar) ── */}
          {step === 2 && (
            <div className="flex h-full">
              {/* Category sidebar (left) */}
              <div className="w-40 shrink-0 border-r bg-gray-50 overflow-y-auto py-3 px-2 flex flex-col gap-1.5">
                <button type="button" onClick={() => setProductCatFilter('')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    !productCatFilter ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  Tous
                </button>
                {categories.map(cat => (
                  <button key={cat.id as number} type="button" onClick={() => setProductCatFilter(String(cat.id))}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      productCatFilter === String(cat.id) ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                    }`}>
                    {cat.name as string}
                  </button>
                ))}
              </div>

              {/* Right content: search + grid */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Search */}
                <div className="px-5 py-2 shrink-0">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)}
                      placeholder="Rechercher un produit..."
                      className="input text-base py-2.5 w-full pl-10" />
                  </div>
                </div>

                {/* Products grid */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {filteredOrderProducts.map(p => {
                    const pid = p.id as string;
                    const qty = getItemQty(pid);
                    const price = parseFloat(p.price as string);
                    const isSelected = qty > 0;
                    return (
                      <div key={pid}
                        className={`rounded-xl border-2 p-3 transition-all select-none ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50 shadow-sm'
                            : 'border-gray-200 bg-white'
                        }`}>
                        <div className="text-sm font-semibold text-gray-800 mb-0.5 leading-tight h-[2.5rem]" title={p.name as string}>
                          <span className="line-clamp-2">{p.name as string}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-gray-400">{p.category_name as string || ''}</span>
                          <span className="text-xs font-semibold text-primary-600 ml-auto">{price.toFixed(2)} DH</span>
                        </div>

                        {!isSelected ? (
                          <button type="button" onClick={() => setItemQty(pid, 1)}
                            className="w-full py-2 rounded-lg bg-primary-600 text-white text-sm font-medium active:bg-primary-700 transition-colors">
                            <Plus size={16} className="inline -mt-0.5 mr-1" /> Ajouter
                          </button>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between bg-white rounded-lg border border-primary-200 overflow-hidden">
                              <button type="button" onClick={() => setItemQty(pid, qty - 1)}
                                className="w-10 h-9 flex items-center justify-center text-lg font-bold text-primary-600 active:bg-primary-50">
                                {qty === 1 ? <Trash2 size={14} className="text-red-400" /> : '−'}
                              </button>
                              <input type="number" min="1" value={qty}
                                onChange={e => setItemQty(pid, parseInt(e.target.value) || 0)}
                                className="w-12 text-center text-base font-bold border-x border-primary-200 h-9 focus:outline-none" />
                              <button type="button" onClick={() => setItemQty(pid, qty + 1)}
                                className="w-10 h-9 flex items-center justify-center text-lg font-bold text-primary-600 active:bg-primary-50">
                                +
                              </button>
                            </div>
                            <div className="text-xs text-gray-500 text-center mt-1">
                              {price.toFixed(2)} x {qty} = <span className="font-bold text-gray-700">{(price * qty).toFixed(2)} DH</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {filteredOrderProducts.length === 0 && (
                  <div className="text-center py-8 text-gray-400">Aucun produit trouve</div>
                )}
              </div>

              {/* Selected items summary */}
              {validItems.length > 0 && (
                <div className="border-t bg-white px-5 py-3 shrink-0">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {validItems.map(item => {
                      const prod = products.find(p => p.id === item.productId);
                      return (
                        <span key={item.productId} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-100 text-primary-800 text-sm font-medium">
                          {prod ? prod.name as string : item.productId} <strong>&times;{item.quantity}</strong>
                          <button type="button" onClick={() => setItemQty(item.productId, 0)}
                            className="ml-1 text-primary-400 hover:text-red-500">&times;</button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">{validItems.length} produit(s)</span>
                    <span className="text-lg font-bold">{subtotal.toFixed(2)} DH</span>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}

          {/* ── STEP 3: Payment ── */}
          {step === 3 && (
            <div className="p-5 space-y-5">
              {/* Order summary */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-500 mb-3">Recapitulatif</h3>
                <div className="flex items-center gap-3 mb-3 pb-3 border-b">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                    clientMode === 'known' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {displayName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {displayName}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        clientMode === 'known' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {clientMode === 'known' ? 'Client connu' : 'Passager'}
                      </span>
                    </div>
                    {displayPhone && (
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        <Phone size={11} /> {displayPhone}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto text-sm text-gray-500">
                    Retrait: <strong>{format(new Date(pickupDate + 'T12:00'), 'dd MMM yyyy', { locale: fr })}</strong>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {validItems.map((item, idx) => {
                    const prod = products.find((p) => p.id === item.productId);
                    const lineTotal = prod ? parseFloat(prod.price as string) * item.quantity : 0;
                    return (
                      <div key={idx} className="flex items-center justify-between text-sm">
                        <span>{prod?.name as string} <span className="text-gray-400">x{item.quantity}</span></span>
                        <span className="font-medium">{lineTotal.toFixed(2)} DH</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t font-semibold">
                  <span>Sous-total</span>
                  <span>{subtotal.toFixed(2)} DH</span>
                </div>
              </div>

              {/* Deferred payment option for known clients */}
              {clientMode === 'known' && (
                <div>
                  <button type="button" onClick={() => setDeferPayment(!deferPayment)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 transition-all ${
                      deferPayment
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                      deferPayment ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                    }`}>
                      {deferPayment && <Check size={14} className="text-white" />}
                    </div>
                    <div className="text-left flex-1">
                      <p className={`text-sm font-medium ${deferPayment ? 'text-blue-700' : 'text-gray-700'}`}>Reporter le paiement</p>
                      <p className="text-xs text-gray-400">Une facture sera generee automatiquement pour le suivi</p>
                    </div>
                  </button>
                </div>
              )}

              {/* Payment method (hidden when deferred) */}
              {!deferPayment && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
                    <div className="grid grid-cols-3 gap-2">
                      {paymentMethods.filter(pm => pm.code !== 'deferred').map((pm) => (
                        <button key={pm.code} type="button" onClick={() => setPaymentMethod(pm.code)}
                          className={`py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                            paymentMethod === pm.code
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}>
                          {pm.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Discount + Advance */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Remise (DH)</label>
                      {type === 'staff' ? (
                        <div className="input py-3 w-full text-base bg-purple-50 border-purple-200 text-purple-700 font-semibold flex items-center justify-between">
                          <span>{effectiveDiscount.toFixed(2)}</span>
                          <span className="text-xs font-medium bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">{staffDiscountPercent}%</span>
                        </div>
                      ) : (
                        <input type="number" min="0" step="0.01" value={discountAmount}
                          onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                          className="input py-3 w-full text-base" />
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Avance (DH)</label>
                      <input type="number" min="0" step="0.01" value={advanceAmount}
                        onChange={(e) => setAdvanceAmount(parseFloat(e.target.value) || 0)}
                        className="input py-3 w-full text-base" />
                    </div>
                  </div>
                </>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="input py-2.5 w-full text-base" rows={2} placeholder="Instructions speciales..." />
              </div>

              {/* Total summary */}
              <div className="bg-primary-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Sous-total</span>
                  <span className="font-medium">{subtotal.toFixed(2)} DH</span>
                </div>
                {effectiveDiscount > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>Remise{type === 'staff' ? ` personnel (${staffDiscountPercent}%)` : ''}</span>
                    <span>-{effectiveDiscount.toFixed(2)} DH</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold border-t border-primary-200 pt-2">
                  <span>Total</span>
                  <span>{total.toFixed(2)} DH</span>
                </div>
                {deferPayment ? (
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-blue-600 font-medium">Paiement reporte</span>
                    <span className="text-blue-600 font-medium">Facture a emettre</span>
                  </div>
                ) : (
                  <>
                    {advanceAmount > 0 && (
                      <div className="flex justify-between text-sm pt-1">
                        <span className="text-green-600 font-medium">Avance versee</span>
                        <span className="text-green-600 font-medium">{advanceAmount.toFixed(2)} DH</span>
                      </div>
                    )}
                    {advanceAmount > 0 && (
                      <div className="flex justify-between text-sm font-semibold">
                        <span>Reste a payer</span>
                        <span>{Math.max(0, total - advanceAmount).toFixed(2)} DH</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="border-t px-5 py-4 shrink-0 rounded-b-2xl">
          <div className="flex gap-3">
            {step === 1 ? (
              <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5">Annuler</button>
            ) : (
              <button type="button" onClick={() => setStep(step - 1)} className="btn-secondary flex-1 py-2.5">
                Retour
              </button>
            )}
            {step < 3 ? (
              <button type="button" onClick={handleNext}
                disabled={step === 1 ? !canNextStep1 : !canNextStep2}
                className="btn-primary flex-1 py-2.5 disabled:opacity-50">
                Suivant
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={saving}
                className="btn-primary flex-1 py-2.5 disabled:opacity-50">
                {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer les modifications' : 'Confirmer la commande'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
