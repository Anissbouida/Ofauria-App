import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers.api';
import { Plus, Search, Pencil, Star } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list({ search }),
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? customersApi.update(editing.id as string, data) : customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(editing ? 'Client mis a jour' : 'Client cree');
      setShowForm(false); setEditing(null);
    },
  });

  const customers = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Clients</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouveau client
        </button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Rechercher un client..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c: Record<string, unknown>) => (
            <div key={c.id as string} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{c.first_name as string} {c.last_name as string}</h3>
                  {c.email && <p className="text-sm text-gray-500">{c.email as string}</p>}
                  {c.phone && <p className="text-sm text-gray-500">{c.phone as string}</p>}
                </div>
                <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-2 hover:bg-gray-100 rounded-lg">
                  <Pencil size={14} className="text-gray-400" />
                </button>
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                <div className="flex items-center gap-1 text-sm">
                  <Star size={14} className="text-amber-400" />
                  <span className="font-medium">{c.loyalty_points as number} pts</span>
                </div>
                <span className="text-sm text-gray-500">Total: {parseFloat(c.total_spent as string).toFixed(2)} DH</span>
              </div>
            </div>
          ))}
          {customers.length === 0 && <p className="text-gray-400 col-span-full text-center py-8">Aucun client trouve</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier le client' : 'Nouveau client'}</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveMutation.mutate(Object.fromEntries(fd));
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Prenom</label><input name="firstName" defaultValue={editing?.first_name as string} className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Nom</label><input name="lastName" defaultValue={editing?.last_name as string} className="input" required /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Email</label><input name="email" type="email" defaultValue={editing?.email as string} className="input" /></div>
              <div><label className="block text-sm font-medium mb-1">Telephone</label><input name="phone" defaultValue={editing?.phone as string} className="input" /></div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
