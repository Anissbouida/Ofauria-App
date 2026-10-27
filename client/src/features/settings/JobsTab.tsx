import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Timer, Loader2, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { automationApi, type ScheduledJob } from '../../api/automation.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Paramètres › Tâches planifiées (mig 364) : ce que l'application fait seule, à quelle
 * fréquence, et comment s'est passé le dernier passage. Le code des tâches est dans le
 * serveur ; ici on active, on règle la fréquence et on lance à la main.
 */
const FREQS: [number, string][] = [[1, 'Chaque minute'], [5, 'Toutes les 5 min'], [15, 'Toutes les 15 min'], [30, 'Toutes les 30 min'],
  [60, 'Toutes les heures'], [180, 'Toutes les 3 h'], [360, 'Toutes les 6 h'], [720, 'Toutes les 12 h'], [1440, 'Une fois par jour'], [10080, 'Une fois par semaine']];
const DOMAINS: Record<string, string> = { system: 'Système', sav: 'SAV', projects: 'Projets', maintenance: 'Maintenance', purchasing: 'Achats' };
const TRIGGERS: Record<string, string> = { auto: 'automatique', manual: 'à la main', external: 'déclencheur externe' };
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const freqLabel = (m: number) => FREQS.find(f => f[0] === m)?.[1] ?? `Toutes les ${m} min`;

export default function JobsTab() {
  const qc = useQueryClient();
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  const { data, isLoading } = useQuery({ queryKey: ['automation-jobs'], queryFn: automationApi.jobs, refetchInterval: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['automation-jobs'] });

  const update = useMutation({
    mutationFn: ({ key, data }: { key: string; data: { enabled?: boolean; intervalMinutes?: number } }) => automationApi.updateJob(key, data),
    onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (key: string) => automationApi.runJob(key),
    onSuccess: r => { refresh(); (r.status === 'ok' ? notify.success : notify.error)(r.message || 'Terminé'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;
  const { jobs, engine } = data;
  const errors = jobs.filter(j => j.enabled && j.last_status === 'error').length;

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <StatusBanner tone={errors ? 'danger' : 'neutral'} icon={Timer} title={errors ? `${errors} tâche(s) en erreur au dernier passage` : 'Ce que l\'application fait seule'}>
        Les tâches tournent toutes les minutes tant que le serveur est actif (dernier passage interne : {dt(engine.lastInternalTick)})
        {engine.externalConfigured
          ? <>, et sont relancées par le déclencheur externe (dernier appel : {dt(engine.lastExternalTick)}).</>
          : <>. Si l'hébergeur met le serveur en veille (Cloud Run), il faut un déclencheur externe : variable CRON_SECRET et un appel planifié à /api/v1/cron/tick.</>}
      </StatusBanner>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th style={{ width: 60 }}>Active</th><th>Tâche</th><th>Fréquence</th><th>Dernier passage</th><th>Résultat</th><th>Prochain</th><th></th></tr></thead>
          <tbody>{jobs.map((j: ScheduledJob) => (
            <Fragment key={j.key}>
              <tr style={{ opacity: j.enabled ? 1 : 0.55 }}>
                <td><input type="checkbox" checked={j.enabled} disabled={!editable || update.isPending} aria-label={`Activer « ${j.label} »`}
                  onChange={e => update.mutate({ key: j.key, data: { enabled: e.target.checked } })} /></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{j.label} <span className="odoo-tag odoo-tag-grey" style={{ fontWeight: 400 }}>{DOMAINS[j.domain] ?? j.domain}</span></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{j.description}</div>
                </td>
                <td>
                  {editable ? (
                    <select value={j.interval_minutes} disabled={update.isPending} aria-label={`Fréquence de « ${j.label} »`}
                      onChange={e => update.mutate({ key: j.key, data: { intervalMinutes: Number(e.target.value) } })}
                      style={{ fontSize: '0.8125rem', padding: '2px 4px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }}>
                      {(FREQS.some(f => f[0] === j.interval_minutes) ? FREQS : [...FREQS, [j.interval_minutes, freqLabel(j.interval_minutes)] as [number, string]])
                        .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : freqLabel(j.interval_minutes)}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{dt(j.last_run_at)}{j.last_duration_ms != null && <div style={{ fontSize: '0.7rem', color: 'var(--odoo-text-muted)' }}>{j.last_duration_ms} ms</div>}</td>
                <td style={{ maxWidth: 320 }}>
                  {j.last_status && <span className={`odoo-tag ${j.last_status === 'ok' ? 'odoo-tag-green' : 'odoo-tag-red'}`}>{j.last_status === 'ok' ? 'OK' : 'Erreur'}</span>}{' '}
                  <span style={{ fontSize: '0.8125rem', color: j.last_status === 'error' ? '#c0392b' : 'var(--odoo-text-muted)' }}>{j.last_message ?? (j.last_run_at ? '' : 'Jamais lancée')}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--odoo-text-muted)' }}>{j.enabled ? dt(j.next_run_at) : '—'}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {editable && j.implemented && (
                    <button className="odoo-btn-secondary" style={{ padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={run.isPending}
                      onClick={() => run.mutate(j.key)}>
                      {run.isPending && run.variables === j.key ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Lancer
                    </button>
                  )}{' '}
                  <button className="odoo-pager-btn" aria-label="Historique" title="Historique des passages" onClick={() => setOpen(open === j.key ? null : j.key)}>
                    {open === j.key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </td>
              </tr>
              {open === j.key && (
                <tr><td colSpan={7} style={{ background: 'var(--odoo-bg-alt)' }}>
                  {j.runs.length === 0 ? <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Aucun passage.</span> : (
                    <table className="odoo-table" style={{ margin: 0 }}>
                      <thead><tr><th>Début</th><th>Déclenché</th><th>Statut</th><th style={{ textAlign: 'right' }}>Éléments</th><th>Message</th></tr></thead>
                      <tbody>{j.runs.map(r => (
                        <tr key={r.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{dt(r.started_at)}</td>
                          <td>{TRIGGERS[r.trigger]}</td>
                          <td><span className={`odoo-tag ${r.status === 'ok' ? 'odoo-tag-green' : r.status === 'error' ? 'odoo-tag-red' : 'odoo-tag-orange'}`}>{r.status === 'ok' ? 'OK' : r.status === 'error' ? 'Erreur' : 'En cours'}</span></td>
                          <td style={{ textAlign: 'right' }}>{r.items}</td>
                          <td style={{ fontSize: '0.8125rem' }}>{r.message}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
