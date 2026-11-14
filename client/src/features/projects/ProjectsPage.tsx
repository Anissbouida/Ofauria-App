import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, ListChecks, Timer, BarChart3, Database, Plus, Search, Loader2, CheckCircle2, AlertTriangle, Clock, Trash2, LayoutGrid, List, GanttChartSquare,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  projectsApi, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, type Project, type ProjectStatus, type TaskStatus,
} from '../../api/projects.api';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ModuleShell, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import { PeriodFilter, Pager, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import { useAuth } from '../../context/AuthContext';
import ProjectsPlanning from './ProjectsPlanning';
import {
  ProjectFormModal, TimeEntryForm, Meter, n2, n0, h1, initials, PRIORITY_TAG, projectHealth, consumption, usageTone, needsAttention, projectRevenue, projectCost,
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
    <ModuleShell title="Projets" views={views} current={current} onSelect={select}
      actions={(current?.key === 'projects' || current?.key === 'overview') ? (
        <button className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouveau projet</button>
      ) : undefined}>
      {current?.key === 'overview' && <Overview />}
      {current?.key === 'projects' && <ProjectList onPlanning={() => select('planning')} />}
      {current?.key === 'planning' && <ProjectsPlanning />}
      {current?.key === 'tasks' && <OpenTasks />}
      {current?.key === 'time' && <TimeSheet />}
      {current?.key === 'profitability' && <Profitability />}
      {creating && <ProjectFormModal onClose={() => setCreating(false)} onSaved={p => navigate(`/projects/${p.id}`)} />}
    </ModuleShell>
  );
}

const STATUS_TAG: Record<ProjectStatus, string> = { draft: 'odoo-tag-grey', active: 'odoo-tag-blue', on_hold: 'odoo-tag-orange', completed: 'odoo-tag-green', cancelled: 'odoo-tag-grey' };

