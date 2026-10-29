import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Loader2, Save, Trash2, Play, Plus, X, Download, LayoutGrid, Table2, LineChart, Hash } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { reportsApi, type ReportConfig, type ReportField, type DashboardTile } from '../../api/reports.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { ReportViz, toCsv, type VizType } from './ReportViz';

const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
const uid = () => Math.random().toString(36).slice(2, 10);
const VIZ: { key: VizType; label: string; icon: typeof Table2 }[] = [
  { key: 'table', label: 'Table', icon: Table2 }, { key: 'bar', label: 'Barres', icon: BarChart3 },
  { key: 'line', label: 'Courbe', icon: LineChart }, { key: 'kpi', label: 'Indicateurs', icon: Hash },
];

export default function ReportBuilder() {
  const [mode, setMode] = useState<'report' | 'dashboard'>('report');
  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={BarChart3} title="Rapports & tableaux de bord configurables">
        Construisez des rapports (source → dimensions, indicateurs, filtres), visualisez-les, exportez-les, puis composez des tableaux de bord de plusieurs tuiles.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={mode === 'report' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode('report')}>Constructeur</button>
        <button className={mode === 'dashboard' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode('dashboard')}><LayoutGrid size={14} /> Tableaux de bord</button>
      </div>
      {mode === 'report' ? <BuilderView /> : <Dashboards />}
    </div>
  );
}

