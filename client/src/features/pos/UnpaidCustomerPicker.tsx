import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, User, UserPlus, X, AlertTriangle } from 'lucide-react';
import { customersApi } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Vente à plus tard = « Compte client » (mig 351) : la vente est portée sur la
 * fiche d'un client. On cherche (nom, téléphone) ou on crée la fiche en deux
 * champs, sans quitter la caisse. Le client choisi affiche ce qu'il doit déjà
 * et son plafond, pour décider en connaissance de cause.
 */
export default function UnpaidCustomerPicker({ customerId, customerLabel, saleTotal, onPick, onClear }: {
  customerId: string;
  customerLabel: string;
  saleTotal: number;
  onPick: (id: string, label: string) => void;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });

  const { data: results } = useQuery({
    queryKey: ['customers-search', query],
    queryFn: () => customersApi.list({ search: query, limit: '6' }),
    enabled: !customerId && query.trim().length >= 2,
  });
  const customers = ((results as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];

  const { data: situation } = useQuery({
    queryKey: ['customer-situation', customerId],
    queryFn: () => customersApi.situation(customerId),
    enabled: !!customerId,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const parts = newCustomer.name.trim().split(/\s+/);
      return customersApi.create({
        firstName: parts[0], lastName: parts.slice(1).join(' ') || null,
        phone: newCustomer.phone.trim() || null, customerType: 'particulier',
      });
    },
    onSuccess: (c: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onPick(c.id as string, [c.first_name, c.last_name].filter(Boolean).join(' '));
      setCreating(false);
      setNewCustomer({ name: '', phone: '' });
      notify.success('Fiche client créée');
    },
    onError: () => notify.error('Création de la fiche impossible'),
  });

  if (customerId) {
    const after = situation ? situation.total + saleTotal : null;
    const overLimit = situation?.creditLimit != null && after != null && after > situation.creditLimit;
    return (
      <div className="mb-4 space-y-2">
        <div className="bg-primary-50 ring-1 ring-primary-200 rounded-lg p-3 flex items-center gap-2">
          <User size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-primary-700 truncate flex-1">{customerLabel}</span>
          <button type="button" onClick={onClear} title="Changer de client" className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {situation && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 space-y-0.5">
            <div className="flex justify-between"><span>Doit déjà</span><span className="font-semibold">{situation.total.toFixed(2)} DH</span></div>
            {situation.overdue > 0 && (
              <div className="flex justify-between text-red-600"><span>dont en retard</span><span className="font-semibold">{situation.overdue.toFixed(2)} DH</span></div>
            )}
            {situation.creditLimit != null && (
              <div className="flex justify-between"><span>Plafond de crédit</span><span>{situation.creditLimit.toFixed(2)} DH</span></div>
            )}
            {overLimit && (
              <div className="flex items-center gap-1 text-red-600 font-medium pt-1">
                <AlertTriangle size={12} /> Avec cette vente : {after!.toFixed(2)} DH, au-dessus du plafond
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (creating) {
    return (
      <div className="mb-4 space-y-2">
        <label className="block text-sm font-medium text-gray-700">Nouvelle fiche client</label>
        <input className="input" placeholder="Nom et prénom" value={newCustomer.name} autoFocus maxLength={120}
          onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} />
        <input className="input" placeholder="Téléphone (pour le relancer)" type="tel" value={newCustomer.phone} maxLength={20}
          onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => setCreating(false)}>Retour</button>
          <button type="button" className="btn-primary flex-1" disabled={newCustomer.name.trim().length < 2 || createMutation.isPending}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Création…' : 'Créer et choisir'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-8" placeholder="Nom ou téléphone…" value={query} autoFocus
          onChange={e => setQuery(e.target.value)} />
      </div>
      {customers.length > 0 && (
        <div className="mt-1 border border-gray-200 rounded-lg divide-y max-h-48 overflow-y-auto">
          {customers.map(c => (
            <button key={c.id as string} type="button"
              onClick={() => onPick(c.id as string, (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '))}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
              <span className="font-medium">{(c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' ')}</span>
              {c.phone && <span className="text-xs text-gray-400 ml-2">{c.phone as string}</span>}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => { setCreating(true); setNewCustomer({ name: query.trim(), phone: '' }); }}
        className="mt-2 text-sm text-primary-600 font-medium inline-flex items-center gap-1">
        <UserPlus size={14} /> {query.trim().length >= 2 && customers.length === 0 ? `Créer la fiche « ${query.trim()} »` : 'Nouveau client'}
      </button>
      <p className="text-[11px] text-gray-400 mt-2">La vente est portée sur le compte du client et suivie dans Ventes › Créances clients.</p>
    </div>
  );
}
