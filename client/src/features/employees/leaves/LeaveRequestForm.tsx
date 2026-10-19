import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage } from '../shared';

/**
 * Demande de congé : le serveur décompte les jours (ouvrables hors repos et
 * fériés, ou calendaires selon le type) et contrôle le solde. L'aperçu les
 * affiche avant l'envoi.
 */
export default function LeaveRequestForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { entries: leaveTypes } = useReferentiel('leave_types');
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const [form, setForm] = useState({ employeeId: '', type: 'annual', startDate: '', endDate: '', reason: '' });
  const [allowNegative, setAllowNegative] = useState(false);
  const ready = !!(form.employeeId && form.type && form.startDate && form.endDate && form.endDate >= form.startDate);

  const { data: preview, isFetching } = useQuery<Record<string, any>>({
    queryKey: ['leave-preview', form.employeeId, form.type, form.startDate, form.endDate],
    queryFn: () => leavesApi.preview({ employeeId: form.employeeId, type: form.type, startDate: form.startDate, endDate: form.endDate }),
    enabled: ready,
  });
  const free = preview?.deductsBalance ? (preview.available ?? 0) - (preview.pending ?? 0) : null;
  const insufficient = free !== null && preview && preview.days > free + 0.001;

  const create = useMutation({
    mutationFn: () => leavesApi.create({ ...form, reason: form.reason || null, allowNegative: allowNegative || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      notify.success('Demande de congé enregistrée');
      onClose();
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors de l\'enregistrement')),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">Nouvelle demande de congé</h2>
        <form onSubmit={e => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Employé *</label>
            <select className="input" required value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">Choisir...</option>
              {(employees as Record<string, any>[]).filter(e => e.is_active).map(e => (
                <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
              ))}
            </select></div>
          <div><label className="block text-sm font-medium mb-1">Type *</label>
            <select className="input" required value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Du *</label>
              <input type="date" className="input" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value, endDate: form.endDate || e.target.value })} /></div>
            <div><label className="block text-sm font-medium mb-1">Au *</label>
              <input type="date" className="input" required min={form.startDate} value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          {ready && (
            <div className={`rounded-xl p-3 text-sm ${insufficient ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>
              {isFetching || !preview ? 'Calcul...' : (
                <>
                  <strong>{preview.days} jour{preview.days > 1 ? 's' : ''} {preview.unit === 'ouvrable' ? 'ouvrable' : 'calendaire'}{preview.days > 1 ? 's' : ''}</strong>
                  {preview.unit === 'ouvrable' && ' (hors repos hebdomadaire et jours fériés)'}
                  {preview.paid ? ' · payé' : ' · non payé par l\'employeur'}
                  {preview.deductsBalance && (
                    <div className="mt-1">
                      Solde disponible : {(preview.available ?? 0).toFixed(2)} j
                      {(preview.pending ?? 0) > 0 && <> − {preview.pending.toFixed(2)} j en attente</>}
                      {insufficient && <> — <strong>solde insuffisant</strong></>}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {insufficient && user?.role === 'admin' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allowNegative} onChange={e => setAllowNegative(e.target.checked)} />
              Autoriser un congé anticipé (solde négatif)
            </label>
          )}
          <div><label className="block text-sm font-medium mb-1">Motif</label>
            <textarea rows={2} className="input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={create.isPending || !ready || (preview?.days ?? 1) <= 0 || (!!insufficient && !allowNegative)} className="odoo-btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}
