import { money as moneyFmt, currencySymbol } from '../../utils/money';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Target, Plus, Phone, CalendarClock, Mail, CheckSquare, StickyNote, Trophy, XCircle, FileSignature, UserPlus, Check, Trash2, AlertTriangle, Megaphone,
  Send, Handshake, Archive, List, SquareKanban, type LucideIcon } from 'lucide-react';

import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { format } from 'date-fns';
import { crmApi, STAGES, STAGE_LABEL, ACTIVITY_LABEL, type Opportunity, type Stage, type ActivityKind, type OpportunityInput, type Campaign } from '../../api/crm.api';
import { customersApi } from '../../api/customers.api';
import { useCustomFieldsForm } from '../../api/custom-fields.api';
import CustomFieldsEditor from '../../components/custom-fields/CustomFieldsEditor';
import { apiErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import SearchSelect from '../../components/ui/SearchSelect';
import { useReferentiel } from '../../hooks/useReferentiel';
import SalesPageShell from '../sales/SalesPageShell';
import { ListToolbar, ListKpi } from '../sales/ListTemplate';
import { Segmented, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

/**
 * CRM (mig 371) : opportunités suivies avant le devis, du premier contact à la commande.
 * Tableau du pipeline par étape (glisser-déposer), liste, activités à faire.
 */
const n0 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const fr = (v: string | null | undefined) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '—');
const frt = (v: string | null | undefined) => (v ? format(new Date(v), 'dd/MM HH:mm') : '');
const lab: React.CSSProperties = { fontSize: '13px', color: 'var(--ds-muted)' };
const STAGE_COLOR: Record<Stage, string> = { new: 'var(--ds-muted)', qualified: 'var(--ds-info)', proposal: 'var(--ds-cat-purple)', negotiation: 'var(--ds-warning)', won: 'var(--ds-success)', lost: 'var(--ds-danger)' };
/** Étape d'une opportunité en étiquette commune (gagné = terminé, perdu = clos sans suite). */
const STAGE_TONE: Record<Stage, { tone: StatusTone; icon?: LucideIcon }> = {
  new: { tone: 'draft', icon: UserPlus }, qualified: { tone: 'progress' }, proposal: { tone: 'progress', icon: Send },
  negotiation: { tone: 'progress', icon: Handshake }, won: { tone: 'done', icon: Trophy }, lost: { tone: 'cancelled', icon: XCircle },
};
const KIND_ICON: Record<ActivityKind, typeof Phone> = { call: Phone, meeting: CalendarClock, email: Mail, task: CheckSquare, note: StickyNote };
const OPEN_STAGES: Stage[] = ['new', 'qualified', 'proposal', 'negotiation'];

export default function CrmPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // Design System : Tableau par défaut ; Kanban (colonnes par étape) et Activités au choix.
  const view = (params.get('view') as 'pipeline' | 'list' | 'activities') || 'list';
  const setView = (v: string) => { params.set('view', v); setParams(params, { replace: true }); };
  const [mine, setMine] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Opportunity | 'new' | null>(null);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [openId, setOpenId] = useState<string | null>(params.get('opportunity'));
  const [losing, setLosing] = useState<Opportunity | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);

  const listParams: Record<string, string> = { limit: '300' };
  if (mine) listParams.mine = 'true';
  if (search) listParams.search = search;
  const { data: ov } = useQuery({ queryKey: ['crm', 'overview', mine], queryFn: () => crmApi.overview(mine) });
  const { data: list, isLoading, isError, error, refetch } = useQuery({ queryKey: ['crm', 'list', listParams], queryFn: () => crmApi.list(listParams) });
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
  const drop = (o: Opportunity, stage: Stage) => {
    if (o.stage === stage) return;
    if (stage === 'lost') { setLosing(o); return; }
    move.mutate({ id: o.id, stage });
  };

  return (
    <SalesPageShell icon={Target} parent="Ventes" title="Pipeline" list
      summary={ov ? `${openCount} affaire${openCount > 1 ? 's' : ''} en cours · ${moneyFmt(openAmount, { decimals: 0 })}` : undefined}
      actions={<>
        <button className="odoo-btn-secondary" onClick={() => setShowCampaigns(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Megaphone size={14} /> Campagnes</button>
        <button className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouvelle opportunité</button>
      </>}>

      {ov && (
        <section className="prj-kpis" aria-label="Indicateurs">
          <ListKpi label="Affaires en cours" value={String(openCount)} sub={`${moneyFmt(openAmount, { decimals: 0 })} espérés`} />
          <ListKpi label="Prévision pondérée" value={`${moneyFmt(weighted, { decimals: 0 })}`} sub="montant × probabilité" />
          <ListKpi label="Gagné ce mois" value={`${moneyFmt(ov.month.wonAmount, { decimals: 0 })}`} sub={`${ov.month.won} affaire(s) · ${ov.month.lost} perdue(s)`} tone={ov.month.wonAmount > 0 ? 'green' : undefined} />
          <ListKpi label="Taux de transformation" value={ov.conversion.rate != null ? `${ov.conversion.rate} %` : '—'} sub={`90 j : ${ov.conversion.won} gagnée(s), ${ov.conversion.lost} perdue(s)`} />
          <ListKpi label="Activités en retard" value={String(ov.overdueActivities)} sub="appels, rendez-vous, tâches" tone={ov.overdueActivities > 0 ? 'red' : undefined} />
        </section>
      )}

      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="N°, affaire, client, prospect…">
        <label className="prj-chip" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} style={{ accentColor: 'var(--ds-accent)' }} /> Mes affaires
        </label>
        <Segmented label="Affichage" value={view} onChange={setView} options={[
          { key: 'list', label: 'Tableau', icon: List },
          { key: 'pipeline', label: 'Kanban', icon: SquareKanban },
          { key: 'activities', label: 'Activités', icon: CalendarClock, count: (ov?.overdueActivities ?? 0) > 0 ? ov!.overdueActivities : undefined },
        ]} />
      </ListToolbar>

      {isLoading ? <LoadingState label="Chargement du pipeline…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : view === 'activities' ? <ActivitiesView mine={mine} onOpen={setOpenId} /> : view === 'list' ? (
        opps.length === 0 ? <Empty filtered={!!search || mine} onReset={() => { setSearchInput(''); setMine(false); }} onNew={() => setEditing('new')} /> : (
          <DataPanel label="Opportunités" footer={<TableFooter note={`${opps.length} affaire${opps.length > 1 ? 's' : ''} · ${moneyFmt(opps.reduce((a, o) => a + Number(o.expected_amount ?? 0), 0), { decimals: 0 })} espérés`} />}>
            <table className="odoo-table">
              <thead><tr><th>N°</th><th>Affaire</th><th>Client</th><th>Étape</th><th className="ds-num">Montant ({currencySymbol()})</th><th className="ds-num">Probabilité</th><th>Conclusion prévue</th><th>Prochaine activité</th><th>Responsable</th></tr></thead>
              <tbody>{opps.map(o => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} style={{ cursor: 'pointer' }}>
                  <td><span className="ds-ref">{o.number}</span></td>
                  <td><span className="ds-strong">{o.title}</span>{o.source_label && <span className="sal-sub">{o.source_label}</span>}</td>
                  <td>{o.client_label}{!o.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}</td>
                  <td><StatusTag tone={STAGE_TONE[o.stage]?.tone ?? 'draft'} icon={STAGE_TONE[o.stage]?.icon} label={STAGE_LABEL[o.stage]} /></td>
                  <td className="ds-num">{o.expected_amount ? Number(o.expected_amount).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—'}</td>
                  <td className="ds-num">{o.probability} %</td>
                  <td>{fr(o.expected_close_date)}</td>
                  <td style={{ color: o.activity_overdue ? 'var(--ds-danger)' : undefined, fontSize: '13px' }}>{o.next_activity_subject ? `${frt(o.next_activity_due)} ${o.next_activity_subject}` : '—'}</td>
                  <td>{o.owner_name ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </DataPanel>
        )
      ) : (
        opps.length === 0 ? <Empty filtered={!!search || mine} onReset={() => { setSearchInput(''); setMine(false); }} onNew={() => setEditing('new')} /> : (
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(220px, 1fr)', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
            {STAGES.map(s => {
              const cards = opps.filter(o => o.stage === s.key && recentClosed(o));
              const total = cards.reduce((a, o) => a + Number(o.expected_amount ?? 0), 0);
              return (
                <div key={s.key} onDragOver={e => e.preventDefault()}
                  onDrop={e => { const id = e.dataTransfer.getData('text/plain'); const o = opps.find(x => x.id === id); if (o) drop(o, s.key); }}
                  className="prj-lane" style={{ minHeight: 200 }}>
                  <div className="prj-lane-head">
                    <span className="prj-dot" style={{ background: STAGE_COLOR[s.key] }} />
                    <strong>{s.label}{s.key === 'won' || s.key === 'lost' ? ' (30 j)' : ''}</strong>
                    <small className="sal-lane-sum">{cards.length} · {moneyFmt(total, { decimals: 0 })}</small>
                  </div>
                  {!cards.length && <div className="prj-lane-empty">Aucune affaire</div>}
                  {cards.map(o => (
                    <button type="button" key={o.id} className="prj-task" draggable onDragStart={e => e.dataTransfer.setData('text/plain', o.id)} onClick={() => setOpenId(o.id)}
                      style={{ gap: 3, fontSize: '13px' }}>
                      <span className="prj-task-title">{o.title}</span>
                      <span style={{ color: 'var(--ds-muted)' }}>{o.client_label}{!o.customer_id ? ' · prospect' : ''}</span>
                      <span>{o.expected_amount ? `${moneyFmt(o.expected_amount, { decimals: 0 })}` : 'montant à estimer'}{o.expected_close_date ? ` · ${fr(o.expected_close_date)}` : ''}</span>
                      {o.next_activity_subject && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: o.activity_overdue ? 'var(--ds-danger)' : 'var(--ds-muted)', fontSize: '12px' }}>
                          {o.activity_overdue && <AlertTriangle size={11} />}{ACTIVITY_LABEL[o.next_activity_kind!]} {frt(o.next_activity_due)} : {o.next_activity_subject}
                        </span>
                      )}
                      {o.owner_name && <span style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{o.owner_name}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )
      )}

      {editing && <OpportunityForm opp={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={o => { refresh(); setEditing(null); setOpenId(o.id); }} />}
      {showCampaigns && <CampaignsModal onClose={() => setShowCampaigns(false)} />}
      {openId && !editing && <OpportunityDetail id={openId} onClose={() => { setOpenId(null); params.delete('opportunity'); setParams(params, { replace: true }); }} onEdit={o => setEditing(o)} onLose={o => setLosing(o)} />}
      {losing && <LoseDialog opp={losing} onClose={() => setLosing(null)} onDone={() => { setLosing(null); refresh(); }} />}
    </SalesPageShell>
  );
}

function Empty({ filtered, onReset, onNew }: { filtered: boolean; onReset: () => void; onNew: () => void }) {
  if (filtered) return <NoResultState onReset={onReset} text="Aucune opportunité ne correspond aux filtres." />;
  return (
    <EmptyState icon={Target} title="Aucune opportunité"
      text="Notez chaque affaire dès le premier contact, puis suivez les relances jusqu'au devis et à la commande."
      action={<button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={onNew}><Plus size={13} /> Nouvelle opportunité</button>} />
  );
}

/* ─── Activités à faire ───────────────────────────────────────────────────── */
function ActivitiesView({ mine, onOpen }: { mine: boolean; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['crm', 'todo', mine], queryFn: () => crmApi.todo(!mine) });
  const done = useMutation({ mutationFn: (id: string) => crmApi.doneActivity(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }), onError: e => notify.error(apiErrorMessage(e)) });
  if (isLoading) return <LoadingState label="Chargement des activités…" />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data.length) return <StatusBanner tone="success" icon={Check} title="Rien à faire">Aucun appel, rendez-vous ni tâche en attente{mine ? ' pour vous' : ''}.</StatusBanner>;
  return (
    <DataPanel label="Activités à faire" footer={<TableFooter note={`${data.length} activité${data.length > 1 ? 's' : ''} à faire`} />}>
    <table className="odoo-table">
      <thead><tr><th>Échéance</th><th>Activité</th><th>Affaire</th><th>Client</th><th>Pour</th><th className="ds-actions">Actions</th></tr></thead>
      <tbody>{data.map(a => {
        const Icon = KIND_ICON[a.kind];
        return (
          <tr key={a.id}>
            <td style={{ whiteSpace: 'nowrap', color: a.overdue ? 'var(--ds-danger)' : undefined, fontWeight: a.overdue ? 600 : 400 }}>{a.due_at ? format(new Date(a.due_at), 'dd/MM/yyyy HH:mm') : 'sans date'}</td>
            <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={13} /> {ACTIVITY_LABEL[a.kind]} · {a.subject}</span></td>
            <td><button className="odoo-pager-btn" style={{ width: 'auto', padding: '0 6px' }} onClick={() => onOpen(a.opportunity_id)}>{a.number} {a.title}</button></td>
            <td>{a.client_label}</td>
            <td>{a.assigned_name ?? '—'}</td>
            <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={done.isPending} onClick={() => done.mutate(a.id)}><Check size={12} /> Fait</button></td>
          </tr>
        );
      })}</tbody>
    </table>
    </DataPanel>
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
    expectedCloseDate: opp?.expected_close_date?.slice(0, 10) ?? '', ownerId: opp?.owner_id ?? user?.id ?? '', description: opp?.description ?? '', campaignId: opp?.campaign_id ?? '',
  });
  const cf = useCustomFieldsForm('opportunity', opp?.custom_fields);
  const { entries: sources } = useReferentiel('crm_sources');
  const { data: campaignOpts = [] } = useQuery({ queryKey: ['crm', 'campaign-options'], queryFn: crmApi.campaignOptions, staleTime: 300_000 });
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
        expectedCloseDate: f.expectedCloseDate || null, ownerId: f.ownerId || null, description: f.description || null, campaignId: f.campaignId || null,
      };
      const saved = opp ? await crmApi.update(opp.id, payload) : await crmApi.create(payload);
      await cf.save(saved.id);
      return saved;
    },
    onSuccess: o => { notify.success(opp ? 'Opportunité enregistrée' : `Opportunité ${o.number} créée`); onSaved(o); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const ok = f.title.trim().length >= 2 && (mode === 'customer' ? !!f.customerId : !!(f.prospectName.trim() || f.prospectCompany.trim()));
  const [initialSnapshot] = useState(() => JSON.stringify({ mode, f }));
  const dirty = JSON.stringify({ mode, f }) !== initialSnapshot;
  const titleError = f.title !== '' && f.title.trim().length < 2 ? 'Au moins 2 caractères.' : undefined;
  return (
    <Modal title={opp ? `Modifier ${opp.number}` : 'Nouvelle opportunité'} onClose={onClose} width={760} locked={save.isPending}
      footer={<FormFooter dirty={dirty} onCancel={onClose} disabled={!ok} busy={save.isPending} onSubmit={() => {
        const missing = cf.missing(); if (missing.length) { notify.error(`À renseigner : ${missing.join(', ')}`); return; }
        save.mutate();
      }} />}>
      <FormSection title="Affaire">
        <FormField label="Affaire" htmlFor="op-title" required error={titleError}>
          <input id="op-title" className="ds-input" maxLength={200} value={f.title} onChange={e => set('title', e.target.value)} placeholder="Ex. : projet d'équipement des bureaux" autoFocus />
        </FormField>
      </FormSection>
      <FormSection title="Client ou prospect">
        <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Type d'interlocuteur">
          {(['prospect', 'customer'] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode(m)}>{m === 'customer' ? 'Client existant' : 'Prospect'}</button>)}
        </div>
        {mode === 'customer' ? (
          <FormField label="Client" required>
            <SearchSelect options={customerOptions} value={f.customerId} onChange={v => set('customerId', v)} placeholder="Rechercher un client…" ariaLabel="Client" width="100%" size="md" />
          </FormField>
        ) : (
          <div className="ds-form-grid">
            <FormField label="Contact" htmlFor="op-p-name" hint="Contact ou société obligatoire.">
              <input id="op-p-name" className="ds-input" maxLength={160} value={f.prospectName} onChange={e => set('prospectName', e.target.value)} />
            </FormField>
            <FormField label="Société" htmlFor="op-p-company">
              <input id="op-p-company" className="ds-input" maxLength={200} value={f.prospectCompany} onChange={e => set('prospectCompany', e.target.value)} />
            </FormField>
            <FormField label="Téléphone" htmlFor="op-p-phone">
              <input id="op-p-phone" className="ds-input" maxLength={30} value={f.prospectPhone} onChange={e => set('prospectPhone', e.target.value)} />
            </FormField>
            <FormField label="E-mail" htmlFor="op-p-email">
              <input id="op-p-email" className="ds-input" type="email" maxLength={255} value={f.prospectEmail} onChange={e => set('prospectEmail', e.target.value)} />
            </FormField>
            <FormField label="Ville" htmlFor="op-p-city">
              <input id="op-p-city" className="ds-input" maxLength={100} value={f.prospectCity} onChange={e => set('prospectCity', e.target.value)} />
            </FormField>
          </div>
        )}
      </FormSection>
      <FormSection title="Prévision">
        <div className="ds-form-grid">
          <FormField label={`Montant espéré (${currencySymbol()})`} htmlFor="op-amount">
            <input id="op-amount" className="ds-input" type="number" min={0} step="1" value={f.expectedAmount} onChange={e => set('expectedAmount', e.target.value)} />
          </FormField>
          <FormField label="Probabilité (%)" htmlFor="op-proba">
            <input id="op-proba" className="ds-input" type="number" min={0} max={100} value={f.probability} onChange={e => set('probability', e.target.value)} placeholder="selon l'étape" />
          </FormField>
          <FormField label="Conclusion prévue" htmlFor="op-close">
            <input id="op-close" className="ds-input" type="date" value={f.expectedCloseDate} onChange={e => set('expectedCloseDate', e.target.value)} />
          </FormField>
          <FormField label="Source" htmlFor="op-source">
            <select id="op-source" className="ds-input" value={f.sourceCode} onChange={e => set('sourceCode', e.target.value)}><option value="">—</option>{sources.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}</select>
          </FormField>
          <FormField label="Responsable">
            <SearchSelect value={f.ownerId} onChange={v => set('ownerId', v)} placeholder="Responsable" width="100%" size="md" ariaLabel="Responsable" options={owners.map(o => ({ id: String(o.id), label: o.name as string }))} />
          </FormField>
          <FormField label="Campagne">
            <SearchSelect value={f.campaignId} onChange={v => set('campaignId', v)} placeholder="—" width="100%" size="md" ariaLabel="Campagne" options={campaignOpts.map(c => ({ id: String(c.id), label: c.name as string }))} />
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Description">
        <FormField label="Description" htmlFor="op-desc">
          <textarea id="op-desc" className="ds-input" style={{ minHeight: 70 }} maxLength={4000} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Besoin du client, contexte, interlocuteurs…" />
        </FormField>
        <CustomFieldsEditor entity="opportunity" values={cf.values} onChange={cf.setValues} />
      </FormSection>
    </Modal>
  );
}

/* ─── Fiche ───────────────────────────────────────────────────────────────── */
function OpportunityDetail({ id, onClose, onEdit, onLose }: { id: string; onClose: () => void; onEdit: (o: Opportunity) => void; onLose: (o: Opportunity) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: o, isLoading, isError, error, refetch } = useQuery({ queryKey: ['crm', 'opp', id], queryFn: () => crmApi.get(id) });
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

  if (isError) return <Modal title="Opportunité" onClose={onClose} width={980}><ErrorState title="L'opportunité n'a pas pu être chargée" error={error} onRetry={() => refetch()} bare /></Modal>;
  if (isLoading || !o) return <Modal title="Opportunité" onClose={onClose} width={980}><LoadingState bare /></Modal>;

  return (
    <Modal title={o.title} subtitle={<span className="ds-ref">{o.number}</span>} onClose={onClose} width={980}
      aside={<StatusTag tone={STAGE_TONE[o.stage]?.tone ?? 'draft'} icon={STAGE_TONE[o.stage]?.icon} label={STAGE_LABEL[o.stage]} />}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={() => onEdit(o)}>Modifier</button>
        {(o.stage === 'won' || o.stage === 'lost') && <button type="button" className="odoo-btn-secondary" onClick={() => stage.mutate('negotiation')}>Rouvrir</button>}
        {o.stage !== 'won' && o.stage !== 'lost' && <>
          <button type="button" className="odoo-btn-secondary" onClick={() => onLose(o)}><XCircle size={13} /> Perdu</button>
          <button type="button" className="odoo-btn-secondary" onClick={() => navigate(`/quotes?opportunity=${o.id}`)}><FileSignature size={13} /> Créer un devis</button>
          <button type="button" className="odoo-btn-primary" disabled={stage.isPending} onClick={() => stage.mutate('won')}><Trophy size={13} /> Gagné</button>
        </>}
      </>}>
            {/* Étapes */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {STAGES.filter(s => s.key !== 'lost' || o.stage === 'lost').map(s => {
                const active = s.key === o.stage;
                return (
                  <button key={s.key} disabled={stage.isPending || active || s.key === 'lost'} onClick={() => stage.mutate(s.key)}
                    style={{ flex: '1 1 110px', padding: '6px 8px', borderRadius: 4, border: `1px solid ${active ? STAGE_COLOR[s.key] : 'var(--ds-sep)'}`,
                      background: active ? STAGE_COLOR[s.key] : 'var(--ds-card)', color: active ? '#fff' : 'var(--ds-ink)', fontSize: '13px', fontWeight: active ? 600 : 400, cursor: active ? 'default' : 'pointer' }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            {o.stage === 'lost' && <StatusBanner tone="warning" icon={XCircle} title={`Perdue${o.lost_reason_label ? ` · ${o.lost_reason_label}` : ''}`}>{o.lost_note || 'Le motif alimente l\'analyse des affaires perdues.'}</StatusBanner>}
            {o.stage === 'won' && <StatusBanner tone="success" icon={Trophy} title="Affaire gagnée">Conclue le {fr(o.closed_at)}.</StatusBanner>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: '14px' }}>
              <div><div style={lab}>Client</div><strong>{o.client_label}</strong>{!o.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}
                <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{[o.customer_phone ?? o.prospect_phone, o.customer_email ?? o.prospect_email, o.prospect_city].filter(Boolean).join(' · ')}</div>
                {!o.customer_id && <button className="odoo-btn-secondary" style={{ padding: '2px 8px', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={toCustomer.isPending} onClick={() => toCustomer.mutate()}><UserPlus size={12} /> Créer la fiche client</button>}
              </div>
              <div><div style={lab}>Montant espéré · probabilité</div>{o.expected_amount ? `${moneyFmt(o.expected_amount, { decimals: 0 })}` : '—'} · {o.probability} %<div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>pondéré {moneyFmt(o.weighted_amount, { decimals: 0 })}</div></div>
              <div><div style={lab}>Conclusion prévue</div>{fr(o.expected_close_date)}</div>
              <div><div style={lab}>Responsable · source</div>{o.owner_name ?? '—'}<div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{o.source_label ?? 'source non renseignée'}</div></div>
            </div>
            {o.description && <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{o.description}</div>}
            {cfDefs.length > 0 && <CustomFieldsEditor entity="opportunity" values={o.custom_fields ?? {}} onChange={() => {}} readOnly />}

            {(o.quotes?.length ?? 0) > 0 && (
              <div>
                <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Devis</div>
                <DataPanel label="Devis de l'affaire">
                <table className="odoo-table ds-dense">
                  <thead><tr><th>N°</th><th>Date</th><th>Statut</th><th className="ds-num">Total ({currencySymbol()})</th></tr></thead>
                  <tbody>{o.quotes!.map(q => (
                  <tr key={q.id} onClick={() => navigate('/quotes')} style={{ cursor: 'pointer' }}>
                    <td className="ds-ref">{q.number}</td><td>{fr(q.quote_date)}</td><td>{q.status}</td><td className="ds-num">{n0(q.total)}</td>
                  </tr>
                ))}</tbody></table>
                </DataPanel>
              </div>
            )}

            <div>
              <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Activités</div>
              {o.stage !== 'won' && o.stage !== 'lost' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
                  <div style={{ width: 130 }}><FormField label="Type" htmlFor="act-kind">
                    <select id="act-kind" className="ds-input" value={act.kind} onChange={e => setAct({ ...act, kind: e.target.value as ActivityKind })}>
                      {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map(k => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}</select>
                  </FormField></div>
                  <div style={{ flex: '1 1 220px' }}><FormField label={act.kind === 'note' ? 'Note' : 'Objet'} htmlFor="act-subject" required>
                    <input id="act-subject" className="ds-input" maxLength={200} value={act.subject} onChange={e => setAct({ ...act, subject: e.target.value })}
                      placeholder={act.kind === 'note' ? 'Ce qui s\'est dit…' : 'Ex. : rappeler pour confirmer le nombre de convives'} />
                  </FormField></div>
                  {act.kind !== 'note' && <>
                    <div style={{ width: 190 }}><FormField label="Échéance" htmlFor="act-due">
                      <input id="act-due" className="ds-input" type="datetime-local" value={act.dueAt} onChange={e => setAct({ ...act, dueAt: e.target.value })} />
                    </FormField></div>
                    <div style={{ width: 170 }}><FormField label="Pour">
                      <SearchSelect value={act.assignedTo} onChange={v => setAct({ ...act, assignedTo: v })} placeholder="Pour" width="100%" size="md" ariaLabel="Assigné à" options={owners.map(u => ({ id: String(u.id), label: u.name as string }))} />
                    </FormField></div>
                  </>}
                  <button type="button" className="odoo-btn-primary" disabled={act.subject.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Ajouter</button>
                </div>
              )}
              {(o.activities ?? []).length === 0 ? <p style={{ fontSize: '13px', color: 'var(--ds-muted)', margin: 0 }}>Aucune activité.</p> : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                  {o.activities!.map(a => {
                    const Icon = KIND_ICON[a.kind];
                    const open = !a.done_at;
                    const overdue = open && a.due_at && new Date(a.due_at) < new Date();
                    return (
                      <li key={a.id} style={{ fontSize: '13px', padding: '6px 10px', borderLeft: `3px solid ${overdue ? 'var(--ds-danger)' : open ? 'var(--ds-accent)' : 'var(--ds-sep)'}`, background: open ? 'var(--odoo-bg-alt, #f8f9fa)' : undefined }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: open ? 600 : 400, color: overdue ? 'var(--ds-danger)' : undefined }}>
                          <Icon size={13} /> {ACTIVITY_LABEL[a.kind]} · {a.subject}
                        </span>
                        <span style={{ color: 'var(--ds-muted)' }}>
                          {' · '}{open ? (a.due_at ? `à faire le ${format(new Date(a.due_at), 'dd/MM/yyyy HH:mm')}` : 'à faire') : `fait le ${format(new Date(a.done_at!), 'dd/MM/yyyy HH:mm')}`}
                          {a.assigned_name ? ` · ${a.assigned_name}` : a.created_by_name ? ` · ${a.created_by_name}` : ''}
                        </span>
                        {a.outcome && <div style={{ color: 'var(--ds-muted)' }}>{a.outcome}</div>}
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
    </Modal>
  );
}

function LoseDialog({ opp, onClose, onDone }: { opp: Opportunity; onClose: () => void; onDone: () => void }) {
  const { entries: reasons } = useReferentiel('quote_lost_reasons');
  const [reason, setReason] = useState(''); const [note, setNote] = useState('');
  const lose = useMutation({ mutationFn: () => crmApi.stage(opp.id, 'lost', { lostReasonCode: reason, lostNote: note || null }), onSuccess: onDone, onError: e => notify.error(apiErrorMessage(e)) });
  return (
    <Modal title="Affaire perdue" subtitle={opp.title} onClose={onClose} width={460} locked={lose.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => lose.mutate()} submitLabel="Classer perdue" disabled={!reason} busy={lose.isPending} />}>
      <FormField label="Motif" htmlFor="lose-reason" required>
        <select id="lose-reason" className="ds-input" value={reason} onChange={e => setReason(e.target.value)}><option value="">Choisir…</option>{reasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
      </FormField>
      <FormField label="Précision" htmlFor="lose-note">
        <input id="lose-note" className="ds-input" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex. : concurrent 15 % moins cher" />
      </FormField>
    </Modal>
  );
}

/* ─── Campagnes marketing (mig 383) ─────────────────────────────────────────── */
function CampaignsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: campaigns = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['crm', 'campaigns'], queryFn: crmApi.campaigns });
  const [showForm, setShowForm] = useState(false);
  const n0v = (v: number | null) => (v == null ? '—' : n0(v));
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'active' | 'closed' }) => crmApi.setCampaignStatus(id, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', budget: '' });
  const create = useMutation({
    mutationFn: () => crmApi.createCampaign({ name: form.name.trim(), startDate: form.startDate || null, endDate: form.endDate || null, budget: form.budget === '' ? null : Number(form.budget) }),
    onSuccess: () => { notify.success('Campagne créée'); setShowForm(false); setForm({ name: '', startDate: '', endDate: '', budget: '' }); qc.invalidateQueries({ queryKey: ['crm'] }); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <Modal title="Campagnes marketing" onClose={onClose} width={820}
      aside={<button type="button" className="odoo-btn-primary ds-btn-sm" onClick={() => setShowForm(v => !v)}><Plus size={14} /> Nouvelle</button>}>
      {showForm && (
        <FormSection title="Nouvelle campagne">
          <div className="ds-form-grid cols-4">
            <FormField label="Nom" htmlFor="cp-name" required>
              <input id="cp-name" className="ds-input" maxLength={160} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex. Salon pro 2026" />
            </FormField>
            <FormField label="Début" htmlFor="cp-start">
              <input id="cp-start" className="ds-input" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </FormField>
            <FormField label="Fin" htmlFor="cp-end">
              <input id="cp-end" className="ds-input" type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </FormField>
            <FormField label={`Budget (${currencySymbol()})`} htmlFor="cp-budget">
              <input id="cp-budget" className="ds-input" type="number" min={0} value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
            </FormField>
          </div>
          <FormFooter onCancel={() => setShowForm(false)} onSubmit={() => create.mutate()} submitLabel="Créer" disabled={form.name.trim().length < 2} busy={create.isPending} />
        </FormSection>
      )}
      {isLoading ? <LoadingState bare /> : isError ? <ErrorState error={error} onRetry={() => refetch()} bare /> : campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="Aucune campagne" text="Créez-en une pour regrouper et mesurer vos opportunités." bare />
      ) : (
        <DataPanel label="Campagnes">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Campagne</th><th>Période</th><th className="ds-num">Budget ({currencySymbol()})</th><th className="ds-num">Opport.</th><th className="ds-num">Gagnées</th><th className="ds-num">Chiffre gagné ({currencySymbol()})</th><th>État</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>
              {(campaigns as Campaign[]).map(c => (
                <tr key={c.id}>
                  <td className="ds-strong">{c.name}</td>
                  <td style={{ color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>{c.start_date ? format(new Date(c.start_date.slice(0, 10) + 'T00:00:00'), 'dd/MM/yy') : '—'}{c.end_date ? ` → ${format(new Date(c.end_date.slice(0, 10) + 'T00:00:00'), 'dd/MM/yy')}` : ''}</td>
                  <td className="ds-num">{n0v(c.budget)}</td>
                  <td className="ds-num">{c.opportunities}</td>
                  <td className="ds-num">{c.won}</td>
                  <td className="ds-num ds-strong">{n0v(c.won_amount)}</td>
                  <td>{c.status === 'active' ? <StatusTag tone="done" label="Active" /> : <StatusTag tone="cancelled" icon={Archive} label="Clôturée" />}</td>
                  <td className="ds-actions">
                    <button type="button" className="odoo-btn-secondary ds-btn-sm"
                      onClick={() => status.mutate({ id: c.id, s: c.status === 'active' ? 'closed' : 'active' })}>
                      {c.status === 'active' ? 'Clôturer' : 'Rouvrir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </Modal>
  );
}
