import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, RefreshCw, Hourglass, CircleStop, Plus } from 'lucide-react';
import { contractsApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage, isoDate } from '../shared';

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
    <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label}
      <input className="input" type={type} value={form[key] ?? ''} onChange={e => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </label>
  );
  const trialLeft = active?.trial_end_date ? Math.round((Date.parse(isoDate(active.trial_end_date)) - Date.parse(today)) / 86400000) : null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-gray-400 uppercase tracking-wider">Contrats et avenants</p>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {!active && <button className="odoo-btn-secondary" style={btn} onClick={() => open('create')}><Plus size={11} /> Contrat</button>}
          {active && <button className="odoo-btn-secondary" style={btn} onClick={() => open('avenant')}><FilePlus2 size={11} /> Avenant</button>}
          {active && active.contract_type !== 'cdi' && active.end_date && (
            <button className="odoo-btn-secondary" style={btn} onClick={() => open('renew')}><RefreshCw size={11} /> Renouveler</button>
          )}
          {active && trialLeft !== null && trialLeft >= 0 && !active.trial_renewed && (
            <button className="odoo-btn-secondary" style={btn} disabled={renewTrial.isPending}
              onClick={() => { if (confirm('Renouveler la période d\'essai (une seule fois, pour la même durée) ?')) renewTrial.mutate(); }}>
              <Hourglass size={11} /> Renouveler l'essai
            </button>
          )}
          {active && <button className="odoo-btn-secondary" style={{ ...btn, color: '#dc3545' }} onClick={() => open('end')}><CircleStop size={11} /> Clôturer</button>}
        </div>
      </div>

      {action && (
        <div className="bg-gray-50 rounded-xl p-3 mb-2" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="text-sm font-semibold">
            {action === 'create' ? 'Nouveau contrat' : action === 'avenant' ? 'Avenant au contrat' : action === 'renew' ? 'Renouvellement' : 'Clôture du contrat'}
          </p>
          {(action === 'create' || action === 'avenant') && (
            <div className="grid grid-cols-3 gap-2">
              {action === 'create' ? field('startDate', 'Début', 'date') : field('effectiveDate', 'Prise d\'effet', 'date')}
              <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Type
                <select className="input" value={form.contractType} onChange={e => setForm({ ...form, contractType: e.target.value })}>
                  {contractTypes.map(ct => <option key={ct.code} value={ct.code}>{ct.label}</option>)}
                </select>
              </label>
              <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Catégorie
                <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {form.contractType !== 'cdi' && field('endDate', 'Fin du contrat *', 'date')}
              {field('jobTitle', 'Poste')}
              {field('monthlySalary', 'Salaire mensuel (DH)', 'number', { step: '0.01' })}
              {field('weeklyHours', 'Heures / semaine', 'number', { step: '0.5' })}
              {action === 'create' && (
                <label className="text-xs flex items-center gap-2 mt-4">
                  <input type="checkbox" checked={!!form.withTrial} onChange={e => setForm({ ...form, withTrial: e.target.checked })} />
                  Période d'essai légale
                </label>
              )}
            </div>
          )}
          {action === 'renew' && (
            <div className="grid grid-cols-2 gap-2">{field('endDate', `Nouvelle fin (actuelle : ${fr(active?.end_date)})`, 'date')}{field('notes', 'Motif')}</div>
          )}
          {action === 'end' && (
            <div className="grid grid-cols-2 gap-2">{field('endDate', 'Date de fin', 'date')}{field('reason', 'Motif (fin de CDD, démission…) *')}</div>
          )}
          {action === 'avenant' && field('notes', 'Objet de l\'avenant')}
          <div className="flex justify-end gap-2">
            <button className="odoo-btn-secondary" onClick={() => setAction(null)}>Annuler</button>
            <button className="odoo-btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>Enregistrer</button>
          </div>
          {action === 'end' && <p className="text-xs text-gray-500">Le solde de tout compte se calcule à part ; pensez à désactiver l'employé une fois parti.</p>}
        </div>
      )}

      {contracts.length === 0 ? <p className="text-sm text-gray-400">Aucun contrat enregistré.</p> : (
        <table className="odoo-table">
          <thead><tr><th>Pièce</th><th>Type</th><th>Période</th><th style={{ textAlign: 'right' }}>Salaire</th><th>Essai</th><th>Statut</th></tr></thead>
          <tbody>
            {contracts.map(c => (
              <tr key={c.id} title={c.notes ?? c.end_reason ?? undefined}>
                <td>{KIND[c.kind] ?? c.kind}{c.job_title ? <span className="text-xs text-gray-500"> · {c.job_title}</span> : null}</td>
                <td>{typeLabel(c.contract_type)} <span className="text-xs text-gray-500">{CATEGORY[c.category]}</span></td>
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

const btn = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0.2rem 0.5rem', fontSize: '0.6875rem' } as const;
