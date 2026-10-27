import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Target, Plus, Search, Loader2, X, Phone, CalendarClock, Mail, CheckSquare, StickyNote, Trophy, XCircle, FileSignature, UserPlus, Check, Trash2, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { crmApi, STAGES, STAGE_LABEL, ACTIVITY_LABEL, type Opportunity, type Stage, type ActivityKind, type OpportunityInput } from '../../api/crm.api';
import { customersApi } from '../../api/customers.api';
import { useCustomFieldsForm } from '../../api/custom-fields.api';
import CustomFieldsEditor from '../../components/custom-fields/CustomFieldsEditor';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { useReferentiel } from '../../hooks/useReferentiel';

/**
 * CRM (mig 371) : opportunités suivies avant le devis, du premier contact à la commande.
 * Tableau du pipeline par étape (glisser-déposer), liste, activités à faire.
 */
const n0 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fr = (v: string | null | undefined) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '—');
const frt = (v: string | null | undefined) => (v ? format(new Date(v), 'dd/MM HH:mm') : '');
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
const STAGE_COLOR: Record<Stage, string> = { new: '#6c757d', qualified: '#0d6efd', proposal: '#6f42c1', negotiation: '#d9822b', won: '#198754', lost: '#dc3545' };
const KIND_ICON: Record<ActivityKind, typeof Phone> = { call: Phone, meeting: CalendarClock, email: Mail, task: CheckSquare, note: StickyNote };
const OPEN_STAGES: Stage[] = ['new', 'qualified', 'proposal', 'negotiation'];

