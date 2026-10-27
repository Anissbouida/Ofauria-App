import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  projectsApi, BILLING_LABELS, PRIORITY_LABELS, type BillingType, type Priority, type Project, type ProjectInput, type Task, type TaskInput,
} from '../../api/projects.api';
import { customersApi } from '../../api/customers.api';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/** Petits formulaires du module Projets, partagés entre la liste et la fiche. */

export const n2 = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const h1 = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
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
          <select className="input" style={{ width: '100%' }} value={f.assigneeId ?? ''} onChange={e => set('assigneeId', e.target.value || null)}>
            <option value="">Personne</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
export function TimeEntryForm({ projectId, tasks, onSaved, compact }: { projectId?: string; tasks?: Task[]; onSaved?: () => void; compact?: boolean }) {
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
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'end', padding: 12, border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg-alt)' }}>
      {!projectId && (
        <div>
          <span style={label}>Projet</span>
          <select className="input" style={{ width: '100%' }} value={pid} onChange={e => { setPid(e.target.value); setTaskId(''); }}>
            <option value="">Choisir…</option>
            {(projectsData?.rows ?? []).map(p => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <span style={label}>Qui</span>
        <select className="input" style={{ width: '100%' }} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Choisir…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {tasks && (
        <div>
          <span style={label}>Tâche</span>
          <select className="input" style={{ width: '100%' }} value={taskId} onChange={e => setTaskId(e.target.value)}>
            <option value="">Sans tâche</option>
            {tasks.filter(t => t.status !== 'cancelled').map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
      )}
      {!tasks && !compact && (
        <div>
          <span style={label}>Activité</span>
          <select className="input" style={{ width: '100%' }} value={activityCode} onChange={e => setActivityCode(e.target.value)}>
            <option value="">—</option>
            {activities.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
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
