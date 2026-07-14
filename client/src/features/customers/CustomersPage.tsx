import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers.api';
import {
  Plus, Search, Pencil, Star, Trash2, Users, Crown, ShoppingCart,
  Receipt, X, Loader2, Phone, Mail, Calendar, ChevronRight,
  ArrowUp, ArrowDown, Clock,
  Building2, MapPin, Cake, Heart, MessageSquare,
  HeartHandshake, FileText, Percent, CreditCard, User,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const AVATAR_COLORS = [
  'from-blue-500 to-indigo-500', 'from-emerald-500 to-teal-500', 'from-violet-500 to-purple-500',
  'from-rose-500 to-pink-500', 'from-amber-500 to-orange-500', 'from-cyan-500 to-sky-500',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getLoyaltyBadge(points: number) {
  if (points >= 5000) return { label: 'Or', bg: 'bg-amber-100', text: 'text-amber-700', icon: '👑' };
  if (points >= 2000) return { label: 'Argent', bg: 'bg-gray-100', text: 'text-gray-600', icon: '🥈' };
  if (points >= 500) return { label: 'Bronze', bg: 'bg-orange-50', text: 'text-orange-600', icon: '🥉' };
  return null;
}

type CustomerType = 'particulier' | 'professionnel' | 'association' | 'revendeur';

const TYPE_META: Record<CustomerType, { label: string; icon: any; color: string; badge: string }> = {
  particulier:   { label: 'Particulier',   icon: User,           color: 'from-blue-500 to-indigo-500',    badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  professionnel: { label: 'Société',       icon: Building2,      color: 'from-violet-500 to-purple-500',  badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  association:   { label: 'Association',   icon: HeartHandshake, color: 'from-emerald-500 to-teal-500',   badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  revendeur:     { label: 'Revendeur',     icon: ShoppingCart,   color: 'from-amber-500 to-orange-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function isMoral(t: string | undefined): boolean {
  return t === 'professionnel' || t === 'association' || t === 'revendeur';
}

function displayName(c: Record<string, any>): { primary: string; secondary: string | null } {
  const type = c.customer_type as string;
  const personne = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  if (isMoral(type) && c.company_name) {
    return { primary: c.company_name as string, secondary: personne || null };
  }
  return { primary: personne || 'Client', secondary: null };
}

function displayInitials(c: Record<string, any>): string {
  const type = c.customer_type as string;
  if (isMoral(type) && c.company_name) {
    const parts = (c.company_name as string).split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '');
  }
  return `${(c.first_name || '').charAt(0)}${(c.last_name || '').charAt(0)}`.toUpperCase() || '?';
}

type SortKey = 'name' | 'loyalty_points' | 'total_spent' | 'last_purchase';
type SortDir = 'asc' | 'desc';

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CustomerType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('total_spent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, typeFilter],
    queryFn: () => customersApi.list({
      search,
      limit: '200',
      ...(typeFilter !== 'all' ? { customerType: typeFilter } : {}),
    }),
  });

  const { data: globalStats } = useQuery({
    queryKey: ['customers-global-stats'],
    queryFn: customersApi.globalStats,
  });

  const deleteMutation = useMutation({
    mutationFn: customersApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-global-stats'] });
      notify.success('Client supprime');
    },
    onError: () => notify.error('Impossible de supprimer ce client (commandes ou ventes liees)'),
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      editing ? customersApi.update(editing.id as string, data) : customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-global-stats'] });
      notify.success(editing ? 'Client mis a jour' : 'Client cree');
      setShowForm(false); setEditing(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message || (editing ? 'Impossible de mettre a jour le client' : 'Impossible de creer le client');
      notify.error(msg);
    },
  });

  const customers = data?.data || [];

  const sorted = useMemo(() => {
    return [...customers].sort((a: Record<string, any>, b: Record<string, any>) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = displayName(a).primary.localeCompare(displayName(b).primary); break;
        case 'loyalty_points': cmp = (a.loyalty_points as number) - (b.loyalty_points as number); break;
        case 'total_spent': cmp = parseFloat(a.total_spent as string) - parseFloat(b.total_spent as string); break;
        case 'last_purchase': {
          const da = a.last_purchase_at ? new Date(a.last_purchase_at as string).getTime() : 0;
          const db = b.last_purchase_at ? new Date(b.last_purchase_at as string).getTime() : 0;
          cmp = da - db; break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [customers, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const gs = globalStats || { total_clients: 0, total_loyalty_points: 0, total_ca_clients: 0, best_client: null };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Fichier clients et fidelite</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nouveau client
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-2">
            <Users size={16} className="text-white" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{gs.total_clients}</p>
          <p className="text-xs text-gray-500">Total clients</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center mx-auto mb-2">
            <Star size={16} className="text-white" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{(gs.total_loyalty_points || 0).toLocaleString('fr-FR')}</p>
          <p className="text-xs text-gray-500">Points fidelite</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center mx-auto mb-2">
            <Receipt size={16} className="text-white" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{n(parseFloat(gs.total_ca_clients) || 0)}</p>
          <p className="text-xs text-gray-500">CA total (DH)</p>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center mx-auto mb-2">
            <Crown size={16} className="text-white" />
          </div>
          {gs.best_client ? (
            <>
              <p className="text-lg font-bold text-gray-900 truncate">
                {gs.best_client.company_name || `${gs.best_client.first_name} ${gs.best_client.last_name}`}
              </p>
              <p className="text-xs text-gray-500">{n(parseFloat(gs.best_client.total_spent))} DH</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-gray-400">-</p>
              <p className="text-xs text-gray-500">Meilleur client</p>
            </>
          )}
        </div>
      </div>

      {/* Filter by type */}
      <div className="bg-white rounded-xl border p-2 flex gap-1 overflow-x-auto">
        <button
          onClick={() => setTypeFilter('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            typeFilter === 'all' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'
          }`}>
          <Users size={12} /> Tous
        </button>
        {(Object.keys(TYPE_META) as CustomerType[]).map(t => {
          const meta = TYPE_META[t];
          const Icon = meta.icon;
          const active = typeFilter === t;
          return (
            <button key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                active ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'
              }`}>
              <Icon size={12} /> {meta.label}
            </button>
          );
        })}
      </div>

      {/* Search + Sort */}
      <div className="bg-white rounded-xl border p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Rechercher par nom, email, telephone, société, ICE..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10 w-full" />
        </div>
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
          {([
            { key: 'total_spent' as SortKey, label: 'CA' },
            { key: 'loyalty_points' as SortKey, label: 'Points' },
            { key: 'name' as SortKey, label: 'Nom' },
            { key: 'last_purchase' as SortKey, label: 'Dernier achat' },
          ]).map(s => (
            <button key={s.key} onClick={() => toggleSort(s.key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                sortKey === s.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {s.label}
              {sortKey === s.key && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </button>
          ))}
        </div>
      </div>

      {/* Customer list */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-gray-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement des clients...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <Users size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-400 font-medium">Aucun client trouve</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((c: Record<string, any>) => {
            const type = (c.customer_type as string) || 'particulier';
            const meta = TYPE_META[type as CustomerType] || TYPE_META.particulier;
            const { primary, secondary } = displayName(c);
            const initials = displayInitials(c);
            const avatarColor = isMoral(type) ? meta.color : getAvatarColor(primary);
            const badge = getLoyaltyBadge(c.loyalty_points as number);
            const ordersCount = (c.orders_count as number) || 0;
            const salesCount = (c.sales_count as number) || 0;
            const lastPurchase = c.last_purchase_at as string | null;
            const TypeIcon = meta.icon;

            return (
              <div key={c.id as string}
                className="bg-white rounded-xl border hover:shadow-md transition-all cursor-pointer group"
                onClick={() => setSelectedId(c.id as string)}>
                <div className="p-4">
                  {/* Top row: avatar + name + actions */}
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarColor} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white font-bold text-sm">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 truncate">{primary}</h3>
                        {badge && (
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${badge.bg} ${badge.text}`}>
                            {badge.icon} {badge.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${meta.badge}`}>
                          <TypeIcon size={9} /> {meta.label}
                        </span>
                        {secondary && (
                          <span className="text-[11px] text-gray-500 truncate">{secondary}</span>
                        )}
                      </div>
                      {c.phone && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                          <Phone size={10} /> {c.phone as string}
                        </p>
                      )}
                      {isMoral(type) && c.ice && (
                        <p className="text-[11px] text-gray-400 mt-0.5">ICE : {c.ice as string}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); setEditing(c); setShowForm(true); }}
                        className="p-1.5 hover:bg-gray-100 rounded-lg" title="Modifier">
                        <Pencil size={13} className="text-gray-400" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation();
                        if (confirm(`Supprimer ${primary} ?`)) deleteMutation.mutate(c.id as string);
                      }} className="p-1.5 hover:bg-red-50 rounded-lg" title="Supprimer">
                        <Trash2 size={13} className="text-red-400" />
                      </button>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100">
                    <div className="text-center">
                      <p className="text-sm font-bold text-gray-900">{n(parseFloat(c.total_spent as string))}</p>
                      <p className="text-[10px] text-gray-400 uppercase">DH depense</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Star size={12} className="text-amber-400" />
                        <p className="text-sm font-bold text-gray-900">{(c.loyalty_points as number).toLocaleString('fr-FR')}</p>
                      </div>
                      <p className="text-[10px] text-gray-400 uppercase">Points</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-gray-900">{ordersCount + salesCount}</p>
                      <p className="text-[10px] text-gray-400 uppercase">Achats</p>
                    </div>
                  </div>

                  {/* Last purchase */}
                  {lastPurchase && (
                    <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> Dernier achat: {format(new Date(lastPurchase), 'dd MMM yyyy', { locale: fr })}
                      </span>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Customer Detail Drawer */}
      {selectedId && (
        <CustomerDetailDrawer
          customerId={selectedId}
          onClose={() => setSelectedId(null)}
          onEdit={(c) => { setSelectedId(null); setEditing(c); setShowForm(true); }}
        />
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <CustomerFormModal
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSubmit={(data) => saveMutation.mutate(data)}
          isPending={saveMutation.isPending}
        />
      )}
    </div>
  );
}

/* ═══════════════════════ CUSTOMER DETAIL DRAWER ═══════════════════════ */
function CustomerDetailDrawer({ customerId, onClose, onEdit }: {
  customerId: string;
  onClose: () => void;
  onEdit: (c: Record<string, any>) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-stats', customerId],
    queryFn: () => customersApi.stats(customerId),
  });

  const customer = data?.customer;
  const orders = data?.orders;
  const sales = data?.sales;
  const [tab, setTab] = useState<'orders' | 'sales'>('sales');

  const type = customer ? (customer.customer_type as string || 'particulier') : 'particulier';
  const meta = TYPE_META[type as CustomerType] || TYPE_META.particulier;
  const TypeIcon = meta.icon;
  const { primary, secondary } = customer ? displayName(customer) : { primary: '', secondary: null };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-stretch justify-end z-50">
      <div className="bg-white w-full max-w-lg shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        {isLoading || !customer ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-gray-400" size={32} />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-white border-b z-10">
              <div className="p-5 flex items-start gap-4">
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${isMoral(type) ? meta.color : getAvatarColor(primary)} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white font-bold text-lg">{displayInitials(customer)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-gray-900">{primary}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${meta.badge}`}>
                      <TypeIcon size={10} /> {meta.label}
                    </span>
                    {secondary && (
                      <span className="text-xs text-gray-500">Contact : {secondary}{customer.contact_role ? ` (${customer.contact_role})` : ''}</span>
                    )}
                  </div>
                  {customer.phone && <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-1"><Phone size={13} /> {customer.phone}</p>}
                  {customer.email && <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5"><Mail size={13} /> {customer.email}</p>}
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Calendar size={11} /> Client depuis {format(new Date(customer.created_at), 'MMMM yyyy', { locale: fr })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onEdit(customer)} className="p-2 hover:bg-gray-100 rounded-lg">
                    <Pencil size={16} className="text-gray-400" />
                  </button>
                  <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
                    <X size={16} className="text-gray-400" />
                  </button>
                </div>
              </div>
            </div>

            {/* Identifiants légaux (entités morales) */}
            {isMoral(type) && (
              <div className="px-5 pt-4">
                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase text-gray-500 mb-2 flex items-center gap-1">
                    <FileText size={11} /> Identifiants légaux
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {customer.forme_juridique && <Info label="Forme" value={customer.forme_juridique} />}
                    {customer.ice && <Info label="ICE" value={customer.ice} mono />}
                    {customer.if_fiscal && <Info label="IF" value={customer.if_fiscal} mono />}
                    {customer.rc && <Info label="RC" value={`${customer.rc}${customer.rc_ville ? ' — ' + customer.rc_ville : ''}`} mono />}
                    {customer.tp && <Info label="TP" value={customer.tp} mono />}
                    {customer.cnss && <Info label="CNSS" value={customer.cnss} mono />}
                    {type === 'association' && customer.association_recepisse && <Info label="Récépissé" value={customer.association_recepisse} mono />}
                    {type === 'association' && customer.president && <Info label="Président" value={customer.president} />}
                    {customer.tva_exonere && <Info label="TVA" value="Exonérée" />}
                  </div>
                </div>
              </div>
            )}

            {/* Conditions commerciales (revendeur) */}
            {type === 'revendeur' && (customer.credit_limit || customer.remise_pct || customer.delai_paiement_jours) && (
              <div className="px-5 pt-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase text-amber-700 mb-2 flex items-center gap-1">
                    <CreditCard size={11} /> Conditions commerciales
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    {customer.credit_limit && (
                      <div>
                        <p className="text-[10px] text-amber-600">Plafond crédit</p>
                        <p className="font-bold text-amber-900">{n(parseFloat(customer.credit_limit))} DH</p>
                      </div>
                    )}
                    {customer.remise_pct && (
                      <div>
                        <p className="text-[10px] text-amber-600">Remise</p>
                        <p className="font-bold text-amber-900">{customer.remise_pct}%</p>
                      </div>
                    )}
                    {customer.delai_paiement_jours && (
                      <div>
                        <p className="text-[10px] text-amber-600">Délai</p>
                        <p className="font-bold text-amber-900">{customer.delai_paiement_jours} j</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Adresse */}
            {(customer.address || customer.city) && (
              <div className="px-5 pt-3">
                <p className="text-xs text-gray-500 flex items-start gap-1.5">
                  <MapPin size={12} className="mt-0.5 flex-shrink-0" />
                  <span>{[customer.address, customer.city].filter(Boolean).join(', ')}</span>
                </p>
              </div>
            )}

            {/* Stats cards */}
            <div className="grid grid-cols-2 gap-3 p-5">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Total depense</p>
                <p className="text-xl font-bold text-gray-900">{n(parseFloat(customer.total_spent))} <span className="text-sm font-normal text-gray-400">DH</span></p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Points fidelite</p>
                <div className="flex items-center justify-center gap-1.5">
                  <Star size={16} className="text-amber-400" />
                  <p className="text-xl font-bold text-gray-900">{(customer.loyalty_points as number).toLocaleString('fr-FR')}</p>
                </div>
                {getLoyaltyBadge(customer.loyalty_points) && (
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${getLoyaltyBadge(customer.loyalty_points)!.bg} ${getLoyaltyBadge(customer.loyalty_points)!.text}`}>
                    {getLoyaltyBadge(customer.loyalty_points)!.icon} {getLoyaltyBadge(customer.loyalty_points)!.label}
                  </span>
                )}
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Commandes</p>
                <div className="flex items-center justify-center gap-1.5">
                  <ShoppingCart size={14} className="text-blue-500" />
                  <p className="text-xl font-bold text-gray-900">{orders?.count || 0}</p>
                </div>
                {orders?.total_amount && parseFloat(orders.total_amount) > 0 && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{n(parseFloat(orders.total_amount))} DH</p>
                )}
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Ventes POS</p>
                <div className="flex items-center justify-center gap-1.5">
                  <Receipt size={14} className="text-emerald-500" />
                  <p className="text-xl font-bold text-gray-900">{sales?.count || 0}</p>
                </div>
                {sales?.total_amount && parseFloat(sales.total_amount) > 0 && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{n(parseFloat(sales.total_amount))} DH</p>
                )}
              </div>
            </div>

            {/* Notes */}
            {customer.notes && (
              <div className="px-5 pb-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-medium text-amber-700 mb-1">Notes</p>
                  <p className="text-sm text-amber-800">{customer.notes}</p>
                </div>
              </div>
            )}

            {/* History tabs */}
            <div className="border-t">
              <div className="px-5 pt-4">
                <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
                  <button onClick={() => setTab('sales')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                      tab === 'sales' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                    }`}>
                    <Receipt size={14} /> Ventes ({sales?.count || 0})
                  </button>
                  <button onClick={() => setTab('orders')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                      tab === 'orders' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                    }`}>
                    <ShoppingCart size={14} /> Commandes ({orders?.count || 0})
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-2">
                {tab === 'sales' ? (
                  (sales?.history || []).length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-6">Aucune vente</p>
                  ) : (
                    (sales.history as Record<string, any>[]).map((s: Record<string, any>) => (
                      <div key={s.id as string} className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">#{s.sale_number}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{format(new Date(s.created_at as string), 'dd/MM/yyyy HH:mm')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-gray-900">{n(parseFloat(s.total as string))} DH</p>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              s.payment_method === 'cash' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                            }`}>{s.payment_method === 'cash' ? 'Especes' : 'Carte'}</span>
                          </div>
                        </div>
                        {s.items && Array.isArray(s.items) && s.items[0]?.name && (
                          <div className="mt-2 pt-2 border-t border-gray-200">
                            {(s.items as Record<string, any>[]).slice(0, 3).map((item, i) => (
                              <p key={i} className="text-xs text-gray-500">{item.quantity}x {item.name} — {n(parseFloat(item.unit_price as string))} DH</p>
                            ))}
                            {(s.items as Record<string, any>[]).length > 3 && (
                              <p className="text-xs text-gray-400 mt-0.5">+{(s.items as Record<string, any>[]).length - 3} autres articles</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )
                ) : (
                  (orders?.history || []).length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-6">Aucune commande</p>
                  ) : (
                    (orders.history as Record<string, any>[]).map((o: Record<string, any>) => {
                      const statusMap: Record<string, { label: string; bg: string }> = {
                        pending: { label: 'En attente', bg: 'bg-yellow-100 text-yellow-700' },
                        confirmed: { label: 'Confirmee', bg: 'bg-blue-100 text-blue-700' },
                        in_production: { label: 'En production', bg: 'bg-violet-100 text-violet-700' },
                        ready: { label: 'Prete', bg: 'bg-emerald-100 text-emerald-700' },
                        completed: { label: 'Terminee', bg: 'bg-green-100 text-green-700' },
                        cancelled: { label: 'Annulee', bg: 'bg-gray-100 text-gray-500' },
                      };
                      const st = statusMap[o.status as string] || { label: o.status, bg: 'bg-gray-100 text-gray-500' };
                      return (
                        <div key={o.id as string} className="bg-gray-50 rounded-xl p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900">#{o.order_number}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{format(new Date(o.created_at as string), 'dd/MM/yyyy HH:mm')}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-gray-900">{n(parseFloat(o.total as string))} DH</p>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${st.bg}`}>{st.label}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 font-medium ${mono ? 'font-mono text-[11px]' : ''} text-right`}>{value}</span>
    </div>
  );
}

/* ═══════════════════════ CUSTOMER FORM MODAL ═══════════════════════ */
function CustomerFormModal({ editing, onClose, onSubmit, isPending }: {
  editing: Record<string, any> | null;
  onClose: () => void;
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
}) {
  const [customerType, setCustomerType] = useState<CustomerType>(
    (editing?.customer_type as CustomerType) || 'particulier'
  );
  const [tvaExonere, setTvaExonere] = useState<boolean>(
    editing?.tva_exonere === true || editing?.customer_type === 'association'
  );

  const isMoralEntity = isMoral(customerType);
  const inputClass = "w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors";

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`bg-gradient-to-r ${TYPE_META[customerType].color} p-5 flex items-center justify-between flex-shrink-0`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              {editing ? <Pencil size={20} className="text-white" /> : <Users size={20} className="text-white" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{editing ? 'Modifier le client' : 'Nouveau client'}</h2>
              <p className="text-sm text-white/80">{TYPE_META[customerType].label}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const payload: Record<string, any> = Object.fromEntries(fd);
          payload.tvaExonere = tvaExonere;
          onSubmit(payload);
        }} className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Section: Type de client */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Type de client</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(TYPE_META) as CustomerType[]).map(t => {
                const m = TYPE_META[t];
                const Icon = m.icon;
                const selected = customerType === t;
                return (
                  <button type="button" key={t}
                    onClick={() => {
                      setCustomerType(t);
                      if (t === 'association') setTvaExonere(true);
                      else if (t === 'particulier') setTvaExonere(false);
                    }}
                    className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border-2 transition-all ${
                      selected
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 bg-white text-gray-600'
                    }`}>
                    <Icon size={18} className={selected ? 'text-blue-500' : 'text-gray-400'} />
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <input type="hidden" name="customerType" value={customerType} />
          </div>

          {/* SOCIÉTÉ : Identité entreprise */}
          {isMoralEntity && (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                {customerType === 'association' ? 'Identité de l\'association' : 'Identité de l\'entreprise'}
              </label>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1.5"><Building2 size={13} /> Raison sociale *</span>
                  </label>
                  <input name="companyName" defaultValue={editing?.company_name as string}
                    className={inputClass} required
                    placeholder={customerType === 'association' ? 'Association X' : 'Pâtisserie du Coin SARL'} />
                </div>

                {customerType !== 'association' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Forme juridique</label>
                      <select name="formeJuridique" defaultValue={editing?.forme_juridique as string || ''} className={inputClass}>
                        <option value="">— Sélectionner —</option>
                        <option value="SARL">SARL</option>
                        <option value="SARL AU">SARL AU (associé unique)</option>
                        <option value="SA">SA</option>
                        <option value="SAS">SAS</option>
                        <option value="SNC">SNC</option>
                        <option value="AE">Auto-Entrepreneur</option>
                        <option value="Coop">Coopérative</option>
                        <option value="GIE">GIE</option>
                        <option value="Autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ville RC</label>
                      <input name="rcVille" defaultValue={editing?.rc_ville as string}
                        className={inputClass} placeholder="Casablanca" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SOCIÉTÉ : Identifiants légaux */}
          {isMoralEntity && (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Identifiants légaux</label>
              <div className="space-y-3">
                {customerType !== 'association' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">ICE</label>
                        <input name="ice" defaultValue={editing?.ice as string}
                          className={`${inputClass} font-mono`}
                          maxLength={15} pattern="[0-9]{15}"
                          title="15 chiffres"
                          placeholder="000000000000000" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">IF (Identifiant Fiscal)</label>
                        <input name="ifFiscal" defaultValue={editing?.if_fiscal as string}
                          className={`${inputClass} font-mono`} placeholder="12345678" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">RC (n°)</label>
                        <input name="rc" defaultValue={editing?.rc as string}
                          className={`${inputClass} font-mono`} placeholder="123456" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">TP (Taxe Prof.)</label>
                        <input name="tp" defaultValue={editing?.tp as string}
                          className={`${inputClass} font-mono`} placeholder="30123456" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CNSS (employeur)</label>
                      <input name="cnss" defaultValue={editing?.cnss as string}
                        className={`${inputClass} font-mono`} placeholder="1234567" />
                    </div>
                  </>
                )}

                {customerType === 'association' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">N° récépissé</label>
                        <input name="associationRecepisse" defaultValue={editing?.association_recepisse as string}
                          className={`${inputClass} font-mono`} placeholder="Récépissé de déclaration" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">IF (si assujettie)</label>
                        <input name="ifFiscal" defaultValue={editing?.if_fiscal as string}
                          className={`${inputClass} font-mono`} placeholder="Optionnel" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Président</label>
                      <input name="president" defaultValue={editing?.president as string}
                        className={inputClass} placeholder="Nom du président" />
                    </div>
                  </>
                )}

                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={tvaExonere} onChange={(e) => setTvaExonere(e.target.checked)}
                    className="w-4 h-4 accent-blue-500" />
                  <span>Client exonéré de TVA</span>
                </label>
              </div>
            </div>
          )}

          {/* Contact principal (entités morales) OU Identité (particulier) */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              {isMoralEntity ? 'Contact principal (optionnel)' : 'Identité'}
            </label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Prénom{isMoralEntity ? '' : ' *'}
                  </label>
                  <input name="firstName" defaultValue={editing?.first_name as string}
                    className={inputClass} required={!isMoralEntity} placeholder="Mohamed" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom{isMoralEntity ? '' : ' *'}
                  </label>
                  <input name="lastName" defaultValue={editing?.last_name as string}
                    className={inputClass} required={!isMoralEntity} placeholder="Alami" />
                </div>
              </div>

              {isMoralEntity && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fonction / Rôle</label>
                  <input name="contactRole" defaultValue={editing?.contact_role as string}
                    className={inputClass}
                    placeholder={customerType === 'association' ? 'Trésorier, Secrétaire...' : 'Gérant, Acheteur, Comptable...'} />
                </div>
              )}

              {!isMoralEntity && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1.5"><Cake size={13} /> Date de naissance</span>
                  </label>
                  <input name="birthday" type="date"
                    defaultValue={editing?.birthday ? (editing.birthday as string).slice(0, 10) : ''}
                    className={inputClass} />
                </div>
              )}
            </div>
          </div>

          {/* Contact */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Contact</label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1.5"><Phone size={13} /> Téléphone</span>
                  </label>
                  <input name="phone" defaultValue={editing?.phone as string}
                    className={inputClass} placeholder="06 XX XX XX XX" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1.5"><Mail size={13} /> Email</span>
                  </label>
                  <input name="email" type="email" defaultValue={editing?.email as string}
                    className={inputClass} placeholder="client@exemple.com" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact préféré</label>
                <div className="flex gap-2">
                  {(['phone', 'email', 'whatsapp'] as const).map(m => (
                    <label key={m} className="flex items-center gap-1.5 px-3 py-2 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors text-sm">
                      <input type="radio" name="preferredContact" value={m}
                        defaultChecked={(editing?.preferred_contact as string || 'phone') === m}
                        className="accent-blue-500" />
                      {m === 'phone' ? 'Téléphone' : m === 'email' ? 'Email' : 'WhatsApp'}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Adresse */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              {isMoralEntity ? 'Adresse du siège' : 'Adresse'}
            </label>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="flex items-center gap-1.5"><MapPin size={13} /> Adresse</span>
                </label>
                <input name="address" defaultValue={editing?.address as string}
                  className={inputClass} placeholder="123 Rue Mohammed V" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ville</label>
                <input name="city" defaultValue={editing?.city as string}
                  className={inputClass} placeholder="Casablanca, Rabat, Fès..." />
              </div>
            </div>
          </div>

          {/* REVENDEUR : Conditions commerciales */}
          {customerType === 'revendeur' && (
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <CreditCard size={11} /> Conditions commerciales
              </label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plafond crédit (DH)</label>
                  <input name="creditLimit" type="number" step="0.01" min="0"
                    defaultValue={editing?.credit_limit as string}
                    className={inputClass} placeholder="10000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1.5"><Percent size={11} /> Remise</span>
                  </label>
                  <input name="remisePct" type="number" step="0.01" min="0" max="100"
                    defaultValue={editing?.remise_pct as string}
                    className={inputClass} placeholder="5" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Délai (jours)</label>
                  <input name="delaiPaiementJours" type="number" step="1" min="0"
                    defaultValue={editing?.delai_paiement_jours as string}
                    className={inputClass} placeholder="30" />
                </div>
              </div>
            </div>
          )}

          {/* Préférences (particulier surtout) */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Préférences & Notes</label>
            <div className="space-y-3">
              {customerType === 'particulier' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <span className="flex items-center gap-1.5"><Heart size={13} /> Allergies / Restrictions</span>
                  </label>
                  <input name="allergies" defaultValue={editing?.allergies as string}
                    className={inputClass} placeholder="Gluten, lactose, fruits à coque..." />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="flex items-center gap-1.5"><MessageSquare size={13} /> Notes internes</span>
                </label>
                <textarea name="notes" defaultValue={editing?.notes as string} rows={2}
                  className={`${inputClass} resize-none`}
                  placeholder="Préférences, habitudes, informations utiles..." />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2 border-t border-gray-100 sticky bottom-0 bg-white pb-1 -mx-5 px-5">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">
              Annuler
            </button>
            <button type="submit" disabled={isPending}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {editing ? 'Mettre à jour' : 'Créer le client'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
