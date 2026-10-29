import type { ReportColumn } from '../../api/reports.api';

export type VizType = 'table' | 'bar' | 'line' | 'kpi';
const palette = ['#4f8df7', '#34c38f', '#f6a609', '#8e6fe0', '#ef6b6b', '#2ab7c4', '#e879a6', '#7a8b99'];

export function fmtVal(v: any, col?: ReportColumn): string {
  if (v == null) return '—';
  if (col?.kind === 'measure') {
    const n = Number(v) || 0;
    if (col.format === 'currency') return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    if (col.format === 'integer') return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }
  return String(v);
}

export function toCsv(columns: ReportColumn[], rows: Record<string, any>[]): string {
  const esc = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = columns.map(c => esc(c.label)).join(';');
  const body = rows.map(r => columns.map(c => esc(c.kind === 'measure' ? String(Number(r[c.key]) || 0) : String(r[c.key] ?? ''))).join(';'));
  return [head, ...body].join('\n');
}

/** Rendu d'un résultat de rapport selon le type de visualisation. */
export function ReportViz({ columns, rows, viz, measureKey }: { columns: ReportColumn[]; rows: Record<string, any>[]; viz: VizType; measureKey?: string }) {
  const dims = columns.filter(c => c.kind === 'dimension');
  const meas = columns.filter(c => c.kind === 'measure');
  const dim = dims[0];
  const measure = meas.find(m => m.key === measureKey) ?? meas[0];

  if (!rows.length) return <p style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)', padding: 12, margin: 0 }}>Aucune donnée.</p>;

  if (viz === 'kpi') {
    const totals = meas.map(m => ({ m, total: rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0) }));
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 8 }}>
        {totals.map(({ m, total }) => (
          <div key={m.key} style={{ minWidth: 120 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtVal(total, m)}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{m.label}</div>
          </div>
        ))}
      </div>
    );
  }

  if ((viz === 'bar' || viz === 'line') && dim && measure) {
    const data = rows.slice(0, viz === 'line' ? 60 : 14).map(r => ({ label: String(r[dim.key] ?? '—'), value: Number(r[measure.key]) || 0 }));
    const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
    if (viz === 'bar') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 8 }}>
          {data.map((d, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 92px', gap: 8, alignItems: 'center', fontSize: '0.78rem' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.label}>{d.label}</span>
              <div style={{ background: 'var(--theme-bg-subtle, #eef1f4)', borderRadius: 3, height: 15 }}>
                <div style={{ width: `${Math.max(2, (Math.abs(d.value) / max) * 100)}%`, background: palette[i % palette.length], height: '100%', borderRadius: 3 }} />
              </div>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(d.value, measure)}</span>
            </div>
          ))}
        </div>
      );
    }
    // Courbe (SVG)
    const W = 480, H = 150, pad = 8;
    const n = data.length;
    const x = (i: number) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
    const y = (v: number) => H - pad - (Math.abs(v) / max) * (H - 2 * pad);
    const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
    return (
      <div style={{ padding: 8 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: 180 }} preserveAspectRatio="none">
          <polyline points={pts} fill="none" stroke={palette[0]} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r="2.5" fill={palette[0]} />)}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>
          <span>{data[0]?.label}</span><span>{measure.label}</span><span>{data[n - 1]?.label}</span>
        </div>
      </div>
    );
  }

  // Table (défaut)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="odoo-table">
        <thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.kind === 'measure' ? 'right' : 'left', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i}>{columns.map(c => <td key={c.key} style={{ textAlign: c.kind === 'measure' ? 'right' : 'left', fontVariantNumeric: c.kind === 'measure' ? 'tabular-nums' : undefined, fontWeight: c.kind === 'measure' ? 600 : 400 }}>{fmtVal(r[c.key], c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
