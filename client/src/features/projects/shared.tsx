import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { fr } from 'date-fns/locale';
import { format } from 'date-fns';
import {
  projectsApi, BILLING_LABELS, PRIORITY_LABELS, type BillingType, type Priority, type Project, type ProjectInput, type Task, type TaskInput, type TaskStatus,
} from '../../api/projects.api';
import { customersApi } from '../../api/customers.api';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import './projects.css';

/** Petits formulaires du module Projets, partagés entre la liste et la fiche. */

export const n2 = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const h1 = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
/** Montant arrondi au dirham, pour les cartes et jauges (le détail garde n2). */
export const n0 = (v: string | number | null | undefined) =>
  Math.round(Number(v ?? 0)).toLocaleString('fr-FR');
export const initials = (name?: string | null) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

export type Tone = 'green' | 'orange' | 'red' | 'blue' | 'grey';
const DAY = 86_400_000;
export const daysUntil = (d: string | null) => (d ? Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY) : null);

/** Recette attendue : forfait, ou temps facturable ; 0 si le projet n'est pas facturé. */
export const projectRevenue = (p: Project) =>
  p.billing_type === 'fixed' ? Number(p.budget_amount ?? 0) : p.billing_type === 'time' ? Number(p.billable_amount) : 0;
/** Coûts engagés : main-d'œuvre (heures × coût) + factures fournisseurs rattachées. */
export const projectCost = (p: Project) => Number(p.cost_spent) + Number(p.external_cost || 0);

/**
 * Jauge de consommation : coûts / forfait (projet au forfait), coûts / budget,
 * sinon heures / heures prévues. null quand rien ne sert de référence.
 */
export function consumption(p: Project): { label: string; used: string; of: string; pct: number } | null {
  const cost = projectCost(p);
  if (p.billing_type === 'fixed' && Number(p.budget_amount) > 0) return { label: 'Coûts / forfait', used: n0(cost), of: `${n0(p.budget_amount)} DH`, pct: cost / Number(p.budget_amount) * 100 };
  if (Number(p.budget_amount) > 0) return { label: 'Coûts / budget', used: n0(cost), of: `${n0(p.budget_amount)} DH`, pct: cost / Number(p.budget_amount) * 100 };
  if (Number(p.estimated_hours) > 0) return { label: 'Heures / prévu', used: h1(p.hours_spent), of: `${h1(p.estimated_hours)} h`, pct: Number(p.hours_spent) / Number(p.estimated_hours) * 100 };
  return null;
}
export const usageTone = (pct: number): Tone => (pct > 100 ? 'red' : pct > 85 ? 'orange' : 'green');

/** Santé d'un projet en un mot, du plus grave au plus rassurant. */
export function projectHealth(p: Project): { tone: Tone; label: string } {
  if (p.status === 'completed') return { tone: 'green', label: 'Terminé' };
  if (p.status === 'cancelled') return { tone: 'grey', label: 'Annulé' };
  const late = daysUntil(p.due_date);
  if (p.is_overdue && late !== null) return { tone: 'red', label: `En retard de ${-late} j` };
  const c = consumption(p);
  if (c && c.pct > 100) return { tone: 'red', label: `Dépassement de ${Math.round(c.pct - 100)} %` };
  if (p.status === 'on_hold') return { tone: 'orange', label: 'En pause' };
  if (p.task_late) return { tone: 'orange', label: `${p.task_late} tâche${p.task_late > 1 ? 's' : ''} en retard` };
  if (p.status === 'draft') return { tone: 'blue', label: 'À lancer' };
  if (c && c.pct > 85) return { tone: 'orange', label: 'Budget presque atteint' };
  return { tone: 'green', label: 'Dans les temps' };
}
export const needsAttention = (p: Project) => ['red', 'orange'].includes(projectHealth(p).tone) && p.status !== 'on_hold';

