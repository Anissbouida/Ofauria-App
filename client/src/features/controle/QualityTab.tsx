import { useMemo, useState } from 'react';
import ControlPlanSection from './ControlPlanSection';
import LotReleaseSection from './LotReleaseSection';
import NcDetailPanel from './NcDetailPanel';
import api from '../../api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ListChecks, Plus, CheckCircle2, XCircle, Trash2, Power, AlertTriangle, Inbox } from 'lucide-react';
import { qualityApi, type QualityTemplate, type QualityItem, type QualityResult, type AppliesTo,
  type NonConformity, type NonConformityInput, type NcStatus, type NcSeverity, type NcSource, type InspectionLinks } from '../../api/quality.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { RowMenu } from '../../components/ui/RowMenu';
import { FilterChips, ListKpi } from '../sales/ListTemplate';
import { Tabs, Panel } from './KlUi';
import { EmptyState, LoadingState, Modal, FormSection, FormField, FormFooter, HeaderActions } from '../../components/ds';

const APPLIES: Record<AppliesTo, string> = { general: 'Général', reception: 'Réception', production: 'Production', product: 'Produit' };
const day = (d: string) => format(new Date(d.slice(0, 10) + 'T00:00:00'), 'd MMM yyyy', { locale: fr });

type QualityView = 'inspections' | 'templates' | 'nonconformities' | 'plan' | 'release';
const QUALITY_VIEWS: Array<[QualityView, string]> = [
  ['inspections', 'Inspections'], ['nonconformities', 'Non-conformités'], ['templates', 'Modèles'], ['plan', 'Plan de contrôle'], ['release', 'Lots à libérer'],
];

export default function QualityTab() {
  const [view, setView] = useState<QualityView>('inspections');
  return (
    <>
      <StatusBanner tone="info" icon={ListChecks} title="Contrôle qualité paramétrable">
        Définissez des modèles d'inspection (points à vérifier, mesures dans une plage), enregistrez des inspections, et suivez les non-conformités jusqu'à leur action corrective. Indépendant des contrôles de réception et de production.
      </StatusBanner>
      <Tabs label="Vues qualité" value={view} onChange={setView} options={QUALITY_VIEWS} />
      {view === 'inspections' ? <Inspections /> : view === 'nonconformities' ? <NonConformities /> : view === 'plan' ? <ControlPlanSection /> : view === 'release' ? <LotReleaseSection /> : <Templates />}
    </>
  );
}

/* ── Non-conformités & actions correctives (mig 385) ── */
const NC_SEVERITY: Record<NcSeverity, { label: string; tag: string }> = {
  low: { label: 'Faible', tag: 'odoo-tag-grey' }, medium: { label: 'Moyenne', tag: 'odoo-tag-orange' }, high: { label: 'Élevée', tag: 'odoo-tag-red' },
};
const NC_STATUS: Record<NcStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'Ouverte', tone: 'blocked' }, in_progress: { label: 'En cours', tone: 'progress' }, closed: { label: 'Clôturée', tone: 'done' },
};
const NC_SOURCE: Record<NcSource, string> = { inspection: 'Inspection', reception: 'Réception', production: 'Production', complaint: 'Réclamation', other: 'Autre' };

