import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, Wrench, CalendarClock, BarChart3, Building2, Plus, Search, Loader2, CheckCircle2, AlertTriangle, Clock, PlayCircle, XCircle, RotateCcw, X, Send, CalendarPlus, Pencil,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  maintenanceApi, KIND_LABELS, STATUS_LABELS, PRIORITY_LABELS, type Intervention, type InterventionStatus, type InterventionKind, type MaintenancePlan,
} from '../../api/maintenance.api';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ModuleShell, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import { StagePipeline, PeriodFilter, Pager, PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef } from '../../components/purchasing/ProcessBoard';
import { InterventionFormModal, PlanFormModal, n2, PRIORITY_TAG } from './forms';

/**
 * Module Maintenance (mig 359), rubriques standard : tableau de bord, interventions,
 * plans d'entretien ; coût par équipement en rapport ; immobilisations en paramétrage.
 * Générique : matériel interne (immobilisations) ou équipement chez le client.
 */
type View = 'overview' | 'interventions' | 'plans' | 'equipment' | 'assets';
const STATUS_TAG: Record<InterventionStatus, string> = { requested: 'odoo-tag-orange', scheduled: 'odoo-tag-blue', in_progress: 'odoo-tag-purple', done: 'odoo-tag-green', cancelled: 'odoo-tag-grey' };
const STAGES: Array<StageDef & { key: InterventionStatus }> = [
  { key: 'requested', label: 'À planifier', hint: 'demandées', icon: AlertTriangle },
  { key: 'scheduled', label: 'Planifiées', hint: 'date fixée', icon: CalendarClock },
  { key: 'in_progress', label: 'En cours', hint: 'intervenant sur place', icon: PlayCircle },
  { key: 'done', label: 'Terminées', hint: 'compte rendu fait', icon: CheckCircle2 },
  { key: 'cancelled', label: 'Annulées', hint: 'sans suite', icon: XCircle },
];

export default function MaintenancePage() {
  const { hasModule } = usePermissions();
  const [params, setParams] = useSearchParams();
  const views: ModuleView<View>[] = [
    { key: 'overview', label: 'Tableau de bord', icon: LayoutDashboard, section: 'dashboard' },
    { key: 'interventions', label: 'Interventions', icon: Wrench, section: 'operations' },
    { key: 'plans', label: "Plans d'entretien", icon: CalendarClock, section: 'operations' },
    { key: 'equipment', label: 'Coût par équipement', icon: BarChart3, section: 'reports' },
    { key: 'assets', label: 'Immobilisations', icon: Building2, section: 'setup', href: '/accounting?tab=immobilisations', external: true, hidden: !hasModule('accounting') },
  ];
  const { current, select } = useModuleView(views);
  const [creating, setCreating] = useState(false);
  const openId = params.get('open');
  const setOpenId = (id: string | null) => { const n = new URLSearchParams(params); if (id) n.set('open', id); else n.delete('open'); setParams(n); };

  return (
    <ModuleShell title="Maintenance" views={views} current={current} onSelect={select}
      actions={current?.key !== 'plans' && current?.key !== 'equipment' ? <button className="odoo-btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouvelle intervention</button> : undefined}>
      {current?.key === 'overview' && <Overview onOpen={setOpenId} />}
      {current?.key === 'interventions' && <InterventionList onOpen={setOpenId} />}
      {current?.key === 'plans' && <Plans onOpen={setOpenId} />}
      {current?.key === 'equipment' && <EquipmentReport />}
      {creating && <InterventionFormModal onClose={() => setCreating(false)} onCreated={id => setOpenId(id)} />}
      {openId && <InterventionDrawer id={openId} onClose={() => setOpenId(null)} />}
    </ModuleShell>
  );
}

function Loading() { return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} /></div>; }

function When({ i }: { i: Intervention }) {
  if (!i.scheduled_at || !['requested', 'scheduled'].includes(i.status)) return <span style={{ color: 'var(--theme-text-muted)' }}>{i.completed_at ? format(new Date(i.completed_at), 'dd/MM/yyyy') : '—'}</span>;
  const d = new Date(i.scheduled_at);
  return <span style={{ color: i.is_overdue ? '#dc3545' : undefined, fontWeight: i.is_overdue ? 600 : 400 }}>{format(d, 'dd/MM HH:mm')}{i.is_overdue ? ` · en retard (${formatDistanceToNow(d, { locale: fr })})` : ''}</span>;
}

