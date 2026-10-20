import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, FileText, Award, RotateCcw, AlertTriangle } from 'lucide-react';
import { settlementsApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage, saveBlobResponse } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { SectionTitle, SubmitButton, fieldLabel, inputCls, panel, smallBtn } from '../ui';

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
  const confirm = useConfirm();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionTitle icon={LogOut} actions={!current && !form && employee.is_active && (
        <button type="button" className="odoo-btn-secondary" style={{ ...smallBtn, color: '#b85d1a' }}
          onClick={() => setForm({ exitDate: new Date().toISOString().slice(0, 10), reason: 'demission', noticeWorked: true })}>
          <LogOut size={11} /> Départ du salarié
        </button>
      )}>Départ</SectionTitle>

      {current && (
        <StatusBanner tone="orange" icon={LogOut}
          title={`${REASONS[current.reason] ?? current.reason} — sortie le ${frd(current.exit_date)}`}
          actions={<>
            <button type="button" className="odoo-btn-secondary" style={smallBtn} onClick={() => pdf('receipt', current.id)}><FileText size={11} /> Reçu pour solde de tout compte</button>
            <button type="button" className="odoo-btn-secondary" style={smallBtn} onClick={() => pdf('certificate', current.id)}><Award size={11} /> Certificat de travail</button>
            {isAdmin && !current.payroll_paid && (
              <button type="button" className="odoo-btn-secondary" style={{ ...smallBtn, color: '#dc3545' }} disabled={cancel.isPending}
                onClick={async () => {
                  if (!(await confirm('Annuler ce solde de tout compte ? Le contrat est rouvert et le salarié réintégré.', { title: 'Annuler le solde de tout compte', confirmLabel: 'Annuler le solde', cancelLabel: 'Retour', danger: true }))) return;
                  cancel.mutate(current.id);
                }}>
                <RotateCcw size={11} /> Annuler
              </button>
            )}
          </>}>
          {current.payroll_id && <div>Porté sur le bulletin {String(current.month).padStart(2, '0')}/{current.year} {current.payroll_paid ? '(payé)' : '(à payer depuis la Paie)'}</div>}
          <div>
            Congés {fmt(parseFloat(current.leave_indemnity))} · Préavis {fmt(parseFloat(current.notice_indemnity))} ·
            Licenciement {fmt(parseFloat(current.severance_indemnity))} · Dommages {fmt(parseFloat(current.damages))} · Retenues {fmt(parseFloat(current.deductions))} DH
          </div>
        </StatusBanner>
      )}

      {form && (
        <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="grid grid-cols-3 gap-3">
            <div><label style={fieldLabel}>Date de sortie</label>
              <input className={inputCls} type="date" value={form.exitDate} onChange={e => setForm({ ...form, exitDate: e.target.value })} /></div>
            <div><label style={fieldLabel}>Motif</label>
              <select className={inputCls} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', marginTop: 20 }}>
              <input type="checkbox" checked={!!form.noticeWorked} onChange={e => setForm({ ...form, noticeWorked: e.target.checked })} /> Préavis effectué
            </label>
            {form.reason === 'licenciement' && (
              <div><label style={fieldLabel}>Dommages-intérêts (mois, sur décision)</label>
                <input className={inputCls} type="number" min="0" step="0.5" value={form.damagesMonths ?? ''} onChange={e => setForm({ ...form, damagesMonths: e.target.value })} /></div>
            )}
            {(employee.pay_frequency ?? 'monthly') !== 'monthly' && (
              <div><label style={fieldLabel}>Paiement du solde</label>
                <select className={inputCls} value={form.paymentMethod ?? 'cash'} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}>
                  <option value="cash">Espèces</option><option value="bank">Virement</option><option value="check">Chèque</option>
                </select></div>
            )}
            <div className="col-span-3"><label style={fieldLabel}>Notes</label>
              <input className={inputCls} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>

          {error ? (
            <StatusBanner tone="danger" icon={AlertTriangle} title="Calcul impossible">{apiErrorMessage(error, 'Calcul impossible')}</StatusBanner>
          ) : !preview || isFetching ? <p style={muted}>Calcul...</p> : (
            <>
              <p style={hint}>
                Ancienneté {preview.seniorityLabel} · salaire de référence {fmt(preview.referenceSalary)} DH
                {preview.referenceMonths < 3 && ' (salaire de base : moins de 3 bulletins)'} · préavis légal {preview.notice.label}
                {preview.notice.owedByEmployee && ' — dû par le salarié'} · indemnité de licenciement : {preview.severance.reason}
              </p>
              <table className="odoo-table">
                <thead><tr><th>Élément</th><th>Calcul</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                <tbody>
                  {preview.lines.map((l: Record<string, any>) => (
                    <tr key={l.code}>
                      <td>{l.label}</td><td style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{l.detail}</td>
                      <td style={{ textAlign: 'right', color: l.kind === 'retenue' ? '#dc3545' : undefined }}>{l.kind === 'retenue' ? '− ' : ''}{fmt(l.amount)}</td>
                    </tr>
                  ))}
                  {!preview.lines.length && <tr><td colSpan={3} style={{ color: 'var(--odoo-text-muted)' }}>Aucune indemnité due.</td></tr>}
                </tbody>
              </table>
              <p style={hint}>
                {preview.payFrequency === 'monthly'
                  ? 'Ces montants seront ajoutés au bulletin du mois de sortie (salaire au prorata, CNSS et IR sur les indemnités de congés et de préavis ; indemnité de licenciement exonérée dans la limite légale). Le paiement se fait depuis la Paie.'
                  : 'Salarié payé à la semaine ou à la quinzaine : le net est payé directement à la validation.'}
              </p>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            {isAdmin ? (
              <SubmitButton disabled={!preview} pending={validate.isPending}
                onClick={async () => {
                  if (!(await confirm(`Valider le départ de ${employee.first_name} ${employee.last_name} au ${frd(form.exitDate)} ?\n\nLe contrat sera clôturé et le salarié sorti des effectifs.`, { title: 'Valider le départ', confirmLabel: 'Valider le départ', danger: true }))) return;
                  validate.mutate();
                }}>
                Valider le solde de tout compte
              </SubmitButton>
            ) : <span style={hint}>Validation réservée à un administrateur.</span>}
          </div>
        </div>
      )}

      {!current && !form && settlements.length === 0 && <p style={muted}>Aucun départ enregistré.</p>}
    </div>
  );
}

const muted = { fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 } as const;
const hint = { fontSize: '0.75rem', color: 'var(--odoo-text-muted)', margin: 0 } as const;
