import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FolderKanban, ArrowLeft, Pencil, PlayCircle, PauseCircle, CheckCircle2, XCircle, RotateCcw, Plus, Trash2, Loader2, ListChecks, Timer, Receipt, Link2, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  projectsApi, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, BILLING_LABELS, PRIORITY_LABELS, type ProjectStatus, type Task, type TaskStatus, type ProjectInvoice,
} from '../../api/projects.api';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { ProjectFormModal, TaskFormModal, TimeEntryForm, n2, h1, PRIORITY_TAG } from './shared';

/** Fiche d'un projet (mig 358) : avancement, tâches, temps passé. Pleine page, hors coquille. */
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
  const refresh = () => { qc.invalidateQueries({ queryKey: ['project', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['project-time'] }); qc.invalidateQueries({ queryKey: ['project-tasks'] }); qc.invalidateQueries({ queryKey: ['project-invoices', id] }); };
  const unlinkInvoice = useMutation({ mutationFn: (invId: string) => projectsApi.unlinkInvoice(id, invId), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const setStatus = useMutation({ mutationFn: (s: ProjectStatus) => projectsApi.setStatus(id, s), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const setTaskStatus = useMutation({ mutationFn: (x: { taskId: string; status: TaskStatus }) => projectsApi.updateTask(x.taskId, { status: x.status }), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const delTask = useMutation({ mutationFn: (taskId: string) => projectsApi.deleteTask(taskId), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const delTime = useMutation({ mutationFn: (tid: string) => projectsApi.deleteTime(tid), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });

  if (isLoading || !p) return <div className="odoo-scope" style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" /></div>;

  const pct = p.task_count ? Math.round((p.task_done / p.task_count) * 100) : 0;
  const laborCost = Number(p.cost_spent);
  const externalCost = Number(p.external_cost || 0);
  const totalCost = laborCost + externalCost;
  const revenue = p.billing_type === 'fixed' ? Number(p.budget_amount ?? 0) : p.billing_type === 'time' ? Number(p.billable_amount) : 0;
  const margin = revenue - totalCost;
  const kpi = (label: string, value: string, sub?: string, tone?: 'danger' | 'ok') => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ color: tone === 'danger' ? '#dc3545' : tone === 'ok' ? '#28a745' : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{sub}</div>}
    </div>
  );
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: '0.8125rem', padding: '3px 0' }}>
      <span style={{ color: 'var(--theme-text-muted)' }}>{k}</span><span>{v ?? '—'}</span>
    </div>
  );
  const tasks = p.tasks ?? [];

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <button className="odoo-btn-secondary" onClick={() => navigate('/projects?tab=projects')}><ArrowLeft size={14} /></button>
        <div className="odoo-breadcrumb">
          <FolderKanban size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Projets</span><span className="odoo-breadcrumb-separator">›</span>
          <span className="font-mono">{p.number}</span><span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{p.name}</span>
          <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 8 }}>{PROJECT_STATUS_LABELS[p.status]}</span>
          <span className={`odoo-tag ${PRIORITY_TAG[p.priority]}`}>{PRIORITY_LABELS[p.priority]}</span>
        </div>
        <div style={{ flex: 1 }} />
        {editable && (
          <>
            {p.status === 'draft' && <button className="odoo-btn-primary" onClick={() => setStatus.mutate('active')}><PlayCircle size={13} /> Lancer</button>}
            {p.status === 'active' && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('on_hold')}><PauseCircle size={13} /> Mettre en pause</button>}
            {p.status === 'on_hold' && <button className="odoo-btn-primary" onClick={() => setStatus.mutate('active')}><PlayCircle size={13} /> Reprendre</button>}
            {p.status === 'active' && <button className="odoo-btn-primary" onClick={() => setStatus.mutate('completed')}><CheckCircle2 size={13} /> Terminer</button>}
            {['draft', 'active', 'on_hold'].includes(p.status) && (
              <button className="odoo-btn-secondary" onClick={async () => { if (await confirm('Annuler ce projet ?', { title: 'Annuler le projet', danger: true })) setStatus.mutate('cancelled'); }}><XCircle size={13} /> Annuler</button>
            )}
            {p.status === 'completed' && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('active')}><RotateCcw size={13} /> Rouvrir</button>}
            {p.status === 'cancelled' && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate('draft')}><RotateCcw size={13} /> Repasser en brouillon</button>}
            <button className="odoo-btn-secondary" onClick={() => setEditing(true)}><Pencil size={13} /> Modifier</button>
          </>
        )}
      </div>

      <div style={{ padding: '16px 20px', display: 'grid', gap: 16 }}>
        {p.is_overdue && <StatusBanner tone="danger" icon={XCircle} title="Échéance dépassée">Prévu pour le {format(new Date(p.due_date!), 'dd MMMM yyyy', { locale: fr })}.</StatusBanner>}

        <div className="odoo-stat-grid">
          {kpi('Avancement', `${pct} %`, `${p.task_done}/${p.task_count} tâches${p.task_late ? ` · ${p.task_late} en retard` : ''}`, p.task_late ? 'danger' : undefined)}
          {kpi('Heures', `${h1(p.hours_spent)} h`, p.estimated_hours ? `sur ${h1(p.estimated_hours)} h prévues` : 'aucune prévision')}
          {kpi('Coût réel', `${n2(totalCost)} DH`, externalCost > 0 ? `MO ${n2(laborCost)} · achats/charges ${n2(externalCost)}` : 'main d’œuvre (heures × coût)')}
          {kpi(p.billing_type === 'fixed' ? 'Forfait' : 'Facturable', revenue ? `${n2(revenue)} DH` : '—', BILLING_LABELS[p.billing_type])}
          {kpi('Marge', revenue ? `${n2(margin)} DH` : '—', revenue ? `${Math.round((margin / revenue) * 100)} %` : 'pas de facturation', revenue ? (margin < 0 ? 'danger' : 'ok') : undefined)}
          {p.billing_type === 'time' && kpi('Reste à facturer', `${n2(p.unbilled_amount)} DH`, `${h1(p.unbilled_hours)} h non facturées`)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          <div>
            {row('Client', p.customer_label || 'Interne')}
            {row('Responsable', p.manager_name)}
            {row('Dates', `${p.start_date ? format(new Date(p.start_date), 'dd/MM/yyyy') : '…'} → ${p.due_date ? format(new Date(p.due_date), 'dd/MM/yyyy') : '…'}`)}
          </div>
          <div>
            {row('Facturation', `${BILLING_LABELS[p.billing_type]}${p.billing_type === 'time' && p.hourly_rate ? ` · ${n2(p.hourly_rate)} DH/h` : ''}`)}
            {row('Budget', p.budget_amount ? `${n2(p.budget_amount)} DH` : null)}
            {row('Créé le', `${format(new Date(p.created_at), 'dd/MM/yyyy')} par ${p.created_by_name || '—'}`)}
          </div>
        </div>
        {p.description && <p style={{ margin: 0, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{p.description}</p>}

        {/* Tâches */}
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ListChecks size={12} /> Tâches
            <div style={{ flex: 1 }} />
            {editable && <button className="odoo-btn-secondary" onClick={() => setTaskModal({})}><Plus size={12} /> Tâche</button>}
          </div>
          {tasks.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune tâche. Découpez le projet en étapes à affecter.</p> : (
            <table className="odoo-table">
              <thead><tr><th style={{ width: 40 }} /><th>Tâche</th><th>Affectée à</th><th>Priorité</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Heures</th><th>Statut</th><th /></tr></thead>
              <tbody>{tasks.map(t => (
                <tr key={t.id} style={{ opacity: t.status === 'cancelled' ? 0.5 : 1 }}>
                  <td><input type="checkbox" checked={t.status === 'done'} disabled={!editable} onChange={e => setTaskStatus.mutate({ taskId: t.id, status: e.target.checked ? 'done' : 'todo' })} /></td>
                  <td onClick={() => editable && setTaskModal({ task: t })} style={{ cursor: editable ? 'pointer' : 'default' }}>
                    <strong style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</strong>
                    {t.description && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{t.description}</div>}
                  </td>
                  <td>{t.assignee_name || '—'}</td>
                  <td><span className={`odoo-tag ${PRIORITY_TAG[t.priority]}`}>{PRIORITY_LABELS[t.priority]}</span></td>
                  <td style={{ color: t.is_overdue ? '#dc3545' : undefined, fontWeight: t.is_overdue ? 600 : 400 }}>{t.due_date ? format(new Date(t.due_date), 'dd/MM/yyyy') : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{h1(t.hours_spent)}{t.estimated_hours ? ` / ${h1(t.estimated_hours)}` : ''}</td>
                  <td>
                    <select className="odoo-filter-dropdown" value={t.status} disabled={!editable} onChange={e => setTaskStatus.mutate({ taskId: t.id, status: e.target.value as TaskStatus })}>
                      {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>{canDelete('projects') && <button className="odoo-btn-secondary" title="Supprimer" onClick={async () => { if (await confirm(`Supprimer la tâche « ${t.title} » ?`, { danger: true })) delTask.mutate(t.id); }}><Trash2 size={12} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        {/* Temps passé */}
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><Timer size={12} /> Temps passé</div>
          {editable && ['draft', 'active', 'on_hold'].includes(p.status) && <TimeEntryForm projectId={p.id} tasks={tasks} compact />}
          {!time?.rows.length ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', marginTop: 8 }}>Aucune heure déclarée.</p> : (
            <table className="odoo-table" style={{ marginTop: 8 }}>
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
                  <td>{!t.invoice_id && canDelete('projects') && <button className="odoo-btn-secondary" title="Supprimer" onClick={() => delTime.mutate(t.id)}><Trash2 size={12} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        {/* Achats & charges rattachés (mig 390) */}
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt size={12} /> Achats &amp; charges
            <div style={{ flex: 1 }} />
            {editable && <button className="odoo-btn-secondary" onClick={() => setLinkModal(true)}><Link2 size={12} /> Rattacher une facture</button>}
          </div>
          {!invoices?.length ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune facture rattachée. Rattachez les factures fournisseurs (matières, sous-traitance, charges) pour que leur coût entre dans la marge du projet.</p>
          ) : (
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
                  <td>{editable && <button className="odoo-btn-secondary" title="Détacher" onClick={async () => { if (await confirm(`Détacher la facture ${inv.invoice_number} du projet ?`)) unlinkInvoice.mutate(inv.id); }}><Trash2 size={12} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
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