function NonConformities() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'' | NcStatus>('');
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['quality', 'nc', filter], queryFn: () => qualityApi.nonconformities(filter || undefined) });
  const [editing, setEditing] = useState<NonConformity | 'new' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // M7-05 : tableau de bord des non-conformités.
  const { data: dash } = useQuery({ queryKey: ['quality', 'nc-dashboard'], queryFn: () => api.get('/quality/nc-dashboard').then(r => r.data.data as {
    total: number; open: number; avg_close_days: number | null; by_cause: { label: string; count: number }[]; by_supplier: { label: string; count: number }[]; overdue_actions: unknown[];
  }) });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: NcStatus }) => qualityApi.updateNonConformity(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quality', 'nc'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      {dash && (
        <>
          <div className="prj-kpis">
            <ListKpi label="Ouvertes" value={String(dash.open)} sub={`sur ${dash.total}`} />
            <ListKpi label="Délai moyen de clôture" value={dash.avg_close_days != null ? `${dash.avg_close_days} j` : '—'} />
            <ListKpi label="Actions en retard" value={String(dash.overdue_actions.length)} tone={dash.overdue_actions.length ? 'red' : undefined} />
          </div>
          {(dash.by_cause.length > 0 || dash.by_supplier.length > 0) && (
            <p className="klc-note">
              {dash.by_cause.length > 0 && <>Par cause : {dash.by_cause.map(c => `${c.label} ${c.count}`).join(' · ')}</>}
              {dash.by_cause.length > 0 && dash.by_supplier.length > 0 && <br />}
              {dash.by_supplier.length > 0 && <>Par fournisseur : {dash.by_supplier.map(c => `${c.label} ${c.count}`).join(' · ')}</>}
            </p>
          )}
        </>
      )}
      <div className="prj-toolbar">
        <FilterChips label="Statut" value={filter} onChange={k => setFilter(k as '' | NcStatus)}
          chips={[{ key: '', label: 'Toutes' }, { key: 'open', label: 'Ouvertes' }, { key: 'in_progress', label: 'En cours' }, { key: 'closed', label: 'Clôturées' }]} />
        <HeaderActions><button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Nouvelle non-conformité</button></HeaderActions>
      </div>
      <Panel>
        <table className="odoo-table">
          <thead><tr><th>Détectée</th><th>Non-conformité</th><th>Source</th><th>Gravité</th><th>Responsable</th><th>Échéance</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8}><LoadingState bare /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={8}><EmptyState bare icon={Inbox} title="Aucune non-conformité" /></td></tr>}
            {rows.map(nc => (
              <tr key={nc.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(nc)}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(nc.detected_on)}</td>
                <td className="ds-strong">{nc.title}{nc.reference_note && <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{nc.reference_note}</div>}</td>
                <td style={{ fontSize: '0.85rem' }}>{NC_SOURCE[nc.source]}</td>
                <td><span className={`odoo-tag ${NC_SEVERITY[nc.severity].tag}`}>{NC_SEVERITY[nc.severity].label}</span></td>
                <td style={{ fontSize: '0.85rem', color: 'var(--ds-muted)' }}>{nc.responsible_name || '—'}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem', color: nc.overdue ? 'var(--ds-danger)' : 'var(--ds-muted)', fontWeight: nc.overdue ? 600 : 400 }}>
                  {nc.overdue && <AlertTriangle size={11} style={{ display: 'inline', verticalAlign: -1, marginRight: 3 }} />}{nc.due_date ? day(nc.due_date) : '—'}
                </td>
                <td><StatusTag tone={NC_STATUS[nc.status].tone} label={NC_STATUS[nc.status].label} /></td>
                <td className="ds-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setDetailId(nc.id)}>Fiche</button>
                  <RowMenu items={[nc.status !== 'closed'
                    ? { label: 'Clôturer', onSelect: () => setStatus.mutate({ id: nc.id, status: 'closed' }) }
                    : { label: 'Rouvrir', onSelect: () => setStatus.mutate({ id: nc.id, status: 'in_progress' }) }]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {editing && <NcForm nc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['quality', 'nc'] }); setEditing(null); }} />}
      {detailId && <NcDetailPanel ncId={detailId} onClose={() => setDetailId(null)} />}
    </>
  );
}

