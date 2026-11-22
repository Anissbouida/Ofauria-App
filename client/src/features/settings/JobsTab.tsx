import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Timer, Loader2, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { automationApi, type ScheduledJob } from '../../api/automation.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, LoadingState } from '../../components/ds';

/**
 * Paramètres › Tâches planifiées (mig 364) : ce que l'application fait seule, à quelle
 * fréquence, et comment s'est passé le dernier passage. Le code des tâches est dans le
 * serveur ; ici on active, on règle la fréquence et on lance à la main.
 */
const FREQS: [number, string][] = [[1, 'Chaque minute'], [5, 'Toutes les 5 min'], [15, 'Toutes les 15 min'], [30, 'Toutes les 30 min'],
  [60, 'Toutes les heures'], [180, 'Toutes les 3 h'], [360, 'Toutes les 6 h'], [720, 'Toutes les 12 h'], [1440, 'Une fois par jour'], [10080, 'Une fois par semaine']];
const DOMAINS: Record<string, string> = { system: 'Système', sav: 'SAV', projects: 'Projets', maintenance: 'Maintenance', purchasing: 'Achats', sales: 'Ventes', accounting: 'Comptabilité', stock: 'Stock', hr: 'Personnel' };
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

  if (isLoading || !data) return <LoadingState />;
  const { jobs, engine } = data;
  const errors = jobs.filter(j => j.enabled && j.last_status === 'error').length;

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <StatusBanner tone={errors ? 'danger' : 'neutral'} icon={Timer} title={errors ? `${errors} tâche(s) en erreur au dernier passage` : 'Ce que l\'application fait seule'}>
        Toutes les minutes · dernier passage {dt(engine.lastInternalTick)}
        {engine.externalConfigured
          ? <> · déclencheur externe {dt(engine.lastExternalTick)}</>
          : <span title="Si l'hébergeur met le serveur en veille (Cloud Run), il faut un déclencheur externe : variable CRON_SECRET et un appel planifié à /api/v1/cron/tick."> · sans déclencheur externe</span>}
      </StatusBanner>
      <DataPanel label="Tâches planifiées">
        <table className="odoo-table">
          <thead><tr><th style={{ width: 60 }}>Active</th><th>Tâche</th><th>Fréquence</th><th>Dernier passage</th><th>Résultat</th><th>Prochain</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{jobs.map((j: ScheduledJob) => (
            <Fragment key={j.key}>
              <tr style={{ opacity: j.enabled ? 1 : 0.55 }}>
                <td><input type="checkbox" checked={j.enabled} disabled={!editable || update.isPending} aria-label={`Activer « ${j.label} »`}
                  onChange={e => update.mutate({ key: j.key, data: { enabled: e.target.checked } })} /></td>
                <td>
                  <div className="ds-strong">{j.label} <span className="odoo-tag odoo-tag-grey" style={{ fontWeight: 400 }}>{DOMAINS[j.domain] ?? j.domain}</span></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--ds-muted)' }}>{j.description}</div>
                </td>
                <td>
                  {editable ? (
                    <select value={j.interval_minutes} disabled={update.isPending} aria-label={`Fréquence de « ${j.label} »`}
                      onChange={e => update.mutate({ key: j.key, data: { intervalMinutes: Number(e.target.value) } })}
                      className="ds-input sm" style={{ width: 'auto' }}>
                      {(FREQS.some(f => f[0] === j.interval_minutes) ? FREQS : [...FREQS, [j.interval_minutes, freqLabel(j.interval_minutes)] as [number, string]])
                        .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  ) : freqLabel(j.interval_minutes)}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{dt(j.last_run_at)}{j.last_duration_ms != null && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{j.last_duration_ms} ms</div>}</td>
                <td style={{ maxWidth: 320 }}>
                  {j.last_status && <StatusTag tone={j.last_status === 'ok' ? 'done' : 'blocked'} label={j.last_status === 'ok' ? 'OK' : 'Erreur'} />}{' '}
                  <span style={{ fontSize: '0.8125rem', color: j.last_status === 'error' ? 'var(--ds-danger)' : 'var(--ds-muted)' }}>{j.last_message ?? (j.last_run_at ? '' : 'Jamais lancée')}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--ds-muted)' }}>{j.enabled ? dt(j.next_run_at) : '—'}</td>
                <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                  {editable && j.implemented && (
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={run.isPending}
                      onClick={() => run.mutate(j.key)}>
                      {run.isPending && run.variables === j.key ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Lancer
                    </button>
                  )}{' '}
                  <button type="button" className="odoo-pager-btn" aria-label="Historique des passages" aria-expanded={open === j.key} title="Historique des passages" onClick={() => setOpen(open === j.key ? null : j.key)}>
                    {open === j.key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </td>
              </tr>
              {open === j.key && (
                <tr><td colSpan={7} style={{ background: 'var(--ds-bg)' }}>
                  {j.runs.length === 0 ? <span style={{ fontSize: '0.8125rem', color: 'var(--ds-muted)' }}>Aucun passage.</span> : (
                    <table className="odoo-table" style={{ margin: 0 }}>
                      <thead><tr><th>Début</th><th>Déclenché</th><th>Statut</th><th className="ds-num">Éléments</th><th>Message</th></tr></thead>
                      <tbody>{j.runs.map(r => (
                        <tr key={r.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{dt(r.started_at)}</td>
                          <td>{TRIGGERS[r.trigger]}</td>
                          <td><StatusTag tone={r.status === 'ok' ? 'done' : r.status === 'error' ? 'blocked' : 'progress'} label={r.status === 'ok' ? 'OK' : r.status === 'error' ? 'Erreur' : 'En cours'} /></td>
                          <td className="ds-num">{r.items}</td>
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
      </DataPanel>
    </div>
  );
}
