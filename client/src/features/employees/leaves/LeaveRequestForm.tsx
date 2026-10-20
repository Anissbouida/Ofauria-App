import { useRef, useState } from 'react';
import { CalendarOff, CalendarDays, AlertTriangle, Hourglass } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage } from '../shared';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { HrModal, SubmitButton, Field, inputCls } from '../ui';

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
  const formRef = useRef<HTMLFormElement>(null);
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
    <HrModal icon={CalendarOff} crumb="Congé" title="Nouvelle demande" width={560} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
        <SubmitButton pending={create.isPending} onClick={() => formRef.current?.requestSubmit()}
          disabled={!ready || (preview?.days ?? 1) <= 0 || (!!insufficient && !allowNegative)}>Enregistrer</SubmitButton>
      </>}>
        <form ref={formRef} onSubmit={e => { e.preventDefault(); create.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Employé *">
            <select className={inputCls} required value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">Choisir...</option>
              {(employees as Record<string, any>[]).filter(e => e.is_active).map(e => (
                <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
              ))}
            </select></Field>
          <Field label="Type *">
            <select className={inputCls} required value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
            </select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Du *">
              <input type="date" className={inputCls} required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value, endDate: form.endDate || e.target.value })} /></Field>
            <Field label="Au *">
              <input type="date" className={inputCls} required min={form.startDate} value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></Field>
          </div>
          {ready && (
            isFetching || !preview ? (
              <StatusBanner tone="neutral" icon={Hourglass} title="Calcul..." />
            ) : (
              <StatusBanner tone={insufficient ? 'danger' : 'info'} icon={insufficient ? AlertTriangle : CalendarDays}
                title={`${preview.days} jour${preview.days > 1 ? 's' : ''} ${preview.unit === 'ouvrable' ? 'ouvrable' : 'calendaire'}${preview.days > 1 ? 's' : ''}${insufficient ? ' — solde insuffisant' : ''}`}>
                {preview.unit === 'ouvrable' && 'Hors repos hebdomadaire et jours fériés · '}
                {preview.paid ? 'payé' : 'non payé par l\'employeur'}
                {preview.deductsBalance && (
                  <div style={{ marginTop: 2 }}>
                    Solde disponible : {(preview.available ?? 0).toFixed(2)} j
                    {(preview.pending ?? 0) > 0 && <> − {preview.pending.toFixed(2)} j en attente</>}
                    {insufficient && <> — <strong>solde insuffisant</strong></>}
                  </div>
                )}
              </StatusBanner>
            )
          )}
          {insufficient && user?.role === 'admin' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
              <input type="checkbox" checked={allowNegative} onChange={e => setAllowNegative(e.target.checked)} />
              Autoriser un congé anticipé (solde négatif)
            </label>
          )}
          <Field label="Motif">
            <textarea rows={2} className={inputCls} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
        </form>
    </HrModal>
  );
}
