import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Factory, Pause, Play, Loader2, Clock, Lock, User, Wrench } from 'lucide-react';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { routingsApi } from '../../api/routings.api';
import { employeesApi } from '../../api/employees.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import SalesPageShell from '../sales/SalesPageShell';
import { ListEmpty } from '../sales/ListTemplate';

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
    <SalesPageShell icon={Factory} parent="Production" title="Atelier"
      summary={<>{!isLoading && <><b>{etapes.length}</b> étape(s) en cours · </>}Qui fait quoi, sur quel poste, en ce moment. Les étapes démarrées des plans en cours apparaissent ici,
        regroupées par poste. Affectez un poste et un opérateur, mettez en pause ou reprenez. La durée affichée
        exclut les pauses. Actualisation automatique.</>}>

      {isLoading && (
        <section className="prj-panel sal-empty"><Loader2 size={18} className="animate-spin" /><span>Chargement…</span></section>
      )}

      {!isLoading && etapes.length === 0 && (
        <ListEmpty icon={Factory} title="Aucune étape en cours." text="Démarrez une étape depuis un plan de production en cours." />
      )}

      {!isLoading && groups.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
          {groups.map(g => (
            <section key={g.id} className="prj-panel" style={{ overflow: 'hidden' }}>
              <div className="prj-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}>
                <span className={`kl-ic ${g.id === NON_ASSIGNE ? 'o' : 'b'}`} style={{ width: 28, height: 28 }}><Wrench size={14} /></span>
                <span>{g.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 500, color: 'var(--theme-text-muted)' }}>{g.etapes.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
                {g.etapes.map(e => {
                  const paused = !!e.paused_at;
                  const mins = elapsedMinutes(e, now);
                  const over = e.duree_estimee_min != null && mins > e.duree_estimee_min;
                  return (
                    <div key={e.etape_id} style={{ borderRadius: 12, padding: 10, background: paused ? 'color-mix(in srgb, var(--prj-orange) 7%, var(--kl-card))' : 'color-mix(in srgb, var(--kl-bg) 55%, var(--kl-card))' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{e.product_name || '—'}</span>
                        {e.est_bloquante && <StatusTag tone="blocked" icon={Lock} label="Bloquante" />}
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
                        <SearchSelect value={e.work_center_id != null ? String(e.work_center_id) : ''} ariaLabel="Poste" width={150}
                          onChange={id => assign.mutate({ id: e.etape_id, patch: { workCenterId: id || null } })}
                          placeholder="— Poste —" options={activeCenters.map(c => ({ id: String(c.id), label: c.name as string }))} />
                        <SearchSelect value={e.assigned_employee_id != null ? String(e.assigned_employee_id) : ''} ariaLabel="Opérateur" width={150}
                          onChange={id => assign.mutate({ id: e.etape_id, patch: { assignedEmployeeId: id || null } })}
                          placeholder="— Opérateur —" options={empOptions.map(o => ({ id: String(o.id), label: o.label as string }))} />
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
            </section>
          ))}
        </div>
      )}
    </SalesPageShell>
  );
}
