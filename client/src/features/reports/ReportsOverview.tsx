import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, LineChart, Line,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Crown, Wallet, PieChart, Percent, Boxes, Calendar } from 'lucide-react';
import { reportsApi } from '../../api/reports.api';

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
const dh = (v: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0) + ' DH';
const dh2 = (v: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0) + ' DH';
const int = (v: number) => new Intl.NumberFormat('fr-FR').format(Math.round(v || 0));
const pct = (v: number) => `${(v || 0).toFixed(1)} %`;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const CSS = `
.exo{display:flex;flex-direction:column;gap:16px;color:#0f172a;font-variant-numeric:tabular-nums;}
.exo-grid{display:grid;gap:16px;}
.exo-card{background:#fff;border:1px solid #e8ecf2;border-radius:12px;box-shadow:0 1px 2px rgba(16,24,40,.04);}
.exo-pad{padding:18px;}
.exo-ttl{font-size:.74rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;display:flex;align-items:center;gap:7px;}
.exo-note{font-size:.72rem;color:#94a3b8;}
.exo-kpi{padding:15px 16px;display:flex;flex-direction:column;gap:7px;border-left:3px solid var(--c,#4f46e5);}
.exo-kpi-lbl{font-size:.72rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.03em;}
.exo-kpi-val{font-size:1.5rem;font-weight:700;color:#0f172a;line-height:1.1;letter-spacing:-.01em;}
.exo-foot{display:flex;align-items:center;gap:8px;font-size:.74rem;}
.exo-hint{color:#94a3b8;}
.exo-delta{display:inline-flex;align-items:center;gap:3px;font-weight:700;font-size:.74rem;padding:1px 6px;border-radius:6px;}
.exo-up{color:#15803d;background:#dcfce7;}
.exo-down{color:#b91c1c;background:#fee2e2;}
.exo-flat{color:#64748b;background:#f1f5f9;}
.exo-tag{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;}
.exo-row{border-bottom:1px solid #f1f5f9;}
.exo-row:last-child{border-bottom:0;}
.exo-th{text-align:left;font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#94a3b8;padding:8px 8px;border-bottom:1px solid #e8ecf2;}
.exo-td{padding:9px 8px;font-size:.84rem;}
.exo-bar{height:7px;border-radius:999px;background:#f1f5f9;overflow:hidden;}
.exo-bar>i{display:block;height:100%;border-radius:999px;}
.exo-mini{font-size:.72rem;color:#64748b;}
.exo-big{font-size:1.3rem;font-weight:700;}
.exo-alert{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;font-size:.82rem;font-weight:600;}
`;