function NcForm({ nc, onClose, onSaved }: { nc: NonConformity | null; onClose: () => void; onSaved: () => void }) {
  const { data: users = [] } = useQuery({ queryKey: ['quality', 'users'], queryFn: qualityApi.users });
  const [f, setF] = useState({
    title: nc?.title ?? '', source: (nc?.source ?? 'other') as NcSource, referenceNote: nc?.reference_note ?? '',
    description: nc?.description ?? '', severity: (nc?.severity ?? 'medium') as NcSeverity,
    correctiveAction: nc?.corrective_action ?? '', responsibleId: nc?.responsible_id ?? '',
    dueDate: nc?.due_date?.slice(0, 10) ?? '', status: (nc?.status ?? 'open') as NcStatus,
  });
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const payload: NonConformityInput & { status?: NcStatus } = {
        title: f.title.trim(), source: f.source, referenceNote: f.referenceNote || null, description: f.description || null,
        severity: f.severity, correctiveAction: f.correctiveAction || null, responsibleId: f.responsibleId || null, dueDate: f.dueDate || null,
      };
      return nc ? qualityApi.updateNonConformity(nc.id, { ...payload, status: f.status }) : qualityApi.createNonConformity(payload);
    },
    onSuccess: () => { notify.success(nc ? 'Non-conformité enregistrée' : 'Non-conformité créée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <Modal title={nc ? 'Non-conformité' : 'Nouvelle non-conformité'} onClose={onClose} locked={save.isPending} width={600}
      footer={<FormFooter onCancel={onClose} submitLabel={nc ? 'Enregistrer' : 'Créer'} busy={save.isPending} disabled={f.title.trim().length < 2} onSubmit={() => save.mutate()} />}>
      <FormSection title="Constat">
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Intitulé" htmlFor="nc-title" required><input id="nc-title" className="ds-input" type="text" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Ex. Lot beurre rance" /></FormField>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <FormField label="Source" htmlFor="nc-source"><select id="nc-source" className="ds-input" value={f.source} onChange={e => set('source', e.target.value)}>{(Object.keys(NC_SOURCE) as NcSource[]).map(k => <option key={k} value={k}>{NC_SOURCE[k]}</option>)}</select></FormField>
            <FormField label="Gravité" htmlFor="nc-severity"><select id="nc-severity" className="ds-input" value={f.severity} onChange={e => set('severity', e.target.value)}>{(Object.keys(NC_SEVERITY) as NcSeverity[]).map(k => <option key={k} value={k}>{NC_SEVERITY[k].label}</option>)}</select></FormField>
            <FormField label="Référence (optionnel)" htmlFor="nc-ref"><input id="nc-ref" className="ds-input" type="text" value={f.referenceNote} onChange={e => set('referenceNote', e.target.value)} /></FormField>
          </div>
          <FormField label="Description" htmlFor="nc-desc"><textarea id="nc-desc" className="ds-input" value={f.description} onChange={e => set('description', e.target.value)} style={{ minHeight: 56 }} placeholder="Qu'est-ce qui ne va pas ?" /></FormField>
        </div>
      </FormSection>
      <FormSection title="Traitement">
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField label="Action corrective" htmlFor="nc-action"><textarea id="nc-action" className="ds-input" value={f.correctiveAction} onChange={e => set('correctiveAction', e.target.value)} style={{ minHeight: 56 }} placeholder="Que fait-on pour corriger et éviter que ça se reproduise ?" /></FormField>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <FormField label="Responsable"><SearchSelect value={f.responsibleId} onChange={v => set('responsibleId', v)} placeholder="—" width="100%" size="md" ariaLabel="Responsable" options={users.map(u => ({ id: String(u.id), label: u.name as string }))} /></FormField>
            <FormField label="Échéance" htmlFor="nc-due"><input id="nc-due" className="ds-input" type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></FormField>
            {nc && <FormField label="Statut" htmlFor="nc-status"><select id="nc-status" className="ds-input" value={f.status} onChange={e => set('status', e.target.value)}>{(Object.keys(NC_STATUS) as NcStatus[]).map(k => <option key={k} value={k}>{NC_STATUS[k].label}</option>)}</select></FormField>}
          </div>
        </div>
      </FormSection>
    </Modal>
  );
}

