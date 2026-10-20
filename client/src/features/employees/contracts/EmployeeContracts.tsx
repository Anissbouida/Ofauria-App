import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, RefreshCw, Hourglass, CircleStop, Plus, FileSignature } from 'lucide-react';
import { contractsApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage, isoDate } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { SectionTitle, SubmitButton, fieldLabel, inputCls, panel, smallBtn } from '../ui';

const fr = (d: unknown) => { const s = isoDate(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const KIND: Record<string, string> = { contrat: 'Contrat', avenant: 'Avenant', renouvellement: 'Renouvellement' };
const CATEGORY: Record<string, string> = { cadre: 'Cadre', employe: 'Employé', ouvrier: 'Ouvrier' };
const STATUS: Record<string, [string, string]> = {
  active: ['En vigueur', 'odoo-tag-green'], superseded: ['Remplacé', 'odoo-tag-grey'], ended: ['Terminé', 'odoo-tag-red'],
};
type Action = 'create' | 'avenant' | 'renew' | 'end' | null;

/**
 * Historique des contrats d'un salarié et actions : contrat initial, avenant
 * (salaire, poste, horaires, type), renouvellement d'un contrat à terme,
 * renouvellement de la période d'essai (une fois), clôture.
 */
export default function EmployeeContracts({ employeeId, onChanged }: { employeeId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { entries: contractTypes, getLabel: typeLabel } = useReferentiel('contract_types');
  const { data: contracts = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['employee-contracts', employeeId],
    queryFn: () => contractsApi.list(employeeId),
  });
  const active = contracts.find(c => c.status === 'active');
  const [action, setAction] = useState<Action>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const today = new Date().toISOString().slice(0, 10);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['employee-contracts', employeeId] });
    queryClient.invalidateQueries({ queryKey: ['employees'] });
    queryClient.invalidateQueries({ queryKey: ['hr-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['employee-salary-history', employeeId] });
    onChanged();
  };
  const run = useMutation({
    mutationFn: async (): Promise<string[] | void> => {
      const num = (v: unknown) => (v === '' || v === undefined ? undefined : parseFloat(String(v)));
      if (action === 'create') {
        await contractsApi.create(employeeId, {
          contractType: form.contractType, category: form.category, jobTitle: form.jobTitle || null,
          startDate: form.startDate, endDate: form.endDate || null, withTrial: !!form.withTrial,
          monthlySalary: num(form.monthlySalary) ?? null, weeklyHours: num(form.weeklyHours),
        });
      } else if (action === 'avenant') {
        await contractsApi.avenant(employeeId, {
          effectiveDate: form.effectiveDate, contractType: form.contractType, category: form.category,
          jobTitle: form.jobTitle || null, monthlySalary: num(form.monthlySalary) ?? null,
          weeklyHours: num(form.weeklyHours), endDate: form.contractType === 'cdi' ? null : (form.endDate || null),
          notes: form.notes || null,
        });
      } else if (action === 'renew') {
        const r = await contractsApi.renew(employeeId, { endDate: form.endDate, notes: form.notes || null });
        return r.warnings;
      } else if (action === 'end') {
        await contractsApi.end(employeeId, { endDate: form.endDate, reason: form.reason });
      }
    },
    onSuccess: (warnings) => {
      refresh(); setAction(null);
      notify.success('Contrat mis à jour');
      if (warnings && warnings.length) notify.warning(warnings.join(' '));
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const renewTrial = useMutation({
    mutationFn: () => contractsApi.renewTrial(employeeId),
    onSuccess: () => { refresh(); notify.success('Période d\'essai renouvelée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  const open = (a: Action) => {
    setAction(a);
    setForm(a === 'create'
      ? { contractType: 'cdi', category: 'employe', startDate: today, withTrial: true }
      : a === 'avenant'
        ? { effectiveDate: today, contractType: active?.contract_type, category: active?.category, jobTitle: active?.job_title ?? '',
            monthlySalary: active?.monthly_salary ?? '', weeklyHours: active?.weekly_hours ?? 44, endDate: isoDate(active?.end_date) }
        : a === 'renew' ? { endDate: '' } : { endDate: today, reason: '' });
  };
  const field = (key: string, label: string, type = 'text', extra: Record<string, any> = {}) => (
    <div>
      <label style={fieldLabel}>{label}</label>
      <input className={inputCls} type={type} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </div>
  );
  const trialLeft = active?.trial_end_date ? Math.round((Date.parse(isoDate(active.trial_end_date)) - Date.parse(today)) / 86400000) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionTitle icon={FileSignature} actions={<>
        {!active && <button type="button" className="odoo-btn-secondary" style={smallBtn} onClick={() => open('create')}><Plus size={11} /> Contrat</button>}
        {active && <button type="button" className="odoo-btn-secondary" style={smallBtn} onClick={() => open('avenant')}><FilePlus2 size={11} /> Avenant</button>}
        {active && active.contract_type !== 'cdi' && active.end_date && (
          <button type="button" className="odoo-btn-secondary" style={smallBtn} onClick={() => open('renew')}><RefreshCw size={11} /> Renouveler</button>
        )}
        {active && trialLeft !== null && trialLeft >= 0 && !active.trial_renewed && (
          <button type="button" className="odoo-btn-secondary" style={smallBtn} disabled={renewTrial.isPending}
            onClick={async () => {
              if (!(await confirm('Renouveler la période d\'essai (une seule fois, pour la même durée) ?', { title: 'Renouveler l\'essai', confirmLabel: 'Renouveler' }))) return;
              renewTrial.mutate();
            }}>
            <Hourglass size={11} /> Renouveler l'essai
          </button>
        )}
        {active && <button type="button" className="odoo-btn-danger" style={smallBtn} onClick={() => open('end')}><CircleStop size={11} /> Clôturer</button>}
      </>}>Contrats et avenants</SectionTitle>

      {action && (
        <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
            {action === 'create' ? 'Nouveau contrat' : action === 'avenant' ? 'Avenant au contrat' : action === 'renew' ? 'Renouvellement' : 'Clôture du contrat'}
          </div>
          {(action === 'create' || action === 'avenant') && (
            <div className="grid grid-cols-3 gap-3">
              {action === 'create' ? field('startDate', 'Début', 'date') : field('effectiveDate', 'Prise d\'effet', 'date')}
              <div><label style={fieldLabel}>Type</label>
                <select className={inputCls} value={form.contractType} onChange={e => setForm({ ...form, contractType: e.target.value })}>
                  {contractTypes.map(ct => <option key={ct.code} value={ct.code}>{ct.label}</option>)}
                </select>
              </div>
              <div><label style={fieldLabel}>Catégorie</label>
                <select className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {form.contractType !== 'cdi' && field('endDate', 'Fin du contrat *', 'date')}
              {field('jobTitle', 'Poste')}
              {field('monthlySalary', 'Salaire mensuel (DH)', 'number', { step: '0.01' })}
              {field('weeklyHours', 'Heures / semaine', 'number', { step: '0.5' })}
              {action === 'create' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', marginTop: 20 }}>
                  <input type="checkbox" checked={!!form.withTrial} onChange={e => setForm({ ...form, withTrial: e.target.checked })} />
                  Période d'essai légale
                </label>
              )}
            </div>
          )}
          {action === 'renew' && (
            <div className="grid grid-cols-2 gap-3">{field('endDate', `Nouvelle fin (actuelle : ${fr(active?.end_date)})`, 'date')}{field('notes', 'Motif')}</div>
          )}
          {action === 'end' && (
            <div className="grid grid-cols-2 gap-3">{field('endDate', 'Date de fin', 'date')}{field('reason', 'Motif (fin de CDD, démission…) *')}</div>
          )}
          {action === 'avenant' && field('notes', 'Objet de l\'avenant')}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setAction(null)}>Annuler</button>
            <SubmitButton pending={run.isPending} danger={action === 'end'} onClick={() => run.mutate()}>Enregistrer</SubmitButton>
          </div>
          {action === 'end' && <p style={hint}>Le solde de tout compte se calcule à part ; pensez à désactiver l'employé une fois parti.</p>}
        </div>
      )}

      {contracts.length === 0 ? <p style={muted}>Aucun contrat enregistré.</p> : (
        <table className="odoo-table">
          <thead><tr><th>Pièce</th><th>Type</th><th>Période</th><th style={{ textAlign: 'right' }}>Salaire</th><th>Essai</th><th>Statut</th></tr></thead>
          <tbody>
            {contracts.map(c => (
              <tr key={c.id} title={c.notes ?? c.end_reason ?? undefined}>
                <td>{KIND[c.kind] ?? c.kind}{c.job_title ? <span style={sub}> · {c.job_title}</span> : null}</td>
                <td>{typeLabel(c.contract_type)} <span style={sub}>{CATEGORY[c.category]}</span></td>
                <td style={{ fontSize: '0.75rem' }}>{fr(c.start_date)} → {c.end_date ? fr(c.end_date) : 'indéterminée'}</td>
                <td style={{ textAlign: 'right' }}>{c.monthly_salary ? `${parseFloat(c.monthly_salary).toFixed(2)}` : '—'}</td>
                <td style={{ fontSize: '0.75rem' }}>{c.trial_end_date ? `${fr(c.trial_end_date)}${c.trial_renewed ? ' (renouvelé)' : ''}` : '—'}</td>
                <td><span className={`odoo-tag ${STATUS[c.status]?.[1] ?? ''}`}>{STATUS[c.status]?.[0] ?? c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const muted = { fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 } as const;
const hint = { fontSize: '0.75rem', color: 'var(--odoo-text-muted)', margin: 0 } as const;
const sub = { fontSize: '0.75rem', color: 'var(--odoo-text-muted)' } as const;
