import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronRight as Caret, GanttChartSquare, Loader2 } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { projectsApi, type Project, type Task } from '../../api/projects.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { projectHealth } from './shared';

/**
 * Planning des projets (refonte 2026-11) : un Gantt des projets ouverts, de leur
 * début à leur échéance, avancement en remplissage ; les tâches datées se déplient
 * sous leur projet. Lecture seule : les dates se changent dans la fiche.
 */
type Scale = 'two' | 'six' | 'quarter';
const SCALES: Record<Scale, { label: string; days: number; col: number }> = {
  two: { label: '2 semaines', days: 14, col: 1 },
  six: { label: '6 semaines', days: 42, col: 7 },
  quarter: { label: 'Trimestre', days: 91, col: 7 },
};
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`);

export default function ProjectsPlanning() {
  const navigate = useNavigate();
  const [scale, setScale] = useState<Scale>('six');
  const [shift, setShift] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { data, isLoading } = useQuery({ queryKey: ['projects', { pageSize: '100' }], queryFn: () => projectsApi.list({ pageSize: '100' }) });
  const { data: tasks = [] } = useQuery({ queryKey: ['project-tasks', 'open', 'planning'], queryFn: () => projectsApi.openTasks({ limit: '200' }) });

  const { days, col } = SCALES[scale];
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const start = addDays(startOfWeek(today, { weekStartsOn: 1 }), (scale === 'two' ? 0 : -7) + shift * Math.round(days / 2));
  const end = addDays(start, days);
  const pos = (d: Date) => (differenceInCalendarDays(d, start) / days) * 100;
  const columns = Array.from({ length: days / col }, (_, i) => addDays(start, i * col));
  const todayPct = pos(today);

  const projects = (data?.rows ?? []).filter(p => ['draft', 'active', 'on_hold'].includes(p.status));
  const tasksBy = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) if (t.due_date) m.set(t.project_id, [...(m.get(t.project_id) ?? []), t]);
    return m;
  }, [tasks]);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /** Barre bornée à la fenêtre ; null si la période est entièrement hors fenêtre. */
  const span = (from: Date, to: Date) => {
    if (to < start || from >= end) return null;
    const l = Math.max(pos(from), 0), r = Math.min(pos(addDays(to, 1)), 100);
    return { left: `${l}%`, width: `${Math.max(r - l, 1.2)}%` };
  };
  const projectSpan = (p: Project) => {
    const from = day(p.start_date ?? p.created_at);
    const to = p.due_date ? day(p.due_date) : addDays(from, 7);
    return span(from, to < from ? from : to);
  };

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" /></div>;

  return (
    <div className="prj">
      <div className="prj-toolbar">
        <strong style={{ flex: 1, minWidth: 200, fontSize: '0.9375rem' }}>
          {format(start, 'd MMM', { locale: fr })} → {format(addDays(end, -1), 'd MMM yyyy', { locale: fr })}
        </strong>
        <div className="prj-views" role="group" aria-label="Échelle">
          {(Object.keys(SCALES) as Scale[]).map(k => (
            <button key={k} type="button" className={scale === k ? 'active' : ''} aria-pressed={scale === k} onClick={() => { setScale(k); setShift(0); }}>{SCALES[k].label}</button>
          ))}
        </div>
        <div className="prj-views" role="group" aria-label="Période">
          <button type="button" aria-label="Période précédente" onClick={() => setShift(s => s - 1)}><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => setShift(0)}>Aujourd’hui</button>
          <button type="button" aria-label="Période suivante" onClick={() => setShift(s => s + 1)}><ChevronRight size={15} /></button>
        </div>
      </div>

      {!projects.length ? (
        <StatusBanner tone="info" icon={GanttChartSquare} title="Aucun projet ouvert">Les projets en brouillon, en cours ou en pause s’affichent ici.</StatusBanner>
      ) : (
        <section className="prj-panel prj-gantt" aria-label="Planning des projets">
          <div className="prj-gantt-inner">
            <div className="prj-gantt-row head">
              <div className="prj-gantt-label" style={{ cursor: 'default', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--odoo-text-muted)' }}>Projet / tâche</div>
              <div className="prj-gantt-cols" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                {columns.map(c => (
                  <div key={c.toISOString()}>{col === 1 ? format(c, 'EEE d', { locale: fr }) : `${format(c, 'd MMM', { locale: fr })}`}</div>
                ))}
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              {todayPct >= 0 && todayPct <= 100 && (
                <div aria-hidden="true" className="prj-gantt-today" style={{ left: `calc(300px + (100% - 300px) * ${todayPct / 100})` }} />
              )}
              {projects.map(p => {
                const bar = projectSpan(p);
                const pct = p.task_count ? Math.round((p.task_done / p.task_count) * 100) : 0;
                const health = projectHealth(p);
                const sub = tasksBy.get(p.id) ?? [];
                const expanded = open.has(p.id);
                const grid = { backgroundImage: 'linear-gradient(to right, var(--odoo-border) 1px, transparent 1px)', backgroundSize: `calc(100% / ${columns.length}) 100%` };
                return (
                  <div key={p.id}>
                    <div className="prj-gantt-row">
                      <button type="button" className="prj-gantt-label" aria-expanded={sub.length ? expanded : undefined}
                        onClick={() => (sub.length ? toggle(p.id) : navigate(`/projects/${p.id}`))} title={sub.length ? 'Afficher les tâches' : 'Ouvrir le projet'}>
                        {sub.length ? (expanded ? <ChevronDown size={14} /> : <Caret size={14} />) : <span style={{ width: 14 }} />}
                        <span className={`prj-dot ${health.tone}`} />
                        <span className="txt">{p.number.replace(/^PRJ-\d{4}-/, 'PRJ-')} · {p.name}</span>
                      </button>
                      <div className="prj-gantt-track" style={grid}>
                        {bar && (
                          <button type="button" className={`prj-gantt-bar${p.is_overdue ? ' late' : ''}`} style={bar}
                            onClick={() => navigate(`/projects/${p.id}`)} title={`${p.name} — ${health.label}`}>
                            <i style={{ width: `${pct}%` }} />
                            <span>{p.status === 'draft' ? 'brouillon' : p.status === 'on_hold' ? 'en pause' : `${pct} %`}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {expanded && sub.map(t => {
                      const due = day(t.due_date!);
                      const from = t.start_date ? day(t.start_date) : null;
                      const tb = from && from < due ? span(from, due) : null;
                      const ms = !tb && due >= start && due < end ? pos(due) + 100 / days / 2 : null;
                      return (
                        <div key={t.id} className="prj-gantt-row">
                          <div className="prj-gantt-label task"><span className="txt">{t.title}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span></div>
                          <div className="prj-gantt-track" style={grid}>
                            {tb && <span className={`prj-gantt-bar task${t.is_overdue ? ' late' : ''}`} style={tb} title={t.title}><i style={{ width: `${Number(t.estimated_hours) > 0 ? Math.min(Number(t.hours_spent) / Number(t.estimated_hours) * 100, 100) : 0}%` }} /></span>}
                            {ms !== null && <span className="prj-gantt-milestone" style={{ left: `calc(${ms}% - 6px)` }} title={`${t.title} — ${format(due, 'd MMM', { locale: fr })}`} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="prj-gantt-legend">
        <span><span className="prj-swatch" style={{ background: 'var(--odoo-purple)' }} />Avancement</span>
        <span><span className="prj-swatch" style={{ background: 'color-mix(in srgb, var(--odoo-purple) 18%, transparent)' }} />Reste à faire</span>
        <span><span className="prj-swatch" style={{ background: 'var(--prj-orange)' }} />En retard</span>
        <span><span className="prj-swatch" style={{ background: 'var(--theme-text, #1D2433)', transform: 'rotate(45deg)' }} />Échéance d’une tâche</span>
      </div>
    </div>
  );
}