export function Meter({ label, value, pct, tone }: { label: string; value: string; pct: number; tone?: Tone }) {
  return (
    <div className="prj-meter">
      <div className="prj-meter-head"><span>{label}</span><strong>{value}</strong></div>
      <div className={`prj-bar ${tone ?? ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
      </div>
    </div>
  );
}

const LANES: Array<{ status: TaskStatus; label: string; tone: string; empty: string }> = [
  { status: 'todo', label: 'À faire', tone: 'grey', empty: 'Rien à faire' },
  { status: 'in_progress', label: 'En cours', tone: '', empty: 'Rien en cours' },
  { status: 'done', label: 'Terminé', tone: 'green', empty: 'Déposez une tâche ici pour la terminer' },
];

/**
 * Kanban des tâches (fiche projet et tâches ouvertes) : une colonne par statut,
 * glisser une carte la change de colonne, cliquer l'ouvre. `showProject` affiche
 * le projet de chaque tâche (vue transverse).
 */
export function TaskBoard({ tasks, editable, onMove, onOpen, showProject }: {
  tasks: Task[]; editable: boolean; onMove: (taskId: string, status: TaskStatus) => void;
  onOpen?: (t: Task) => void; showProject?: boolean;
}) {
  const [over, setOver] = useState<TaskStatus | null>(null);
  return (
    <div className="prj-board">
      {LANES.map(lane => {
        const list = tasks.filter(t => t.status === lane.status);
        return (
          <div key={lane.status} className={`prj-lane${over === lane.status ? ' over' : ''}`}
            onDragOver={editable ? e => { e.preventDefault(); setOver(lane.status); } : undefined}
            onDragLeave={() => setOver(o => (o === lane.status ? null : o))}
            onDrop={editable ? e => {
              e.preventDefault(); setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              const t = tasks.find(x => x.id === id);
              if (t && t.status !== lane.status) onMove(id, lane.status);
            } : undefined}>
            <div className="prj-lane-head"><span className={`prj-dot ${lane.tone}`} /><strong>{lane.label}</strong><small>{list.length}</small></div>
            {!list.length && <div className="prj-lane-empty">{lane.empty}</div>}
            {list.map(t => (
              <button key={t.id} type="button" className={`prj-task${t.status === 'done' ? ' done' : ''}`} draggable={editable}
                onDragStart={e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => onOpen?.(t)} title={editable ? 'Glisser pour changer de colonne · cliquer pour ouvrir' : undefined}>
                {showProject && t.project_name && <span className="prj-card-num">{t.project_number} · {t.project_name}</span>}
                <span className="prj-task-title">{t.title}</span>
                <span className="prj-task-meta">
                  <span className={`prj-prio ${t.priority}`}>{PRIORITY_LABELS[t.priority]}</span>
                  <span style={{ flex: 1 }}>
                    {t.due_date && <span className={t.is_overdue ? 'late' : ''}>{format(new Date(t.due_date), 'd MMM', { locale: fr })}</span>}
                    {Number(t.hours_spent) > 0 || t.estimated_hours ? ` · ${h1(t.hours_spent)}${t.estimated_hours ? ` / ${h1(t.estimated_hours)}` : ''} h` : ''}
                  </span>
                  {t.assignee_name && <span className="prj-avatar" title={t.assignee_name}>{initials(t.assignee_name)}</span>}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Indicateur en tuile, commun aux rubriques du module. */
export function Kpi({ label, value, sub, tone, aside }: { label: string; value: string; sub?: string; tone?: 'red' | 'green'; aside?: string }) {
  return (
    <div className="prj-kpi">
      <div className="prj-kpi-head"><span>{label}</span>{aside && <span>{aside}</span>}</div>
      <div className="prj-kpi-value" style={{ color: tone ? `var(--prj-${tone})` : undefined }}>{value}</div>
      {sub && <div className="prj-kpi-sub">{sub}</div>}
    </div>
  );
}

export const PRIORITY_TAG: Record<Priority, string> = { critical: 'odoo-tag-red', high: 'odoo-tag-orange', normal: 'odoo-tag-blue', low: 'odoo-tag-grey' };
const label: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, display: 'block' };

function customerLabel(c: Record<string, any>): string {
  return (c.company_name as string)?.trim() || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
}

function Shell({ title, onClose, children, footer, width = 640 }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; width?: number }) {
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{title}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>{children}</div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          {footer}
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════ Projet ═══════════════════ */
export function ProjectFormModal({ project, onClose, onSaved }: { project?: Project | null; onClose: () => void; onSaved?: (p: Project) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<ProjectInput>({
    name: project?.name ?? '', description: project?.description ?? '', customerId: project?.customer_id ?? null,
    priority: project?.priority ?? 'normal', startDate: project?.start_date?.slice(0, 10) ?? null, dueDate: project?.due_date?.slice(0, 10) ?? null,
    billingType: project?.billing_type ?? 'none', hourlyRate: project?.hourly_rate ? Number(project.hourly_rate) : null,
    budgetAmount: project?.budget_amount ? Number(project.budget_amount) : null, estimatedHours: project?.estimated_hours ? Number(project.estimated_hours) : null,
    notes: project?.notes ?? '',
  });
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerName, setCustomerName] = useState(project?.customer_label ?? '');
  const { data: customersData } = useQuery({
    queryKey: ['customers', 'search', customerQuery],
    queryFn: () => customersApi.list({ search: customerQuery, limit: '20' }),
    enabled: customerQuery.trim().length >= 2,
  });
  const customers: Record<string, any>[] = customersData?.data ?? [];
  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setF(s => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: ProjectInput = { ...f, description: f.description || null, notes: f.notes || null };
      return project ? projectsApi.update(project.id, body) : projectsApi.create(body);
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['project', p.id] });
      notify.success(project ? 'Projet enregistré' : `Projet ${p.number} créé`); onSaved?.(p); onClose();
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const num = (v: string) => (v === '' ? null : Number(v));

  return (
    <Shell title={project ? `Modifier ${project.number}` : 'Nouveau projet'} onClose={onClose}
      footer={<>
        <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button className="odoo-btn-primary" disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 size={13} className="animate-spin" />} Enregistrer
        </button>
      </>}>
      <div>
        <span style={label}>Nom du projet</span>
        <input className="input" style={{ width: '100%' }} value={f.name} maxLength={200} onChange={e => set('name', e.target.value)} placeholder="Ex. : Mariage Benali 14 juin, Chantier villa Anfa, Mission audit…" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <span style={label}>Client</span>
          {f.customerId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="odoo-tag odoo-tag-blue">{customerName || 'Fiche client'}</span>
              <button type="button" className="odoo-btn-secondary" onClick={() => { set('customerId', null); setCustomerName(''); }}>Changer</button>
            </div>
          ) : (
            <>
              <input className="input" style={{ width: '100%' }} value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} placeholder="Rechercher une fiche (ou interne)" />
              {customers.length > 0 && customerQuery.trim().length >= 2 && (
                <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, marginTop: 4, maxHeight: 140, overflowY: 'auto' }}>
                  {customers.slice(0, 8).map(c => (
                    <button key={c.id} type="button" onClick={() => { set('customerId', c.id); setCustomerName(customerLabel(c)); setCustomerQuery(''); }}
                      style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: '0.8125rem', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                      {customerLabel(c)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <span style={label}>Priorité</span>
          <select className="input" style={{ width: '100%' }} value={f.priority} onChange={e => set('priority', e.target.value as Priority)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div><span style={label}>Début</span><input className="input" type="date" style={{ width: '100%' }} value={f.startDate ?? ''} onChange={e => set('startDate', e.target.value || null)} /></div>
        <div><span style={label}>Échéance</span><input className="input" type="date" style={{ width: '100%' }} value={f.dueDate ?? ''} onChange={e => set('dueDate', e.target.value || null)} /></div>
        <div><span style={label}>Heures prévues</span><input className="input" type="number" min="0" step="0.5" style={{ width: '100%' }} value={f.estimatedHours ?? ''} onChange={e => set('estimatedHours', num(e.target.value))} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <span style={label}>Facturation</span>
          <select className="input" style={{ width: '100%' }} value={f.billingType} onChange={e => set('billingType', e.target.value as BillingType)}>
            {Object.entries(BILLING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>{f.billingType === 'fixed' ? 'Forfait (DH)' : 'Budget (DH)'}</span>
          <input className="input" type="number" min="0" step="0.01" style={{ width: '100%' }} value={f.budgetAmount ?? ''} onChange={e => set('budgetAmount', num(e.target.value))} />
        </div>
        <div>
          <span style={label}>Taux horaire facturé (DH)</span>
          <input className="input" type="number" min="0" step="0.01" style={{ width: '100%' }} value={f.hourlyRate ?? ''} disabled={f.billingType !== 'time'}
            onChange={e => set('hourlyRate', num(e.target.value))} placeholder={f.billingType === 'time' ? 'Sinon taux de l\'activité' : '—'} />
        </div>
      </div>
      <div>
        <span style={label}>Description</span>
        <textarea className="input" style={{ width: '100%', minHeight: 70 }} value={f.description ?? ''} onChange={e => set('description', e.target.value)} />
      </div>
    </Shell>
  );
}

/* ═══════════════════ Tâche ═══════════════════ */
export function TaskFormModal({ projectId, task, onClose }: { projectId: string; task?: Task | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery({ queryKey: ['project-people'], queryFn: projectsApi.people });
  const [f, setF] = useState<TaskInput>({
    title: task?.title ?? '', description: task?.description ?? '', priority: task?.priority ?? 'normal', assigneeId: task?.assignee_id ?? null,
    startDate: task?.start_date?.slice(0, 10) ?? null, dueDate: task?.due_date?.slice(0, 10) ?? null,
    estimatedHours: task?.estimated_hours ? Number(task.estimated_hours) : null,
  });
  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => setF(s => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body: TaskInput = { ...f, description: f.description || null };
      return task ? projectsApi.updateTask(task.id, body) : projectsApi.createTask(projectId, body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', projectId] }); qc.invalidateQueries({ queryKey: ['project-tasks'] }); onClose(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Shell title={task ? 'Modifier la tâche' : 'Nouvelle tâche'} onClose={onClose} width={560}
      footer={<>
        <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button className="odoo-btn-primary" disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
      </>}>
      <div><span style={label}>Tâche</span><input className="input" style={{ width: '100%' }} value={f.title} maxLength={200} onChange={e => set('title', e.target.value)} autoFocus /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <span style={label}>Affectée à</span>
          <SearchSelect size="md" width="100%" ariaLabel="Affectée à" placeholder="Personne" value={f.assigneeId ?? ''} onChange={v => set('assigneeId', v || null)}
            options={people.map(p => ({ id: p.id, label: p.name, sublabel: p.role ?? undefined }))} />
        </div>
        <div>
          <span style={label}>Priorité</span>
          <select className="input" style={{ width: '100%' }} value={f.priority} onChange={e => set('priority', e.target.value as Priority)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div><span style={label}>Début</span><input className="input" type="date" style={{ width: '100%' }} value={f.startDate ?? ''} onChange={e => set('startDate', e.target.value || null)} /></div>
        <div><span style={label}>Échéance</span><input className="input" type="date" style={{ width: '100%' }} value={f.dueDate ?? ''} onChange={e => set('dueDate', e.target.value || null)} /></div>
        <div><span style={label}>Heures prévues</span><input className="input" type="number" min="0" step="0.5" style={{ width: '100%' }} value={f.estimatedHours ?? ''} onChange={e => set('estimatedHours', e.target.value === '' ? null : Number(e.target.value))} /></div>
      </div>
      <div><span style={label}>Détail</span><textarea className="input" style={{ width: '100%', minHeight: 60 }} value={f.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
    </Shell>
  );
}

/* ═══════════════════ Temps passé ═══════════════════ */
export function TimeEntryForm({ projectId, tasks, onSaved, compact, bare }: { projectId?: string; tasks?: Task[]; onSaved?: () => void; compact?: boolean; bare?: boolean }) {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery({ queryKey: ['project-people'], queryFn: projectsApi.people });
  const { entries: activities } = useReferentiel('project_activity_types');
  const { data: projectsData } = useQuery({
    queryKey: ['projects', 'for-time'], queryFn: () => projectsApi.list({ status: 'active', pageSize: '100' }), enabled: !projectId,
  });
  const [pid, setPid] = useState(projectId ?? '');
  const [taskId, setTaskId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [workDate, setWorkDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hours, setHours] = useState('');
  const [activityCode, setActivityCode] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  useEffect(() => { if (projectId) setPid(projectId); }, [projectId]);
  useEffect(() => { if (!employeeId && people.length === 1) setEmployeeId(people[0].id); }, [people, employeeId]);

  const add = useMutation({
    mutationFn: () => projectsApi.addTime({ projectId: pid, taskId: taskId || null, employeeId, workDate, hours: Number(hours), activityCode: activityCode || null, note: note || null, billable }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', pid] }); qc.invalidateQueries({ queryKey: ['project-time'] }); qc.invalidateQueries({ queryKey: ['projects'] });
      setHours(''); setNote(''); notify.success('Temps enregistré'); onSaved?.();
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const can = !!pid && !!employeeId && Number(hours) > 0 && !add.isPending;
  const cols = compact ? '1fr 1fr 110px 90px 1fr auto' : '1.2fr 1fr 1fr 120px 90px 1fr auto';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'end', ...(bare ? {} : { padding: 12, border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg-alt)' }) }}>
      {!projectId && (
        <div>
          <span style={label}>Projet</span>
          <SearchSelect size="md" width="100%" ariaLabel="Projet" placeholder="Rechercher un projet…" value={pid} onChange={v => { setPid(v); setTaskId(''); }}
            options={(projectsData?.rows ?? []).map(p => ({ id: p.id, label: p.name, sublabel: `${p.number}${p.customer_label ? ` · ${p.customer_label}` : ''}` }))} />
        </div>
      )}
      <div>
        <span style={label}>Qui</span>
        <SearchSelect size="md" width="100%" ariaLabel="Qui" placeholder="Rechercher une personne…" value={employeeId} onChange={setEmployeeId}
          options={people.map(p => ({ id: p.id, label: p.name, sublabel: p.role ?? undefined }))} />
      </div>
      {tasks && (
        <div>
          <span style={label}>Tâche</span>
          <SearchSelect size="md" width="100%" ariaLabel="Tâche" placeholder="Sans tâche" value={taskId} onChange={setTaskId}
            options={tasks.filter(t => t.status !== 'cancelled').map(t => ({ id: t.id, label: t.title, sublabel: t.assignee_name ?? undefined }))} />
        </div>
      )}
      {!tasks && !compact && (
        <div>
          <span style={label}>Activité</span>
          <SearchSelect size="md" width="100%" ariaLabel="Activité" placeholder="Aucune" value={activityCode} onChange={setActivityCode}
            options={activities.map(a => ({ id: a.code, label: a.label }))} />
        </div>
      )}
      <div><span style={label}>Date</span><input className="input" type="date" style={{ width: '100%' }} value={workDate} onChange={e => setWorkDate(e.target.value)} /></div>
      <div><span style={label}>Heures</span><input className="input" type="number" min="0.25" max="24" step="0.25" style={{ width: '100%' }} value={hours} onChange={e => setHours(e.target.value)} placeholder="2" /></div>
      <div>
        <span style={label}>Note</span>
        <input className="input" style={{ width: '100%' }} value={note} onChange={e => setNote(e.target.value)} placeholder="Ce qui a été fait" onKeyDown={e => { if (e.key === 'Enter' && can) add.mutate(); }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', whiteSpace: 'nowrap' }} title="Compté dans le facturable">
          <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} /> Fact.
        </label>
        <button className="odoo-btn-primary" disabled={!can} onClick={() => add.mutate()}>{add.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Ajouter'}</button>
      </div>
    </div>
  );
}