export default function CrmPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as 'pipeline' | 'list' | 'activities') || 'pipeline';
  const setView = (v: string) => { params.set('view', v); setParams(params, { replace: true }); };
  const [mine, setMine] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Opportunity | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get('opportunity'));
  const [losing, setLosing] = useState<Opportunity | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);

  const listParams: Record<string, string> = { limit: '300' };
  if (mine) listParams.mine = 'true';
  if (search) listParams.search = search;
  const { data: ov } = useQuery({ queryKey: ['crm', 'overview', mine], queryFn: () => crmApi.overview(mine) });
  const { data: list, isLoading } = useQuery({ queryKey: ['crm', 'list', listParams], queryFn: () => crmApi.list(listParams) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: Stage }) => crmApi.stage(id, stage),
    onSuccess: (o) => { refresh(); if (o.stage === 'won') notify.success(`Affaire gagnée : ${o.title}`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const opps = list?.data ?? [];
  const recentClosed = (o: Opportunity) => !o.closed_at || Date.now() - new Date(o.closed_at).getTime() < 30 * 86400000;
  const by = ov?.byStage ?? {};
  const openAmount = OPEN_STAGES.reduce((s, k) => s + (by[k]?.amount ?? 0), 0);
  const weighted = OPEN_STAGES.reduce((s, k) => s + (by[k]?.weighted ?? 0), 0);
  const openCount = OPEN_STAGES.reduce((s, k) => s + (by[k]?.count ?? 0), 0);
  const kpi = (label: string, value: string, sub?: string, danger?: boolean) => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ color: danger ? '#dc3545' : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{sub}</div>}
    </div>
  );
  const drop = (o: Opportunity, stage: Stage) => {
    if (o.stage === stage) return;
    if (stage === 'lost') { setLosing(o); return; }
    move.mutate({ id: o.id, stage });
  };

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}><Target size={18} /> Pipeline commercial</h1>
        {(['pipeline', 'list', 'activities'] as const).map(v => (
          <button key={v} className={view === v ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView(v)}>
            {{ pipeline: 'Pipeline', list: 'Liste', activities: 'Activités' }[v]}
            {v === 'activities' && (ov?.overdueActivities ?? 0) > 0 && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }}>{ov!.overdueActivities}</span>}
          </button>
        ))}
        <button className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouvelle opportunité</button>
      </div>

      {ov && (
        <div className="odoo-stat-grid">
          {kpi('Affaires en cours', String(openCount), `${n0(openAmount)} DH espérés`)}
          {kpi('Prévision pondérée', `${n0(weighted)} DH`, 'montant × probabilité')}
          {kpi('Gagné ce mois', `${n0(ov.month.wonAmount)} DH`, `${ov.month.won} affaire(s) · ${ov.month.lost} perdue(s)`)}
          {kpi('Taux de transformation', ov.conversion.rate != null ? `${ov.conversion.rate} %` : '—', `90 j : ${ov.conversion.won} gagnée(s), ${ov.conversion.lost} perdue(s)`)}
          {kpi('Activités en retard', String(ov.overdueActivities), 'appels, rendez-vous, tâches', ov.overdueActivities > 0)}
        </div>
      )}

      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="N°, affaire, client, prospect…" />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mes affaires
        </label>
      </div>

      {isLoading ? <Loader2 className="animate-spin" size={18} /> : view === 'activities' ? <ActivitiesView mine={mine} onOpen={setOpenId} /> : view === 'list' ? (
        opps.length === 0 ? <Empty onNew={() => setEditing('new')} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>N°</th><th>Affaire</th><th>Client</th><th>Étape</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Prob.</th><th>Conclusion prévue</th><th>Prochaine activité</th><th>Responsable</th></tr></thead>
              <tbody>{opps.map(o => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} style={{ cursor: 'pointer' }}>
                  <td className="font-mono">{o.number}</td>
                  <td><strong>{o.title}</strong>{o.source_label && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{o.source_label}</div>}</td>
                  <td>{o.client_label}{!o.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}</td>
                  <td><span className="odoo-tag" style={{ background: `${STAGE_COLOR[o.stage]}1a`, color: STAGE_COLOR[o.stage] }}>{STAGE_LABEL[o.stage]}</span></td>
                  <td style={{ textAlign: 'right' }}>{o.expected_amount ? `${n0(o.expected_amount)} DH` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{o.probability} %</td>
                  <td>{fr(o.expected_close_date)}</td>
                  <td style={{ color: o.activity_overdue ? '#dc3545' : undefined, fontSize: '0.8125rem' }}>{o.next_activity_subject ? `${frt(o.next_activity_due)} ${o.next_activity_subject}` : '—'}</td>
                  <td>{o.owner_name ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      ) : (
        opps.length === 0 ? <Empty onNew={() => setEditing('new')} /> : (
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(220px, 1fr)', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {STAGES.map(s => {
              const cards = opps.filter(o => o.stage === s.key && recentClosed(o));
              const total = cards.reduce((a, o) => a + Number(o.expected_amount ?? 0), 0);
              return (
                <div key={s.key} onDragOver={e => e.preventDefault()}
                  onDrop={e => { const id = e.dataTransfer.getData('text/plain'); const o = opps.find(x => x.id === id); if (o) drop(o, s.key); }}
                  style={{ background: 'var(--odoo-bg-alt, #f8f9fa)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, borderTop: `3px solid ${STAGE_COLOR[s.key]}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.8125rem' }}>
                    <strong>{s.label}{s.key === 'won' || s.key === 'lost' ? ' (30 j)' : ''}</strong>
                    <span style={{ color: 'var(--theme-text-muted)' }}>{cards.length} · {n0(total)} DH</span>
                  </div>
                  {cards.map(o => (
                    <div key={o.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', o.id)} onClick={() => setOpenId(o.id)}
                      style={{ background: 'var(--odoo-bg, #fff)', border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 8, cursor: 'pointer', display: 'grid', gap: 3, fontSize: '0.8125rem' }}>
                      <strong style={{ fontSize: '0.8125rem' }}>{o.title}</strong>
                      <span style={{ color: 'var(--theme-text-muted)' }}>{o.client_label}{!o.customer_id ? ' · prospect' : ''}</span>
                      <span>{o.expected_amount ? `${n0(o.expected_amount)} DH` : 'montant à estimer'}{o.expected_close_date ? ` · ${fr(o.expected_close_date)}` : ''}</span>
                      {o.next_activity_subject && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: o.activity_overdue ? '#dc3545' : 'var(--theme-text-muted)', fontSize: '0.75rem' }}>
                          {o.activity_overdue && <AlertTriangle size={11} />}{ACTIVITY_LABEL[o.next_activity_kind!]} {frt(o.next_activity_due)} : {o.next_activity_subject}
                        </span>
                      )}
                      {o.owner_name && <span style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{o.owner_name}</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )
      )}

      {editing && <OpportunityForm opp={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={o => { refresh(); setEditing(null); setOpenId(o.id); }} />}
      {openId && !editing && <OpportunityDetail id={openId} onClose={() => { setOpenId(null); params.delete('opportunity'); setParams(params, { replace: true }); }} onEdit={o => setEditing(o)} onLose={o => setLosing(o)} />}
      {losing && <LoseDialog opp={losing} onClose={() => setLosing(null)} onDone={() => { setLosing(null); refresh(); }} />}
    </div>
  );
}

function Empty({ onNew }: { onNew: () => void }) {
  return (
    <StatusBanner tone="info" icon={Target} title="Aucune opportunité" actions={<button className="odoo-btn-primary" onClick={onNew}><Plus size={13} /> Nouvelle opportunité</button>}>
      Notez chaque affaire dès le premier contact : demande d'un client, visite d'un prospect, recommandation. Vous suivez ensuite les relances jusqu'au devis puis à la commande.
    </StatusBanner>
  );
}

/* ─── Activités à faire ───────────────────────────────────────────────────── */
function ActivitiesView({ mine, onOpen }: { mine: boolean; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['crm', 'todo', mine], queryFn: () => crmApi.todo(!mine) });
  const done = useMutation({ mutationFn: (id: string) => crmApi.doneActivity(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }), onError: e => notify.error(apiErrorMessage(e)) });
  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  if (!data.length) return <StatusBanner tone="success" icon={Check} title="Rien à faire">Aucun appel, rendez-vous ni tâche en attente{mine ? ' pour vous' : ''}.</StatusBanner>;
  return (
    <table className="odoo-table">
      <thead><tr><th>Échéance</th><th>Activité</th><th>Affaire</th><th>Client</th><th>Pour</th><th></th></tr></thead>
      <tbody>{data.map(a => {
        const Icon = KIND_ICON[a.kind];
        return (
          <tr key={a.id}>
            <td style={{ whiteSpace: 'nowrap', color: a.overdue ? '#dc3545' : undefined, fontWeight: a.overdue ? 600 : 400 }}>{a.due_at ? format(new Date(a.due_at), 'dd/MM/yyyy HH:mm') : 'sans date'}</td>
            <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={13} /> {ACTIVITY_LABEL[a.kind]} · {a.subject}</span></td>
            <td><button className="odoo-pager-btn" style={{ width: 'auto', padding: '0 6px' }} onClick={() => onOpen(a.opportunity_id)}>{a.number} {a.title}</button></td>
            <td>{a.client_label}</td>
            <td>{a.assigned_name ?? '—'}</td>
            <td style={{ textAlign: 'right' }}><button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => done.mutate(a.id)}><Check size={12} /> Fait</button></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

/* ─── Saisie ──────────────────────────────────────────────────────────────── */
function OpportunityForm({ opp, onClose, onSaved }: { opp: Opportunity | null; onClose: () => void; onSaved: (o: Opportunity) => void }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'customer' | 'prospect'>(opp && !opp.customer_id ? 'prospect' : opp ? 'customer' : 'prospect');
  const [f, setF] = useState({
    title: opp?.title ?? '', customerId: opp?.customer_id ?? '', prospectName: opp?.prospect_name ?? '', prospectCompany: opp?.prospect_company ?? '',
    prospectPhone: opp?.prospect_phone ?? '', prospectEmail: opp?.prospect_email ?? '', prospectCity: opp?.prospect_city ?? '',
    sourceCode: opp?.source_code ?? '', expectedAmount: opp?.expected_amount ? String(Number(opp.expected_amount)) : '', probability: opp ? String(opp.probability) : '',
    expectedCloseDate: opp?.expected_close_date?.slice(0, 10) ?? '', ownerId: opp?.owner_id ?? user?.id ?? '', description: opp?.description ?? '',
  });
  const cf = useCustomFieldsForm('opportunity', opp?.custom_fields);
  const { entries: sources } = useReferentiel('crm_sources');
  const { data: owners = [] } = useQuery({ queryKey: ['crm', 'owners'], queryFn: crmApi.owners, staleTime: 300_000 });
  const { data: customersResp } = useQuery({ queryKey: ['customers', 'all-for-crm'], queryFn: () => customersApi.list({ limit: '1000' }), enabled: mode === 'customer' });
  const customers = ((customersResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const customerOptions = useMemo(() => customers.map(c => ({ id: String(c.id), label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '), sublabel: c.city || undefined })), [customers]);
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      const payload: OpportunityInput = {
        title: f.title, customerId: mode === 'customer' ? f.customerId || null : null,
        prospectName: f.prospectName || null, prospectCompany: f.prospectCompany || null, prospectPhone: f.prospectPhone || null,
        prospectEmail: f.prospectEmail || null, prospectCity: f.prospectCity || null, sourceCode: f.sourceCode || null,
        expectedAmount: f.expectedAmount === '' ? null : Number(f.expectedAmount), probability: f.probability === '' ? null : Number(f.probability),
        expectedCloseDate: f.expectedCloseDate || null, ownerId: f.ownerId || null, description: f.description || null,
      };
      const saved = opp ? await crmApi.update(opp.id, payload) : await crmApi.create(payload);
      await cf.save(saved.id);
      return saved;
    },
    onSuccess: o => { notify.success(opp ? 'Opportunité enregistrée' : `Opportunité ${o.number} créée`); onSaved(o); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const ok = f.title.trim().length >= 2 && (mode === 'customer' ? !!f.customerId : !!(f.prospectName.trim() || f.prospectCompany.trim()));
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10 }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{opp ? `Modifier ${opp.number}` : 'Nouvelle opportunité'}</span></div>
          <div style={{ flex: 1 }} /><button className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
          <label style={lab}>Affaire *<input style={field} maxLength={200} value={f.title} onChange={e => set('title', e.target.value)} placeholder="Ex. : buffet d'inauguration 200 personnes" autoFocus /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['prospect', 'customer'] as const).map(m => <button key={m} type="button" className={mode === m ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode(m)}>{m === 'customer' ? 'Client existant' : 'Prospect'}</button>)}
          </div>
          {mode === 'customer' ? (
            <label style={lab}>Client *<SearchSelect options={customerOptions} value={f.customerId} onChange={v => set('customerId', v)} placeholder="Rechercher un client…" width="100%" size="md" /></label>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label style={lab}>Contact<input style={field} maxLength={160} value={f.prospectName} onChange={e => set('prospectName', e.target.value)} /></label>
              <label style={lab}>Société<input style={field} maxLength={200} value={f.prospectCompany} onChange={e => set('prospectCompany', e.target.value)} /></label>
              <label style={lab}>Téléphone<input style={field} maxLength={30} value={f.prospectPhone} onChange={e => set('prospectPhone', e.target.value)} /></label>
              <label style={lab}>E-mail<input style={field} type="email" maxLength={255} value={f.prospectEmail} onChange={e => set('prospectEmail', e.target.value)} /></label>
              <label style={lab}>Ville<input style={field} maxLength={100} value={f.prospectCity} onChange={e => set('prospectCity', e.target.value)} /></label>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <label style={lab}>Montant espéré (DH)<input style={field} type="number" min={0} step="1" value={f.expectedAmount} onChange={e => set('expectedAmount', e.target.value)} /></label>
            <label style={lab}>Probabilité (%)<input style={field} type="number" min={0} max={100} value={f.probability} onChange={e => set('probability', e.target.value)} placeholder="selon l'étape" /></label>
            <label style={lab}>Conclusion prévue<input style={field} type="date" value={f.expectedCloseDate} onChange={e => set('expectedCloseDate', e.target.value)} /></label>
            <label style={lab}>Source<select style={field} value={f.sourceCode} onChange={e => set('sourceCode', e.target.value)}><option value="">—</option>{sources.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
            <label style={lab}>Responsable<select style={field} value={f.ownerId} onChange={e => set('ownerId', e.target.value)}>{owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          </div>
          <label style={lab}>Description<textarea style={{ ...field, minHeight: 70 }} maxLength={4000} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Besoin du client, contexte, interlocuteurs…" /></label>
          <CustomFieldsEditor entity="opportunity" values={cf.values} onChange={cf.setValues} />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={!ok || save.isPending} onClick={() => {
            const missing = cf.missing(); if (missing.length) { notify.error(`À renseigner : ${missing.join(', ')}`); return; }
            save.mutate();
          }}>Enregistrer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Fiche ───────────────────────────────────────────────────────────────── */
function OpportunityDetail({ id, onClose, onEdit, onLose }: { id: string; onClose: () => void; onEdit: (o: Opportunity) => void; onLose: (o: Opportunity) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: o, isLoading } = useQuery({ queryKey: ['crm', 'opp', id], queryFn: () => crmApi.get(id) });
  const { data: owners = [] } = useQuery({ queryKey: ['crm', 'owners'], queryFn: crmApi.owners, staleTime: 300_000 });
  const [act, setAct] = useState({ kind: 'call' as ActivityKind, subject: '', dueAt: '', assignedTo: user?.id ?? '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });
  const stage = useMutation({ mutationFn: (s: Stage) => crmApi.stage(id, s), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const add = useMutation({
    mutationFn: () => crmApi.addActivity(id, { kind: act.kind, subject: act.subject, dueAt: act.dueAt ? new Date(act.dueAt).toISOString() : null, assignedTo: act.assignedTo || null }),
    onSuccess: () => { refresh(); setAct(a => ({ ...a, subject: '', dueAt: '' })); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const done = useMutation({ mutationFn: (aid: string) => crmApi.doneActivity(aid), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const del = useMutation({ mutationFn: (aid: string) => crmApi.deleteActivity(aid), onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)) });
  const toCustomer = useMutation({ mutationFn: () => crmApi.createCustomer(id), onSuccess: () => { refresh(); notify.success('Fiche client créée'); }, onError: e => notify.error(apiErrorMessage(e)) });
  const { defs: cfDefs } = useCustomFieldsForm('opportunity');

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 980, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10 }}>
        {isLoading || !o ? <div style={{ padding: 24 }}><Loader2 className="animate-spin" size={18} /></div> : (<>
          <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1, flexWrap: 'wrap', gap: 6 }}>
            <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{o.number} · {o.title}</span></div>
            <div style={{ flex: 1 }} />
            {o.stage !== 'won' && o.stage !== 'lost' && <>
              <button className="odoo-btn-secondary" onClick={() => navigate(`/quotes?opportunity=${o.id}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileSignature size={13} /> Créer un devis</button>
              <button className="odoo-btn-primary" disabled={stage.isPending} onClick={() => stage.mutate('won')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trophy size={13} /> Gagné</button>
              <button className="odoo-btn-secondary" onClick={() => onLose(o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><XCircle size={13} /> Perdu</button>
            </>}
            {(o.stage === 'won' || o.stage === 'lost') && <button className="odoo-btn-secondary" onClick={() => stage.mutate('negotiation')}>Rouvrir</button>}
            <button className="odoo-btn-secondary" onClick={() => onEdit(o)}>Modifier</button>
            <button className="odoo-btn-secondary" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
          </div>
          <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
            {/* Étapes */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {STAGES.filter(s => s.key !== 'lost' || o.stage === 'lost').map(s => {
                const active = s.key === o.stage;
                return (
                  <button key={s.key} disabled={stage.isPending || active || s.key === 'lost'} onClick={() => stage.mutate(s.key)}
                    style={{ flex: '1 1 110px', padding: '6px 8px', borderRadius: 4, border: `1px solid ${active ? STAGE_COLOR[s.key] : 'var(--odoo-border)'}`,
                      background: active ? STAGE_COLOR[s.key] : 'var(--odoo-bg)', color: active ? '#fff' : 'var(--odoo-text)', fontSize: '0.8125rem', fontWeight: active ? 600 : 400, cursor: active ? 'default' : 'pointer' }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            {o.stage === 'lost' && <StatusBanner tone="warning" icon={XCircle} title={`Perdue${o.lost_reason_label ? ` · ${o.lost_reason_label}` : ''}`}>{o.lost_note || 'Le motif alimente l\'analyse des affaires perdues.'}</StatusBanner>}
            {o.stage === 'won' && <StatusBanner tone="success" icon={Trophy} title="Affaire gagnée">Conclue le {fr(o.closed_at)}.</StatusBanner>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: '0.875rem' }}>
              <div><div style={lab}>Client</div><strong>{o.client_label}</strong>{!o.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}
                <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{[o.customer_phone ?? o.prospect_phone, o.customer_email ?? o.prospect_email, o.prospect_city].filter(Boolean).join(' · ')}</div>
                {!o.customer_id && <button className="odoo-btn-secondary" style={{ padding: '2px 8px', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={toCustomer.isPending} onClick={() => toCustomer.mutate()}><UserPlus size={12} /> Créer la fiche client</button>}
              </div>
              <div><div style={lab}>Montant espéré · probabilité</div>{o.expected_amount ? `${n0(o.expected_amount)} DH` : '—'} · {o.probability} %<div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>pondéré {n0(o.weighted_amount)} DH</div></div>
              <div><div style={lab}>Conclusion prévue</div>{fr(o.expected_close_date)}</div>
              <div><div style={lab}>Responsable · source</div>{o.owner_name ?? '—'}<div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{o.source_label ?? 'source non renseignée'}</div></div>
            </div>
            {o.description && <div style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>{o.description}</div>}
            {cfDefs.length > 0 && <CustomFieldsEditor entity="opportunity" values={o.custom_fields ?? {}} onChange={() => {}} readOnly />}

            {(o.quotes?.length ?? 0) > 0 && (
              <div>
                <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Devis</div>
                <table className="odoo-table"><tbody>{o.quotes!.map(q => (
                  <tr key={q.id} onClick={() => navigate('/quotes')} style={{ cursor: 'pointer' }}>
                    <td className="font-mono">{q.number}</td><td>{fr(q.quote_date)}</td><td>{q.status}</td><td style={{ textAlign: 'right' }}>{n0(q.total)} DH</td>
                  </tr>
                ))}</tbody></table>
              </div>
            )}

            <div>
              <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Activités</div>
              {o.stage !== 'won' && o.stage !== 'lost' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
                  <label style={{ ...lab, width: 130 }}>Type<select style={field} value={act.kind} onChange={e => setAct({ ...act, kind: e.target.value as ActivityKind })}>
                    {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map(k => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}</select></label>
                  <label style={{ ...lab, flex: '1 1 220px' }}>{act.kind === 'note' ? 'Note' : 'Objet'}<input style={field} maxLength={200} value={act.subject} onChange={e => setAct({ ...act, subject: e.target.value })}
                    placeholder={act.kind === 'note' ? 'Ce qui s\'est dit…' : 'Ex. : rappeler pour confirmer le nombre de convives'} /></label>
                  {act.kind !== 'note' && <>
                    <label style={{ ...lab, width: 190 }}>Échéance<input style={field} type="datetime-local" value={act.dueAt} onChange={e => setAct({ ...act, dueAt: e.target.value })} /></label>
                    <label style={{ ...lab, width: 170 }}>Pour<select style={field} value={act.assignedTo} onChange={e => setAct({ ...act, assignedTo: e.target.value })}>{owners.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                  </>}
                  <button className="odoo-btn-primary" disabled={act.subject.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Ajouter</button>
                </div>
              )}
              {(o.activities ?? []).length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>Aucune activité.</p> : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                  {o.activities!.map(a => {
                    const Icon = KIND_ICON[a.kind];
                    const open = !a.done_at;
                    const overdue = open && a.due_at && new Date(a.due_at) < new Date();
                    return (
                      <li key={a.id} style={{ fontSize: '0.8125rem', padding: '6px 10px', borderLeft: `3px solid ${overdue ? '#dc3545' : open ? 'var(--odoo-primary, #714b67)' : 'var(--odoo-border)'}`, background: open ? 'var(--odoo-bg-alt, #f8f9fa)' : undefined }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: open ? 600 : 400, color: overdue ? '#dc3545' : undefined }}>
                          <Icon size={13} /> {ACTIVITY_LABEL[a.kind]} · {a.subject}
                        </span>
                        <span style={{ color: 'var(--theme-text-muted)' }}>
                          {' · '}{open ? (a.due_at ? `à faire le ${format(new Date(a.due_at), 'dd/MM/yyyy HH:mm')}` : 'à faire') : `fait le ${format(new Date(a.done_at!), 'dd/MM/yyyy HH:mm')}`}
                          {a.assigned_name ? ` · ${a.assigned_name}` : a.created_by_name ? ` · ${a.created_by_name}` : ''}
                        </span>
                        {a.outcome && <div style={{ color: 'var(--theme-text-muted)' }}>{a.outcome}</div>}
                        {open && <span style={{ marginLeft: 8 }}>
                          <button className="odoo-btn-secondary" style={{ padding: '0 6px' }} onClick={() => done.mutate(a.id)}><Check size={11} /> Fait</button>{' '}
                          <button className="odoo-pager-btn" aria-label="Supprimer l'activité" onClick={() => del.mutate(a.id)}><Trash2 size={11} /></button>
                        </span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>)}
      </div>
    </ModalBackdrop>
  );
}

function LoseDialog({ opp, onClose, onDone }: { opp: Opportunity; onClose: () => void; onDone: () => void }) {
  const { entries: reasons } = useReferentiel('quote_lost_reasons');
  const [reason, setReason] = useState(''); const [note, setNote] = useState('');
  const lose = useMutation({ mutationFn: () => crmApi.stage(opp.id, 'lost', { lostReasonCode: reason, lostNote: note || null }), onSuccess: onDone, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--theme-bg-card)', borderRadius: 10, padding: 20, display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 600 }}>Affaire perdue · {opp.title}</div>
        <label style={lab}>Motif *<select style={field} value={reason} onChange={e => setReason(e.target.value)}><option value="">Choisir…</option>{reasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
        <label style={lab}>Précision<input style={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex. : concurrent 15 % moins cher" /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={!reason || lose.isPending} onClick={() => lose.mutate()}>Classer perdue</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
