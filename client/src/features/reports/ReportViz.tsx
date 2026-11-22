import { money, currencySymbol } from '../../utils/money';
import { DataPanel } from '../../components/ds';
import type { ReportColumn } from '../../api/reports.api';

export type VizType = 'table' | 'bar' | 'line' | 'kpi';

export function fmtVal(v: any, col?: ReportColumn): string {
  if (v == null) return '—';
  if (col?.kind === 'measure') {
    const n = Number(v) || 0;
    if (col.format === 'currency') return money(n);
    if (col.format === 'integer') return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }
  // Dimension date : le serveur renvoie un horodatage ISO (jour) ou « AAAA-MM » (mois).
  const str = String(v);
  const month = /^(\d{4})-(\d{2})$/.exec(str);
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) { const [y, m, d] = str.split('-'); return `${d}/${m}/${y}`; }
  return str;
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

  if (!rows.length) return <p className="kl-viz-empty">Aucune donnée.</p>;

  if (viz === 'kpi') {
    const totals = meas.map(m => ({ m, total: rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0) }));
    return (
      <div className="kl-viz-kpis">
        {totals.map(({ m, total }) => (
          <div key={m.key}><b>{fmtVal(total, m)}</b><span>{m.label}</span></div>
        ))}
      </div>
    );
  }

  if ((viz === 'bar' || viz === 'line') && dim && measure) {
    const data = rows.slice(0, viz === 'line' ? 60 : 14).map(r => ({ label: fmtVal(r[dim.key], dim), value: Number(r[measure.key]) || 0 }));
    const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
    if (viz === 'bar') {
      return (
        <div className="kl-viz-bars">
          {data.map((d, i) => (
            <div key={i} className="kl-viz-bar">
              <span title={d.label}>{d.label}</span>
              <div className="t"><i style={{ width: `${Math.max(2, (Math.abs(d.value) / max) * 100)}%`, opacity: 1 - Math.min(i, 10) * 0.05 }} /></div>
              <b>{fmtVal(d.value, measure)}</b>
            </div>
          ))}
        </div>
      );
    }
    // Courbe (SVG) dans la couleur du thème
    const W = 480, H = 150, pad = 8;
    const n = data.length;
    const x = (i: number) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
    const y = (v: number) => H - pad - (Math.abs(v) / max) * (H - 2 * pad);
    const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
    const area = `${x(0)},${H - pad} ${pts} ${x(n - 1)},${H - pad}`;
    return (
      <div style={{ padding: '8px 4px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: 200, color: 'var(--ds-accent)' }} preserveAspectRatio="none">
          <polygon points={area} fill="currentColor" opacity="0.1" />
          <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ds-muted)', marginTop: 4 }}>
          <span>{data[0]?.label}</span><span>{measure.label}</span><span>{data[n - 1]?.label}</span>
        </div>
      </div>
    );
  }

  // Table (défaut) : montants sans devise, devise dans l'en-tête.
  const cell = (v: any, c: ReportColumn) => (v != null && c.kind === 'measure' && c.format === 'currency' ? (Number(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtVal(v, c));
  return (
    <DataPanel label="Résultat du rapport">
      <table className="odoo-table ds-dense">
        <thead><tr>{columns.map(c => <th key={c.key} className={c.kind === 'measure' ? 'ds-num' : undefined} style={{ whiteSpace: 'nowrap' }}>{c.label}{c.kind === 'measure' && c.format === 'currency' ? ` (${currencySymbol()})` : ''}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i}>{columns.map((c, j) => <td key={c.key} className={c.kind === 'measure' ? 'ds-num ds-strong' : j === 0 ? 'ds-strong' : undefined}>{cell(r[c.key], c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}