function Row({ i, onOpen }: { i: Intervention; onOpen: (id: string) => void }) {
  return (
    <tr onClick={() => onOpen(i.id)} style={{ cursor: 'pointer' }}>
      <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{i.number}</td>
      <td><strong>{i.title}</strong><div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{KIND_LABELS[i.kind]}{i.under_warranty ? ' · garantie' : ''}</div></td>
      <td>{i.equipment_name}{i.serial_no ? <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> · {i.serial_no}</span> : null}</td>
      <td>{i.customer_label || <span style={{ color: 'var(--theme-text-muted)' }}>interne</span>}</td>
      <td><span className={`odoo-tag ${PRIORITY_TAG[i.priority]}`}>{PRIORITY_LABELS[i.priority]}</span></td>
      <td><span className={`odoo-tag ${STATUS_TAG[i.status]}`}>{STATUS_LABELS[i.status]}</span></td>
      <td style={{ whiteSpace: 'nowrap' }}><When i={i} /></td>
      <td>{i.assignee_name || '—'}</td>
      <td style={{ textAlign: 'right' }}>{i.status === 'done' ? n2(i.total_cost) : '—'}</td>
    </tr>
  );
}

function InterventionList({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<InterventionStatus | ''>('');
  const [kind, setKind] = useState<InterventionKind | ''>('');
  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, kind, search]);
  const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
  if (status) params.status = status; if (kind) params.kind = kind; if (search) params.search = search;
  const { data, isLoading } = useQuery({ queryKey: ['maintenance', 'list', params], queryFn: () => maintenanceApi.list(params) });
  const by = data?.byStatus ?? {};
  const open = (by.requested?.count ?? 0) + (by.scheduled?.count ?? 0) + (by.in_progress?.count ?? 0);
  return (
    <>
      <StagePipeline title="Où en sont les interventions" summary={`${open} ouvertes · ${(by.requested?.overdue ?? 0) + (by.scheduled?.overdue ?? 0)} en retard`}
        stages={STAGES} stats={Object.fromEntries(STAGES.map(s => [s.key, { count: by[s.key]?.count ?? 0, sub: '', late: by[s.key]?.overdue ?? 0, alertLabel: 'en retard' }]))}
        isActive={k => status === k} onPick={k => setStatus(status === k ? '' : (k as InterventionStatus))} />
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="N°, objet, équipement, n° de série, client…" />
        <select className="odoo-filter-dropdown" value={kind} onChange={e => setKind(e.target.value as InterventionKind | '')}>
          <option value="">Tous types</option>
          {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {isLoading ? <Loading /> : !data?.rows.length ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Aucune intervention">Rien sur ces filtres.</StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Objet</th><th>Équipement</th><th>Client</th><th>Priorité</th><th>Statut</th><th>Quand</th><th>Intervenant</th><th style={{ textAlign: 'right' }}>Coût</th></tr></thead>
            <tbody>{data.rows.map(i => <Row key={i.id} i={i} onOpen={onOpen} />)}</tbody>
          </table>
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} intervention${data.total > 1 ? 's' : ''}`} />
        </div>
      )}
    </>
  );
}

function Overview({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<PeriodKey>('month'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const range = periodParams(period, from, to);
  const { data, isLoading } = useQuery({ queryKey: ['maintenance', 'overview', range], queryFn: () => maintenanceApi.overview(range) });
  const { data: urgent } = useQuery({ queryKey: ['maintenance', 'list', 'urgent'], queryFn: () => maintenanceApi.list({ pageSize: '8' }) });
  const fromPlan = useMutation({ mutationFn: (id: string) => maintenanceApi.createFromPlan(id), onSuccess: i => { qc.invalidateQueries({ queryKey: ['maintenance'] }); onOpen(i.id); }, onError: e => notify.error(apiErrorMessage(e)) });
  if (isLoading || !data) return <Loading />;
  const kpi = (l: string, v: string, sub?: string, danger?: boolean) => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}><div className="odoo-stat-card-label">{l}</div><div className="odoo-stat-card-value" style={{ color: danger ? '#dc3545' : undefined }}>{v}</div>{sub && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{sub}</div>}</div>
  );
  const openRows = (urgent?.rows ?? []).filter(i => ['requested', 'scheduled', 'in_progress'].includes(i.status));
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <PeriodFilter label="Terminées" title="Période des interventions terminées" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        <strong style={{ fontSize: '0.8125rem' }}>{periodLabel(period, from, to)}</strong>
      </div>
      <div className="odoo-stat-grid">
        {kpi('À planifier', String(data.interventions.requested), `${data.interventions.critical} critique(s)`, data.interventions.critical > 0)}
        {kpi('Planifiées / en cours', String(data.interventions.scheduled + data.interventions.in_progress), `${data.interventions.overdue} en retard`, data.interventions.overdue > 0)}
        {kpi('Entretiens à échéance', String(data.plans.overdue + data.plans.due_soon), `${data.plans.overdue} dépassé(s) · ${data.plans.active} plans actifs`, data.plans.overdue > 0)}
        {kpi('Terminées sur la période', String(data.done.count), `${data.done.preventive} préventives · ${data.done.corrective} dépannages`)}
        {kpi('Coût sur la période', `${n2(data.done.cost)} DH`, 'pièces + main-d\'œuvre')}
        {kpi('Arrêt matériel', `${Number(data.done.downtime).toLocaleString('fr-FR')} h`, 'temps d\'indisponibilité')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><Wrench size={12} /> Interventions ouvertes</div>
          {openRows.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune intervention ouverte.</p> : (
            <table className="odoo-table"><tbody>{openRows.map(i => (
              <tr key={i.id} onClick={() => onOpen(i.id)} style={{ cursor: 'pointer' }}>
                <td><strong>{i.title}</strong><div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{i.equipment_name}{i.customer_label ? ` · ${i.customer_label}` : ''}</div></td>
                <td><span className={`odoo-tag ${PRIORITY_TAG[i.priority]}`}>{PRIORITY_LABELS[i.priority]}</span></td>
                <td><span className={`odoo-tag ${STATUS_TAG[i.status]}`}>{STATUS_LABELS[i.status]}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}><When i={i} /></td>
              </tr>
            ))}</tbody></table>
          )}
        </div>
        <div>
          <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}><CalendarClock size={12} /> Entretiens à faire</div>
          {data.duePlans.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Rien à échéance sous 7 jours.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {data.duePlans.map(pl => (
                <li key={pl.id} style={{ fontSize: '0.8125rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {pl.is_overdue ? <AlertTriangle size={13} style={{ color: '#dc3545' }} /> : <Clock size={13} style={{ color: 'var(--theme-text-muted)' }} />}
                  <span style={{ flex: 1 }}><strong>{pl.label}</strong> <span style={{ color: 'var(--theme-text-muted)' }}>· {pl.equipment_name}</span></span>
                  <span style={{ color: pl.is_overdue ? '#dc3545' : 'var(--theme-text-muted)' }}>{format(new Date(pl.next_due_on), 'dd/MM')}</span>
                  <button className="odoo-btn-secondary" title="Créer l'intervention" disabled={pl.open_count > 0 || fromPlan.isPending} onClick={() => fromPlan.mutate(pl.id)}><CalendarPlus size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function Plans({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { canEdit } = usePermissions();
  const [modal, setModal] = useState<null | { plan?: MaintenancePlan }>(null);
  const { data: plans = [], isLoading } = useQuery({ queryKey: ['maintenance', 'plans'], queryFn: () => maintenanceApi.plans() });
  const fromPlan = useMutation({ mutationFn: (id: string) => maintenanceApi.createFromPlan(id), onSuccess: i => { qc.invalidateQueries({ queryKey: ['maintenance'] }); onOpen(i.id); }, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Entretien préventif : « tous les N jours, faire X sur tel équipement ». À l'échéance, créez l'intervention d'un clic ; une fois terminée, le plan se reprogramme.</span>
        <div style={{ flex: 1 }} />
        {canEdit('maintenance') && <button className="odoo-btn-primary" onClick={() => setModal({})}><Plus size={14} /> Nouveau plan</button>}
      </div>
      {isLoading ? <Loading /> : plans.length === 0 ? (
        <StatusBanner tone="info" icon={CalendarClock} title="Aucun plan d'entretien">Fours, chambres froides, pétrins, véhicules : définissez la fréquence de contrôle de chaque équipement.</StatusBanner>
      ) : (
        <table className="odoo-table">
          <thead><tr><th>Entretien</th><th>Équipement</th><th>Client</th><th>Fréquence</th><th>Dernier</th><th>Prochain</th><th>Intervenant</th><th /></tr></thead>
          <tbody>{plans.map(pl => (
            <tr key={pl.id} style={{ opacity: pl.is_active ? 1 : 0.5 }}>
              <td><strong>{pl.label}</strong>{!pl.is_active && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>inactif</span>}</td>
              <td>{pl.equipment_name}{pl.serial_no ? <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> · {pl.serial_no}</span> : null}</td>
              <td>{pl.customer_label || <span style={{ color: 'var(--theme-text-muted)' }}>interne</span>}</td>
              <td>tous les {pl.frequency_days} j</td>
              <td>{pl.last_done_on ? format(new Date(pl.last_done_on), 'dd/MM/yyyy') : '—'}</td>
              <td style={{ color: pl.is_overdue ? '#dc3545' : pl.is_due_soon ? '#d9822b' : undefined, fontWeight: pl.is_overdue ? 600 : 400 }}>{format(new Date(pl.next_due_on), 'dd/MM/yyyy')}</td>
              <td>{pl.assignee_name || '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {canEdit('maintenance') && <>
                  <button className="odoo-btn-secondary" title={pl.open_count > 0 ? 'Une intervention est déjà ouverte' : 'Créer l\'intervention'} disabled={pl.open_count > 0 || !pl.is_active} onClick={() => fromPlan.mutate(pl.id)}><CalendarPlus size={12} /></button>{' '}
                  <button className="odoo-btn-secondary" title="Modifier" onClick={() => setModal({ plan: pl })}><Pencil size={12} /></button>
                </>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {modal && <PlanFormModal plan={modal.plan} onClose={() => setModal(null)} />}
    </>
  );
}

function EquipmentReport() {
  const [period, setPeriod] = useState<PeriodKey>('12m'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const range = periodParams(period, from, to);
  const { data = [], isLoading } = useQuery({ queryKey: ['maintenance', 'equipment', range], queryFn: () => maintenanceApi.equipmentReport(range) });
  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <PeriodFilter label="Période" title="Interventions terminées ou créées" period={period} onPeriod={setPeriod} from={from} onFrom={setFrom} to={to} onTo={setTo} />
        <strong style={{ fontSize: '0.8125rem' }}>{periodLabel(period, from, to)}</strong>
      </div>
      {isLoading ? <Loading /> : data.length === 0 ? <StatusBanner tone="info" icon={BarChart3} title="Aucune intervention sur la période">Le coût par équipement apparaît dès la première intervention terminée.</StatusBanner> : (
        <table className="odoo-table">
          <thead><tr><th>Équipement</th><th>Client</th><th style={{ textAlign: 'right' }}>Interventions</th><th style={{ textAlign: 'right' }}>Dépannages</th><th style={{ textAlign: 'right' }}>Ouvertes</th><th style={{ textAlign: 'right' }}>Arrêt (h)</th><th style={{ textAlign: 'right' }}>Coût (DH)</th><th>Dernière</th></tr></thead>
          <tbody>{data.map((r, i) => (
            <tr key={i}>
              <td><strong>{r.equipment_name}</strong>{r.fixed_asset_id ? <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>immobilisation</span> : null}</td>
              <td>{r.customer_label || <span style={{ color: 'var(--theme-text-muted)' }}>interne</span>}</td>
              <td style={{ textAlign: 'right' }}>{r.count}</td>
              <td style={{ textAlign: 'right', color: r.corrective > 2 ? '#dc3545' : undefined }}>{r.corrective}</td>
              <td style={{ textAlign: 'right' }}>{r.open}</td>
              <td style={{ textAlign: 'right' }}>{Number(r.downtime).toLocaleString('fr-FR')}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{n2(r.cost)}</td>
              <td>{r.last_done_at ? format(new Date(r.last_done_at), 'dd/MM/yyyy') : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

/* ═══════════════════════ FICHE ═══════════════════════ */
function InterventionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canEdit } = usePermissions();
  const editable = canEdit('maintenance');
  const { data: i, isLoading } = useQuery({ queryKey: ['maintenance', 'one', id], queryFn: () => maintenanceApi.get(id) });
  const { data: people = [] } = useQuery({ queryKey: ['maintenance-people'], queryFn: maintenanceApi.people });
  const [note, setNote] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState('');
  const [done, setDone] = useState({ workDone: '', laborHours: '', laborRate: '', partsCost: '', downtimeHours: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['maintenance'] });
  const setStatus = useMutation({
    mutationFn: (p: Parameters<typeof maintenanceApi.setStatus>[1]) => maintenanceApi.setStatus(id, p),
    onSuccess: () => { refresh(); setFinishing(false); setScheduling(false); }, onError: e => notify.error(apiErrorMessage(e)),
  });
  const update = useMutation({ mutationFn: (p: Parameters<typeof maintenanceApi.update>[1]) => maintenanceApi.update(id, p), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const comment = useMutation({ mutationFn: () => maintenanceApi.comment(id, note.trim()), onSuccess: () => { refresh(); setNote(''); }, onError: e => notify.error(apiErrorMessage(e)) });
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, fontSize: '0.8125rem', padding: '3px 0' }}><span style={{ color: 'var(--theme-text-muted)' }}>{k}</span><span>{v ?? '—'}</span></div>
  );
  const assigneeRate = people.find(p => p.id === i?.assignee_id)?.cost_rate;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: 'min(700px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--theme-bg-card)', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)' }}>
        {isLoading || !i ? <Loading /> : (
          <>
            <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <div className="odoo-breadcrumb">
                <Wrench size={14} style={{ color: 'var(--theme-accent)' }} />
                <span className="font-mono">{i.number}</span>
                <span className={`odoo-tag ${STATUS_TAG[i.status]}`} style={{ marginLeft: 6 }}>{STATUS_LABELS[i.status]}</span>
                <span className={`odoo-tag ${PRIORITY_TAG[i.priority]}`}>{PRIORITY_LABELS[i.priority]}</span>
                <span className="odoo-tag odoo-tag-grey">{KIND_LABELS[i.kind]}</span>
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
              {i.is_overdue && <StatusBanner tone="danger" icon={Clock} title="Date planifiée dépassée">Prévue le {format(new Date(i.scheduled_at!), 'dd/MM/yyyy HH:mm')}.</StatusBanner>}

              {editable && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {['requested', 'scheduled'].includes(i.status) && <button className="odoo-btn-secondary" onClick={() => { setWhen(i.scheduled_at ? format(new Date(i.scheduled_at), "yyyy-MM-dd'T'HH:mm") : ''); setScheduling(true); }}><CalendarClock size={13} /> {i.status === 'scheduled' ? 'Replanifier' : 'Planifier'}</button>}
                  {['requested', 'scheduled'].includes(i.status) && <button className="odoo-btn-primary" onClick={() => setStatus.mutate({ status: 'in_progress' })}><PlayCircle size={13} /> Démarrer</button>}
                  {i.status === 'in_progress' && <button className="odoo-btn-primary" onClick={() => { setDone(d => ({ ...d, laborRate: d.laborRate || (assigneeRate ?? '') })); setFinishing(true); }}><CheckCircle2 size={13} /> Terminer</button>}
                  {['requested', 'scheduled', 'in_progress'].includes(i.status) && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate({ status: 'cancelled' })}><XCircle size={13} /> Annuler</button>}
                  {['done', 'cancelled'].includes(i.status) && <button className="odoo-btn-secondary" onClick={() => setStatus.mutate({ status: i.status === 'done' ? 'in_progress' : 'requested' })}><RotateCcw size={13} /> Rouvrir</button>}
                  {!['done', 'cancelled'].includes(i.status) && (
                    <select className="odoo-filter-dropdown" value={i.assignee_id ?? ''} onChange={e => update.mutate({ assigneeId: e.target.value || null })} title="Intervenant">
                      <option value="">Intervenant : à affecter</option>
                      {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
              )}

              {scheduling && (
                <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'flex', gap: 8, alignItems: 'end', background: 'var(--odoo-bg-alt)' }}>
                  <div style={{ flex: 1 }}><span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>Date et heure</span><input className="input" type="datetime-local" style={{ width: '100%' }} value={when} onChange={e => setWhen(e.target.value)} /></div>
                  <button className="odoo-btn-secondary" onClick={() => setScheduling(false)}>Annuler</button>
                  <button className="odoo-btn-primary" disabled={!when} onClick={() => setStatus.mutate({ status: 'scheduled', scheduledAt: new Date(when).toISOString() })}>Planifier</button>
                </div>
              )}

              {finishing && (
                <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'grid', gap: 10, background: 'var(--odoo-bg-alt)' }}>
                  <strong style={{ fontSize: '0.875rem' }}>Compte rendu</strong>
                  <textarea className="input" style={{ minHeight: 70 }} value={done.workDone} onChange={e => setDone({ ...done, workDone: e.target.value })} placeholder="Travail réalisé, pièces changées, état constaté…" />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {([['laborHours', 'Heures main-d\'œuvre'], ['laborRate', 'Taux horaire (DH)'], ['partsCost', 'Pièces (DH)'], ['downtimeHours', 'Arrêt matériel (h)']] as const).map(([k, l]) => (
                      <div key={k}><span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'block', marginBottom: 4 }}>{l}</span><input className="input" type="number" min="0" step="0.25" style={{ width: '100%' }} value={done[k]} onChange={e => setDone({ ...done, [k]: e.target.value })} /></div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="odoo-btn-secondary" onClick={() => setFinishing(false)}>Annuler</button>
                    <button className="odoo-btn-primary" disabled={!done.workDone.trim() || setStatus.isPending}
                      onClick={() => setStatus.mutate({ status: 'done', workDone: done.workDone.trim(),
                        laborHours: done.laborHours ? Number(done.laborHours) : null, laborRate: done.laborRate ? Number(done.laborRate) : null,
                        partsCost: done.partsCost ? Number(done.partsCost) : null, downtimeHours: done.downtimeHours ? Number(done.downtimeHours) : null })}>Terminer</button>
                  </div>
                </div>
              )}

              <div><h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>{i.title}</h3>{i.reported_problem && <p style={{ margin: 0, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>{i.reported_problem}</p>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                <div>
                  {row('Équipement', <>{i.equipment_name}{i.asset_label && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>immobilisation</span>}</>)}
                  {row('N° de série', i.serial_no)}
                  {row('Client', i.customer_label || 'Interne')}
                  {row('Lieu', i.location)}
                  {row('Origine', i.complaint_number ? <button className="odoo-btn-secondary" onClick={() => navigate(`/controle?tab=sav`)}>Réclamation {i.complaint_number}</button> : i.plan_label ? `Plan : ${i.plan_label}` : i.project_number ? `Projet ${i.project_number}` : null)}
                </div>
                <div>
                  {row('Intervenant', i.assignee_name)}
                  {row('Planifiée', i.scheduled_at ? format(new Date(i.scheduled_at), 'dd/MM/yyyy HH:mm') : null)}
                  {row('Démarrée', i.started_at ? format(new Date(i.started_at), 'dd/MM/yyyy HH:mm') : null)}
                  {row('Terminée', i.completed_at ? format(new Date(i.completed_at), 'dd/MM/yyyy HH:mm') : null)}
                  {row('Créée le', `${format(new Date(i.created_at), 'dd/MM/yyyy')} par ${i.created_by_name || '—'}`)}
                  {row('Garantie / refact.', `${i.under_warranty ? 'sous garantie' : 'hors garantie'} · ${i.billable ? 'refacturable' : 'non refacturable'}`)}
                </div>
              </div>

              {i.status === 'done' && (
                <StatusBanner tone="success" icon={CheckCircle2} title={`Terminée · coût ${n2(i.total_cost)} DH`}>
                  {i.work_done}<br />
                  <span style={{ fontSize: '0.75rem' }}>{Number(i.labor_hours ?? 0).toLocaleString('fr-FR')} h × {n2(i.labor_rate)} DH + pièces {n2(i.parts_cost)} DH{i.downtime_hours ? ` · arrêt ${Number(i.downtime_hours).toLocaleString('fr-FR')} h` : ''}</span>
                </StatusBanner>
              )}

              <div>
                <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Journal</div>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                  {(i.events ?? []).map(e => (
                    <li key={e.id} style={{ fontSize: '0.8125rem', display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                      <span style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(e.created_at), 'dd/MM HH:mm')}</span>
                      <span><strong>{e.by_name || '—'}</strong> · {eventLabel(e.event_type, e.from_value, e.to_value)}{e.note && <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{e.note}</span>}</span>
                    </li>
                  ))}
                </ol>
                {editable && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input className="input" style={{ flex: 1 }} value={note} onChange={e => setNote(e.target.value)} placeholder="Ajouter une note" onKeyDown={e => { if (e.key === 'Enter' && note.trim()) comment.mutate(); }} />
                    <button className="odoo-btn-secondary" disabled={!note.trim() || comment.isPending} onClick={() => comment.mutate()}><Send size={13} /></button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}

function eventLabel(type: string, from: string | null, to: string | null): string {
  switch (type) {
    case 'created': return `intervention créée (${KIND_LABELS[(to as InterventionKind)] ?? to})`;
    case 'status': return `${STATUS_LABELS[(from as InterventionStatus)] ?? from} → ${STATUS_LABELS[(to as InterventionStatus)] ?? to}`;
    case 'assigned': return 'intervenant affecté';
    case 'scheduled': return to ? `planifiée le ${format(new Date(to), 'dd/MM/yyyy HH:mm')}` : 'date retirée';
    case 'edited': return 'fiche modifiée';
    default: return 'note';
  }
}
