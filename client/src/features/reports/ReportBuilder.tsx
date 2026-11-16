import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Loader2, Save, Trash2, Play, Plus, X, Download, LayoutGrid, Table2, LineChart, Hash, ChevronUp, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { reportsApi, type ReportConfig, type ReportField, type DashboardTile } from '../../api/reports.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
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
    <div className="kl-rep" style={{ display: 'grid' }}>
      <div className="prj-views" role="tablist" aria-label="Rapports personnalisés" style={{ justifySelf: 'start' }}>
        <button type="button" role="tab" aria-selected={mode === 'report'} className={mode === 'report' ? 'active' : ''} onClick={() => setMode('report')}><BarChart3 size={13} /> Constructeur</button>
        <button type="button" role="tab" aria-selected={mode === 'dashboard'} className={mode === 'dashboard' ? 'active' : ''} onClick={() => setMode('dashboard')}><LayoutGrid size={13} /> Tableaux de bord</button>
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

  const Tog = ({ f, on, onClick }: { f: ReportField; on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} aria-pressed={on} className={`kl-rb-tog${on ? ' on' : ''}`}>{f.label}</button>
  );

  return (
    <div className="kl-rb">
      <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
        <section>
          <div className="kl-sec"><h2>Paramètres</h2>{isFetching && <small><Loader2 size={13} className="animate-spin" style={{ display: 'inline' }} /> calcul…</small>}</div>
          <div className="kl-group kl-rb-form">
            <div className="kl-rb-row">
              <span className="k">Source</span>
              <span className="v"><SearchSelect value={sourceKey} onChange={pickSource} clearable={false} placeholder="Source" width={200} size="md" ariaLabel="Source de données" options={sources.map(s => ({ id: String(s.key), label: s.label as string }))} /></span>
            </div>
            {source?.hasDate !== false && (
              <div className="kl-rb-row">
                <span className="k">Période</span>
                <span className="v">
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="Du" />
                  <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="Au" />
                </span>
              </div>
            )}
            {source && (<>
              <div className="kl-rb-row">
                <span className="k">Regrouper par<small>dimensions</small></span>
                <span className="v">{source.dimensions.map(d => <Tog key={d.key} f={d} on={dims.includes(d.key)} onClick={() => toggle(dims, setDims, d.key)} />)}</span>
              </div>
              <div className="kl-rb-row">
                <span className="k">Calculer<small>indicateurs</small></span>
                <span className="v">{source.measures.map(m => <Tog key={m.key} f={m} on={meas.includes(m.key)} onClick={() => toggle(meas, setMeas, m.key)} />)}</span>
              </div>
              {source.filters.length > 0 && (
                <div className="kl-rb-row">
                  <span className="k">Filtres</span>
                  <span className="v">{source.filters.map(f => <FilterSelect key={f.key} sourceKey={sourceKey} field={f} value={filters[f.key] ?? ''} onChange={v => setFilters(p => ({ ...p, [f.key]: v }))} />)}</span>
                </div>
              )}
            </>)}
          </div>
        </section>

        {meas.length === 0 && <StatusBanner tone="warning" icon={Play} title="Sélectionnez au moins un indicateur à calculer." />}
        {isError && <StatusBanner tone="danger" icon={X} title="Erreur">{apiErrorMessage(error)}</StatusBanner>}

        <section>
          <div className="kl-sec"><h2>Résultat</h2>{rows.length > 0 && <small>{rows.length} ligne{rows.length > 1 ? 's' : ''}{rows.length === 500 ? ' (limité à 500)' : ''}</small>}</div>
          <div className="kl-group">
            {cols.length > 0 && (
              <div className="kl-rb-res-head">
                <div className="prj-views" role="tablist" aria-label="Visualisation">
                  {VIZ.map(v => <button key={v.key} type="button" role="tab" aria-selected={viz === v.key} className={viz === v.key ? 'active' : ''} onClick={() => setViz(v.key)}><v.icon size={13} /> {v.label}</button>)}
                </div>
                <span style={{ flex: 1 }} />
                <button type="button" className="odoo-btn-secondary" onClick={exportCsv} disabled={!rows.length}><Download size={13} /> CSV</button>
                <button type="button" className="odoo-btn-secondary" onClick={() => setAddOpen(true)} disabled={meas.length === 0}><Plus size={13} /> Ajouter à un tableau de bord</button>
              </div>
            )}
            <div className="kl-rb-res-body"><ReportViz columns={cols} rows={rows} viz={viz} /></div>
          </div>
        </section>
      </div>

      <aside className="kl-rb-side">
        <div className="kl-widget">
          <h3>{editingId ? 'Modifier le rapport' : 'Enregistrer le rapport'}</h3>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom du rapport" aria-label="Nom du rapport" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="odoo-btn-primary" onClick={save} style={{ flex: 1, justifyContent: 'center' }}><Save size={13} /> {editingId ? 'Enregistrer' : 'Créer'}</button>
            {editingId && <button type="button" className="odoo-btn-secondary" onClick={reset} title="Nouveau rapport"><Plus size={13} /></button>}
          </div>
        </div>
        <section>
          <div className="kl-sec"><h2 style={{ fontSize: 17 }}>Rapports enregistrés</h2><small>{saved.length}</small></div>
          <div className="kl-group kl-rb-saved">
            {saved.length === 0 && <div className="kl-viz-empty">Aucun rapport.</div>}
            {saved.map(s => (
              <div key={s.id} className={`kl-cell${editingId === s.id ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => load(s)}
                onKeyDown={e => { if (e.key === 'Enter') load(s); }}>
                <span className="kl-ic b" style={{ width: 28, height: 28, borderRadius: 8 }}><BarChart3 size={14} /></span>
                <span className="tx"><span className="t1" title={s.name}>{s.name}</span></span>
                <button type="button" className="kl-rb-del" title="Supprimer" aria-label={`Supprimer ${s.name}`}
                  onClick={async e => { e.stopPropagation(); await reportsApi.customDelete(s.id); if (editingId === s.id) reset(); qc.invalidateQueries({ queryKey: ['rb-saved'] }); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>

      {addOpen && <AddToDashboard tile={{ id: uid(), title: name || source?.label || 'Tuile', source_key: sourceKey, config: config(), viz }} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function FilterSelect({ sourceKey, field, value, onChange }: { sourceKey: string; field: ReportField; value: string; onChange: (v: string) => void }) {
  const { data: options = [] } = useQuery({ queryKey: ['rb-fopt', sourceKey, field.key], queryFn: () => reportsApi.customFilterOptions(sourceKey, field.key) });
  return (
    <label className="kl-rb-filter">{field.label}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ minWidth: 130 }}><option value="">Tous</option>{options.map(o => <option key={o} value={o}>{o}</option>)}</select></label>
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
            <SearchSelect value={target} onChange={setTarget} placeholder="— Nouveau —" width="100%" size="md" ariaLabel="Tableau de bord"
              options={dashboards.map(d => ({ id: String(d.id), label: d.name as string }))} /></label>
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

  async function saveTiles(tiles: DashboardTile[]) {
    if (!dash) return;
    await reportsApi.dashboardUpdate(dash.id, { name: dash.name, tiles });
    qc.invalidateQueries({ queryKey: ['rb-dash-one', dash.id] });
  }
  const removeTile = (id: string) => dash && saveTiles(dash.tiles.filter(t => t.id !== id));
  const resizeTile = (id: string, size: 'half' | 'full') => dash && saveTiles(dash.tiles.map(t => t.id === id ? { ...t, size } : t));
  function moveTile(i: number, dir: -1 | 1) {
    if (!dash) return;
    const j = i + dir; const tiles = [...dash.tiles];
    if (j < 0 || j >= tiles.length) return;
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    saveTiles(tiles);
  }
  async function del() {
    if (!dash || !await confirm(`Supprimer le tableau de bord « ${dash.name} » ?`, { danger: true })) return;
    await reportsApi.dashboardDelete(dash.id); setSelId(null);
    qc.invalidateQueries({ queryKey: ['rb-dash'] });
  }

  if (!dashboards.length) return (
    <div className="kl-ar-empty" style={{ display: 'grid', justifyItems: 'center', gap: 6, padding: '40px 16px' }}>
      <LayoutGrid size={28} style={{ opacity: .35 }} />
      <b style={{ color: 'var(--theme-text-strong)', fontSize: 16 }}>Aucun tableau de bord</b>
      <span>Créez un rapport dans le Constructeur, puis « Ajouter à un tableau de bord ».</span>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {dashboards.length <= 6 ? (
          <div className="prj-views" role="tablist" aria-label="Tableaux de bord">
            {dashboards.map(d => <button key={d.id} type="button" role="tab" aria-selected={d.id === activeId} className={d.id === activeId ? 'active' : ''} onClick={() => setSelId(d.id)}>{d.name} <small style={{ opacity: .6 }}>{d.tile_count}</small></button>)}
          </div>
        ) : (
          <SearchSelect value={activeId != null ? String(activeId) : ''} onChange={setSelId} clearable={false} placeholder="Tableau de bord" width={240} size="md" ariaLabel="Tableau de bord actif" options={dashboards.map(d => ({ id: String(d.id), label: `${d.name} (${d.tile_count})` }))} />
        )}
        {dash && <button type="button" className="odoo-btn-danger" onClick={del} style={{ marginLeft: 'auto' }}><Trash2 size={13} /> Supprimer</button>}
      </div>
      {dash && dash.tiles.length === 0 && <div className="kl-ar-empty">Tableau de bord vide : ajoutez des tuiles depuis le Constructeur.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20 }}>
        {dash?.tiles.map((t, i) => (
          <div key={t.id} style={{ gridColumn: (t.size ?? 'half') === 'full' ? '1 / -1' : 'auto', minWidth: 0 }}>
            <Tile tile={t} onRemove={() => removeTile(t.id)} onResize={() => resizeTile(t.id, (t.size ?? 'half') === 'full' ? 'half' : 'full')}
              onUp={() => moveTile(i, -1)} onDown={() => moveTile(i, 1)} isFirst={i === 0} isLast={i === dash.tiles.length - 1} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Tile({ tile, onRemove, onResize, onUp, onDown, isFirst, isLast }: {
  tile: DashboardTile; onRemove: () => void; onResize: () => void; onUp: () => void; onDown: () => void; isFirst: boolean; isLast: boolean;
}) {
  const { data: result, isFetching, isError } = useQuery({
    queryKey: ['rb-tile', tile.id, tile.config],
    queryFn: () => reportsApi.customRun({ sourceKey: tile.source_key, ...tile.config, limit: 200 }),
  });
  const full = (tile.size ?? 'half') === 'full';
  return (
    <div className="kl-rb-tile">
      <div className="kl-rb-tile-head">
        <b title={tile.title}>{tile.title}</b>
        <div className="acts">
          {isFetching && <Loader2 size={13} className="animate-spin" style={{ alignSelf: 'center', marginRight: 4 }} />}
          <button type="button" onClick={onUp} disabled={isFirst} title="Monter" aria-label="Monter"><ChevronUp size={14} /></button>
          <button type="button" onClick={onDown} disabled={isLast} title="Descendre" aria-label="Descendre"><ChevronDown size={14} /></button>
          <button type="button" onClick={onResize} title={full ? 'Demi-largeur' : 'Pleine largeur'} aria-label={full ? 'Demi-largeur' : 'Pleine largeur'}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          <button type="button" onClick={onRemove} title="Retirer" aria-label="Retirer"><X size={14} /></button>
        </div>
      </div>
      <div style={{ padding: '0 14px 14px', minHeight: 60, flex: 1 }}>
        {isError ? <p className="kl-viz-empty" style={{ color: 'var(--prj-red)' }}>Erreur de chargement.</p>
          : result ? <ReportViz columns={result.columns} rows={result.rows} viz={tile.viz} />
            : <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></div>}
      </div>
    </div>
  );
}
