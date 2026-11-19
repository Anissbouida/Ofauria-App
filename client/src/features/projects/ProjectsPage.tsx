import { money } from '../../utils/money';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, ListChecks, Timer, BarChart3, Database, Plus, Search, Loader2, CheckCircle2, AlertTriangle, Clock, Trash2, LayoutGrid, List, GanttChartSquare, Columns3, PauseCircle,
  ChevronRight, Receipt, Wallet,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  projectsApi, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS, type Project, type ProjectStatus, type TaskStatus,
} from '../../api/projects.api';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { ModuleShell, ModulePage, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import { PeriodFilter, Pager, periodParams, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import { useAuth } from '../../context/AuthContext';
import SearchSelect from '../../components/ui/SearchSelect';
import ProjectsPlanning from './ProjectsPlanning';
import {
  ProjectFormModal, TimeEntryForm, TaskBoard, Kpi, Meter, usePeopleOptions, n2, n0, h1, initials, projectHealth, consumption, usageTone, needsAttention, projectRevenue, projectCost,
} from './shared';

/**
 * Module Projets (mig 358), rubriques standard : tableau de bord, projets, tâches
 * ouvertes, temps passé ; rentabilité en rapport ; types d'activité en paramétrage.
 * Module générique : un projet est un événement, un chantier, une mission…
 */
type View = 'overview' | 'projects' | 'planning' | 'tasks' | 'time' | 'profitability' | 'activities';

export default function ProjectsPage() {
  const { hasModule } = usePermissions();
  const views: ModuleView<View>[] = [
    { key: 'overview', label: 'Tableau de bord', icon: LayoutDashboard, section: 'dashboard' },
    { key: 'projects', label: 'Projets', icon: FolderKanban, section: 'operations' },
    { key: 'planning', label: 'Planning', icon: GanttChartSquare, section: 'operations' },
    { key: 'tasks', label: 'Tâches ouvertes', icon: ListChecks, section: 'operations' },
    { key: 'time', label: 'Temps passé', icon: Timer, section: 'operations' },
    { key: 'profitability', label: 'Rentabilité', icon: BarChart3, section: 'reports' },
    { key: 'activities', label: "Types d'activité", icon: Database, section: 'setup', href: '/settings?page=referentiel', external: true, hidden: !hasModule('settings') },
  ];
  const { current, select } = useModuleView(views);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <ModuleShell title="Projets" views={views} current={current} onSelect={select} flush
      actions={(current?.key === 'projects' || current?.key === 'overview') ? (
        <button className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouveau projet</button>
      ) : undefined}>
      <ModulePage title={current?.label}>
        {current?.key === 'overview' && <Overview />}
        {current?.key === 'projects' && <ProjectList onPlanning={() => select('planning')} />}
        {current?.key === 'planning' && <ProjectsPlanning />}
        {current?.key === 'tasks' && <OpenTasks />}
        {current?.key === 'time' && <TimeSheet />}
        {current?.key === 'profitability' && <Profitability />}
      </ModulePage>
      {creating && <ProjectFormModal onClose={() => setCreating(false)} onSaved={p => navigate(`/projects/${p.id}`)} />}
    </ModuleShell>
  );
}

const STATUS_TONE: Record<ProjectStatus, StatusTone> = { draft: 'draft', active: 'progress', on_hold: 'blocked', completed: 'done', cancelled: 'cancelled' };
const ProjectStatusTag = ({ status }: { status: ProjectStatus }) => (
  <StatusTag tone={STATUS_TONE[status] ?? 'draft'} icon={status === 'on_hold' ? PauseCircle : undefined} label={PROJECT_STATUS_LABELS[status] ?? status} />
);

function Progress({ p }: { p: Project }) {
  const pct = p.task_count ? Math.round((p.task_done / p.task_count) * 100) : 0;
  return (
    <div title={`${p.task_done}/${p.task_count} tâches`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--odoo-border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct === 100 ? 'var(--prj-green)' : 'var(--theme-accent)' }} />
      </div>
      <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{pct}%</span>
    </div>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const navigate = useNavigate();
  const health = projectHealth(p);
  return (
    <tr onClick={() => navigate(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
      <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{p.number}</td>
      <td><strong>{p.name}</strong></td>
      <td>{p.customer_label || <span style={{ color: 'var(--theme-text-muted)' }}>interne</span>}</td>
      <td><ProjectStatusTag status={p.status} /></td>
      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span className={`prj-dot ${health.tone}`} />{health.label}</span></td>
      <td style={{ whiteSpace: 'nowrap' }}>{p.due_date ? format(new Date(p.due_date), 'dd/MM/yyyy') : '—'}</td>
      <td><Progress p={p} /></td>
      <td style={{ textAlign: 'right' }}>{h1(p.hours_spent)} h</td>
      <td style={{ textAlign: 'right' }}>{n2(projectCost(p))}</td>
      <td style={{ textAlign: 'right' }}>{projectRevenue(p) ? n2(projectRevenue(p)) : '—'}</td>
      <td>{p.manager_name || '—'}</td>
    </tr>
  );
}

/** Carte d'un projet : avancement, consommation, santé, échéance, responsable. */
function ProjectCard({ p }: { p: Project }) {
  const navigate = useNavigate();
  const pct = p.task_count ? (p.task_done / p.task_count) * 100 : 0;
  const use = consumption(p);
  const health = projectHealth(p);
  return (
    <button type="button" className="prj-card" onClick={() => navigate(`/projects/${p.id}`)}>
      <div className="prj-card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="prj-card-num">{p.number}</div>
          <div className="prj-card-name">{p.name}</div>
          <div className="prj-card-client">{p.customer_label || 'Interne'}{p.order_number ? ` · ${p.order_number}` : ''}</div>
        </div>
        <ProjectStatusTag status={p.status} />
      </div>
      <Meter label="Tâches" value={p.task_count ? `${p.task_done} / ${p.task_count}` : 'aucune'} pct={pct} />
      {use
        ? <Meter label={use.label} value={`${use.used} / ${use.of}`} pct={use.pct} tone={usageTone(use.pct)} />
        : <Meter label="Heures passées" value={`${h1(p.hours_spent)} h`} pct={0} />}
      <div className="prj-card-foot">
        <span className={`prj-dot ${health.tone}`} />
        <span className="prj-health-label">{health.label}</span>
        {p.due_date && <span className="prj-card-due">{format(new Date(p.due_date), 'd MMM', { locale: fr })}</span>}
        {p.manager_name && <span className="prj-avatar" title={p.manager_name}>{initials(p.manager_name)}</span>}
      </div>
    </button>
  );
}

type Chip = 'open' | 'attention' | 'mine' | 'completed' | 'all';
type Layout = 'cards' | 'list';
const LAYOUT_KEY = 'kalum.projects.layout';

function ProjectList({ onPlanning }: { onPlanning: () => void }) {
  const { user } = useAuth();
  const [chip, setChip] = useState<Chip>('open');
  const [layout, setLayoutState] = useState<Layout>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'cards'; } catch { return 'cards'; } });
  const setLayout = (l: Layout) => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* commodité seulement */ } };
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  const params: Record<string, string> = { pageSize: '100' };
  if (search) params.search = search;
  const { data, isLoading } = useQuery({ queryKey: ['projects', params], queryFn: () => projectsApi.list(params) });
  const month = periodParams('month', '', '');
  const { data: ov } = useQuery({ queryKey: ['projects', 'overview', month], queryFn: () => projectsApi.overview(month) });

  const all = data?.rows ?? [];
  const isOpen = (p: Project) => ['draft', 'active', 'on_hold'].includes(p.status);
  const tests: Record<Chip, (p: Project) => boolean> = {
    open: isOpen, attention: p => isOpen(p) && needsAttention(p), mine: p => !!user && p.manager_id === user.id && p.status !== 'cancelled',
    completed: p => p.status === 'completed', all: () => true,
  };
  const rows = all.filter(tests[chip]);
  const count = (c: Chip) => all.filter(tests[c]).length;
  const running = all.filter(p => p.status === 'active' || p.status === 'on_hold').length;
  const drafts = all.filter(p => p.status === 'draft').length;
  const attention = all.filter(tests.attention);
  const lateCount = attention.filter(p => p.is_overdue).length;
  const done = all.filter(p => p.status === 'completed' && projectRevenue(p) > 0);
  const doneRev = done.reduce((t, p) => t + projectRevenue(p), 0);
  const doneMargin = doneRev ? Math.round((doneRev - done.reduce((t, p) => t + projectCost(p), 0)) / doneRev * 100) : null;
  const CHIPS: Array<[Chip, string]> = [['open', 'Actifs'], ['attention', 'À surveiller'], ['mine', 'Mes projets'], ['completed', 'Terminés'], ['all', 'Tous']];

  return (
    <div className="prj">
      <section className="prj-kpis" aria-label="Indicateurs">
        <div className="prj-kpi"><div className="prj-kpi-head">En cours</div><div className="prj-kpi-value">{running}</div><div className="prj-kpi-sub">{drafts} brouillon{drafts > 1 ? 's' : ''} à lancer</div></div>
        <div className="prj-kpi"><div className="prj-kpi-head">À surveiller</div><div className="prj-kpi-value" style={{ color: attention.length ? 'var(--prj-red)' : undefined }}>{attention.length}</div>
          <div className="prj-kpi-sub">{attention.length ? `${lateCount} en retard · ${attention.length - lateCount} autre${attention.length - lateCount > 1 ? 's' : ''}` : 'rien à signaler'}</div></div>
        <div className="prj-kpi"><div className="prj-kpi-head">Heures ce mois</div><div className="prj-kpi-value">{ov ? `${h1(ov.time.hours)} h` : '…'}</div><div className="prj-kpi-sub">{ov ? `coût ${money(ov.time.cost, { decimals: 0 })}` : ''}</div></div>
        <div className="prj-kpi"><div className="prj-kpi-head">Marge des projets terminés</div>
          <div className="prj-kpi-value" style={{ color: doneMargin === null ? undefined : doneMargin < 0 ? 'var(--prj-red)' : 'var(--prj-green)' }}>{doneMargin === null ? '—' : `${doneMargin} %`}</div>
          <div className="prj-kpi-sub">{done.length} projet{done.length > 1 ? 's' : ''} facturé{done.length > 1 ? 's' : ''}</div></div>
      </section>

      <div className="prj-toolbar">
        <label className="prj-search">
          <Search size={15} aria-hidden="true" style={{ color: 'var(--theme-text-muted)' }} />
          <input type="search" aria-label="Rechercher un projet" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="N°, nom, client…" />
        </label>
        <div className="prj-chips" role="group" aria-label="Filtrer">
          {CHIPS.map(([k, l]) => (
            <button key={k} type="button" className={`prj-chip${chip === k ? ' active' : ''}`} aria-pressed={chip === k} onClick={() => setChip(k)}>
              {l} <small>{count(k)}</small>
            </button>
          ))}
        </div>
        <div className="prj-views" role="group" aria-label="Affichage">
          <button type="button" className={layout === 'cards' ? 'active' : ''} aria-pressed={layout === 'cards'} onClick={() => setLayout('cards')}><LayoutGrid size={14} /> Cartes</button>
          <button type="button" className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={14} /> Liste</button>
          <button type="button" onClick={onPlanning}><GanttChartSquare size={14} /> Planning</button>
        </div>
      </div>

      {isLoading ? <Loading /> : !rows.length ? (
        <StatusBanner tone="info" icon={FolderKanban} title={all.length ? 'Aucun projet dans ce filtre' : 'Aucun projet'}>
          {all.length ? 'Changez de filtre ou de recherche.' : 'Créez un projet : un événement, un chantier, une mission, une commande sur devis.'}
        </StatusBanner>
      ) : layout === 'cards' ? (
        <div className="prj-cards">{rows.map(p => <ProjectCard key={p.id} p={p} />)}</div>
      ) : (
        <section className="prj-panel prj-scroll">
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Projet</th><th>Client</th><th>Statut</th><th>Santé</th><th>Échéance</th><th>Avancement</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coûts</th><th style={{ textAlign: 'right' }}>Recette</th><th>Responsable</th></tr></thead>
            <tbody>{rows.map(p => <ProjectRow key={p.id} p={p} />)}</tbody>
          </table>
        </section>
      )}
      {data && data.total > all.length && <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{all.length} projets affichés sur {data.total} : affinez la recherche.</p>}
    </div>
  );
}

