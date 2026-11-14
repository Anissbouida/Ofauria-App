import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FolderKanban, ArrowLeft, Pencil, PlayCircle, PauseCircle, CheckCircle2, XCircle, RotateCcw, Plus, Trash2, Loader2, Link2, X, Check, Columns3, List,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  projectsApi, TASK_STATUS_LABELS, BILLING_LABELS, PRIORITY_LABELS, type ProjectStatus, type Task, type TaskStatus, type ProjectInvoice,
} from '../../api/projects.api';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import {
  ProjectFormModal, TaskFormModal, TimeEntryForm, TaskBoard, n2, n0, h1, PRIORITY_TAG, projectRevenue, consumption, usageTone,
} from './shared';

/**
 * Fiche d'un projet (mig 358, refonte 2026-11) : frise des étapes, jauges de santé,
 * onglets Tâches (Kanban ou liste) / Temps / Achats et charges, colonne rentabilité,
 * informations et activité récente (reconstituée à partir des tâches, du temps et des factures).
 */
type Tab = 'tasks' | 'time' | 'purchases' | 'notes';
const TASK_LAYOUT_KEY = 'kalum.projects.taskLayout';
const fmtDay = (d: string | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy', { locale: fr }) : null);

export default function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canEdit, canDelete } = usePermissions();
  const editable = canEdit('projects');
  const { data: p, isLoading } = useQuery({ queryKey: ['project', id], queryFn: () => projectsApi.get(id), enabled: !!id });
  const { data: time } = useQuery({ queryKey: ['project-time', { projectId: id }], queryFn: () => projectsApi.listTime({ projectId: id, pageSize: '200' }), enabled: !!id });
  const { data: invoices } = useQuery({ queryKey: ['project-invoices', id], queryFn: () => projectsApi.listInvoices(id), enabled: !!id });
  const [editing, setEditing] = useState(false);
  const [taskModal, setTaskModal] = useState<null | { task?: Task }>(null);
  const [linkModal, setLinkModal] = useState(false);
  const [tab, setTab] = useState<Tab>('tasks');
  const [taskLayout, setTaskLayoutState] = useState<'board' | 'list'>(() => { try { return localStorage.getItem(TASK_LAYOUT_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; } });
  const setTaskLayout = (l: 'board' | 'list') => { setTaskLayoutState(l); try { localStorage.setItem(TASK_LAYOUT_KEY, l); } catch { /* commodité seulement */ } };
  const refresh = () => { qc.invalidateQueries({ queryKey: ['project', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['project-time'] }); qc.invalidateQueries({ queryKey: ['project-tasks'] }); qc.invalidateQueries({ queryKey: ['project-invoices', id] }); };
  const unlinkInvoice = useMutation({ mutationFn: (invId: string) => projectsApi.unlinkInvoice(id, invId), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const setStatus = useMutation({ mutationFn: (s: ProjectStatus) => projectsApi.setStatus(id, s), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const setTaskStatus = useMutation({ mutationFn: (x: { taskId: string; status: TaskStatus }) => projectsApi.updateTask(x.taskId, { status: x.status }), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const delTask = useMutation({ mutationFn: (taskId: string) => projectsApi.deleteTask(taskId), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const delTime = useMutation({ mutationFn: (tid: string) => projectsApi.deleteTime(tid), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });

  if (isLoading || !p) return <div className="odoo-scope" style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" /></div>;

  const tasks = p.tasks ?? [];
  const pct = p.task_count ? Math.round((p.task_done / p.task_count) * 100) : 0;
  const laborCost = Number(p.cost_spent);
  const externalCost = Number(p.external_cost || 0);
  const totalCost = laborCost + externalCost;
  const revenue = projectRevenue(p);
  const margin = revenue - totalCost;
  const use = consumption(p);
  const hoursPct = Number(p.estimated_hours) > 0 ? Number(p.hours_spent) / Number(p.estimated_hours) * 100 : 0;
  const purchases = (invoices ?? []).filter(i => i.status !== 'cancelled');
  const isOpen = ['draft', 'active', 'on_hold'].includes(p.status);

  // Frise : Brouillon → En cours (ou En pause) → Terminé (ou Annulé).
  const rank = { draft: 0, active: 1, on_hold: 1, completed: 2, cancelled: 2 }[p.status];
  const steps = [
    { label: 'Brouillon', sub: fmtDay(p.created_at), state: rank > 0 ? 'done' : 'current' },
    { label: p.status === 'on_hold' ? 'En pause' : 'En cours', sub: p.start_date ? `depuis le ${fmtDay(p.start_date)}` : null, state: rank > 1 ? 'done' : rank === 1 ? (p.status === 'on_hold' ? 'warn' : 'current') : '' },
    p.status === 'cancelled'
      ? { label: 'Annulé', sub: null, state: 'warn' }
      : { label: 'Terminé', sub: p.completed_at ? fmtDay(p.completed_at) : p.due_date ? `prévu le ${fmtDay(p.due_date)}` : null, state: rank === 2 ? 'done' : '' },
  ];

  // Activité : reconstituée (tâches terminées, temps saisi, factures rattachées, création).
  const feed = [
    ...tasks.filter(t => t.completed_at).map(t => ({ at: t.completed_at!, text: `${t.assignee_name ? `${t.assignee_name} a terminé` : 'Terminé :'} « ${t.title} »` })),
    ...(time?.rows ?? []).map(t => ({ at: t.created_at, text: `${t.employee_name} : ${h1(t.hours)} h${t.task_title ? ` sur « ${t.task_title} »` : ''}` })),
    ...purchases.map(i => ({ at: i.invoice_date, text: `Facture ${i.invoice_number} rattachée (${n0(i.amount)} DH)` })),
    { at: p.created_at, text: `Projet créé${p.created_by_name ? ` par ${p.created_by_name}` : ''}` },
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  // Rentabilité : achats + main-d'œuvre + marge, sur la plus grande des deux bornes.
  const scale = Math.max(revenue, totalCost) || 1;
  const seg = (v: number) => `${Math.max(v, 0) / scale * 100}%`;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <button className="odoo-btn-secondary" aria-label="Retour aux projets" onClick={() => navigate('/projects?tab=projects')}><ArrowLeft size={14} /></button>
        <div className="odoo-breadcrumb">
          <FolderKanban size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Projets</span><span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current font-mono">{p.number}</span>
        </div>
        <div style={{ flex: 1 }} />
        {editable && (
          <>
            <button className="odoo-btn-secondary" onClick={() => setEditing(true)}><Pencil size={13} /> Modifier</button>
            {['draft', 'active', 'on_hold'].includes(p.status) && (
              <button className="odoo-btn-secondary" onClick={async () => { if (await confirm('Annuler ce projet ?', { title: 'Annuler le projet', danger: true })) setStatus.mutate('cancelled'); }}><XCircle size={13} /> Annuler</button>
            )}
            {p.status === 'active' && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('on_hold')}><PauseCircle size={13} /> Mettre en pause</button>}
            {p.status === 'draft' && <button className="odoo-btn-primary" onClick={() => setStatus.mutate('active')}><PlayCircle size={13} /> Lancer</button>}
            {p.status === 'on_hold' && <button className="odoo-btn-primary" onClick={() => setStatus.mutate('active')}><PlayCircle size={13} /> Reprendre</button>}
            {p.status === 'active' && <button className="odoo-btn-primary" onClick={() => setStatus.mutate('completed')}><CheckCircle2 size={13} /> Terminer</button>}
            {p.status === 'completed' && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('active')}><RotateCcw size={13} /> Rouvrir</button>}
            {p.status === 'cancelled' && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('draft')}><RotateCcw size={13} /> Repasser en brouillon</button>}
          </>
        )}
      </div>

      <div className="prj prj-detail">
        {p.is_overdue && <StatusBanner tone="danger" icon={XCircle} title="Échéance dépassée">Prévu pour le {format(new Date(p.due_date!), 'dd MMMM yyyy', { locale: fr })}.</StatusBanner>}

        <section className="prj-panel prj-hero">
          <div className="prj-hero-top">
            <div className="prj-hero-icon"><FolderKanban size={24} /></div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h1>{p.name}</h1>
              <div className="prj-hero-meta">
                <span>{p.customer_label || 'Interne'}</span>
                {p.order_number && <span>Commande {p.order_number}</span>}
                {p.manager_name && <span>Responsable : {p.manager_name}</span>}
                <span className={`prj-prio ${p.priority}`}>{PRIORITY_LABELS[p.priority]}</span>
              </div>
            </div>
          </div>
          <ol className="prj-steps" aria-label="Étapes du projet">
            {steps.map((st, i) => (
              <Fragment key={st.label}>
                {i > 0 && <li aria-hidden="true" className={`prj-step-line${st.state === 'done' || st.state === 'current' || st.state === 'warn' ? ' done' : ''}`} />}
                <li className={`prj-step ${st.state}`} aria-current={st.state === 'current' ? 'step' : undefined}>
                  <span className="prj-step-mark">{st.state === 'done' && <Check size={12} strokeWidth={3} />}</span>
                  {st.label}{st.sub ? ` · ${st.sub}` : ''}
                </li>
              </Fragment>
            ))}
          </ol>
        </section>

        <section className="prj-kpis" aria-label="Santé du projet">
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Avancement</span><span>{p.task_done} / {p.task_count} tâches</span></div>
            <div className="prj-kpi-value">{pct} %</div>
            <div className="prj-bar"><span style={{ width: `${pct}%` }} /></div>
            {p.task_late > 0 && <div className="prj-kpi-sub" style={{ color: 'var(--prj-red)' }}>{p.task_late} en retard</div>}
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Temps passé</span><span>{p.estimated_hours ? `prévu ${h1(p.estimated_hours)} h` : 'sans prévision'}</span></div>
            <div className="prj-kpi-value">{h1(p.hours_spent)} h</div>
            <div className={`prj-bar ${usageTone(hoursPct)}`}><span style={{ width: `${Math.min(hoursPct, 100)}%` }} /></div>
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Coûts engagés</span><span>{use && use.label !== 'Heures / prévu' ? `sur ${use.of}` : 'MO + achats'}</span></div>
            <div className="prj-kpi-value">{n0(totalCost)} DH</div>
            {use && use.label !== 'Heures / prévu'
              ? <div className={`prj-bar ${usageTone(use.pct)}`}><span style={{ width: `${Math.min(use.pct, 100)}%` }} /></div>
              : <div className="prj-kpi-sub">MO {n0(laborCost)} · achats {n0(externalCost)}</div>}
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Marge</span><span>{BILLING_LABELS[p.billing_type]}</span></div>
            <div className="prj-kpi-value" style={{ color: revenue ? (margin < 0 ? 'var(--prj-red)' : 'var(--prj-green)') : undefined }}>{revenue ? `${n0(margin)} DH` : '—'}</div>
            <div className="prj-kpi-sub">{revenue ? `${Math.round((margin / revenue) * 100)} % de ${n0(revenue)} DH` : 'projet non facturé'}</div>
          </div>
        </section>

        <div className="prj-columns">
          <section className="prj-panel prj-main">
            <div className="prj-tabs" role="tablist" aria-label="Contenu du projet">
              <button type="button" role="tab" aria-selected={tab === 'tasks'} className={`prj-tab${tab === 'tasks' ? ' active' : ''}`} onClick={() => setTab('tasks')}>Tâches<small>{tasks.length}</small></button>
              <button type="button" role="tab" aria-selected={tab === 'time'} className={`prj-tab${tab === 'time' ? ' active' : ''}`} onClick={() => setTab('time')}>Temps<small>{h1(p.hours_spent)} h</small></button>
              <button type="button" role="tab" aria-selected={tab === 'purchases'} className={`prj-tab${tab === 'purchases' ? ' active' : ''}`} onClick={() => setTab('purchases')}>Achats et charges<small>{purchases.length}</small></button>
              {(p.description || p.notes) && <button type="button" role="tab" aria-selected={tab === 'notes'} className={`prj-tab${tab === 'notes' ? ' active' : ''}`} onClick={() => setTab('notes')}>Notes</button>}
              <span style={{ flex: 1 }} />
              {tab === 'tasks' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
                  <div className="prj-views" role="group" aria-label="Affichage des tâches">
                    <button type="button" className={taskLayout === 'board' ? 'active' : ''} aria-pressed={taskLayout === 'board'} onClick={() => setTaskLayout('board')}><Columns3 size={14} /> Kanban</button>
                    <button type="button" className={taskLayout === 'list' ? 'active' : ''} aria-pressed={taskLayout === 'list'} onClick={() => setTaskLayout('list')}><List size={14} /> Liste</button>
                  </div>
                  {editable && <button className="odoo-btn-secondary" onClick={() => setTaskModal({})}><Plus size={12} /> Tâche</button>}
                </div>
              )}
              {tab === 'purchases' && editable && <button className="odoo-btn-secondary" onClick={() => setLinkModal(true)}><Link2 size={12} /> Rattacher une facture</button>}
            </div>

            <div className="prj-tab-body">
              {tab === 'tasks' && (tasks.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune tâche. Découpez le projet en étapes à affecter.</p>
              ) : taskLayout === 'board' ? (
                <TaskBoard tasks={tasks} editable={editable} onMove={(taskId, status) => setTaskStatus.mutate({ taskId, status })}
                  onOpen={t => editable && setTaskModal({ task: t })} />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="odoo-table">
                    <thead><tr><th style={{ width: 40 }} /><th>Tâche</th><th>Affectée à</th><th>Priorité</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Heures</th><th>Statut</th><th /></tr></thead>
                    <tbody>{tasks.map(t => (
                      <tr key={t.id} style={{ opacity: t.status === 'cancelled' ? 0.5 : 1 }}>
                        <td><input type="checkbox" aria-label={`Fait : ${t.title}`} checked={t.status === 'done'} disabled={!editable} onChange={e => setTaskStatus.mutate({ taskId: t.id, status: e.target.checked ? 'done' : 'todo' })} /></td>
                        <td onClick={() => editable && setTaskModal({ task: t })} style={{ cursor: editable ? 'pointer' : 'default' }}>
                          <strong style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</strong>
                          {t.description && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{t.description}</div>}
                        </td>
                        <td>{t.assignee_name || '—'}</td>
                        <td><span className={`odoo-tag ${PRIORITY_TAG[t.priority]}`}>{PRIORITY_LABELS[t.priority]}</span></td>
                        <td style={{ color: t.is_overdue ? '#dc3545' : undefined, fontWeight: t.is_overdue ? 600 : 400 }}>{t.due_date ? format(new Date(t.due_date), 'dd/MM/yyyy') : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{h1(t.hours_spent)}{t.estimated_hours ? ` / ${h1(t.estimated_hours)}` : ''}</td>
                        <td>
                          <select className="odoo-filter-dropdown" aria-label="Statut" value={t.status} disabled={!editable} onChange={e => setTaskStatus.mutate({ taskId: t.id, status: e.target.value as TaskStatus })}>
                            {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td>{canDelete('projects') && <button className="odoo-btn-secondary" title="Supprimer" aria-label={`Supprimer ${t.title}`} onClick={async () => { if (await confirm(`Supprimer la tâche « ${t.title} » ?`, { danger: true })) delTask.mutate(t.id); }}><Trash2 size={12} /></button>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ))}

              {tab === 'time' && (
                <>
                  {editable && isOpen && <TimeEntryForm projectId={p.id} tasks={tasks} compact />}
                  {!time?.rows.length ? <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune heure déclarée.</p> : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="odoo-table">
                        <thead><tr><th>Date</th><th>Qui</th><th>Tâche / activité</th><th>Note</th><th style={{ textAlign: 'right' }}>Heures</th><th style={{ textAlign: 'right' }}>Coût</th><th style={{ textAlign: 'right' }}>Facturable</th><th /></tr></thead>
                        <tbody>{time.rows.map(t => (
                          <tr key={t.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.work_date), 'EEE dd/MM', { locale: fr })}</td>
                            <td>{t.employee_name}</td>
                            <td>{t.task_title || t.activity_label || '—'}</td>
                            <td style={{ color: 'var(--theme-text-muted)' }}>{t.note || ''}</td>
                            <td style={{ textAlign: 'right' }}>{h1(t.hours)}</td>
                            <td style={{ textAlign: 'right' }}>{n2(t.cost)}</td>
                            <td style={{ textAlign: 'right' }}>{t.billable ? n2(t.amount) : <span style={{ color: 'var(--theme-text-muted)' }}>non fact.</span>}</td>
                            <td>{!t.invoice_id && canDelete('projects') && <button className="odoo-btn-secondary" title="Supprimer" aria-label="Supprimer la saisie" onClick={() => delTime.mutate(t.id)}><Trash2 size={12} /></button>}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {tab === 'purchases' && (!invoices?.length ? (
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune facture rattachée : leur coût entre dans la marge du projet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="odoo-table">
                    <thead><tr><th>Facture</th><th>Type</th><th>Fournisseur / catégorie</th><th>Date</th><th>Statut</th><th style={{ textAlign: 'right' }}>Montant HT</th><th /></tr></thead>
                    <tbody>{invoices.map(inv => (
                      <tr key={inv.id}>
                        <td className="font-mono">{inv.invoice_number}</td>
                        <td><span className={`odoo-tag ${inv.invoice_type === 'received' ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{inv.invoice_type === 'received' ? 'Coût' : 'Produit'}</span></td>
                        <td>{inv.supplier_name || inv.category_name || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(inv.invoice_date), 'dd/MM/yyyy')}</td>
                        <td>{inv.status === 'cancelled' ? <span className="odoo-tag odoo-tag-grey">Annulée</span> : <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{inv.status}</span>}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n2(inv.amount)}</td>
                        <td>{editable && <button className="odoo-btn-secondary" title="Détacher" aria-label={`Détacher ${inv.invoice_number}`} onClick={async () => { if (await confirm(`Détacher la facture ${inv.invoice_number} du projet ?`)) unlinkInvoice.mutate(inv.id); }}><Trash2 size={12} /></button>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ))}

              {tab === 'notes' && (
                <div style={{ display: 'grid', gap: 12, fontSize: '0.875rem' }}>
                  {p.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.description}</p>}
                  {p.notes && <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--theme-text-muted)' }}>{p.notes}</p>}
                </div>
              )}
            </div>
          </section>

          <aside className="prj-aside">
            <section className="prj-panel">
              <h2>Rentabilité</h2>
              <div className="prj-stack" aria-hidden="true">
                <span style={{ width: seg(externalCost), background: 'var(--odoo-purple)' }} />
                <span style={{ width: seg(laborCost), background: 'color-mix(in srgb, var(--odoo-purple) 45%, transparent)' }} />
                {margin > 0 && <span style={{ width: seg(margin), background: 'var(--prj-green)' }} />}
              </div>
              <dl className="prj-legend">
                <dt><span className="prj-swatch" style={{ background: 'var(--odoo-purple)' }} />Achats rattachés</dt><dd>{n0(externalCost)} DH</dd>
                <dt><span className="prj-swatch" style={{ background: 'color-mix(in srgb, var(--odoo-purple) 45%, transparent)' }} />Main-d’œuvre ({h1(p.hours_spent)} h)</dt><dd>{n0(laborCost)} DH</dd>
                {revenue > 0 && <>
                  <dt><span className="prj-swatch" style={{ background: margin < 0 ? 'var(--prj-red)' : 'var(--prj-green)' }} />{margin < 0 ? 'Perte' : 'Marge'}</dt>
                  <dd style={{ color: margin < 0 ? 'var(--prj-red)' : 'var(--prj-green)' }}>{n0(margin)} DH</dd>
                </>}
              </dl>
              <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', borderTop: '1px solid var(--odoo-border)', paddingTop: 10 }}>
                {revenue > 0 ? `${p.billing_type === 'fixed' ? 'Forfait' : 'Facturable'} ${n0(revenue)} DH` : 'Projet non facturé'}
                {p.billing_type === 'time' && Number(p.unbilled_amount) > 0 ? ` · reste à facturer ${n0(p.unbilled_amount)} DH` : ''}
              </div>
            </section>

            <section className="prj-panel">
              <h2>Informations</h2>
              <dl className="prj-dl">
                <dt>Dates</dt><dd>{fmtDay(p.start_date) ?? '…'} → {fmtDay(p.due_date) ?? '…'}</dd>
                <dt>Facturation</dt><dd>{BILLING_LABELS[p.billing_type]}{p.billing_type === 'time' && p.hourly_rate ? ` · ${n2(p.hourly_rate)} DH/h` : ''}</dd>
                {p.billing_type !== 'fixed' && p.budget_amount && <><dt>Budget</dt><dd>{n0(p.budget_amount)} DH</dd></>}
                <dt>Responsable</dt><dd>{p.manager_name || '—'}</dd>
                <dt>Créé le</dt><dd>{fmtDay(p.created_at)}{p.created_by_name ? ` par ${p.created_by_name}` : ''}</dd>
              </dl>
            </section>

            <section className="prj-panel">
              <h2>Activité</h2>
              <ol className="prj-feed">
                {feed.map((f, i) => (
                  <li key={i}><span className="prj-dot" /><span>{f.text}<small>{format(new Date(f.at), 'd MMM yyyy', { locale: fr })}</small></span></li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </div>

      {editing && <ProjectFormModal project={p} onClose={() => setEditing(false)} />}
      {taskModal && <TaskFormModal projectId={p.id} task={taskModal.task} onClose={() => setTaskModal(null)} />}
      {linkModal && <LinkInvoiceModal projectId={p.id} onClose={() => setLinkModal(false)} onLinked={refresh} />}
    </div>
  );
}

/** Modale : rechercher et rattacher une facture (libre ou déjà sur ce projet) au projet. */
function LinkInvoiceModal({ projectId, onClose, onLinked }: { projectId: string; onClose: () => void; onLinked: () => void }) {
  const [search, setSearch] = useState('');
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['project-linkable', projectId, search],
    queryFn: () => projectsApi.linkableInvoices(projectId, search ? { search } : {}),
  });
  const link = useMutation({
    mutationFn: (invId: string) => projectsApi.linkInvoice(projectId, invId),
    onSuccess: () => { notify.success('Facture rattachée'); onLinked(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(680px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Link2 size={16} /> Rattacher une facture</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="N° de facture ou fournisseur…"
            style={{ padding: '0.45rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' }} />
          <div style={{ overflowY: 'auto' }}>
            {isLoading ? <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></div>
              : rows.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune facture disponible. Les factures déjà rattachées à un autre projet ou annulées ne sont pas listées.</p>
              : (
                <table className="odoo-table">
                  <thead><tr><th>Facture</th><th>Type</th><th>Fournisseur</th><th>Date</th><th style={{ textAlign: 'right' }}>HT</th><th /></tr></thead>
                  <tbody>{rows.map((inv: ProjectInvoice) => (
                    <tr key={inv.id}>
                      <td className="font-mono">{inv.invoice_number}</td>
                      <td><span className={`odoo-tag ${inv.invoice_type === 'received' ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{inv.invoice_type === 'received' ? 'Coût' : 'Produit'}</span></td>
                      <td>{inv.supplier_name || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(inv.invoice_date), 'dd/MM/yyyy')}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n2(inv.amount)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {inv.project_id === projectId
                          ? <span className="odoo-tag odoo-tag-green">Rattachée</span>
                          : <button className="odoo-btn-primary" style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }} disabled={link.isPending} onClick={() => link.mutate(inv.id)}><Plus size={12} /> Rattacher</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
