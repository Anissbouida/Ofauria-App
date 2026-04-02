import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '../../api/employees.api';
import { Plus, Pencil, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data: employees = [], isLoading } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? employeesApi.update(editing.id as string, data) : employeesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(editing ? 'Employe mis a jour' : 'Employe ajoute');
      setShowForm(false); setEditing(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bakery-chocolate">Employes</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Ajouter un employe
        </button>
      </div>

      {isLoading ? <p className="text-gray-500">Chargement...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((e: Record<string, unknown>) => (
            <div key={e.id as string} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <UserCog size={20} className="text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{e.first_name as string} {e.last_name as string}</h3>
                    <p className="text-sm text-gray-500 capitalize">{e.role as string}</p>
                  </div>
                </div>
                <button onClick={() => { setEditing(e); setShowForm(true); }} className="p-2 hover:bg-gray-100 rounded-lg">
                  <Pencil size={14} className="text-gray-400" />
                </button>
              </div>
              <div className="mt-3 pt-3 border-t text-sm text-gray-500 flex justify-between">
                <span>{e.phone as string || 'Pas de telephone'}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${e.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {e.is_active ? 'Actif' : 'Inactif'}
                </span>
              </div>
            </div>
          ))}
          {employees.length === 0 && <p className="text-gray-400 col-span-full text-center py-8">Aucun employe</p>}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">{editing ? 'Modifier' : 'Nouvel employe'}</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, unknown> = Object.fromEntries(fd);
              if (data.hourlyRate) data.hourlyRate = parseFloat(data.hourlyRate as string);
              saveMutation.mutate(data);
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Prenom</label><input name="firstName" defaultValue={editing?.first_name as string} className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Nom</label><input name="lastName" defaultValue={editing?.last_name as string} className="input" required /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Role</label>
                <select name="role" defaultValue={editing?.role as string || 'baker'} className="input">
                  <option value="baker">Boulanger</option><option value="decorator">Patissier</option>
                  <option value="cashier">Caissier</option><option value="manager">Gerant</option>
                </select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Telephone</label><input name="phone" defaultValue={editing?.phone as string} className="input" /></div>
                <div><label className="block text-sm font-medium mb-1">Taux horaire (€)</label><input name="hourlyRate" type="number" step="0.01" defaultValue={editing?.hourly_rate as string} className="input" /></div>
              </div>
              {!editing && <div><label className="block text-sm font-medium mb-1">Date d'embauche</label><input name="hireDate" type="date" className="input" required /></div>}
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