function Overview() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const range = periodParams(period, from, to);
  const { data, isLoading } = useQuery({ queryKey: ['projects', 'overview', range], queryFn: () => projectsApi.overview(range) });
  const { data: tasks = [] } = useQuery({ queryKey: ['project-tasks', 'open', 'overview'], queryFn: () => projectsApi.openTasks({ limit: '8' }) });
  if (isLoading || !data) return <Loading />;
  const margin = Number(data.time.amount) - Number(data.time.cost);
  const inProgress = data.projects.active + data.projects.on_hold;
  return (
    <div className="prj">
      <div className="prj-toolbar">
        <PeriodFilter label="Temps passé" title="Période des heures" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
      </div>
      <section className="kl-hero" aria-label="Indicateurs">
        <div className="kl-widget">
          <div className="kl-wlabel"><span className="kl-sq"><FolderKanban size={13} /></span>Projets en cours</div>
          <div className="kl-big">{inProgress}</div>
          <div className="kl-sub">{data.projects.draft} brouillon{data.projects.draft > 1 ? 's' : ''} à lancer · <span style={{ color: data.projects.overdue > 0 ? 'var(--prj-red)' : undefined }}>{data.projects.overdue} en retard</span></div>
        </div>
        <div className="kl-widget">
          <div className="kl-wlabel"><span className="kl-sq"><ListChecks size={13} /></span>Tâches ouvertes</div>
          <div className="kl-big">{data.tasks.open}</div>
          <div className="kl-sub" style={{ color: data.tasks.overdue > 0 ? 'var(--prj-red)' : undefined }}>{data.tasks.overdue} en retard</div>
        </div>
        <div className="kl-widget">
          <div className="kl-wlabel"><span className="kl-sq"><Timer size={13} /></span>Heures sur la période</div>
          <div className="kl-big">{h1(data.time.hours)}<small>h</small></div>
          <div className="kl-sub">coût {money(data.time.cost, { decimals: 0 })}</div>
        </div>
      </section>
      <section className="kl-stats" aria-label="Facturation du temps">
        <div className="kl-widget">
          <div className="kl-wlabel"><span className="kl-sq"><Receipt size={13} /></span>Facturable sur la période</div>
          <div className="kl-big" style={{ fontSize: 30 }}>{money(data.time.amount, { decimals: 0 })}</div>
          <div className="kl-sub" style={{ color: margin < 0 ? 'var(--prj-red)' : undefined }}>marge {money(margin, { decimals: 0 })}</div>
        </div>
        <div className="kl-widget">
          <div className="kl-wlabel"><span className="kl-sq"><Wallet size={13} /></span>Reste à facturer</div>
          <div className="kl-big" style={{ fontSize: 30 }}>{money(data.time.unbilled, { decimals: 0 })}</div>
          <div className="kl-sub">temps facturable non facturé</div>
        </div>
      </section>
      <div className="kl-two">
        <section className="a" aria-label="Projets en cours">
          <div>
            <div className="kl-sec"><h2>Projets en cours</h2><small>{data.active.length}</small></div>
            {data.active.length === 0
              ? <div className="kl-group kl-empty">Aucun projet en cours.</div>
              : <div className="prj-cards">{data.active.map(p => <ProjectCard key={p.id} p={p} />)}</div>}
          </div>
        </section>
        <section className="b" aria-label="Prochaines tâches">
          <div>
            <div className="kl-sec"><h2>Prochaines tâches</h2><small>{tasks.length ? 'retards d’abord' : ''}</small></div>
            {tasks.length === 0 ? <div className="kl-group kl-empty">Aucune tâche ouverte.</div> : (
              <div className="kl-group">
                {tasks.map(t => (
                  <button key={t.id} type="button" className="kl-cell ico" onClick={() => navigate(`/projects/${t.project_id}`)}>
                    <span className={`kl-ic ${t.is_overdue ? 'r' : 'x'}`}>{t.is_overdue ? <AlertTriangle size={16} /> : <Clock size={16} />}</span>
                    <span className="tx"><span className="t1">{t.title}</span>
                      <span className="t2">{t.project_name}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span></span>
                    {t.due_date && <span className={`tr${t.is_overdue ? ' red' : ''}`}>{format(new Date(t.due_date), 'd MMM', { locale: fr })}</span>}
                    <ChevronRight size={15} className="chev" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const TASKS_LAYOUT_KEY = 'kalum.projects.openTasksLayout';

function OpenTasks() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canEdit } = usePermissions();
  const [assignee, setAssignee] = useState('');
  const [layout, setLayoutState] = useState<'board' | 'list'>(() => { try { return localStorage.getItem(TASKS_LAYOUT_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; } });
  const setLayout = (l: 'board' | 'list') => { setLayoutState(l); try { localStorage.setItem(TASKS_LAYOUT_KEY, l); } catch { /* commodité seulement */ } };
  const { data: people = [] } = useQuery({ queryKey: ['project-people'], queryFn: projectsApi.people });
  const peopleOptions = usePeopleOptions(people);
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['project-tasks', 'open', assignee], queryFn: () => projectsApi.openTasks({ limit: '200', ...(assignee ? { assigneeId: assignee } : {}) }) });
  const setStatus = useMutation({
    mutationFn: (p: { id: string; status: TaskStatus }) => projectsApi.updateTask(p.id, { status: p.status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-tasks'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }, onError: e => notify.error(apiErrorMessage(e)),
  });
  const late = tasks.filter(t => t.is_overdue).length;
  const doing = tasks.filter(t => t.status === 'in_progress').length;
  const unassigned = tasks.filter(t => !t.assignee_id).length;
  return (
    <div className="prj">
      <section className="prj-kpis" aria-label="Indicateurs">
        <Kpi label="Tâches ouvertes" value={String(tasks.length)} sub={`${doing} en cours`} />
        <Kpi label="En retard" value={String(late)} sub="échéance dépassée" tone={late ? 'red' : undefined} />
        <Kpi label="Sans responsable" value={String(unassigned)} sub="à affecter" />
      </section>
      <div className="prj-toolbar">
        <SearchSelect size="md" width={240} ariaLabel="Affectée à" placeholder="Tout le monde" value={assignee} onChange={setAssignee}
          options={peopleOptions} />
        <span className="prj-note" style={{ flex: 1 }}>Projets en brouillon ou en cours, retards d’abord.</span>
        <div className="prj-views" role="group" aria-label="Affichage">
          <button type="button" className={layout === 'board' ? 'active' : ''} aria-pressed={layout === 'board'} onClick={() => setLayout('board')}><Columns3 size={14} /> Kanban</button>
          <button type="button" className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={14} /> Liste</button>
        </div>
      </div>
      {isLoading ? <Loading /> : tasks.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucune tâche ouverte">Tout est fait, ou rien n'est encore planifié.</StatusBanner>
      ) : layout === 'board' ? (
        <TaskBoard tasks={tasks} editable={canEdit('projects')} showProject onMove={(id, status) => setStatus.mutate({ id, status })} onOpen={t => navigate(`/projects/${t.project_id}`)} />
      ) : (
        <section className="prj-panel prj-scroll">
          <table className="odoo-table">
            <thead><tr><th>Tâche</th><th>Projet</th><th>Affectée à</th><th>Priorité</th><th>Échéance</th><th>Statut</th><th style={{ textAlign: 'right' }}>Heures</th></tr></thead>
            <tbody>{tasks.map(t => (
              <tr key={t.id}>
                <td><strong>{t.title}</strong></td>
                <td><button type="button" onClick={() => navigate(`/projects/${t.project_id}`)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--theme-accent-hover)', cursor: 'pointer' }}>{t.project_name}</button></td>
                <td>{t.assignee_name || '—'}</td>
                <td><span className={`prj-prio ${t.priority}`}>{PRIORITY_LABELS[t.priority]}</span></td>
                <td style={{ color: t.is_overdue ? 'var(--prj-red)' : undefined, fontWeight: t.is_overdue ? 600 : 400 }}>{t.due_date ? format(new Date(t.due_date), 'dd/MM/yyyy') : '—'}</td>
                <td>
                  <select className="odoo-filter-dropdown" aria-label="Statut" value={t.status} disabled={!canEdit('projects')} onChange={e => setStatus.mutate({ id: t.id, status: e.target.value as TaskStatus })}>
                    {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>{h1(t.hours_spent)}{t.estimated_hours ? ` / ${h1(t.estimated_hours)}` : ''} h</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function TimeSheet() {
  const qc = useQueryClient();
  const { canEdit } = usePermissions();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  const range = periodParams(period, from, to);
  const { data: people = [] } = useQuery({ queryKey: ['project-people'], queryFn: projectsApi.people });
  const peopleOptions = usePeopleOptions(people);
  const params: Record<string, string> = { ...range, page: String(page), pageSize: '50' };
  if (employee) params.employeeId = employee;
  const { data, isLoading } = useQuery({ queryKey: ['project-time', params], queryFn: () => projectsApi.listTime(params) });
  const del = useMutation({ mutationFn: (id: string) => projectsApi.deleteTime(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-time'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }, onError: e => notify.error(apiErrorMessage(e)) });
  const margin = data ? Number(data.amount) - Number(data.cost) : 0;
  return (
    <div className="prj">
      <div className="prj-toolbar">
        <PeriodFilter label="Période" title="Dates de travail" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        <SearchSelect size="md" width={240} ariaLabel="Personne" placeholder="Tout le monde" value={employee} onChange={setEmployee}
          options={peopleOptions} />
      </div>
      <section className="prj-kpis" aria-label="Indicateurs">
        <Kpi label="Heures" value={data ? `${h1(data.hours)} h` : '…'} sub={data ? `${data.total} saisie${data.total > 1 ? 's' : ''}` : undefined} />
        <Kpi label="Coût" value={data ? money(data.cost, { decimals: 0 }) : '…'} sub="heures × coût horaire" />
        <Kpi label="Facturable" value={data ? money(data.amount, { decimals: 0 }) : '…'} sub="heures facturables × taux" />
        <Kpi label="Marge sur le temps" value={data ? money(margin, { decimals: 0 }) : '…'} tone={data ? (margin < 0 ? 'red' : 'green') : undefined} />
      </section>
      {canEdit('projects') && (
        <section className="prj-panel">
          <div className="prj-panel-head">Saisir du temps</div>
          <div className="prj-panel-body"><TimeEntryForm bare /></div>
        </section>
      )}
      {isLoading ? <Loading /> : !data?.rows.length ? (
        <StatusBanner tone="info" icon={Timer} title="Aucun temps saisi">Aucune heure sur cette période.</StatusBanner>
      ) : (
        <section className="prj-panel">
          <div className="prj-panel-head">Saisies <small>{data.total}</small></div>
          <div className="prj-scroll">
            <table className="odoo-table">
              <thead><tr><th>Date</th><th>Qui</th><th>Projet</th><th>Tâche / activité</th><th>Note</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coût</th><th style={{ textAlign: 'right' }}>Facturable</th><th /></tr></thead>
              <tbody>{data.rows.map(t => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.work_date), 'EEE dd/MM', { locale: fr })}</td>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="prj-avatar">{initials(t.employee_name)}</span>{t.employee_name}</span></td>
                  <td>{t.project_name}</td>
                  <td>{t.task_title || t.activity_label || '—'}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{t.note || ''}</td>
                  <td style={{ textAlign: 'right' }}>{h1(t.hours)}</td>
                  <td style={{ textAlign: 'right' }}>{n2(t.cost)}</td>
                  <td style={{ textAlign: 'right' }}>{t.billable ? n2(t.amount) : <span style={{ color: 'var(--theme-text-muted)' }}>non fact.</span>}</td>
                  <td>{!t.invoice_id && canEdit('projects') && <button className="odoo-btn-secondary" title="Supprimer" aria-label="Supprimer la saisie" onClick={() => del.mutate(t.id)}><Trash2 size={12} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} ligne${data.total > 1 ? 's' : ''}`} />
        </section>
      )}
    </div>
  );
}

function Profitability() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['projects', 'profitability'], queryFn: () => projectsApi.list({ pageSize: '100' }) });
  if (isLoading || !data) return <Loading />;
  const rows = data.rows.filter(p => p.status !== 'cancelled');
  const billed = rows.filter(p => projectRevenue(p) > 0);
  const rev = billed.reduce((t, p) => t + projectRevenue(p), 0);
  const cost = billed.reduce((t, p) => t + projectCost(p), 0);
  const m = rev - cost;
  return (
    <div className="prj">
      <section className="prj-kpis" aria-label="Indicateurs">
        <Kpi label="Recette attendue" value={money(rev, { decimals: 0 })} sub={`${billed.length} projet${billed.length > 1 ? 's' : ''} facturé${billed.length > 1 ? 's' : ''}`} />
        <Kpi label="Coûts engagés" value={money(cost, { decimals: 0 })} sub="main-d’œuvre + achats rattachés" />
        <Kpi label="Marge" value={money(m, { decimals: 0 })} tone={rev ? (m < 0 ? 'red' : 'green') : undefined} />
        <Kpi label="Marge moyenne" value={rev ? `${Math.round(m / rev * 100)} %` : '—'} tone={rev ? (m < 0 ? 'red' : 'green') : undefined} />
      </section>
      <p className="prj-note">Recette = forfait, ou heures facturables × taux. Coûts = heures × coût horaire + factures fournisseurs rattachées.</p>
      <section className="prj-panel prj-scroll">
        <table className="odoo-table">
          <thead><tr><th>Projet</th><th>Client</th><th>Statut</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coûts</th><th style={{ textAlign: 'right' }}>Recette</th><th style={{ textAlign: 'right' }}>Marge</th><th>Marge %</th></tr></thead>
          <tbody>{rows.map(p => {
            const r = projectRevenue(p); const c = projectCost(p); const mm = r - c; const pct = r ? Math.round((mm / r) * 100) : null;
            return (
              <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
                <td><strong>{p.name}</strong> <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{p.number}</span></td>
                <td>{p.customer_label || '—'}</td>
                <td><ProjectStatusTag status={p.status} /></td>
                <td style={{ textAlign: 'right' }}>{h1(p.hours_spent)}{p.estimated_hours ? ` / ${h1(p.estimated_hours)}` : ''}</td>
                <td style={{ textAlign: 'right' }}>{n2(c)}</td>
                <td style={{ textAlign: 'right' }}>{r ? n2(r) : '—'}</td>
                <td style={{ textAlign: 'right', color: r ? (mm < 0 ? 'var(--prj-red)' : 'var(--prj-green)') : undefined, fontWeight: 600 }}>{r ? n2(mm) : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{pct === null ? '—' : <>{pct} %<span className="prj-inline-bar" aria-hidden="true"><span style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: pct < 0 ? 'var(--prj-red)' : 'var(--prj-green)' }} /></span></>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
    </div>
  );
}

function Loading() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>;
}
