import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Factory, Pause, Play, Loader2, Clock, Lock, User, Wrench } from 'lucide-react';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { routingsApi } from '../../api/routings.api';
import { employeesApi } from '../../api/employees.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';

// Étape en cours renvoyée par /atelier/live (mig 399).
interface LiveEtape {
  etape_id: string;
  nom: string;
  ordre: number;
  started_at: string | null;
  paused_at: string | null;
  pause_accumulee_min: number;
  duree_estimee_min: number | null;
  est_bloquante: boolean;
  work_center_id: string | null;
  work_center_name: string | null;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  started_by_name: string | null;
  plan_id: string;
  plan_date: string | null;
  product_name: string | null;
}

const NON_ASSIGNE = '__none__';

const inp: React.CSSProperties = { padding: '0.3rem 0.4rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit', fontSize: '0.78rem', width: '100%' };

// Minutes de travail effectif écoulées (temps depuis le démarrage − pauses).
function elapsedMinutes(e: LiveEtape, nowMs: number): number {
  if (!e.started_at) return 0;
  const started = new Date(e.started_at).getTime();
  const openPause = e.paused_at ? Math.max(0, Math.ceil((nowMs - new Date(e.paused_at).getTime()) / 60000)) : 0;
  return Math.max(0, Math.round((nowMs - started) / 60000) - (e.pause_accumulee_min || 0) - openPause);
}

export default function AtelierPage() {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  // Horloge locale : rafraîchit les durées affichées sans retaper le serveur.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const { data: etapes = [], isLoading } = useQuery<LiveEtape[]>({
    queryKey: ['atelier-live'],
    queryFn: () => productionEtapesApi.atelierLive(),
    refetchInterval: 15000,
  });
  const { data: centers = [] } = useQuery({ queryKey: ['work-centers'], queryFn: routingsApi.workCenters });
  const { data: employees = [] } = useQuery<Record<string, unknown>[]>({ queryKey: ['employees'], queryFn: employeesApi.list });
  const activeCenters = centers.filter(c => c.is_active);
  const empOptions = useMemo(
    () => employees.map(e => ({ id: String(e.id), label: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() })),
    [employees]
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['atelier-live'] });
  const assign = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { workCenterId?: string | null; assignedEmployeeId?: string | null } }) => productionEtapesApi.assign(id, patch),
    onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)),
  });
  const pause = useMutation({ mutationFn: (id: string) => productionEtapesApi.pause(id), onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)) });
  const resume = useMutation({ mutationFn: (id: string) => productionEtapesApi.resume(id), onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e)) });

  // Regroupement par poste (les non assignées d'abord, pour qu'on les affecte).
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; etapes: LiveEtape[] }>();
    for (const e of etapes) {
      const key = e.work_center_id ?? NON_ASSIGNE;
      const name = e.work_center_name ?? 'Non assigné';
      const g = map.get(key) ?? { id: key, name, etapes: [] };
      g.etapes.push(e);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.id === NON_ASSIGNE ? -1 : b.id === NON_ASSIGNE ? 1 : a.name.localeCompare(b.name));
  }, [etapes]);

  return (
    <div className="odoo-scope" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={Factory} title="Atelier — étapes en cours">
        Qui fait quoi, sur quel poste, en ce moment. Les étapes démarrées des plans en cours apparaissent ici,
        regroupées par poste. Affectez un poste et un opérateur, mettez en pause ou reprenez. La durée affichée
        exclut les pauses. Actualisation automatique.
      </StatusBanner>

      {isLoading && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
        </div>
      )}

      {!isLoading && etapes.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          Aucune étape en cours. Démarrez une étape depuis un plan de production en cours.
        </div>
      )}

      {!isLoading && groups.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
          {groups.map(g => (
            <div key={g.id} style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--odoo-bg)' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--odoo-border)', display: 'flex', alignItems: 'center', gap: 8, background: g.id === NON_ASSIGNE ? 'rgba(234,179,8,0.08)' : 'var(--theme-bg-subtle, rgba(127,127,127,0.06))' }}>
                <Wrench size={14} style={{ color: g.id === NON_ASSIGNE ? '#b45309' : 'var(--theme-accent)' }} />
                <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{g.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>{g.etapes.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
                {g.etapes.map(e => {
                  const paused = !!e.paused_at;
                  const mins = elapsedMinutes(e, now);
                  const over = e.duree_estimee_min != null && mins > e.duree_estimee_min;
                  return (
                    <div key={e.etape_id} style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 8, background: paused ? 'rgba(234,179,8,0.06)' : 'var(--theme-bg-card, transparent)' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{e.product_name || '—'}</span>
                        {e.est_bloquante && <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: '#dc2626', background: '#fef2f2', borderRadius: 3, padding: '1px 4px' }}><Lock size={8} style={{ display: 'inline' }} /> Bloquante</span>}
                        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--theme-text-muted)' }}>{e.plan_date ? new Date(e.plan_date).toLocaleDateString('fr-FR') : ''}</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>#{e.ordre} · {e.nom}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: '0.76rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums', color: over ? '#c62828' : paused ? '#b45309' : '#2e7d32', fontWeight: 600 }}>
                          <Clock size={11} /> {mins} min{e.duree_estimee_min != null ? ` / ${e.duree_estimee_min}` : ''}{paused ? ' (en pause)' : ''}
                        </span>
                        {(e.assigned_employee_name || e.started_by_name) && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--theme-text-muted)' }}>
                            <User size={11} /> {e.assigned_employee_name || e.started_by_name}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <select value={e.work_center_id ?? ''} title="Poste" style={inp}
                          onChange={ev => assign.mutate({ id: e.etape_id, patch: { workCenterId: ev.target.value || null } })}>
                          <option value="">— Poste —</option>
                          {activeCenters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select value={e.assigned_employee_id ?? ''} title="Opérateur" style={inp}
                          onChange={ev => assign.mutate({ id: e.etape_id, patch: { assignedEmployeeId: ev.target.value || null } })}>
                          <option value="">— Opérateur —</option>
                          {empOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        {paused ? (
                          <button className="odoo-btn-primary" style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }} disabled={resume.isPending} onClick={() => resume.mutate(e.etape_id)} title="Reprendre"><Play size={12} /></button>
                        ) : (
                          <button className="odoo-btn-secondary" style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap' }} disabled={pause.isPending} onClick={() => pause.mutate(e.etape_id)} title="Mettre en pause"><Pause size={12} /></button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