/* ─── Constructeur de rapport ──────────────────────────────────────────── */
function BuilderView() {
  const qc = useQueryClient();
  const { data: sources = [] } = useQuery({ queryKey: ['rb-sources'], queryFn: () => reportsApi.customSources() });
  const { data: saved = [] } = useQuery({ queryKey: ['rb-saved'], queryFn: () => reportsApi.customList() });

  const [sourceKey, setSourceKey] = useState('');
  const [dims, setDims] = useState<string[]>([]);
  const [meas, setMeas] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [viz, setViz] = useState<VizType>('bar');
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const source = sources.find(s => s.key === sourceKey);
  function pickSource(k: string, reset = true) {
    setSourceKey(k);
    if (reset) {
      const s = sources.find(x => x.key === k);
      setDims(s?.dimensions[0] ? [s.dimensions[0].key] : []);
      setMeas(s?.measures[0] ? [s.measures[0].key] : []);
      setFilters({}); setSort(null);
    }
  }
  useEffect(() => { if (!sourceKey && sources.length) pickSource(sources[0].key); }, [sources]); // eslint-disable-line
  const toggle = (arr: string[], set: (v: string[]) => void, k: string) => set(arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k]);

  const runConfig = useMemo(() => ({ sourceKey, dimensions: dims, measures: meas, filters, dateFrom, dateTo, sort: sort ?? undefined, limit: 500 }), [sourceKey, dims, meas, filters, dateFrom, dateTo, sort]);
  const { data: result, isFetching, isError, error } = useQuery({
    queryKey: ['rb-run', runConfig], queryFn: () => reportsApi.customRun(runConfig), enabled: !!sourceKey && meas.length > 0,
  });
  const cols = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const config = (): ReportConfig => ({ dimensions: dims, measures: meas, filters, dateFrom, dateTo, sort: sort ?? undefined, viz });

  async function save() {
    if (!name.trim()) { notify.error('Donnez un nom au rapport'); return; }
    try {
      if (editingId) await reportsApi.customUpdate(editingId, { name, sourceKey, config: config() });
      else { const r = await reportsApi.customCreate({ name, sourceKey, config: config() }); setEditingId(r.id); }
      notify.success('Rapport enregistré');
      qc.invalidateQueries({ queryKey: ['rb-saved'] });
    } catch (e) { notify.error(apiErrorMessage(e)); }
  }
  function load(s: typeof saved[number]) {
    setEditingId(s.id); setName(s.name); setSourceKey(s.source_key);
    const c = s.config || ({} as ReportConfig);
    setDims(c.dimensions ?? []); setMeas(c.measures ?? []); setFilters(c.filters ?? {});
    setDateFrom(c.dateFrom ?? dateFrom); setDateTo(c.dateTo ?? dateTo); setSort(c.sort ?? null); setViz(c.viz ?? 'bar');
  }
  function reset() { setEditingId(null); setName(''); if (source) pickSource(source.key); }
  function exportCsv() {
    if (!rows.length) return;
    const csv = toCsv(cols, rows);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${(name || sourceKey || 'rapport').replace(/\s+/g, '_')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const Chip = ({ f, on, onClick }: { f: ReportField; on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={on ? 'odoo-tag odoo-tag-blue' : 'odoo-tag odoo-tag-grey'} style={{ cursor: 'pointer', border: 'none', padding: '0.25rem 0.55rem' }}>{f.label}</button>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Source</span>
            <select value={sourceKey} onChange={e => pickSource(e.target.value)} style={{ ...inp, minWidth: 150 }}>{sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Du</span><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Au</span><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} /></label>
          {isFetching && <Loader2 size={15} className="animate-spin" style={{ marginBottom: 8 }} />}
        </div>

        {source && (<>
          <Section label="Dimensions (regrouper par)"><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{source.dimensions.map(d => <Chip key={d.key} f={d} on={dims.includes(d.key)} onClick={() => toggle(dims, setDims, d.key)} />)}</div></Section>
          <Section label="Indicateurs (calculer)"><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{source.measures.map(m => <Chip key={m.key} f={m} on={meas.includes(m.key)} onClick={() => toggle(meas, setMeas, m.key)} />)}</div></Section>
          {source.filters.length > 0 && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{source.filters.map(f => <FilterSelect key={f.key} sourceKey={sourceKey} field={f} value={filters[f.key] ?? ''} onChange={v => setFilters(p => ({ ...p, [f.key]: v }))} />)}</div>}
        </>)}

        {meas.length === 0 && <StatusBanner tone="warning" icon={Play} title="Sélectionnez au moins un indicateur à calculer." />}
        {isError && <StatusBanner tone="danger" icon={X} title="Erreur">{apiErrorMessage(error)}</StatusBanner>}

        {cols.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>{VIZ.map(v => <button key={v.key} type="button" onClick={() => setViz(v.key)} className={viz === v.key ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '0.3rem 0.5rem' }}><v.icon size={13} /> {v.label}</button>)}</div>
            <button type="button" className="odoo-btn-secondary" onClick={exportCsv} disabled={!rows.length} style={{ marginLeft: 'auto' }}><Download size={13} /> CSV</button>
            <button type="button" className="odoo-btn-secondary" onClick={() => setAddOpen(true)} disabled={meas.length === 0}><Plus size={13} /> Ajouter à un tableau de bord</button>
          </div>
        )}

        <div style={{ border: cols.length ? '1px solid var(--odoo-border)' : 'none', borderRadius: 6 }}>
          <ReportViz columns={cols} rows={rows} viz={viz} />
        </div>
        {rows.length > 0 && <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{rows.length} ligne(s){rows.length === 500 ? ' (limité à 500)' : ''}.</p>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{editingId ? 'Modifier le rapport' : 'Enregistrer le rapport'}</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom du rapport" style={inp} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="odoo-btn-primary" onClick={save} style={{ flex: 1 }}><Save size={13} /> {editingId ? 'Enregistrer' : 'Créer'}</button>
            {editingId && <button type="button" className="odoo-btn-secondary" onClick={reset} title="Nouveau"><Plus size={13} /></button>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', margin: '2px 0 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Rapports enregistrés</div>
          {saved.length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)' }}>Aucun rapport.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {saved.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.35rem 0.5rem', borderRadius: 4, background: editingId === s.id ? 'var(--theme-bg-subtle, #eef3ff)' : 'transparent', border: '1px solid var(--odoo-border)' }}>
                <button type="button" onClick={() => load(s)} style={{ flex: 1, textAlign: 'left', fontSize: '0.8rem', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</button>
                <button type="button" onClick={async () => { await reportsApi.customDelete(s.id); if (editingId === s.id) reset(); qc.invalidateQueries({ queryKey: ['rb-saved'] }); }} className="odoo-pager-btn" title="Supprimer"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {addOpen && <AddToDashboard tile={{ id: uid(), title: name || source?.label || 'Tuile', source_key: sourceKey, config: config(), viz }} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>{children}</div>;
}

function FilterSelect({ sourceKey, field, value, onChange }: { sourceKey: string; field: ReportField; value: string; onChange: (v: string) => void }) {
  const { data: options = [] } = useQuery({ queryKey: ['rb-fopt', sourceKey, field.key], queryFn: () => reportsApi.customFilterOptions(sourceKey, field.key) });
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>{field.label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, minWidth: 140 }}><option value="">Tous</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></label>
  );
}

/* ─── Ajout d'une tuile à un tableau de bord ───────────────────────────── */
function AddToDashboard({ tile, onClose }: { tile: DashboardTile; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: dashboards = [] } = useQuery({ queryKey: ['rb-dash'], queryFn: () => reportsApi.dashboards() });
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');
  const [title, setTitle] = useState(tile.title);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const t = { ...tile, title: title.trim() || tile.title };
      if (target === '__new__' || !target) {
        if (!newName.trim()) { notify.error('Nom du tableau de bord requis'); setBusy(false); return; }
        await reportsApi.dashboardCreate({ name: newName, tiles: [t] });
      } else {
        const d = await reportsApi.getDashboard(target);
        await reportsApi.dashboardUpdate(target, { name: d.name, tiles: [...(d.tiles ?? []), t] });
      }
      notify.success('Tuile ajoutée');
      qc.invalidateQueries({ queryKey: ['rb-dash'] });
      onClose();
    } catch (e) { notify.error(apiErrorMessage(e)); setBusy(false); }
  }

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(460px, 96vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><LayoutGrid size={16} /> Ajouter à un tableau de bord</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Titre de la tuile</span><input value={title} onChange={e => setTitle(e.target.value)} style={inp} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Tableau de bord</span>
            <select value={target} onChange={e => setTarget(e.target.value)} style={{ ...inp, width: '100%' }}>
              <option value="">— Nouveau —</option>
              {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
          {(!target) && <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Nom du nouveau tableau de bord</span><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ex : Pilotage quotidien" style={inp} /></label>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={busy} onClick={add}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Ajouter</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Tableaux de bord ─────────────────────────────────────────────────── */
function Dashboards() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: dashboards = [] } = useQuery({ queryKey: ['rb-dash'], queryFn: () => reportsApi.dashboards() });
  const [selId, setSelId] = useState<string | null>(null);
  const activeId = selId ?? dashboards[0]?.id ?? null;
  const { data: dash } = useQuery({ queryKey: ['rb-dash-one', activeId], queryFn: () => reportsApi.getDashboard(activeId!), enabled: !!activeId });

  async function removeTile(tileId: string) {
    if (!dash) return;
    await reportsApi.dashboardUpdate(dash.id, { name: dash.name, tiles: dash.tiles.filter(t => t.id !== tileId) });
    qc.invalidateQueries({ queryKey: ['rb-dash-one', dash.id] });
  }
  async function del() {
    if (!dash || !await confirm(`Supprimer le tableau de bord « ${dash.name} » ?`, { danger: true })) return;
    await reportsApi.dashboardDelete(dash.id); setSelId(null);
    qc.invalidateQueries({ queryKey: ['rb-dash'] });
  }

  if (!dashboards.length) return <StatusBanner tone="info" icon={LayoutGrid} title="Aucun tableau de bord">Créez un rapport dans le Constructeur puis « Ajouter à un tableau de bord ».</StatusBanner>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={activeId ?? ''} onChange={e => setSelId(e.target.value)} style={{ ...inp, minWidth: 220 }}>{dashboards.map(d => <option key={d.id} value={d.id}>{d.name} ({d.tile_count})</option>)}</select>
        {dash && <button type="button" className="odoo-btn-secondary" onClick={del} style={{ marginLeft: 'auto' }}><Trash2 size={13} /> Supprimer</button>}
      </div>
      {dash && dash.tiles.length === 0 && <StatusBanner tone="info" icon={LayoutGrid} title="Tableau de bord vide">Ajoutez des tuiles depuis le Constructeur.</StatusBanner>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {dash?.tiles.map(t => <Tile key={t.id} tile={t} onRemove={() => removeTile(t.id)} />)}
      </div>
    </div>
  );
}

function Tile({ tile, onRemove }: { tile: DashboardTile; onRemove: () => void }) {
  const { data: result, isFetching, isError } = useQuery({
    queryKey: ['rb-tile', tile.id, tile.config],
    queryFn: () => reportsApi.customRun({ sourceKey: tile.source_key, ...tile.config, limit: 200 }),
  });
  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--odoo-border)', background: 'var(--theme-bg-subtle, #f7f8fa)' }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tile.title}>{tile.title}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isFetching && <Loader2 size={13} className="animate-spin" />}
          <button type="button" onClick={onRemove} className="odoo-pager-btn" title="Retirer"><X size={13} /></button>
        </div>
      </div>
      <div style={{ padding: 4, minHeight: 60 }}>
        {isError ? <p style={{ fontSize: '0.8rem', color: '#dc3545', padding: 12 }}>Erreur de chargement.</p>
          : result ? <ReportViz columns={result.columns} rows={result.rows} viz={tile.viz} />
            : <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></div>}
      </div>
    </div>
  );
}
