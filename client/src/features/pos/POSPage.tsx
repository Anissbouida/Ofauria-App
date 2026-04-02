import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { ordersApi } from '../../api/orders.api';
import { customersApi } from '../../api/customers.api';
import { Minus, Plus, Trash2, Search, User } from 'lucide-react';
import toast from 'react-hot-toast';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
}

export default function POSPage() {
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [showPayment, setShowPayment] = useState(false);

  const { data: productsData } = useQuery({
    queryKey: ['pos-products', { categoryId: selectedCategory, search, isAvailable: 'true' }],
    queryFn: () => productsApi.list({ categoryId: selectedCategory, search, isAvailable: 'true', limit: '100' }),
  });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const { data: customersData } = useQuery({
    queryKey: ['customers-search', customerSearch],
    queryFn: () => customersApi.list({ search: customerSearch, limit: '5' }),
    enabled: customerSearch.length >= 2,
  });

  const checkoutMutation = useMutation({
    mutationFn: ordersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setCart([]); setCustomerId(''); setShowPayment(false);
      toast.success('Commande enregistree !');
    },
    onError: () => toast.error('Erreur lors de la commande'),
  });

  const products = productsData?.data || [];
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal;

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
      type: 'in_store',
      items: cart.map(i => ({ productId: i.productId, quantity: i.quantity })),
      paymentMethod,
    });
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-7rem)]">
      {/* Left: Product Grid */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Rechercher un produit..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
          </div>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button onClick={() => setSelectedCategory('')} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${!selectedCategory ? 'bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>Tout</button>
          {categories.map((c: { id: number; name: string }) => (
            <button key={c.id} onClick={() => setSelectedCategory(String(c.id))} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${selectedCategory === String(c.id) ? 'bg-primary-600 text-white' : 'bg-white text-gray-600'}`}>{c.name}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto flex-1">
          {products.map((p: Record<string, unknown>) => (
            <button key={p.id as string} onClick={() => addToCart(p)} className="bg-white rounded-xl p-3 text-left hover:shadow-md transition-shadow border border-gray-100 flex flex-col">
              {p.image_url ? (
                <img src={p.image_url as string} alt="" className="w-full h-24 object-cover rounded-lg mb-2" />
              ) : (
                <div className="w-full h-24 bg-primary-50 rounded-lg mb-2 flex items-center justify-center text-3xl">🥖</div>
              )}
              <span className="font-medium text-sm truncate">{p.name as string}</span>
              <span className="text-primary-600 font-bold mt-1">{parseFloat(p.price as string).toFixed(2)} €</span>
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
                <p className="text-primary-600 text-sm">{item.price.toFixed(2)} €</p>
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
              <span className="text-sm font-semibold w-16 text-right">{(item.price * item.quantity).toFixed(2)} €</span>
              <button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))} className="text-red-400 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Customer search */}
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

        {/* Total and checkout */}
        <div className="p-4 border-t space-y-3">
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="text-primary-600">{total.toFixed(2)} €</span>
          </div>
          <button onClick={() => setShowPayment(true)} disabled={cart.length === 0} className="btn-primary w-full py-3 text-lg">
            Encaisser
          </button>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold mb-4">Paiement</h2>
            <p className="text-3xl font-bold text-primary-600 text-center mb-6">{total.toFixed(2)} €</p>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {(['cash', 'card', 'mobile'] as const).map(m => (
                <button key={m} onClick={() => setPaymentMethod(m)}
                  className={`py-3 rounded-xl text-sm font-medium transition-colors ${paymentMethod === m ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {m === 'cash' ? 'Especes' : m === 'card' ? 'Carte' : 'Mobile'}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowPayment(false)} className="btn-secondary flex-1">Annuler</button>
              <button onClick={handleCheckout} disabled={checkoutMutation.isPending} className="btn-primary flex-1">
                {checkoutMutation.isPending ? 'En cours...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