function Delta({ cur, prev, goodUp = true }: { cur: number; prev: number; goodUp?: boolean }) {
  if (!isFinite(prev) || prev === 0) return <span className="exo-delta exo-flat">—</span>;
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  const up = p >= 0;
  const positive = goodUp ? up : !up;
  return (
    <span className={`exo-delta ${positive ? 'exo-up' : 'exo-down'}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{Math.abs(p).toFixed(1)}%
    </span>
  );
}

function Kpi({ label, value, color, delta, hint }: { label: string; value: string; color: string; delta?: React.ReactNode; hint?: string }) {
  return (
    <div className="exo-card exo-kpi" style={{ ['--c' as any]: color }}>
      <span className="exo-kpi-lbl">{label}</span>
      <span className="exo-kpi-val">{value}</span>
      <div className="exo-foot">{delta}{hint && <span className="exo-hint">{hint}</span>}</div>
    </div>
  );
}

/** Jauge de coût vs cible : vert dans la cible, orange proche, rouge au-delà. */
function costTone(v: number, max: number, min = 0) {
  if (v > max) return '#dc2626';
  if (v > max * 0.9 || (min && v < min)) return '#d97706';
  return '#16a34a';
}

type Props = {
  d: any; dashLoading: boolean;
  chartData: { date: string; commandes: number; revenue: number }[]; salesLoading: boolean;
  periodTotals: { totalRevenue: number; totalOrders: number; avgRevenue: number };
  productData: any[]; productsLoading: boolean;
  topProducts: any[]; maxRevenue: number;
  lossStats: any;
  startDate: string; endDate: string;
  activePreset: DatePreset; presets: { key: DatePreset; label: string }[]; onPreset: (p: DatePreset) => void;
  customStart: string; customEnd: string; setCustomStart: (v: string) => void; setCustomEnd: (v: string) => void;
};

export default function ReportsOverview(p: Props) {
  const { chartData, salesLoading, periodTotals, productData, lossStats, startDate, endDate } = p;

  // Période précédente (même durée, juste avant) pour les évolutions.
  const spanDays = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1);
  const prevTo = addDays(startDate, -1);
  const prevFrom = addDays(prevTo, -(spanDays - 1));
  const { data: prevSales = [] } = useQuery({ queryKey: ['reports-sales', prevFrom, prevTo], queryFn: () => reportsApi.sales(prevFrom, prevTo) });
  const { data: cost } = useQuery({ queryKey: ['reports-cost-summary', startDate, endDate], queryFn: () => reportsApi.costSummary(startDate, endDate) });
  const { data: fin } = useQuery({ queryKey: ['reports-finance', startDate, endDate], queryFn: () => reportsApi.financeOverview(startDate, endDate) });

  const prev = useMemo(() => {
    const rev = (prevSales as any[]).reduce((s, x) => s + (parseFloat(x.revenue) || 0), 0);
    const ord = (prevSales as any[]).reduce((s, x) => s + (parseInt(x.sales_count) || 0), 0);
    return { rev, ord, avg: ord > 0 ? rev / ord : 0 };
  }, [prevSales]);

  const curAvgBasket = periodTotals.totalOrders > 0 ? periodTotals.totalRevenue / periodTotals.totalOrders : 0;
  const netSales = cost?.netSales ?? periodTotals.totalRevenue;
  const grossMargin = cost ? cost.netSales - cost.foodCost : 0;
  const grossMarginPct = cost && cost.netSales > 0 ? (grossMargin / cost.netSales) * 100 : 0;
  const operatingMargin = cost ? cost.netSales - cost.primeCost : 0;
  const operatingMarginPct = cost && cost.netSales > 0 ? (operatingMargin / cost.netSales) * 100 : 0;

  // Tendance : CA par jour, période actuelle vs précédente (alignées par rang de jour).
  const trend = useMemo(() => {
    const prevRev = (prevSales as any[]).map(x => parseFloat(x.revenue) || 0);
    return chartData.map((c, i) => ({ date: c.date, actuel: c.revenue, precedent: prevRev[i] ?? null }));
  }, [chartData, prevSales]);

  // CA par catégorie.
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of productData as any[]) {
      const cat = r.category || 'Sans catégorie';
      m.set(cat, (m.get(cat) || 0) + (parseFloat(r.total_revenue) || 0));
    }
    const rows = [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    return rows.slice(0, 8).map(r => ({ ...r, pct: (r.value / total) * 100 }));
  }, [productData]);

  // Top produits par marge (si coûts dispo) sinon par CA.
  const topByMargin = useMemo(() => {
    const src = (cost?.breakdown ?? []) as any[];
    if (src.length) {
      return src.map(b => {
        const rev = parseFloat(b.revenue) || 0; const fc = parseFloat(b.food_cost) || 0;
        return { id: b.product_id, name: b.name, category: b.category, rev, margin: rev - fc, marginPct: rev > 0 ? ((rev - fc) / rev) * 100 : 0, hasCost: b.has_cost_data };
      }).sort((a, b) => b.rev - a.rev).slice(0, 7);
    }
    return (productData as any[]).map(r => ({ id: r.id, name: r.name, category: r.category, rev: parseFloat(r.total_revenue) || 0, margin: 0, marginPct: 0, hasCost: false })).sort((a, b) => b.rev - a.rev).slice(0, 7);
  }, [cost, productData]);

  // Alertes décisionnelles.
  const alerts: { tone: string; text: string }[] = [];
  if (p.d.lowStockCount > 0) alerts.push({ tone: '#d97706', text: `${p.d.lowStockCount} ingrédient(s) en stock bas` });
  if (cost && cost.foodCostPct > cost.targets.foodCostPctMax) alerts.push({ tone: '#dc2626', text: `Coût matière ${pct(cost.foodCostPct)} au-dessus de la cible (${pct(cost.targets.foodCostPctMax)})` });
  if (cost && cost.primeCostPct > cost.targets.primeCostPctMax) alerts.push({ tone: '#dc2626', text: `Prime cost ${pct(cost.primeCostPct)} au-dessus de la cible (${pct(cost.targets.primeCostPctMax)})` });
  if (fin && fin.pipeline.uncashedChecks.overdue > 0) alerts.push({ tone: '#dc2626', text: `Chèques échus non encaissés : ${dh(fin.pipeline.uncashedChecks.overdue)}` });
  if (fin && fin.pipeline.unpaidInvoices.total > 0) alerts.push({ tone: '#64748b', text: `${fin.pipeline.unpaidInvoices.count} facture(s) fournisseur impayée(s) : ${dh(fin.pipeline.unpaidInvoices.total)}` });

  const costRows = cost ? [
    { label: 'Coût matière', value: cost.foodCost, p: cost.foodCostPct, tone: costTone(cost.foodCostPct, cost.targets.foodCostPctMax, cost.targets.foodCostPctMin), target: `cible ${pct(cost.targets.foodCostPctMin)}–${pct(cost.targets.foodCostPctMax)}` },
    { label: "Main-d'œuvre", value: cost.laborCost, p: cost.laborCostPct, tone: costTone(cost.laborCostPct, cost.targets.laborCostPctMax), target: `cible ≤ ${pct(cost.targets.laborCostPctMax)}` },
    { label: 'Énergie', value: cost.energyCost, p: cost.energyCostPct, tone: '#64748b', target: '' },
    { label: 'Pertes', value: cost.lossesCost, p: cost.lossesCostPct, tone: cost.lossesCostPct > 3 ? '#dc2626' : '#64748b', target: '' },
    { label: 'Prime cost', value: cost.primeCost, p: cost.primeCostPct, tone: costTone(cost.primeCostPct, cost.targets.primeCostPctMax), target: `cible ≤ ${pct(cost.targets.primeCostPctMax)}`, strong: true },
  ] : [];

  const periodLabel = `${spanDays} j · vs ${spanDays} j préc.`;

  return (
    <div className="exo">
      <style>{CSS}</style>

      {/* Période */}
      <div className="exo-card exo-pad" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingTop: 12, paddingBottom: 12 }}>
        <Calendar size={16} style={{ color: '#64748b' }} />
        <span className="exo-ttl" style={{ marginRight: 4 }}>Période</span>
        <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 9, padding: 3, gap: 2 }}>
          {p.presets.map(pr => (
            <button key={pr.key} onClick={() => p.onPreset(pr.key)}
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: '.78rem', fontWeight: 600, border: 0, cursor: 'pointer',
                background: p.activePreset === pr.key ? '#fff' : 'transparent', color: p.activePreset === pr.key ? '#4f46e5' : '#64748b',
                boxShadow: p.activePreset === pr.key ? '0 1px 2px rgba(16,24,40,.08)' : 'none' }}>{pr.label}</button>
          ))}
        </div>
        {p.activePreset === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={p.customStart} onChange={e => p.setCustomStart(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px', fontSize: '.8rem' }} />
            <span style={{ color: '#94a3b8' }}>→</span>
            <input type="date" value={p.customEnd} onChange={e => p.setCustomEnd(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px', fontSize: '.8rem' }} />
          </div>
        )}
        <span className="exo-note" style={{ marginLeft: 'auto' }}>Évolutions comparées à la période précédente de même durée</span>
      </div>

      {/* Alertes */}
      {alerts.length > 0 && (
        <div className="exo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {alerts.map((a, i) => (
            <div key={i} className="exo-alert" style={{ background: `${a.tone}12`, color: a.tone, border: `1px solid ${a.tone}33` }}>
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />{a.text}
            </div>
          ))}
        </div>
      )}

      {/* KPI band */}
      <div className="exo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Kpi label="CA de la période" value={dh(periodTotals.totalRevenue)} color="#4f46e5" delta={<Delta cur={periodTotals.totalRevenue} prev={prev.rev} />} hint={periodLabel} />
        <Kpi label="Commandes" value={int(periodTotals.totalOrders)} color="#0ea5e9" delta={<Delta cur={periodTotals.totalOrders} prev={prev.ord} />} hint={`${int(periodTotals.totalOrders / spanDays)} / jour`} />
        <Kpi label="Panier moyen" value={dh2(curAvgBasket)} color="#8b5cf6" delta={<Delta cur={curAvgBasket} prev={prev.avg} />} />
        <Kpi label="Marge brute" value={cost ? dh(grossMargin) : '—'} color="#16a34a" delta={cost ? <span className="exo-delta exo-up" style={{ background: '#f1f5f9', color: '#0f172a' }}>{pct(grossMarginPct)}</span> : undefined} hint="CA net − coût matière" />
        <Kpi label="Coût matière" value={cost ? pct(cost.foodCostPct) : '—'} color={cost ? costTone(cost.foodCostPct, cost.targets.foodCostPctMax, cost.targets.foodCostPctMin) : '#64748b'} hint={cost ? `cible ${pct(cost.targets.foodCostPctMin)}–${pct(cost.targets.foodCostPctMax)}` : ''} />
        <Kpi label="Prime cost" value={cost ? pct(cost.primeCostPct) : '—'} color={cost ? costTone(cost.primeCostPct, cost.targets.primeCostPctMax) : '#64748b'} hint={cost ? `marge expl. ${pct(operatingMarginPct)}` : ''} />
      </div>

      {/* Tendance CA + Répartition catégorie */}
      <div className="exo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="exo-card exo-pad" style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="exo-ttl"><TrendingUp size={14} />Évolution du chiffre d'affaires</span>
            <span className="exo-note">période actuelle vs précédente</span>
          </div>
          <div style={{ display: 'flex', gap: 24, margin: '6px 0 2px' }}>
            <div><div className="exo-big">{dh(periodTotals.totalRevenue)}</div><div className="exo-mini">actuel · moy. {dh(periodTotals.avgRevenue)}/j</div></div>
            <div><div className="exo-big" style={{ color: '#94a3b8' }}>{dh(prev.rev)}</div><div className="exo-mini">précédent</div></div>
          </div>
          <div style={{ height: 250, marginTop: 8 }}>
            {salesLoading ? <Empty t="Chargement…" /> : chartData.length === 0 ? <Empty t="Aucune donnée" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8ecf2', fontSize: 13, boxShadow: '0 8px 24px rgba(16,24,40,.08)' }} formatter={(v: number, n) => [dh2(v), n === 'actuel' ? 'Actuel' : 'Précédent']} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'actuel' ? 'Actuel' : 'Précédent'} />
                  <Line type="monotone" dataKey="precedent" stroke="#cbd5e1" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line type="monotone" dataKey="actuel" stroke="#4f46e5" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="exo-card exo-pad" style={{ minWidth: 0 }}>
          <span className="exo-ttl"><PieChart size={14} />CA par catégorie</span>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {byCategory.length === 0 ? <p className="exo-mini">Aucune donnée.</p> : byCategory.map((c, i) => (
              <div key={c.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', marginBottom: 4 }}>
                  <span style={{ color: '#334155', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ color: '#0f172a', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{dh(c.value)} <span className="exo-mini">({c.pct.toFixed(0)}%)</span></span>
                </div>
                <div className="exo-bar"><i style={{ width: `${c.pct}%`, background: ['#4f46e5', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#64748b', '#a855f7'][i % 8] }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Structure de coûts + Trésorerie */}
      <div className="exo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="exo-card exo-pad" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="exo-ttl"><Percent size={14} />Structure de coûts & rentabilité</span>
            <span className="exo-note">% du CA net</span>
          </div>
          {!cost ? <p className="exo-mini" style={{ marginTop: 12 }}>Coûts indisponibles pour la période.</p> : (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {costRows.map(r => (
                <div key={r.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.84rem', marginBottom: 4 }}>
                    <span style={{ fontWeight: (r as any).strong ? 700 : 500, color: '#334155' }}>{r.label}{r.target && <span className="exo-mini" style={{ marginLeft: 8 }}>{r.target}</span>}</span>
                    <span style={{ fontWeight: 700, color: r.tone }}>{pct(r.p)} <span className="exo-mini" style={{ color: '#94a3b8', fontWeight: 500 }}>· {dh(r.value)}</span></span>
                  </div>
                  <div className="exo-bar"><i style={{ width: `${Math.min(r.p, 100)}%`, background: r.tone }} /></div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #e8ecf2' }}>
                <span style={{ fontWeight: 700 }}>Marge d'exploitation</span>
                <span style={{ fontWeight: 800, color: operatingMargin >= 0 ? '#15803d' : '#b91c1c' }}>{dh(operatingMargin)} <span className="exo-mini">({pct(operatingMarginPct)})</span></span>
              </div>
            </div>
          )}
        </div>

        <div className="exo-card exo-pad" style={{ minWidth: 0 }}>
          <span className="exo-ttl"><Wallet size={14} />Trésorerie & engagements</span>
          {!fin ? <p className="exo-mini" style={{ marginTop: 12 }}>Indisponible.</p> : (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Stat label="Reste à payer (fourn.)" value={dh(fin.kpis.remainingToPay.total)} sub={`${fin.kpis.remainingToPay.count} éléments`} tone="#dc2626" />
              <Stat label="Engagements (BC)" value={dh(fin.kpis.engagement.total)} sub={`${fin.kpis.engagement.count} BC`} tone="#4f46e5" />
              <Stat label="Chèques à encaisser" value={dh(fin.pipeline.uncashedChecks.total)} sub={fin.pipeline.uncashedChecks.overdue > 0 ? `dont ${dh(fin.pipeline.uncashedChecks.overdue)} échus` : `${fin.pipeline.uncashedChecks.count} chèques`} tone={fin.pipeline.uncashedChecks.overdue > 0 ? '#dc2626' : '#0ea5e9'} />
              <Stat label="Reçu non facturé" value={dh(fin.kpis.receivedNotInvoiced.total)} sub={`${fin.kpis.receivedNotInvoiced.count} récept.`} tone="#d97706" />
              {fin.topSuppliers?.length > 0 && (
                <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                  <div className="exo-mini" style={{ fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Principaux fournisseurs créditeurs</div>
                  {fin.topSuppliers.slice(0, 3).map(s => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', padding: '3px 0' }}>
                      <span style={{ color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      <span style={{ fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{dh(s.totalDue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top produits (marge) + Pertes */}
      <div className="exo-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="exo-card exo-pad" style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="exo-ttl"><Crown size={14} />Produits — contribution & rentabilité</span>
            <span className="exo-note">{productData.length} produits · {cost ? 'marge réelle' : 'CA'}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="exo-th">Produit</th><th className="exo-th">Catégorie</th>
                <th className="exo-th" style={{ textAlign: 'right' }}>CA</th>
                <th className="exo-th" style={{ textAlign: 'right' }}>Marge</th>
                <th className="exo-th" style={{ textAlign: 'right' }}>Marge %</th>
              </tr></thead>
              <tbody>
                {topByMargin.length === 0 ? <tr><td className="exo-td exo-mini" colSpan={5} style={{ textAlign: 'center', padding: 20 }}>Aucune donnée.</td></tr>
                  : topByMargin.map((r, i) => (
                    <tr key={r.id} className="exo-row">
                      <td className="exo-td"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: i < 3 ? '#eef2ff' : '#f1f5f9', color: i < 3 ? '#4f46e5' : '#94a3b8', fontSize: '.64rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{r.name}</span></div></td>
                      <td className="exo-td"><span className="exo-tag" style={{ background: '#f1f5f9', color: '#64748b' }}>{r.category || '—'}</span></td>
                      <td className="exo-td" style={{ textAlign: 'right', fontWeight: 600 }}>{dh(r.rev)}</td>
                      <td className="exo-td" style={{ textAlign: 'right', fontWeight: 600, color: r.hasCost ? (r.margin >= 0 ? '#15803d' : '#b91c1c') : '#94a3b8' }}>{r.hasCost ? dh(r.margin) : '—'}</td>
                      <td className="exo-td" style={{ textAlign: 'right' }}>{r.hasCost ? <span className="exo-tag" style={{ background: r.marginPct >= 60 ? '#dcfce7' : r.marginPct >= 40 ? '#fef9c3' : '#fee2e2', color: r.marginPct >= 60 ? '#15803d' : r.marginPct >= 40 ? '#a16207' : '#b91c1c' }}>{r.marginPct.toFixed(0)}%</span> : <span className="exo-mini">n/d</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="exo-card exo-pad" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="exo-ttl"><Boxes size={14} />Pertes & invendus</span>
            <span className="exo-note">ce mois</span>
          </div>
          {!lossStats || !(lossStats.topReasons as any[])?.length ? <p className="exo-mini" style={{ marginTop: 12 }}>Aucune perte enregistrée.</p> : (
            <>
              <div style={{ marginTop: 10, marginBottom: 10 }}>
                <span className="exo-big" style={{ color: '#b91c1c' }}>{dh((lossStats.topReasons as any[]).reduce((s, r) => s + (parseFloat(r.total_cost) || 0), 0))}</span>
                <span className="exo-mini" style={{ marginLeft: 8 }}>coût total des pertes</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(lossStats.topReasons as any[]).slice(0, 6).map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.82rem' }}>
                    <span style={{ color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span className="exo-tag" style={{ background: '#f1f5f9', color: '#64748b', marginRight: 6 }}>{String(r.loss_type)}</span>{String(r.reason)}
                    </span>
                    <span style={{ fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{dh(parseFloat(r.total_cost) || 0)} <span className="exo-mini">·{r.count}×</span></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div style={{ borderLeft: `3px solid ${tone}`, paddingLeft: 10 }}>
      <div className="exo-mini" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.02em', fontSize: '.68rem' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{value}</div>
      <div className="exo-mini">{sub}</div>
    </div>
  );
}

function Empty({ t }: { t: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: '.85rem' }}>{t}</div>;
}
