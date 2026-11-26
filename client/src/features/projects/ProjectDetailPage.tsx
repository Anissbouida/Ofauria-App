import { money, currencySymbol } from '../../utils/money';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { FolderKanban, ArrowLeft, Pencil, PlayCircle, PauseCircle, CheckCircle2, XCircle, RotateCcw, Plus, Trash2, Link2, X, Check, Columns3, List, Timer } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  projectsApi, TASK_STATUS_LABELS, BILLING_LABELS, PROJECT_STATUS_LABELS, PRIORITY_LABELS, type ProjectStatus, type Task, type TaskStatus, type ProjectInvoice,
} from '../../api/projects.api';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { Breadcrumb, DataPanel, EmptyState, LoadingState, Modal } from '../../components/ds';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
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
const STATUS_TONE: Record<ProjectStatus, StatusTone> = { draft: 'draft', active: 'progress', on_hold: 'blocked', completed: 'done', cancelled: 'cancelled' };
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

  if (isLoading || !p) return <div className="odoo-scope"><LoadingState bare label="Chargement du projet…" /></div>;

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
    ...purchases.map(i => ({ at: i.invoice_date, text: `Facture ${i.invoice_number} rattachée (${money(i.amount, { decimals: 0 })})` })),
    { at: p.created_at, text: `Projet créé${p.created_by_name ? ` par ${p.created_by_name}` : ''}` },
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  // Rentabilité : achats + main-d'œuvre + marge, sur la plus grande des deux bornes.
  const scale = Math.max(revenue, totalCost) || 1;
  const seg = (v: number) => `${Math.max(v, 0) / scale * 100}%`;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <button type="button" className="ds-icon-btn" aria-label="Retour aux projets" onClick={() => navigate('/projects?tab=projects')}><ArrowLeft size={16} aria-hidden="true" /></button>
        <Breadcrumb icon={FolderKanban} items={[
          { label: 'Projets', onClick: () => navigate('/projects') },
          { label: 'Projets', onClick: () => navigate('/projects?tab=projects') },
          { label: <span className="ds-ref">{p.number}</span> },
        ]} />
        <div style={{ flex: 1 }} />
        {editable && (
          <>
            <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(true)}><Pencil size={13} /> Modifier</button>
            {['draft', 'active', 'on_hold'].includes(p.status) && (
              <button type="button" className="ds-btn-danger" onClick={async () => { if (await confirm('Annuler ce projet ?', { title: 'Annuler le projet', confirmLabel: 'Annuler le projet', cancelLabel: 'Retour', danger: true })) setStatus.mutate('cancelled'); }}><XCircle size={13} aria-hidden="true" /> Annuler le projet</button>
            )}
            {p.status === 'active' && <button type="button" className="odoo-btn-secondary" onClick={() => setStatus.mutate('on_hold')}><PauseCircle size={13} /> Mettre en pause</button>}
            {p.status === 'draft' && <button type="button" className="odoo-btn-primary" onClick={() => setStatus.mutate('active')}><PlayCircle size={13} /> Lancer</button>}
            {p.status === 'on_hold' && <button type="button" className="odoo-btn-primary" onClick={() => setStatus.mutate('active')}><PlayCircle size={13} /> Reprendre</button>}
            {p.status === 'active' && <button type="button" className="odoo-btn-primary" onClick={() => setStatus.mutate('completed')}><CheckCircle2 size={13} /> Terminer</button>}
            {p.status === 'completed' && <button type="button" className="odoo-btn-secondary" onClick={() => setStatus.mutate('active')}><RotateCcw size={13} /> Rouvrir</button>}
            {p.status === 'cancelled' && <button type="button" className="odoo-btn-secondary" onClick={() => setStatus.mutate('draft')}><RotateCcw size={13} /> Repasser en brouillon</button>}
          </>
        )}
      </div>

      <div className="prj prj-detail">
        {p.is_overdue && <StatusBanner tone="danger" icon={XCircle} title="Échéance dépassée">Prévu pour le {format(new Date(p.due_date!), 'd MMMM yyyy', { locale: fr })}.</StatusBanner>}

        <section className="prj-panel prj-hero">
          <div className="prj-hero-top">
            <div className="prj-hero-icon"><FolderKanban size={24} /></div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1>{p.name}</h1>
                <StatusTag tone={STATUS_TONE[p.status] ?? 'draft'} icon={p.status === 'on_hold' ? PauseCircle : undefined} label={PROJECT_STATUS_LABELS[p.status] ?? p.status} />
              </div>
              <div className="prj-hero-meta">
                <span className="ds-ref">{p.number}</span>
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
            {p.task_late > 0 && <div className="prj-kpi-sub" style={{ color: 'var(--ds-danger)' }}>{p.task_late} en retard</div>}
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Temps passé</span><span>{p.estimated_hours ? `prévu ${h1(p.estimated_hours)} h` : 'sans prévision'}</span></div>
            <div className="prj-kpi-value">{h1(p.hours_spent)} h</div>
            <div className={`prj-bar ${usageTone(hoursPct)}`}><span style={{ width: `${Math.min(hoursPct, 100)}%` }} /></div>
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Coûts engagés</span><span>{use && use.label !== 'Heures / prévu' ? `sur ${use.of}` : 'MO + achats'}</span></div>
            <div className="prj-kpi-value">{money(totalCost, { decimals: 0 })}</div>
            {use && use.label !== 'Heures / prévu'
              ? <div className={`prj-bar ${usageTone(use.pct)}`}><span style={{ width: `${Math.min(use.pct, 100)}%` }} /></div>
              : <div className="prj-kpi-sub">MO {n0(laborCost)} · achats {n0(externalCost)}</div>}
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Marge</span><span>{BILLING_LABELS[p.billing_type]}</span></div>
            <div className="prj-kpi-value" style={{ color: revenue ? (margin < 0 ? 'var(--ds-danger)' : 'var(--ds-success)') : undefined }}>{revenue ? money(margin, { decimals: 0 }) : '—'}</div>
            <div className="prj-kpi-sub">{revenue ? `${Math.round((margin / revenue) * 100)} % de ${money(revenue, { decimals: 0 })}` : 'projet non facturé'}</div>
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
                  {editable && <button type="button" className="odoo-btn-secondary" onClick={() => setTaskModal({})}><Plus size={12} /> Tâche</button>}
                </div>
              )}
              {tab === 'purchases' && editable && <button type="button" className="odoo-btn-secondary" onClick={() => setLinkModal(true)}><Link2 size={12} /> Rattacher une facture</button>}
            </div>

            <div className="prj-tab-body">
              {tab === 'tasks' && (tasks.length === 0 ? (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-muted)' }}>Aucune tâche. Découpez le projet en étapes à affecter.</p>
              ) : taskLayout === 'board' ? (
                <TaskBoard tasks={tasks} editable={editable} onMove={(taskId, status) => setTaskStatus.mutate({ taskId, status })}
                  onOpen={t => editable && setTaskModal({ task: t })} />
              ) : (
                <DataPanel>
                  <table className="odoo-table">
                    <thead><tr><th style={{ width: 40 }} /><th>Tâche</th><th>Affectée à</th><th>Priorité</th><th>Échéance</th><th className="ds-num">Heures (h)</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
                    <tbody>{tasks.map(t => (
                      <tr key={t.id} style={{ opacity: t.status === 'cancelled' ? 0.5 : 1 }}>
                        <td><input type="checkbox" aria-label={`Fait : ${t.title}`} checked={t.status === 'done'} disabled={!editable} onChange={e => setTaskStatus.mutate({ taskId: t.id, status: e.target.checked ? 'done' : 'todo' })} /></td>
                        <td onClick={() => editable && setTaskModal({ task: t })} style={{ cursor: editable ? 'pointer' : 'default' }}>
                          <span className="ds-strong" style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
                          {t.description && <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{t.description}</div>}
                        </td>
                        <td>{t.assignee_name || '—'}</td>
                        <td><span className={`odoo-tag ${PRIORITY_TAG[t.priority]}`}>{PRIORITY_LABELS[t.priority]}</span></td>
                        <td style={{ color: t.is_overdue ? 'var(--ds-danger)' : undefined, fontWeight: t.is_overdue ? 600 : 400 }}>{t.due_date ? format(new Date(t.due_date), 'd MMM yyyy', { locale: fr }) : '—'}</td>
                        <td className="ds-num">{h1(t.hours_spent)}{t.estimated_hours ? ` / ${h1(t.estimated_hours)}` : ''}</td>
                        <td>
                          <select className="odoo-filter-dropdown" aria-label="Statut" value={t.status} disabled={!editable} onChange={e => setTaskStatus.mutate({ taskId: t.id, status: e.target.value as TaskStatus })}>
                            {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td className="ds-actions">{canDelete('projects') && <button type="button" className="ds-icon-btn" title="Supprimer" aria-label={`Supprimer ${t.title}`} onClick={async () => { if (await confirm(`Supprimer la tâche « ${t.title} » ?`, { title: 'Supprimer la tâche', confirmLabel: 'Supprimer', danger: true })) delTask.mutate(t.id); }}><Trash2 size={15} aria-hidden="true" /></button>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </DataPanel>
              ))}

              {tab === 'time' && (
                <>
                  {editable && isOpen && <TimeEntryForm projectId={p.id} tasks={tasks} compact />}
                  {!time?.rows.length ? <EmptyState bare icon={Timer} title="Aucune heure déclarée" /> : (
                    <DataPanel>
                      <table className="odoo-table">
                        <thead><tr><th>Date</th><th>Personne</th><th>Tâche ou activité</th><th>Note</th><th className="ds-num">Heures (h)</th><th className="ds-num">Coût ({currencySymbol()})</th><th className="ds-num">Facturable ({currencySymbol()})</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
                        <tbody>{time.rows.map(t => (
                          <tr key={t.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(t.work_date), 'EEE d MMM', { locale: fr })}</td>
                            <td>{t.employee_name}</td>
                            <td>{t.task_title || t.activity_label || '—'}</td>
                            <td style={{ color: 'var(--ds-muted)' }}>{t.note || ''}</td>
                            <td className="ds-num">{h1(t.hours)}</td>
                            <td className="ds-num">{n2(t.cost)}</td>
                            <td className="ds-num">{t.billable ? n2(t.amount) : <span style={{ color: 'var(--ds-muted)' }}>non fact.</span>}</td>
                            <td className="ds-actions">{!t.invoice_id && canDelete('projects') && <button type="button" className="ds-icon-btn" title="Supprimer" aria-label="Supprimer la saisie" onClick={async () => { if (await confirm('Supprimer cette saisie de temps ?', { title: 'Supprimer la saisie', confirmLabel: 'Supprimer', danger: true })) delTime.mutate(t.id); }}><Trash2 size={15} aria-hidden="true" /></button>}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </DataPanel>
                  )}
                </>
              )}

              {tab === 'purchases' && (!invoices?.length ? (
                <EmptyState bare icon={Link2} title="Aucune facture rattachée" text="Le coût des factures rattachées entre dans la marge du projet." />
              ) : (
                <DataPanel>
                  <table className="odoo-table">
                    <thead><tr><th>Facture</th><th>Type</th><th>Fournisseur ou catégorie</th><th>Date</th><th>Statut</th><th className="ds-num">Montant HT ({currencySymbol()})</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
                    <tbody>{invoices.map(inv => (
                      <tr key={inv.id}>
                        <td className="ds-ref">{inv.invoice_number}</td>
                        <td><span className={`odoo-tag ${inv.invoice_type === 'received' ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{inv.invoice_type === 'received' ? 'Coût' : 'Produit'}</span></td>
                        <td>{inv.supplier_name || inv.category_name || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(inv.invoice_date), 'd MMM yyyy', { locale: fr })}</td>
                        <td>{inv.status === 'cancelled' ? <StatusTag tone="cancelled" label="Annulée" /> : <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{inv.status}</span>}</td>
                        <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{n2(inv.amount)}</td>
                        <td className="ds-actions">{editable && <button type="button" className="ds-icon-btn" title="Détacher" aria-label={`Détacher ${inv.invoice_number}`} onClick={async () => { if (await confirm(`Détacher la facture ${inv.invoice_number} du projet ?`)) unlinkInvoice.mutate(inv.id); }}><Trash2 size={15} aria-hidden="true" /></button>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </DataPanel>
              ))}

              {tab === 'notes' && (
                <div style={{ display: 'grid', gap: 12, fontSize: '14px' }}>
                  {p.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.description}</p>}
                  {p.notes && <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--ds-muted)' }}>{p.notes}</p>}
                </div>
              )}
            </div>
          </section>

          <aside className="prj-aside">
            <section className="prj-panel">
              <h2>Rentabilité</h2>
              <div className="prj-stack" aria-hidden="true">
                <span style={{ width: seg(externalCost), background: 'var(--ds-accent)' }} />
                <span style={{ width: seg(laborCost), background: 'color-mix(in srgb, var(--ds-accent) 45%, transparent)' }} />
                {margin > 0 && <span style={{ width: seg(margin), background: 'var(--ds-success)' }} />}
              </div>
              <dl className="prj-legend">
                <dt><span className="prj-swatch" style={{ background: 'var(--ds-accent)' }} />Achats rattachés</dt><dd>{money(externalCost, { decimals: 0 })}</dd>
                <dt><span className="prj-swatch" style={{ background: 'color-mix(in srgb, var(--ds-accent) 45%, transparent)' }} />Main-d’œuvre ({h1(p.hours_spent)} h)</dt><dd>{money(laborCost, { decimals: 0 })}</dd>
                {Number(p.committed_purchases || 0) > 0 && <>
                  <dt><span className="prj-swatch" style={{ background: 'var(--ds-border-strong, #CBD5E1)' }} />Commandes engagées (reçu {money(Number(p.received_purchases || 0), { decimals: 0 })})</dt>
                  <dd>{money(Number(p.committed_purchases), { decimals: 0 })}</dd>
                </>}
                {revenue > 0 && <>
                  <dt><span className="prj-swatch" style={{ background: margin < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }} />{margin < 0 ? 'Perte' : 'Marge'}</dt>
                  <dd style={{ color: margin < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{money(margin, { decimals: 0 })}</dd>
                </>}
              </dl>
              <div style={{ fontSize: '13px', color: 'var(--ds-muted)', borderTop: '1px solid var(--ds-sep)', paddingTop: 10 }}>
                {revenue > 0 ? `${p.billing_type === 'fixed' ? 'Forfait' : 'Facturable'} ${money(revenue, { decimals: 0 })}` : 'Projet non facturé'}
                {p.billing_type === 'time' && Number(p.unbilled_amount) > 0 ? ` · reste à facturer ${money(p.unbilled_amount, { decimals: 0 })}` : ''}
              </div>
            </section>

            <section className="prj-panel">
              <h2>Informations</h2>
              <dl className="prj-dl">
                <dt>Dates</dt><dd>{fmtDay(p.start_date) ?? '…'} → {fmtDay(p.due_date) ?? '…'}</dd>
                <dt>Facturation</dt><dd>{BILLING_LABELS[p.billing_type]}{p.billing_type === 'time' && p.hourly_rate ? ` · ${money(p.hourly_rate)}/h` : ''}</dd>
                {p.billing_type !== 'fixed' && p.budget_amount && <><dt>Budget</dt><dd>{money(p.budget_amount, { decimals: 0 })}</dd></>}
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
    <Modal title="Rattacher une facture" onClose={onClose} width={680}
      footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="search" className="ds-input" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher une facture" placeholder="N° de facture ou fournisseur…" />
          <div>
            {isLoading ? <LoadingState bare />
              : rows.length === 0 ? <EmptyState bare icon={Link2} title="Aucune facture disponible" text="Les factures déjà rattachées à un autre projet ou annulées ne sont pas listées." />
              : (
                <DataPanel label="Factures disponibles">
                <table className="odoo-table ds-dense">
                  <thead><tr><th>Facture</th><th>Type</th><th>Fournisseur</th><th>Date</th><th className="ds-num">Montant HT ({currencySymbol()})</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
                  <tbody>{rows.map((inv: ProjectInvoice) => (
                    <tr key={inv.id}>
                      <td className="ds-ref">{inv.invoice_number}</td>
                      <td><span className={`odoo-tag ${inv.invoice_type === 'received' ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{inv.invoice_type === 'received' ? 'Coût' : 'Produit'}</span></td>
                      <td>{inv.supplier_name || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(inv.invoice_date), 'd MMM yyyy', { locale: fr })}</td>
                      <td className="ds-num">{n2(inv.amount)}</td>
                      <td className="ds-actions">
                        {inv.project_id === projectId
                          ? <StatusTag tone="done" label="Rattachée" />
                          : <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={link.isPending} onClick={() => link.mutate(inv.id)}><Plus size={12} /> Rattacher</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
                </DataPanel>
              )}
          </div>
        </div>
    </Modal>
  );
}