/* ── Inspections ── */
function Inspections() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['quality', 'inspections'], queryFn: () => qualityApi.inspections() });
  const [newInsp, setNewInsp] = useState(false);
  return (
    <>
      <HeaderActions><button type="button" className="odoo-btn-primary" onClick={() => setNewInsp(true)}><Plus size={14} /> Nouvelle inspection</button></HeaderActions>
      <Panel>
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Inspection</th><th>Modèle</th><th>Référence</th><th style={{ textAlign: 'center' }}>Conformité</th><th>Par</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6}><LoadingState bare /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6}><EmptyState bare icon={Inbox} title="Aucune inspection" /></td></tr>}
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{day(r.inspected_on)}</td>
                <td className="ds-strong">{r.title}</td>
                <td style={{ color: 'var(--ds-muted)', fontSize: '0.85rem' }}>{r.template_name}</td>
                <td style={{ color: 'var(--ds-muted)', fontSize: '0.85rem' }}>{r.reference_note || '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  {r.conformity
                    ? <StatusTag tone="done" label="Conforme" />
                    : <StatusTag tone="blocked" label={`${r.failed} non conforme${r.failed > 1 ? 's' : ''}`} />}
                </td>
                <td style={{ color: 'var(--ds-muted)', fontSize: '0.85rem' }}>{r.inspected_by_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {newInsp && <InspectionForm onClose={() => setNewInsp(false)} onSaved={() => { qc.invalidateQueries({ queryKey: ['quality'] }); setNewInsp(false); }} />}
    </>
  );
}

