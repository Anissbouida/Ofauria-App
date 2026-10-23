import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Printer, Plus, Info, Thermometer } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  haccpApi, ACTION_STATUS_LABELS, ACTION_SOURCE_LABELS, FREQUENCY_LABELS, EQUIPMENT_TYPE_LABELS,
  type ActionStatus, type CleaningTask, type EquipmentConfig, type EquipmentType, type Frequency, type ReceptionRow,
} from '../../api/haccp.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Contrôle & Qualité › HACCP (mig 315) — côté gérant : validation des actions
 * correctives, registres imprimables (températures, nettoyage), contrôle à
 * réception, configuration des enceintes et du plan de nettoyage.
 */

type View = 'actions' | 'temperatures' | 'nettoyage' | 'receptions' | 'config';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'actions', label: 'Actions correctives' },
  { key: 'temperatures', label: 'Registre températures' },
  { key: 'nettoyage', label: 'Registre nettoyage' },
  { key: 'receptions', label: 'Contrôle à réception' },
  { key: 'config', label: 'Configuration' },
];

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const dt = (s: string | null) => (s ? format(new Date(s), 'dd/MM/yyyy HH:mm') : '—');
const t = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} °C`);
const STATUS_TAG: Record<ActionStatus, string> = { open: 'odoo-tag-red', done: 'odoo-tag-yellow', validated: 'odoo-tag-green' };
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 };

export default function HaccpManagerTab() {
  const [view, setView] = useState<View>('actions');
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Vues HACCP">
        {VIEWS.map(v => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
            className={view === v.key ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setView(v.key)}>{v.label}</button>
        ))}
        <Link to="/haccp" className="odoo-btn-secondary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Thermometer size={13} /> Feuille du jour
        </Link>
      </div>
      {view === 'actions' && <ActionsView />}
      {view === 'temperatures' && <TemperaturesView />}
      {view === 'nettoyage' && <CleaningView />}
      {view === 'receptions' && <ReceptionsView />}
      {view === 'config' && <ConfigView />}
    </>
  );
}

function Range({ from, to, onFrom, onTo, children }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; children?: React.ReactNode }) {
  return (
    <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
      <span style={{ fontSize: '0.8125rem' }}>Du</span>
      <input type="date" value={from} onChange={e => onFrom(e.target.value)} className="odoo-search-input" style={{ width: 150 }} aria-label="Du" />
      <span style={{ fontSize: '0.8125rem' }}>au</span>
      <input type="date" value={to} onChange={e => onTo(e.target.value)} className="odoo-search-input" style={{ width: 150 }} aria-label="Au" />
      {children}
      <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => window.print()}>
        <Printer size={13} /> Imprimer
      </button>
    </div>
  );
}

function Loading() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Loader2 size={20} className="animate-spin" /></div>;
}

/* ─── Actions correctives ──────────────────────────────────────────── */

function ActionsView() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'done' | 'open' | 'validated' | ''>('done');
  const { data = [], isLoading } = useQuery({
    queryKey: ['haccp-actions', status],
    queryFn: () => haccpApi.actions(status ? { status } : { from: daysAgo(90) }),
  });
  const validate = useMutation({
    mutationFn: (p: { id: string; approve: boolean; note?: string | null }) => haccpApi.validateAction(p.id, p.approve, p.note),
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ['haccp-actions'] });
      qc.invalidateQueries({ queryKey: ['controle-overview'] });
      notify.success(p.approve ? 'Action validée' : 'Action renvoyée au chef');
    },
    onError: (e) => notify.error(e),
  });
  const sendBack = (id: string) => {
    const note = window.prompt('Pourquoi renvoyer cette action ? (le chef verra ce commentaire)');
    if (note?.trim()) validate.mutate({ id, approve: false, note });
  };

  return (
    <>
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="odoo-search-input" aria-label="Statut">
          <option value="done">À valider</option>
          <option value="open">À traiter (rien de fait)</option>
          <option value="validated">Validées</option>
          <option value="">Toutes (90 jours)</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{data.length} action(s)</span>
      </div>
      {isLoading ? <Loading /> : data.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Rien à afficher">Aucune action corrective dans cet état.</StatusBanner>
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Date</th><th>Origine</th><th>Problème</th><th>Action réalisée</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {data.map(a => (
                <tr key={a.id} className={a.status === 'open' ? 'row-danger' : undefined}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{dt(a.created_at)}<div style={{ color: 'var(--theme-text-muted)' }}>{a.created_by_name}</div></td>
                  <td><span className="odoo-tag odoo-tag-grey">{ACTION_SOURCE_LABELS[a.source_kind]}</span></td>
                  <td style={{ maxWidth: 320 }}>{a.problem}</td>
                  <td style={{ maxWidth: 320, fontSize: '0.8125rem' }}>
                    {a.action_taken ?? <span style={{ color: '#dc3545' }}>—</span>}
                    {a.done_by_name && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{a.done_by_name} · {dt(a.done_at)}</div>}
                    {a.validation_note && <div style={{ fontSize: '0.6875rem', color: '#b85d1a' }}>Gérant : {a.validation_note}</div>}
                  </td>
                  <td><span className={`odoo-tag ${STATUS_TAG[a.status]}`}>{ACTION_STATUS_LABELS[a.status]}</span>
                    {a.validated_by_name && a.status === 'validated' && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{a.validated_by_name}</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {a.status === 'done' && (
                      <>
                        <button type="button" className="odoo-btn-primary" disabled={validate.isPending} onClick={() => validate.mutate({ id: a.id, approve: true })}>Valider</button>{' '}
                        <button type="button" className="odoo-btn-secondary" disabled={validate.isPending} onClick={() => sendBack(a.id)}>Renvoyer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ─── Registres ────────────────────────────────────────────────────── */

function TemperaturesView() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(iso(new Date()));
  const [outOnly, setOutOnly] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ['haccp-readings', from, to, outOnly],
    queryFn: () => haccpApi.readings({ from, to, ...(outOnly ? { outOfRange: 'true' as const } : {}) }),
  });
  return (
    <>
      <Range from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={outOnly} onChange={e => setOutOnly(e.target.checked)} /> Hors plage seulement
        </label>
      </Range>
      {isLoading ? <Loading /> : data.length === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Aucun relevé sur la période" />
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Date et heure</th><th>Enceinte</th><th style={{ textAlign: 'right' }}>Relevé</th><th>Plage</th><th>Par</th><th>Action corrective</th></tr></thead>
            <tbody>
              {data.map(r => (
                <tr key={r.id} className={r.in_range ? undefined : 'row-danger'}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dt(r.read_at)}</td>
                  <td>{r.equipment_name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: r.in_range ? undefined : '#dc3545' }}>{t(r.value)}</td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{t(r.temp_min)} à {t(r.temp_max)}</td>
                  <td style={{ fontSize: '0.75rem' }}>{r.read_by_name ?? '—'}</td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {r.action_status ? <><span className={`odoo-tag ${STATUS_TAG[r.action_status]}`}>{ACTION_STATUS_LABELS[r.action_status]}</span> {r.action_taken}</> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CleaningView() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(iso(new Date()));
  const { data = [], isLoading } = useQuery({ queryKey: ['haccp-cleaning', from, to], queryFn: () => haccpApi.cleaningLogs({ from, to }) });
  return (
    <>
      <Range from={from} to={to} onFrom={setFrom} onTo={setTo} />
      {isLoading ? <Loading /> : data.length === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Aucun nettoyage enregistré sur la période" />
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Date et heure</th><th>Zone</th><th>Tâche</th><th>Fréquence</th><th>Par</th><th>Résultat</th></tr></thead>
            <tbody>
              {data.map(l => (
                <tr key={l.id} className={l.conforme ? undefined : 'row-danger'}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dt(l.done_at)}</td>
                  <td>{l.zone}</td>
                  <td>{l.label}</td>
                  <td>{FREQUENCY_LABELS[l.frequency]}</td>
                  <td style={{ fontSize: '0.75rem' }}>{l.done_by_name ?? '—'}</td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {l.conforme ? <span className="odoo-tag odoo-tag-green">Conforme</span> : <><span className="odoo-tag odoo-tag-red">Non conforme</span> {l.note}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ─── Contrôle à réception ─────────────────────────────────────────── */

type Tri = boolean | null;
function TriToggle({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
      {label}
      <select value={value == null ? '' : value ? 'ok' : 'ko'} onChange={e => onChange(e.target.value === '' ? null : e.target.value === 'ok')} className="odoo-search-input">
        <option value="">Non vérifié</option>
        <option value="ok">Conforme</option>
        <option value="ko">Non conforme</option>
      </select>
    </label>
  );
}

function ReceptionCheckForm({ r, onDone }: { r: ReceptionRow; onDone: () => void }) {
  const [temperatureOk, setTemperatureOk] = useState<Tri>(r.temperature_ok);
  const [temperatureValue, setTemperatureValue] = useState(r.temperature_value == null ? '' : String(r.temperature_value));
  const [visualOk, setVisualOk] = useState<Tri>(r.visual_ok);
  const [packagingOk, setPackagingOk] = useState<Tri>(r.packaging_ok);
  const [labelsOk, setLabelsOk] = useState<Tri>(r.labels_ok);
  const [notes, setNotes] = useState(r.qc_notes ?? '');
  const [actionTaken, setActionTaken] = useState('');
  const anyKo = [temperatureOk, visualOk, packagingOk, labelsOk].includes(false);
  const save = useMutation({
    mutationFn: () => haccpApi.checkReception(r.id, {
      temperatureOk, temperatureValue: temperatureValue.trim() ? Number(temperatureValue.replace(',', '.')) : null,
      visualOk, packagingOk, labelsOk, overallConformity: !anyKo, notes: notes || null, actionTaken: anyKo ? actionTaken || null : null,
    }),
    onSuccess: () => { notify.success(anyKo ? 'Non-conformité enregistrée, action corrective ouverte' : 'Contrôle enregistré'); onDone(); },
    onError: (e) => notify.error(e),
  });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
      <TriToggle label="Température" value={temperatureOk} onChange={setTemperatureOk} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Relevé (°C)
        <input type="text" inputMode="decimal" value={temperatureValue} onChange={e => setTemperatureValue(e.target.value)} className="odoo-search-input" />
      </label>
      <TriToggle label="Aspect" value={visualOk} onChange={setVisualOk} />
      <TriToggle label="Emballage" value={packagingOk} onChange={setPackagingOk} />
      <TriToggle label="Étiquetage / DLC" value={labelsOk} onChange={setLabelsOk} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)', gridColumn: 'span 2' }}>
        Observations
        <input value={notes} onChange={e => setNotes(e.target.value)} className="odoo-search-input" />
      </label>
      {anyKo && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: '#dc3545', gridColumn: 'span 2' }}>
          Action réalisée (refus, avoir demandé…), facultatif
          <input value={actionTaken} onChange={e => setActionTaken(e.target.value)} className="odoo-search-input" />
        </label>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className={anyKo ? 'odoo-btn-danger' : 'odoo-btn-primary'} disabled={save.isPending} onClick={() => save.mutate()}>
          {anyKo ? 'Enregistrer non conforme' : 'Enregistrer conforme'}
        </button>
        <button type="button" className="odoo-btn-secondary" onClick={onDone}>Annuler</button>
      </div>
    </div>
  );
}

function ReceptionsView() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(iso(new Date()));
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['haccp-receptions', from, to], queryFn: () => haccpApi.receptions({ from, to }) });
  const rows = data.filter(r => !onlyMissing || r.overall_conformity == null || r.overall_conformity === false);
  const done = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['haccp-receptions'] }); qc.invalidateQueries({ queryKey: ['controle-overview'] }); };
  return (
    <>
      <Range from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
          <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> Non contrôlées ou non conformes
        </label>
      </Range>
      {isLoading ? <Loading /> : rows.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Toutes les réceptions de la période sont contrôlées" />
      ) : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Date</th><th>Bon</th><th>Fournisseur</th><th>Reçu par</th><th>Contrôle</th><th /></tr></thead>
            <tbody>
              {rows.map(r => [
                <tr key={r.id} className={r.overall_conformity === false ? 'row-danger' : undefined}>
                  <td>{format(new Date(`${r.reception_date}T00:00:00`), 'dd/MM/yyyy')}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', fontWeight: 600 }}>{r.voucher_number}</td>
                  <td>{r.supplier_name ?? '—'}</td>
                  <td style={{ fontSize: '0.75rem' }}>{r.received_by_name ?? '—'}</td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {r.overall_conformity == null ? <span style={{ color: '#b85d1a', fontWeight: 600 }}>Non contrôlée</span>
                      : r.overall_conformity ? <span className="odoo-tag odoo-tag-green">Conforme</span>
                        : <span className="odoo-tag odoo-tag-red">Non conforme</span>}
                    {r.temperature_value != null && ` · ${t(r.temperature_value)}`}
                    {r.checked_by_name && <div style={{ color: 'var(--theme-text-muted)' }}>{r.checked_by_name} · {dt(r.checked_at)}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="odoo-btn-secondary" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                      {r.overall_conformity == null ? 'Contrôler' : 'Modifier'}
                    </button>
                  </td>
                </tr>,
                editing === r.id && (
                  <tr key={`${r.id}-f`}><td colSpan={6} style={{ background: 'var(--odoo-bg-hover)' }}><ReceptionCheckForm r={r} onDone={done} /></td></tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ─── Configuration ────────────────────────────────────────────────── */

function ConfigView() {
  return (
    <>
      <EquipmentConfigTable />
      <TasksConfigTable />
    </>
  );
}

function EquipmentConfigTable() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['haccp-equipment'], queryFn: haccpApi.equipment });
  const [drafts, setDrafts] = useState<Record<string, Partial<EquipmentConfig>>>({});
  const [adding, setAdding] = useState(false);
  const [newEq, setNewEq] = useState({ nom: '', type: 'vitrine' as EquipmentType, temp_min: '0', temp_max: '4' });
  const save = useMutation({
    mutationFn: (e: Omit<EquipmentConfig, 'id' | 'is_active'> & { id?: string }) => haccpApi.saveEquipment(e),
    onSuccess: (_r, e) => {
      setDrafts(d => { const c = { ...d }; if (e.id) delete c[e.id]; return c; });
      setAdding(false); setNewEq({ nom: '', type: 'vitrine', temp_min: '0', temp_max: '4' });
      qc.invalidateQueries({ queryKey: ['haccp-equipment'] }); qc.invalidateQueries({ queryKey: ['haccp-today'] });
      notify.success('Enceinte enregistrée');
    },
    onError: (err) => notify.error(err),
  });
  const val = (e: EquipmentConfig) => ({ ...e, ...drafts[e.id] });
  const set = (id: string, patch: Partial<EquipmentConfig>) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>Enceintes froides surveillées</h3>
        {!adding && <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setAdding(true)}><Plus size={13} /> Ajouter</button>}
      </div>
      {isLoading ? <Loading /> : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Enceinte</th><th>Type</th><th>Surveillée</th><th>Min (°C)</th><th>Max (°C)</th><th>Relevés / jour</th><th /></tr></thead>
            <tbody>
              {adding && (
                <tr>
                  <td><input value={newEq.nom} onChange={e => setNewEq({ ...newEq, nom: e.target.value })} className="odoo-search-input" placeholder="Vitrine boutique" aria-label="Nom" /></td>
                  <td>
                    <select value={newEq.type} onChange={e => setNewEq({ ...newEq, type: e.target.value as EquipmentType })} className="odoo-search-input" aria-label="Type">
                      {(Object.keys(EQUIPMENT_TYPE_LABELS) as EquipmentType[]).map(k => <option key={k} value={k}>{EQUIPMENT_TYPE_LABELS[k]}</option>)}
                    </select>
                  </td>
                  <td>Oui</td>
                  <td><input value={newEq.temp_min} onChange={e => setNewEq({ ...newEq, temp_min: e.target.value })} className="odoo-search-input" style={{ width: 70 }} aria-label="Min" /></td>
                  <td><input value={newEq.temp_max} onChange={e => setNewEq({ ...newEq, temp_max: e.target.value })} className="odoo-search-input" style={{ width: 70 }} aria-label="Max" /></td>
                  <td>2</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="odoo-btn-primary" disabled={!newEq.nom.trim() || save.isPending}
                      onClick={() => save.mutate({ nom: newEq.nom, type: newEq.type, haccp_monitored: true, temp_min: numOrNull(newEq.temp_min), temp_max: numOrNull(newEq.temp_max), readings_per_day: 2 })}>Créer</button>{' '}
                    <button type="button" className="odoo-btn-secondary" onClick={() => setAdding(false)}>Annuler</button>
                  </td>
                </tr>
              )}
              {data.map(raw => {
                const e = val(raw);
                const dirty = !!drafts[raw.id];
                return (
                  <tr key={raw.id}>
                    <td style={{ fontWeight: 600 }}>{e.nom}</td>
                    <td>{EQUIPMENT_TYPE_LABELS[e.type]}</td>
                    <td><input type="checkbox" checked={e.haccp_monitored} onChange={ev => set(raw.id, { haccp_monitored: ev.target.checked })} aria-label={`Surveiller ${e.nom}`} /></td>
                    <td><input value={e.temp_min ?? ''} onChange={ev => set(raw.id, { temp_min: numOrNull(ev.target.value) })} className="odoo-search-input" style={{ width: 70 }} aria-label="Min" /></td>
                    <td><input value={e.temp_max ?? ''} onChange={ev => set(raw.id, { temp_max: numOrNull(ev.target.value) })} className="odoo-search-input" style={{ width: 70 }} aria-label="Max" /></td>
                    <td><input type="number" min={1} max={12} value={e.readings_per_day} onChange={ev => set(raw.id, { readings_per_day: Number(ev.target.value) || 1 })} className="odoo-search-input" style={{ width: 60 }} aria-label="Relevés par jour" /></td>
                    <td>{dirty && <button type="button" className="odoo-btn-primary" disabled={save.isPending}
                      onClick={() => save.mutate({ id: raw.id, nom: e.nom, type: e.type, haccp_monitored: e.haccp_monitored, temp_min: e.temp_min, temp_max: e.temp_max, readings_per_day: e.readings_per_day })}>Enregistrer</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Repères usuels : froid positif 0 à 4 °C, surgelé ≤ −18 °C, vitrine pâtisserie 0 à 4 °C. Une enceinte créée ici n'entre pas dans le coût de revient.
      </p>
    </div>
  );
}

function TasksConfigTable() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['haccp-tasks'], queryFn: haccpApi.tasks });
  const [draft, setDraft] = useState<(Omit<CleaningTask, 'id'> & { id?: string }) | null>(null);
  const save = useMutation({
    mutationFn: haccpApi.saveTask,
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['haccp-tasks'] }); qc.invalidateQueries({ queryKey: ['haccp-today'] }); notify.success('Tâche enregistrée'); },
    onError: (err) => notify.error(err),
  });
  const empty = () => ({ zone: '', label: '', frequency: 'daily' as Frequency, method: null, is_active: true, display_order: (data.length + 1) * 10 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>Plan de nettoyage</h3>
        {!draft && <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setDraft(empty())}><Plus size={13} /> Ajouter une tâche</button>}
      </div>
      {draft && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 2fr auto', gap: 8, alignItems: 'end', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 10 }}>
          <input value={draft.zone} onChange={e => setDraft({ ...draft, zone: e.target.value })} className="odoo-search-input" placeholder="Zone" aria-label="Zone" />
          <input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="odoo-search-input" placeholder="Tâche" aria-label="Tâche" />
          <select value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value as Frequency })} className="odoo-search-input" aria-label="Fréquence">
            {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map(f => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
          </select>
          <input value={draft.method ?? ''} onChange={e => setDraft({ ...draft, method: e.target.value || null })} className="odoo-search-input" placeholder="Méthode / produit" aria-label="Méthode" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="odoo-btn-primary" disabled={!draft.zone.trim() || !draft.label.trim() || save.isPending} onClick={() => save.mutate(draft)}>Enregistrer</button>
            <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
          </div>
        </div>
      )}
      {isLoading ? <Loading /> : (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr><th>Zone</th><th>Tâche</th><th>Fréquence</th><th>Méthode</th><th>Active</th><th /></tr></thead>
            <tbody>
              {data.map(k => (
                <tr key={k.id} style={{ opacity: k.is_active ? 1 : 0.5 }}>
                  <td>{k.zone}</td>
                  <td style={{ fontWeight: 600 }}>{k.label}</td>
                  <td>{FREQUENCY_LABELS[k.frequency]}</td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{k.method ?? '—'}</td>
                  <td><input type="checkbox" checked={k.is_active} aria-label={`Activer ${k.label}`} onChange={e => save.mutate({ ...k, is_active: e.target.checked })} /></td>
                  <td style={{ textAlign: 'right' }}><button type="button" className="odoo-btn-secondary" onClick={() => setDraft({ ...k })}>Modifier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

