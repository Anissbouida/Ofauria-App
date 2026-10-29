import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Loader2, Save, Trash2, Play, Plus, X } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { reportsApi, type ReportColumn, type ReportConfig, type ReportField } from '../../api/reports.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';

const inp: React.CSSProperties = { padding: '0.4rem 0.55rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit' };
const palette = ['#4f8df7', '#34c38f', '#f6a609', '#8e6fe0', '#ef6b6b', '#2ab7c4', '#e879a6', '#7a8b99'];

function fmtVal(v: any, col: ReportColumn): string {
  if (v == null) return '—';
  if (col.kind === 'measure') {
    const n = Number(v) || 0;
    if (col.format === 'currency') return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    if (col.format === 'integer') return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }
  return String(v);
}

/** Rapports configurables (mig 394) : source → dimensions, indicateurs, filtres, exécution, graphe, enregistrement. */
export default function ReportBuilder() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: sources = [] } = useQuery({ queryKey: ['rb-sources'], queryFn: () => reportsApi.customSources() });
  const { data: saved = [] } = useQuery({ queryKey: ['rb-saved'], queryFn: () => reportsApi.customList() });

  const [sourceKey, setSourceKey] = useState('');
  const [dims, setDims] = useState<string[]>([]);
  const [meas, setMeas] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

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
    queryKey: ['rb-run', runConfig],
    queryFn: () => reportsApi.customRun(runConfig),
    enabled: !!sourceKey && meas.length > 0,
  });

  const configToSave = (): ReportConfig => ({ dimensions: dims, measures: meas, filters, dateFrom, dateTo, sort: sort ?? undefined });
  async function save() {
    if (!name.trim()) { notify.error('Donnez un nom au rapport'); return; }
    try {
      if (editingId) await reportsApi.customUpdate(editingId, { name, sourceKey, config: configToSave() });
      else { const r = await reportsApi.customCreate({ name, sourceKey, config: configToSave() }); setEditingId(r.id); }
      notify.success('Rapport enregistré');
      qc.invalidateQueries({ queryKey: ['rb-saved'] });
    } catch (e) { notify.error(apiErrorMessage(e)); }
  }
  function load(s: typeof saved[number]) {
    setEditingId(s.id); setName(s.name); setSourceKey(s.source_key);
    const c = s.config || ({} as ReportConfig);
    setDims(c.dimensions ?? []); setMeas(c.measures ?? []); setFilters(c.filters ?? {});
    setDateFrom(c.dateFrom ?? dateFrom); setDateTo(c.dateTo ?? dateTo); setSort(c.sort ?? null);
  }
  async function del(id: string) {
    if (!await confirm('Supprimer ce rapport enregistré ?', { danger: true })) return;
    await reportsApi.customDelete(id);
    if (editingId === id) { setEditingId(null); setName(''); }
    qc.invalidateQueries({ queryKey: ['rb-saved'] });
  }
  function reset() { setEditingId(null); setName(''); if (source) pickSource(source.key); }

  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];
  // Graphe : 1 dimension + indicateur(s) → barres horizontales sur le 1er indicateur.
  const chartMeasure = cols.find(c => c.kind === 'measure');
  const chartDim = dims.length === 1 ? cols.find(c => c.kind === 'dimension') : null;
  const chartData = chartDim && chartMeasure ? rows.slice(0, 12).map(r => ({ label: String(r[chartDim.key] ?? '—'), value: Number(r[chartMeasure.key]) || 0 })) : [];
  const chartMax = Math.max(1, ...chartData.map(d => Math.abs(d.value)));

  const Chip = ({ f, on, onClick }: { f: ReportField; on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} className={on ? 'odoo-tag odoo-tag-blue' : 'odoo-tag odoo-tag-grey'}
      style={{ cursor: 'pointer', border: 'none', padding: '0.25rem 0.55rem' }}>{f.label}</button>
  );

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StatusBanner tone="info" icon={BarChart3} title="Rapports configurables">
        Choisissez une source, les dimensions (regroupements), les indicateurs à calculer et des filtres. Exécutez, visualisez, puis enregistrez pour réutiliser.
      </StatusBanner>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 16, alignItems: 'start' }}>
        {/* ── Constructeur + résultats ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Source</span>
              <select value={sourceKey} onChange={e => pickSource(e.target.value)} style={{ ...inp, minWidth: 160 }}>
                {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Du</span><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>Au</span><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} /></label>
            {isFetching && <Loader2 size={15} className="animate-spin" style={{ marginBottom: 8 }} />}
          </div>

          {source && (
            <>
              <div><div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Dimensions (regrouper par)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{source.dimensions.map(d => <Chip key={d.key} f={d} on={dims.includes(d.key)} onClick={() => toggle(dims, setDims, d.key)} />)}</div></div>
              <div><div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Indicateurs (calculer)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{source.measures.map(m => <Chip key={m.key} f={m} on={meas.includes(m.key)} onClick={() => toggle(meas, setMeas, m.key)} />)}</div></div>
              {source.filters.length > 0 && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {source.filters.map(f => <FilterSelect key={f.key} sourceKey={sourceKey} field={f} value={filters[f.key] ?? ''} onChange={v => setFilters(p => ({ ...p, [f.key]: v }))} />)}
                </div>
              )}
            </>
          )}

          {meas.length === 0 && <StatusBanner tone="warning" icon={Play} title="Sélectionnez au moins un indicateur à calculer." />}
          {isError && <StatusBanner tone="danger" icon={X} title="Erreur">{apiErrorMessage(error)}</StatusBanner>}

          {chartData.length > 0 && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>{chartMeasure?.label} par {chartDim?.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {chartData.map((d, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 90px', gap: 8, alignItems: 'center', fontSize: '0.8rem' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</span>
                    <div style={{ background: 'var(--theme-bg-subtle, #eef1f4)', borderRadius: 3, height: 16 }}>
                      <div style={{ width: `${Math.max(2, (Math.abs(d.value) / chartMax) * 100)}%`, background: palette[i % palette.length], height: '100%', borderRadius: 3 }} />
                    </div>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{chartMeasure && fmtVal(d.value, chartMeasure)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr>{cols.map(c => (
                <th key={c.key} style={{ textAlign: c.kind === 'measure' ? 'right' : 'left', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => setSort(s => ({ key: c.key, dir: s?.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              ))}</tr></thead>
              <tbody>
                {cols.length === 0 && <tr><td style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Choisissez des indicateurs puis exécutez.</td></tr>}
                {cols.length > 0 && rows.length === 0 && !isFetching && <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucune donnée sur la période.</td></tr>}
                {rows.map((r, i) => (
                  <tr key={i}>{cols.map(c => <td key={c.key} style={{ textAlign: c.kind === 'measure' ? 'right' : 'left', fontVariantNumeric: c.kind === 'measure' ? 'tabular-nums' : undefined, fontWeight: c.kind === 'measure' ? 600 : 400 }}>{fmtVal(r[c.key], c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{rows.length} ligne(s){rows.length === 500 ? ' (limité à 500)' : ''}.</p>}
        </div>

        {/* ── Enregistrement + rapports sauvegardés ── */}
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
                  <button type="button" onClick={() => del(s.id)} className="odoo-pager-btn" title="Supprimer"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ sourceKey, field, value, onChange }: { sourceKey: string; field: ReportField; value: string; onChange: (v: string) => void }) {
  const { data: options = [] } = useQuery({ queryKey: ['rb-fopt', sourceKey, field.key], queryFn: () => reportsApi.customFilterOptions(sourceKey, field.key) });
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}><span style={{ color: 'var(--theme-text-muted)' }}>{field.label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, minWidth: 140 }}>
        <option value="">Tous</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
