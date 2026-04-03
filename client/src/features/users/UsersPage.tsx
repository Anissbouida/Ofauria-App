import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/users.api';
import { Plus, Pencil, Shield, ShieldOff, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { ROLE_LABELS } from '@ofauria/shared';

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? usersApi.update(editing.id as string, data) : usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(editing ? 'Utilisateur mis a jour' : 'Utilisateur cree');
      setShowForm(false); setEditing(null);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err?.response?.data?.error?.message || 'Erreur');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.update(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Statut mis a jour');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Utilisateurs</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Nouvel utilisateur
        </button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Nom</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Email</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Code PIN</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Role</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u: Record<string, unknown>) => (
                <tr key={u.id as string} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="font-medium">{u.firstName as string} {u.lastName as string}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{u.email as string}</td>
                  <td className="px-6 py-4">
                    {u.pinCode ? (
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">{u.pinCode as string}</span>
                    ) : (
                      <span className="text-xs text-gray-300">Non defini</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                      {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role as string}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => { setEditing(u); setShowForm(true); }} className="p-2 hover:bg-gray-100 rounded-lg" title="Modifier">
                      <Pencil size={16} className="text-gray-500" />
                    </button>
                    <button
                      onClick={() => toggleMutation.mutate({ id: u.id as string, isActive: !u.isActive })}
                      className="p-2 hover:bg-gray-100 rounded-lg ml-1"
                      title={u.isActive ? 'Desactiver' : 'Activer'}
                    >
                      {u.isActive ? <ShieldOff size={16} className="text-red-500" /> : <Shield size={16} className="text-green-500" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p className="text-center py-8 text-gray-400">Aucun utilisateur</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, unknown> = Object.fromEntries(fd);
              if (!data.password) delete data.password;
              if (!data.pinCode) data.pinCode = editing ? null : undefined;
              if (data.pinCode === undefined) delete data.pinCode;
              saveMutation.mutate(data);
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Prenom</label>
                  <input name="firstName" defaultValue={editing?.firstName as string} className="input" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nom</label>
                  <input name="lastName" defaultValue={editing?.lastName as string} className="input" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input name="email" type="email" defaultValue={editing?.email as string} className="input" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                    <KeyRound size={14} />
                    Mot de passe {editing ? '(vide = inchange)' : ''}
                  </label>
                  <input name="password" type="password" className="input" placeholder={editing ? '••••••••' : 'Mot de passe'} {...(!editing ? { required: true, minLength: 4 } : {})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                    <KeyRound size={14} />
                    Code PIN (4 chiffres)
                  </label>
                  <input name="pinCode" type="text" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6}
                    defaultValue={editing?.pinCode as string || ''} className="input font-mono text-center tracking-widest"
                    placeholder="ex: 1234" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select name="role" defaultValue={editing?.role as string || 'cashier'} className="input">
                  <option value="admin">Administrateur</option>
                  <option value="manager">Gerant</option>
                  <option value="baker">Boulanger</option>
                  <option value="pastry_chef">Patissier</option>
                  <option value="viennoiserie">Viennoiserie</option>
                  <option value="saleswoman">Vendeuse</option>
                  <option value="cashier">Caissier</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
                  {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