function Progress({ p }: { p: Project }) {
  const pct = p.task_count ? Math.round((p.task_done / p.task_count) * 100) : 0;
  return (
    <div title={`${p.task_done}/${p.task_count} tâches`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--odoo-border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct === 100 ? '#28a745' : 'var(--odoo-purple)' }} />
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
      <td><span className={`odoo-tag ${STATUS_TAG[p.status]}`}>{PROJECT_STATUS_LABELS[p.status]}</span></td>
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
        <span className={`prj-pill ${p.status}`}>{PROJECT_STATUS_LABELS[p.status]}</span>
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
        <div className="prj-kpi"><div className="prj-kpi-head">Heures ce mois</div><div className="prj-kpi-value">{ov ? `${h1(ov.time.hours)} h` : '…'}</div><div className="prj-kpi-sub">{ov ? `coût ${n0(ov.time.cost)} DH` : ''}</div></div>
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
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Projet</th><th>Client</th><th>Statut</th><th>Santé</th><th>Échéance</th><th>Avancement</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coûts</th><th style={{ textAlign: 'right' }}>Recette</th><th>Responsable</th></tr></thead>
            <tbody>{rows.map(p => <ProjectRow key={p.id} p={p} />)}</tbody>
          </table>
        </div>
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
  const kpi = (label: string, value: string, sub?: string, danger?: boolean) => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ color: danger ? '#dc3545' : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{sub}</div>}
    </div>
  );
  const margin = Number(data.time.amount) - Number(data.time.cost);
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <PeriodFilter label="Temps passé" title="Période des heures" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        <strong style={{ fontSize: '0.8125rem' }}>{periodLabel(period, from, to)}</strong>
      </div>
      <div className="odoo-stat-grid">
        {kpi('Projets en cours', String(data.projects.active + data.projects.on_hold), `${data.projects.draft} brouillon(s)`)}
        {kpi('Projets en retard', String(data.projects.overdue), 'échéance dépassée', data.projects.overdue > 0)}
        {kpi('Tâches ouvertes', String(data.tasks.open), `${data.tasks.overdue} en retard`, data.tasks.overdue > 0)}
        {kpi('Heures sur la période', `${h1(data.time.hours)} h`, `coût ${n2(data.time.cost)} DH`)}
        {kpi('Facturable sur la période', `${n2(data.time.amount)} DH`, `marge ${n2(margin)} DH`, margin < 0)}
        {kpi('Reste à facturer', `${n2(data.time.unbilled)} DH`, 'temps facturable non facturé')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><FolderKanban size={12} /> Projets en cours</div>
          {data.active.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucun projet en cours.</p> : (
            <table className="odoo-table">
              <thead><tr><th>Projet</th><th>Client</th><th>Échéance</th><th>Avancement</th><th style={{ textAlign: 'right' }}>Heures</th></tr></thead>
              <tbody>{data.active.map(p => (
                <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
                  <td><strong>{p.name}</strong> <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{p.number}</span></td>
                  <td>{p.customer_label || '—'}</td>
                  <td style={{ color: p.is_overdue ? '#dc3545' : undefined }}>{p.due_date ? format(new Date(p.due_date), 'dd/MM') : '—'}</td>
                  <td><Progress p={p} /></td>
                  <td style={{ textAlign: 'right' }}>{h1(p.hours_spent)} h</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><ListChecks size={12} /> Prochaines tâches</div>
          {tasks.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune tâche ouverte.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {tasks.map(t => (
                <li key={t.id} onClick={() => navigate(`/projects/${t.project_id}`)} style={{ cursor: 'pointer', fontSize: '0.8125rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t.is_overdue ? <AlertTriangle size={13} style={{ color: '#dc3545' }} /> : <Clock size={13} style={{ color: 'var(--theme-text-muted)' }} />}
                  <span style={{ flex: 1 }}><strong>{t.title}</strong> <span style={{ color: 'var(--theme-text-muted)' }}>· {t.project_name}</span></span>
                  <span style={{ color: 'var(--theme-text-muted)' }}>{t.assignee_name || '—'}</span>
                  <span style={{ color: t.is_overdue ? '#dc3545' : 'var(--theme-text-muted)' }}>{t.due_date ? format(new Date(t.due_date), 'dd/MM') : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function OpenTasks() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assignee, setAssignee] = useState('');
  const { data: people = [] } = useQuery({ queryKey: ['project-people'], queryFn: projectsApi.people });
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['project-tasks', 'open', assignee], queryFn: () => projectsApi.openTasks({ limit: '200', ...(assignee ? { assigneeId: assignee } : {}) }) });
  const setStatus = useMutation({
    mutationFn: (p: { id: string; status: TaskStatus }) => projectsApi.updateTask(p.id, { status: p.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-tasks'] }), onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <select className="odoo-filter-dropdown" value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">Tout le monde</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{tasks.length} tâche{tasks.length > 1 ? 's' : ''} ouverte{tasks.length > 1 ? 's' : ''}, retards d'abord</span>
      </div>
      {isLoading ? <Loading /> : tasks.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucune tâche ouverte">Tout est fait, ou rien n'est encore planifié.</StatusBanner>
      ) : (
        <table className="odoo-table">
          <thead><tr><th>Tâche</th><th>Projet</th><th>Affectée à</th><th>Priorité</th><th>Échéance</th><th>Statut</th><th style={{ textAlign: 'right' }}>Heures</th></tr></thead>
          <tbody>{tasks.map(t => (
            <tr key={t.id}>
              <td><strong>{t.title}</strong></td>
              <td onClick={() => navigate(`/projects/${t.project_id}`)} style={{ cursor: 'pointer', color: 'var(--odoo-purple)' }}>{t.project_name}</td>
              <td>{t.assignee_name || '—'}</td>
              <td><span className={`odoo-tag ${PRIORITY_TAG[t.priority]}`}>{t.priority}</span></td>
              <td style={{ color: t.is_overdue ? '#dc3545' : undefined, fontWeight: t.is_overdue ? 600 : 400 }}>{t.due_date ? format(new Date(t.due_date), 'dd/MM/yyyy') : '—'}</td>
              <td>
                <select className="odoo-filter-dropdown" value={t.status} onChange={e => setStatus.mutate({ id: t.id, status: e.target.value as TaskStatus })}>
                  {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td style={{ textAlign: 'right' }}>{h1(t.hours_spent)}{t.estimated_hours ? ` / ${h1(t.estimated_hours)}` : ''} h</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
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
  const params: Record<string, string> = { ...range, page: String(page), pageSize: '50' };
  if (employee) params.employeeId = employee;
  const { data, isLoading } = useQuery({ queryKey: ['project-time', params], queryFn: () => projectsApi.listTime(params) });
  const del = useMutation({ mutationFn: (id: string) => projectsApi.deleteTime(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-time'] }); qc.invalidateQueries({ queryKey: ['projects'] }); }, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <>
      {canEdit('projects') && <TimeEntryForm />}
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <PeriodFilter label="Période" title="Dates de travail" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        <select className="odoo-filter-dropdown" value={employee} onChange={e => setEmployee(e.target.value)}>
          <option value="">Tout le monde</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {data && <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}><strong>{h1(data.hours)} h</strong> · coût {n2(data.cost)} DH · facturable {n2(data.amount)} DH</span>}
      </div>
      {isLoading ? <Loading /> : !data?.rows.length ? (
        <StatusBanner tone="info" icon={Timer} title="Aucun temps saisi">Déclarez les heures passées sur un projet avec le formulaire ci-dessus.</StatusBanner>
      ) : (
        <>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Qui</th><th>Projet</th><th>Tâche / activité</th><th>Note</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coût</th><th style={{ textAlign: 'right' }}>Facturable</th><th /></tr></thead>
            <tbody>{data.rows.map(t => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.work_date), 'EEE dd/MM', { locale: fr })}</td>
                <td>{t.employee_name}</td>
                <td>{t.project_name}</td>
                <td>{t.task_title || t.activity_label || '—'}</td>
                <td style={{ color: 'var(--theme-text-muted)' }}>{t.note || ''}</td>
                <td style={{ textAlign: 'right' }}>{h1(t.hours)}</td>
                <td style={{ textAlign: 'right' }}>{n2(t.cost)}</td>
                <td style={{ textAlign: 'right' }}>{t.billable ? n2(t.amount) : <span style={{ color: 'var(--theme-text-muted)' }}>non fact.</span>}</td>
                <td>{!t.invoice_id && canEdit('projects') && <button className="odoo-btn-secondary" title="Supprimer" onClick={() => del.mutate(t.id)}><Trash2 size={12} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} ligne${data.total > 1 ? 's' : ''}`} />
        </>
      )}
    </>
  );
}

function Profitability() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['projects', 'profitability'], queryFn: () => projectsApi.list({ pageSize: '100' }) });
  if (isLoading || !data) return <Loading />;
  const rows = data.rows.filter(p => p.status !== 'cancelled');
  const revenue = (p: Project) => (p.billing_type === 'fixed' ? Number(p.budget_amount ?? 0) : p.billing_type === 'time' ? Number(p.billable_amount) : 0);
  return (
    <>
      <StatusBanner tone="info" icon={BarChart3} title="Coût réel = heures × coût horaire des personnes">
        Facturable = forfait du projet, ou heures facturables × taux. La marge ne compte pas encore les achats affectés au projet.
      </StatusBanner>
      <table className="odoo-table">
        <thead><tr><th>Projet</th><th>Client</th><th>Statut</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Prévu</th><th style={{ textAlign: 'right' }}>Coût réel</th><th style={{ textAlign: 'right' }}>Facturable</th><th style={{ textAlign: 'right' }}>Marge</th><th style={{ textAlign: 'right' }}>Marge %</th></tr></thead>
        <tbody>{rows.map(p => {
          const rev = revenue(p); const cost = Number(p.cost_spent); const m = rev - cost;
          return (
            <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
              <td><strong>{p.name}</strong> <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{p.number}</span></td>
              <td>{p.customer_label || '—'}</td>
              <td><span className={`odoo-tag ${STATUS_TAG[p.status]}`}>{PROJECT_STATUS_LABELS[p.status]}</span></td>
              <td style={{ textAlign: 'right' }}>{h1(p.hours_spent)}{p.estimated_hours ? ` / ${h1(p.estimated_hours)}` : ''}</td>
              <td style={{ textAlign: 'right' }}>{p.estimated_hours ? `${h1(p.estimated_hours)} h` : '—'}</td>
              <td style={{ textAlign: 'right' }}>{n2(cost)}</td>
              <td style={{ textAlign: 'right' }}>{rev ? n2(rev) : '—'}</td>
              <td style={{ textAlign: 'right', color: m < 0 ? '#dc3545' : '#28a745', fontWeight: 600 }}>{rev ? n2(m) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{rev ? `${Math.round((m / rev) * 100)} %` : '—'}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}

function Loading() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>;
}
