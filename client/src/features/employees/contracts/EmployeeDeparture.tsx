import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, FileText, Award, RotateCcw } from 'lucide-react';
import { settlementsApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage, saveBlobResponse } from '../shared';

const REASONS: Record<string, string> = {
  demission: 'Démission', licenciement: 'Licenciement', faute_grave: 'Licenciement pour faute grave',
  fin_cdd: 'Fin de CDD', rupture_essai: 'Rupture de la période d\'essai', depart_negocie: 'Départ négocié',
  retraite: 'Retraite', deces: 'Décès', abandon_poste: 'Abandon de poste',
};
const fmt = (v: number) => (v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frd = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/**
 * Départ du salarié : aperçu du solde de tout compte (congés, préavis,
 * indemnité de licenciement, dommages-intérêts), validation (admin : clôture
 * du contrat, sortie des effectifs, lignes ajoutées au dernier bulletin),
 * reçu pour solde de tout compte et certificat de travail.
 */
export default function EmployeeDeparture({ employee }: { employee: Record<string, any> }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const employeeId = employee.id as string;
  const { data: settlements = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['settlements', employeeId],
    queryFn: () => settlementsApi.list(employeeId),
  });
  const current = settlements.find(s => s.status === 'validated');
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const ready = !!(form?.exitDate && form?.reason);
  const payload = form ? {
    exitDate: form.exitDate, reason: form.reason, noticeWorked: !!form.noticeWorked,
    damagesMonths: form.damagesMonths ? parseFloat(form.damagesMonths) : 0, notes: form.notes || null,
    paymentMethod: form.paymentMethod || undefined,
  } : null;
  const { data: preview, isFetching, error } = useQuery<Record<string, any>>({
    queryKey: ['settlement-preview', employeeId, payload],
    queryFn: () => settlementsApi.preview(employeeId, payload!),
    enabled: ready,
    retry: false,
  });
  const refresh = () => ['settlements', 'employees', 'employee-contracts', 'payroll', 'hr-alerts'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const validate = useMutation({
    mutationFn: () => settlementsApi.validate(employeeId, payload!),
    onSuccess: () => { refresh(); setForm(null); notify.success('Solde de tout compte validé : contrat clôturé, salarié sorti des effectifs'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => settlementsApi.cancel(id),
    onSuccess: () => { refresh(); notify.success('Solde de tout compte annulé : salarié réintégré'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const pdf = async (kind: 'receipt' | 'certificate', id: string) => {
    try { saveBlobResponse(await settlementsApi[kind](id), `${kind}.pdf`); }
    catch (err) { notify.error(apiErrorMessage(err, 'PDF indisponible')); }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-gray-400 uppercase tracking-wider">Départ</p>
        {!current && !form && employee.is_active && (
          <button className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0.2rem 0.5rem', fontSize: '0.6875rem', color: '#b85d1a' }}
            onClick={() => setForm({ exitDate: new Date().toISOString().slice(0, 10), reason: 'demission', noticeWorked: true })}>
            <LogOut size={11} /> Départ du salarié
          </button>
        )}
      </div>

      {current && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <strong>{REASONS[current.reason] ?? current.reason}</strong> — sortie le {frd(current.exit_date)}
            {current.payroll_id && <> · porté sur le bulletin {String(current.month).padStart(2, '0')}/{current.year} {current.payroll_paid ? '(payé)' : '(à payer depuis la Paie)'}</>}
          </div>
          <div className="text-xs text-gray-600">
            Congés {fmt(parseFloat(current.leave_indemnity))} · Préavis {fmt(parseFloat(current.notice_indemnity))} ·
            Licenciement {fmt(parseFloat(current.severance_indemnity))} · Dommages {fmt(parseFloat(current.damages))} · Retenues {fmt(parseFloat(current.deductions))} DH
          </div>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <button className="odoo-btn-secondary" style={btn} onClick={() => pdf('receipt', current.id)}><FileText size={11} /> Reçu pour solde de tout compte</button>
            <button className="odoo-btn-secondary" style={btn} onClick={() => pdf('certificate', current.id)}><Award size={11} /> Certificat de travail</button>
            {isAdmin && !current.payroll_paid && (
              <button className="odoo-btn-secondary" style={{ ...btn, color: '#dc3545' }} disabled={cancel.isPending}
                onClick={() => { if (confirm('Annuler ce solde de tout compte ? Le contrat est rouvert et le salarié réintégré.')) cancel.mutate(current.id); }}>
                <RotateCcw size={11} /> Annuler
              </button>
            )}
          </div>
        </div>
      )}

      {form && (
        <div className="bg-gray-50 rounded-xl p-3" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs" style={col}>Date de sortie
              <input className="input" type="date" value={form.exitDate} onChange={e => setForm({ ...form, exitDate: e.target.value })} /></label>
            <label className="text-xs" style={col}>Motif
              <select className="input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label className="text-xs flex items-center gap-2 mt-4">
              <input type="checkbox" checked={!!form.noticeWorked} onChange={e => setForm({ ...form, noticeWorked: e.target.checked })} /> Préavis effectué
            </label>
            {form.reason === 'licenciement' && (
              <label className="text-xs" style={col}>Dommages-intérêts (mois, sur décision)
                <input className="input" type="number" min="0" step="0.5" value={form.damagesMonths ?? ''} onChange={e => setForm({ ...form, damagesMonths: e.target.value })} /></label>
            )}
            {(employee.pay_frequency ?? 'monthly') !== 'monthly' && (
              <label className="text-xs" style={col}>Paiement du solde
                <select className="input" value={form.paymentMethod ?? 'cash'} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                  <option value="cash">Espèces</option><option value="bank">Virement</option><option value="check">Chèque</option>
                </select></label>
            )}
            <label className="text-xs col-span-3" style={col}>Notes
              <input className="input" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          </div>

          {error ? <p className="text-sm text-red-600">{apiErrorMessage(error, 'Calcul impossible')}</p>
            : !preview || isFetching ? <p className="text-sm text-gray-400">Calcul...</p> : (
            <>
              <p className="text-xs text-gray-600">
                Ancienneté {preview.seniorityLabel} · salaire de référence {fmt(preview.referenceSalary)} DH
                {preview.referenceMonths < 3 && ' (salaire de base : moins de 3 bulletins)'} · préavis légal {preview.notice.label}
                {preview.notice.owedByEmployee && ' — dû par le salarié'} · indemnité de licenciement : {preview.severance.reason}
              </p>
              <table className="odoo-table">
                <thead><tr><th>Élément</th><th>Calcul</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                <tbody>
                  {preview.lines.map((l: Record<string, any>) => (
                    <tr key={l.code}>
                      <td>{l.label}</td><td className="text-xs text-gray-500">{l.detail}</td>
                      <td style={{ textAlign: 'right', color: l.kind === 'retenue' ? '#dc3545' : undefined }}>{l.kind === 'retenue' ? '− ' : ''}{fmt(l.amount)}</td>
                    </tr>
                  ))}
                  {!preview.lines.length && <tr><td colSpan={3} className="text-gray-400">Aucune indemnité due.</td></tr>}
                </tbody>
              </table>
              <p className="text-xs text-gray-500">
                {preview.payFrequency === 'monthly'
                  ? 'Ces montants seront ajoutés au bulletin du mois de sortie (salaire au prorata, CNSS et IR sur les indemnités de congés et de préavis ; indemnité de licenciement exonérée dans la limite légale). Le paiement se fait depuis la Paie.'
                  : 'Salarié payé à la semaine ou à la quinzaine : le net est payé directement à la validation.'}
              </p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button className="odoo-btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            {isAdmin ? (
              <button className="odoo-btn-primary" disabled={!preview || validate.isPending}
                onClick={() => { if (confirm(`Valider le départ de ${employee.first_name} ${employee.last_name} au ${frd(form.exitDate)} ?\n\nLe contrat sera clôturé et le salarié sorti des effectifs.`)) validate.mutate(); }}>
                Valider le solde de tout compte
              </button>
            ) : <span className="text-xs text-gray-500">Validation réservée à un administrateur.</span>}
          </div>
        </div>
      )}

      {!current && !form && settlements.length === 0 && <p className="text-sm text-gray-400">Aucun départ enregistré.</p>}
    </div>
  );
}

const btn = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0.2rem 0.5rem', fontSize: '0.6875rem' } as const;
const col = { display: 'flex', flexDirection: 'column', gap: 2 } as const;