export function InspectionForm({ onClose, onSaved, links = {}, defaultTitle = '', pendingId = null, items = null }: {
  onClose: () => void; onSaved: () => void;
  /** M7-01 : rattachements (ordre, opération, lot, réception). */
  links?: InspectionLinks; defaultTitle?: string;
  /** M7-02 : inspection « à faire » à réaliser, avec ses points (plan de contrôle). */
  pendingId?: string | null; items?: QualityItem[] | null;
}) {
  const { data: templates = [] } = useQuery({ queryKey: ['quality', 'templates'], queryFn: qualityApi.templates });
  const activeTemplates = templates.filter(t => t.is_active);
  const [templateId, setTemplateId] = useState('');
  const tplFound = activeTemplates.find(t => t.id === templateId) || null;
  // Points imposés par le plan de contrôle (M7-02) : un modèle implicite.
  const tpl = items ? { id: '', name: 'Plan de contrôle', items } as unknown as typeof tplFound : tplFound;
  const [title, setTitle] = useState(defaultTitle);
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  // résultats indexés sur les points du modèle
  const [vals, setVals] = useState<Record<number, { ok: boolean; value: string; note: string }>>({});

  const results = useMemo<QualityResult[]>(() => {
    if (!tpl) return [];
    return tpl.items.map((it, i) => {
      const v = vals[i] || { ok: false, value: '', note: '' };
      let ok = v.ok;
      let value: number | null = null;
      if (it.kind === 'measure') {
        value = v.value === '' ? null : Number(v.value);
        ok = value != null && (it.min == null || value >= it.min) && (it.max == null || value <= it.max);
      }
      return { label: it.label, kind: it.kind, ok, value, note: v.note || null };
    });
  }, [tpl, vals]);
  const conform = results.length > 0 && results.every(r => r.ok);

  const save = useMutation({
    mutationFn: () => qualityApi.createInspection({ templateId: templateId || null, title: title.trim(), referenceNote: reference || null, inspectedOn: date, results, notes: notes || null, pendingId, ...links }),
    onSuccess: () => { notify.success('Inspection enregistrée'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const setVal = (i: number, patch: Partial<{ ok: boolean; value: string; note: string }>) =>
    setVals(v => { const cur = v[i] ?? { ok: false, value: '', note: '' }; return { ...v, [i]: { ...cur, ...patch } }; });

  return (
    <Modal title="Nouvelle inspection" onClose={onClose} locked={save.isPending} width={620}
      footer={<FormFooter onCancel={onClose} busy={save.isPending} disabled={!tpl || !title.trim()} onSubmit={() => save.mutate()} />}>
      <FormSection title="Inspection">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <FormField label="Modèle" required>
            <SearchSelect value={templateId} onChange={v => { setTemplateId(v); setVals({}); }}
              placeholder="— Choisir un modèle —" width="100%" size="md" ariaLabel="Modèle"
              options={activeTemplates.map(t => ({ id: String(t.id), label: t.name as string }))} />
          </FormField>
          <FormField label="Date" htmlFor="insp-date"><input id="insp-date" className="ds-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></FormField>
          <FormField label="Intitulé" htmlFor="insp-title" required><input id="insp-title" className="ds-input" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. Lot farine LI-260610" /></FormField>
          <FormField label="Référence (optionnel)" htmlFor="insp-ref"><input id="insp-ref" className="ds-input" type="text" value={reference} onChange={e => setReference(e.target.value)} /></FormField>
        </div>
      </FormSection>

      {tpl && (
        <FormSection title="Points à vérifier">
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--ds-hair)', borderRadius: 8 }}>
            {tpl.items.map((it, i) => {
              const r = results[i];
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', padding: '8px 12px', borderTop: i ? '1px solid var(--ds-hair)' : 'none' }}>
                  <div>
                    <div className="ds-strong" style={{ fontSize: '0.88rem' }}>{it.label}
                      {it.kind === 'measure' && <span style={{ color: 'var(--ds-muted)', fontWeight: 400, fontSize: '0.78rem' }}> (attendu {it.min ?? '−∞'} à {it.max ?? '+∞'}{it.unit ? ' ' + it.unit : ''})</span>}
                    </div>
                    <input type="text" className="ds-input sm" aria-label={`Remarque : ${it.label}`} value={vals[i]?.note ?? ''} onChange={e => setVal(i, { note: e.target.value })} placeholder="Remarque…" style={{ marginTop: 4 }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end' }}>
                    {it.kind === 'ok' ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={vals[i]?.ok ?? false} onChange={e => setVal(i, { ok: e.target.checked })} style={{ accentColor: 'var(--ds-accent)' }} /> Conforme
                      </label>
                    ) : (
                      <input type="number" step="any" className="ds-input sm" aria-label={`Mesure : ${it.label}`} value={vals[i]?.value ?? ''} onChange={e => setVal(i, { value: e.target.value })} placeholder={it.unit || 'valeur'} style={{ width: 110 }} />
                    )}
                    {r && (vals[i]?.value || vals[i]?.ok || it.kind === 'ok') && (r.ok ? <CheckCircle2 size={16} style={{ color: 'var(--ds-success)' }} /> : <XCircle size={16} style={{ color: 'var(--ds-danger)' }} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </FormSection>
      )}
      <FormSection title="Conclusion">
        <FormField label="Notes (optionnel)" htmlFor="insp-notes"><textarea id="insp-notes" className="ds-input" value={notes} onChange={e => setNotes(e.target.value)} style={{ minHeight: 56 }} /></FormField>
        {tpl && <div style={{ marginTop: 12 }}><StatusTag tone={conform ? 'done' : 'blocked'} label={`Résultat : ${conform ? 'Conforme' : 'Non conforme'}`} /></div>}
      </FormSection>
    </Modal>
  );
}

/* ── Modèles ── */
function Templates() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['quality', 'templates'], queryFn: qualityApi.templates });
  const [editing, setEditing] = useState<QualityTemplate | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => qualityApi.setTemplateActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quality', 'templates'] }),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  return (
    <>
      <HeaderActions><button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> Nouveau modèle</button></HeaderActions>
      <Panel>
        <table className="odoo-table">
          <thead><tr><th>Modèle</th><th>S'applique à</th><th className="ds-num">Points</th><th className="ds-num">Inspections</th><th>État</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6}><LoadingState bare /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6}><EmptyState bare icon={Inbox} title="Aucun modèle. Créez-en un pour commencer" /></td></tr>}
            {rows.map(t => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(t)}>
                <td className="ds-strong">{t.name}</td>
                <td>{APPLIES[t.applies_to]}</td>
                <td className="ds-num">{t.items.length}</td>
                <td className="ds-num">{t.inspections_count}</td>
                <td><StatusTag tone={t.is_active ? 'done' : 'cancelled'} label={t.is_active ? 'Actif' : 'Inactif'} /></td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm"
                    onClick={e => { e.stopPropagation(); toggle.mutate({ id: t.id, active: !t.is_active }); }} title={t.is_active ? 'Désactiver' : 'Activer'} aria-label={t.is_active ? 'Désactiver' : 'Activer'}>
                    <Power size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {editing && <TemplateForm tpl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['quality', 'templates'] }); setEditing(null); }} />}
    </>
  );
}

function TemplateForm({ tpl, onClose, onSaved }: { tpl: QualityTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tpl?.name ?? '');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(tpl?.applies_to ?? 'general');
  const [items, setItems] = useState<QualityItem[]>(tpl?.items ?? [{ label: '', kind: 'ok' }]);

  const save = useMutation({
    mutationFn: () => {
      const clean = items.filter(i => i.label.trim());
      return tpl ? qualityApi.updateTemplate(tpl.id, { name: name.trim(), appliesTo, items: clean })
                 : qualityApi.createTemplate({ name: name.trim(), appliesTo, items: clean });
    },
    onSuccess: () => { notify.success(tpl ? 'Modèle enregistré' : 'Modèle créé'); onSaved(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const setItem = (i: number, patch: Partial<QualityItem>) => setItems(a => a.map((it, j) => j === i ? { ...it, ...patch } : it));
  const valid = name.trim().length >= 2 && items.some(i => i.label.trim());

  return (
    <Modal title={tpl ? 'Modifier le modèle' : 'Nouveau modèle'} onClose={onClose} locked={save.isPending} width={640}
      footer={<FormFooter onCancel={onClose} submitLabel={tpl ? 'Enregistrer' : 'Créer'} busy={save.isPending} disabled={!valid} onSubmit={() => save.mutate()} />}>
      <FormSection title="Modèle">
        <div className="ds-form-grid">
          <FormField label="Nom du modèle" htmlFor="tpl-name" required><input id="tpl-name" className="ds-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Réception matière première" /></FormField>
          <FormField label="S'applique à" htmlFor="tpl-applies">
            <select id="tpl-applies" className="ds-input" value={appliesTo} onChange={e => setAppliesTo(e.target.value as AppliesTo)}>
              {(Object.keys(APPLIES) as AppliesTo[]).map(k => <option key={k} value={k}>{APPLIES[k]}</option>)}
            </select>
          </FormField>
        </div>
      </FormSection>

      <FormSection title={<>Points à vérifier<span className="ds-req" aria-hidden="true"> *</span></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="text" className="ds-input" aria-label={`Point ${i + 1}`} value={it.label} onChange={e => setItem(i, { label: e.target.value })} placeholder="Point à vérifier" style={{ flex: 1, minWidth: 160, width: 'auto' }} />
              <select className="ds-input" aria-label={`Type du point ${i + 1}`} value={it.kind} onChange={e => setItem(i, { kind: e.target.value as 'ok' | 'measure' })} style={{ width: 150 }}>
                <option value="ok">Conforme / non</option>
                <option value="measure">Mesure (plage)</option>
              </select>
              {it.kind === 'measure' && (
                <>
                  <input type="number" step="any" className="ds-input" aria-label="Minimum" value={it.min ?? ''} onChange={e => setItem(i, { min: e.target.value === '' ? null : Number(e.target.value) })} placeholder="min" style={{ width: 80 }} />
                  <input type="number" step="any" className="ds-input" aria-label="Maximum" value={it.max ?? ''} onChange={e => setItem(i, { max: e.target.value === '' ? null : Number(e.target.value) })} placeholder="max" style={{ width: 80 }} />
                  <input type="text" className="ds-input" aria-label="Unité" value={it.unit ?? ''} onChange={e => setItem(i, { unit: e.target.value })} placeholder="unité" style={{ width: 80 }} />
                </>
              )}
              <button type="button" className="ds-icon-btn" onClick={() => setItems(a => a.filter((_, j) => j !== i))} title="Retirer" aria-label="Retirer"><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="odoo-btn-secondary ds-btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setItems(a => [...a, { label: '', kind: 'ok' }])}><Plus size={13} /> Ajouter un point</button>
        </div>
      </FormSection>
    </Modal>
  );
}
