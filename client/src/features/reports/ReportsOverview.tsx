import { money, currencySymbol } from '../../utils/money';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Line,
} from 'recharts';
import { AlertTriangle, Wallet, FileWarning, Package } from 'lucide-react';
import { reportsApi } from '../../api/reports.api';
import { ListKpi } from '../sales/ListTemplate';
import { DataPanel } from '../../components/ds';

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
const dh = (v: number) => money(v || 0, { decimals: 0 });
const dh2 = (v: number) => money(v || 0);
const num0 = (v: number) => (v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const int = (v: number) => new Intl.NumberFormat('fr-FR').format(Math.round(v || 0));
const pct = (v: number) => `${(v || 0).toFixed(1)} %`;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Évolution vs période précédente, en texte court pour la tuile. */
function deltaTxt(cur: number, prev: number): { txt: string; up: boolean } | null {
  if (!isFinite(prev) || prev === 0) return null;
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return { txt: `${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)} %`, up: p >= 0 };
}

/** Jauge de coût vs cible : vert dans la cible, orange proche, rouge au-delà. */
function costTone(v: number, max: number, min = 0): 'red' | 'orange' | 'green' {
  if (v > max) return 'red';
  if (v > max * 0.9 || (min && v < min)) return 'orange';
  return 'green';
}
const TONE_VAR = { red: 'var(--prj-red)', orange: 'var(--prj-orange)', green: 'var(--prj-green)', muted: 'var(--ds-muted)' } as const;

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
  const alerts: { tone: 'o' | 'r' | 'x'; icon: typeof AlertTriangle; text: string }[] = [];
  if (p.d.lowStockCount > 0) alerts.push({ tone: 'o', icon: Package, text: `${p.d.lowStockCount} ingrédient(s) en stock bas` });
  if (cost && cost.foodCostPct > cost.targets.foodCostPctMax) alerts.push({ tone: 'r', icon: AlertTriangle, text: `Coût matière ${pct(cost.foodCostPct)} au-dessus de la cible (${pct(cost.targets.foodCostPctMax)})` });
  if (cost && cost.primeCostPct > cost.targets.primeCostPctMax) alerts.push({ tone: 'r', icon: AlertTriangle, text: `Prime cost ${pct(cost.primeCostPct)} au-dessus de la cible (${pct(cost.targets.primeCostPctMax)})` });
  if (fin && fin.pipeline.uncashedChecks.overdue > 0) alerts.push({ tone: 'r', icon: Wallet, text: `Chèques échus non encaissés : ${dh(fin.pipeline.uncashedChecks.overdue)}` });
  if (fin && fin.pipeline.unpaidInvoices.total > 0) alerts.push({ tone: 'x', icon: FileWarning, text: `${fin.pipeline.unpaidInvoices.count} facture(s) fournisseur impayée(s) : ${dh(fin.pipeline.unpaidInvoices.total)}` });

  const costRows = cost ? [
    { label: 'Coût matière', value: cost.foodCost, p: cost.foodCostPct, tone: costTone(cost.foodCostPct, cost.targets.foodCostPctMax, cost.targets.foodCostPctMin), target: `cible ${pct(cost.targets.foodCostPctMin)}–${pct(cost.targets.foodCostPctMax)}` },
    { label: "Main-d'œuvre", value: cost.laborCost, p: cost.laborCostPct, tone: costTone(cost.laborCostPct, cost.targets.laborCostPctMax), target: `cible ≤ ${pct(cost.targets.laborCostPctMax)}` },
    { label: 'Énergie', value: cost.energyCost, p: cost.energyCostPct, tone: 'muted' as const, target: '' },
    { label: 'Pertes', value: cost.lossesCost, p: cost.lossesCostPct, tone: cost.lossesCostPct > 3 ? 'red' as const : 'muted' as const, target: '' },
    { label: 'Prime cost', value: cost.primeCost, p: cost.primeCostPct, tone: costTone(cost.primeCostPct, cost.targets.primeCostPctMax), target: `cible ≤ ${pct(cost.targets.primeCostPctMax)}`, strong: true },
  ] : [];

  const periodLabel = `${spanDays} j · vs ${spanDays} j préc.`;
  const dRev = deltaTxt(periodTotals.totalRevenue, prev.rev);
  const dOrd = deltaTxt(periodTotals.totalOrders, prev.ord);
  const dAvg = deltaTxt(curAvgBasket, prev.avg);
  const losses = lossStats && (lossStats.topReasons as any[])?.length ? (lossStats.topReasons as any[]) : [];

  return (
    <>
      {/* KPI */}
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="CA de la période" value={dh(periodTotals.totalRevenue)} sub={dRev ? `${dRev.txt} · ${periodLabel}` : periodLabel} />
        <ListKpi label="Commandes" value={int(periodTotals.totalOrders)} sub={`${dOrd ? dOrd.txt + ' · ' : ''}${int(periodTotals.totalOrders / spanDays)} / jour`} />
        <ListKpi label="Panier moyen" value={dh2(curAvgBasket)} sub={dAvg ? `${dAvg.txt} vs période préc.` : 'vs période préc.'} />
        <ListKpi label="Marge brute" value={cost ? dh(grossMargin) : '—'} sub={cost ? `${pct(grossMarginPct)} du CA net` : 'CA net − coût matière'} tone={cost && grossMargin < 0 ? 'red' : undefined} />
      </section>

      {/* À surveiller */}
      {alerts.length > 0 && (
        <section>
          <div className="kl-sec"><h2>À surveiller</h2><small>{alerts.length}</small></div>
          <div className="kl-group">
            {alerts.map((a, i) => (
              <div key={i} className="kl-cell ico" style={{ cursor: 'default', minHeight: 50 }}>
                <span className={`kl-ic ${a.tone}`}><a.icon size={16} /></span>
                <span className="tx"><span className="t1" style={{ whiteSpace: 'normal' }}>{a.text}</span></span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tendance + catégories */}
      <section>
        <div className="kl-sec"><h2>Chiffre d'affaires</h2><small>période actuelle vs précédente</small></div>
        <div className="kl-rep-grid">
          <div className="kl-widget wide">
            <div className="kl-rep-figs">
              <div><b>{dh(periodTotals.totalRevenue)}</b><small>actuel · moy. {dh(periodTotals.avgRevenue)} / jour</small></div>
              <div><b className="muted">{dh(prev.rev)}</b><small>période précédente</small></div>
            </div>
            <div style={{ height: 250, marginTop: 8 }}>
              {salesLoading ? <Empty t="Chargement…" /> : chartData.length === 0 ? <Empty t="Aucune donnée" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="repArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--ds-accent)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--ds-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-sep)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--ds-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: 'var(--ds-muted)' }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: 0, fontSize: 13, boxShadow: '0 8px 24px rgba(15,23,42,.12)' }} formatter={(v: number, n) => [dh2(v), n === 'actuel' ? 'Actuel' : 'Précédent']} />
                    <Line type="monotone" dataKey="precedent" stroke="var(--ds-muted)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    <Area type="monotone" dataKey="actuel" stroke="var(--ds-accent)" strokeWidth={2.5} fill="url(#repArea)" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="kl-widget">
            <div className="kl-rep-head"><h3>Par catégorie</h3><small>top 8</small></div>
            <div className="kl-rep-bars">
              {byCategory.length === 0 ? <p className="kl-viz-empty">Aucune donnée.</p> : byCategory.map((c, i) => (
                <div key={c.name} className="kl-rep-bar">
                  <div className="l"><span>{c.name}</span><b>{dh(c.value)}<small>{c.pct.toFixed(0)} %</small></b></div>
                  <div className="t"><i style={{ width: `${c.pct}%`, opacity: 1 - i * 0.09 }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Coûts + trésorerie */}
      <section>
        <div className="kl-sec"><h2>Rentabilité et trésorerie</h2></div>
        <div className="kl-rep-grid">
          <div className="kl-widget">
            <div className="kl-rep-head"><h3>Structure de coûts</h3><small>% du CA net</small></div>
            {!cost ? <p className="kl-viz-empty">Coûts indisponibles pour la période.</p> : (
              <div className="kl-rep-bars">
                {costRows.map(r => (
                  <div key={r.label} className="kl-rep-bar">
                    <div className="l">
                      <span style={{ fontWeight: (r as any).strong ? 600 : 400 }}>{r.label}{r.target && <em>{r.target}</em>}</span>
                      <b style={{ color: TONE_VAR[r.tone] }}>{pct(r.p)}<small>{dh(r.value)}</small></b>
                    </div>
                    <div className="t"><i style={{ width: `${Math.min(r.p, 100)}%`, background: TONE_VAR[r.tone] }} /></div>
                  </div>
                ))}
                <div className="kl-rep-total">
                  <span>Marge d'exploitation</span>
                  <b className={operatingMargin >= 0 ? 'kl-rep-tone-g' : 'kl-rep-tone-r'}>{dh(operatingMargin)} <small style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>{pct(operatingMarginPct)}</small></b>
                </div>
              </div>
            )}
          </div>

          <div className="kl-widget" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="kl-rep-head" style={{ padding: '18px 20px 6px' }}><h3>Trésorerie et engagements</h3></div>
            {!fin ? <p className="kl-viz-empty">Indisponible.</p> : (
              <>
                <Stat label="Reste à payer (fournisseurs)" value={dh(fin.kpis.remainingToPay.total)} sub={`${fin.kpis.remainingToPay.count} éléments`} tone="r" />
                <Stat label="Engagements (bons de commande)" value={dh(fin.kpis.engagement.total)} sub={`${fin.kpis.engagement.count} BC`} tone="b" />
                <Stat label="Chèques à encaisser" value={dh(fin.pipeline.uncashedChecks.total)} sub={fin.pipeline.uncashedChecks.overdue > 0 ? `dont ${dh(fin.pipeline.uncashedChecks.overdue)} échus` : `${fin.pipeline.uncashedChecks.count} chèques`} tone={fin.pipeline.uncashedChecks.overdue > 0 ? 'r' : 'g'} />
                <Stat label="Reçu non facturé" value={dh(fin.kpis.receivedNotInvoiced.total)} sub={`${fin.kpis.receivedNotInvoiced.count} réceptions`} tone="o" />
                {fin.topSuppliers?.length > 0 && (
                  <div style={{ padding: '10px 20px 16px', borderTop: '1px solid var(--ds-sep)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ds-muted)', marginBottom: 6 }}>Principaux fournisseurs créditeurs</div>
                    {fin.topSuppliers.slice(0, 3).map(s => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '3px 0' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        <b style={{ fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{dh(s.totalDue)}</b>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Produits + pertes */}
      <section>
        <div className="kl-sec"><h2>Produits</h2><small>{productData.length} produits · {cost ? 'marge réelle' : 'CA'}</small></div>
        <div className="kl-rep-grid">
          <DataPanel label="Produits" className="kl-widget wide" style={{ padding: 0 }}>
            <table className="odoo-table ds-dense">
              <thead><tr>
                <th>Produit</th><th>Catégorie</th>
                <th className="ds-num">CA ({currencySymbol()})</th>
                <th className="ds-num">Marge ({currencySymbol()})</th>
                <th className="ds-num">Marge %</th>
              </tr></thead>
              <tbody>
                {topByMargin.length === 0 ? <tr><td colSpan={5} className="kl-viz-empty">Aucune donnée.</td></tr>
                  : topByMargin.map((r, i) => (
                    <tr key={r.id}>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <span className={`kl-rep-rank${i < 3 ? ' top' : ''}`}>{i + 1}</span>
                        <span className="ds-strong">{r.name}</span></span></td>
                      <td style={{ color: 'var(--ds-muted)' }}>{r.category || '—'}</td>
                      <td className="ds-num ds-strong">{num0(r.rev)}</td>
                      <td className="ds-num" style={r.hasCost && r.margin < 0 ? { color: 'var(--ds-danger)' } : undefined}>{r.hasCost ? num0(r.margin) : '—'}</td>
                      <td className="ds-num">{r.hasCost
                        ? <span className={`kl-pill ${r.marginPct >= 60 ? 'g' : r.marginPct >= 40 ? 'o' : 'r'}`}>{r.marginPct.toFixed(0)} %</span>
                        : <span style={{ color: 'var(--ds-muted)' }}>n/d</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </DataPanel>

          <div className="kl-widget" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="kl-rep-head" style={{ padding: '18px 20px 0' }}><h3>Pertes et invendus</h3><small>ce mois</small></div>
            {!losses.length ? <p className="kl-viz-empty">Aucune perte enregistrée.</p> : (
              <>
                <div className="kl-rep-figs" style={{ padding: '0 20px' }}>
                  <div><b className="kl-rep-tone-r">{dh(losses.reduce((s, r) => s + (parseFloat(r.total_cost) || 0), 0))}</b><small>coût total des pertes</small></div>
                </div>
                <div className="kl-group" style={{ boxShadow: 'none', borderRadius: 0, borderTop: '1px solid var(--ds-sep)' }}>
                  {losses.slice(0, 6).map((r, i) => (
                    <div key={i} className="kl-cell" style={{ cursor: 'default', minHeight: 48 }}>
                      <span className="tx"><span className="t1">{String(r.reason)}</span><span className="t2">{String(r.loss_type)} · {r.count}×</span></span>
                      <span className="tr">{dh(parseFloat(r.total_cost) || 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'r' | 'b' | 'g' | 'o' }) {
  return (
    <div className="kl-cell" style={{ cursor: 'default', minHeight: 54 }}>
      <span className="tx"><span className="t1">{label}</span><span className="t2">{sub}</span></span>
      <span className="tr" style={{ fontWeight: 600, color: tone === 'r' ? 'var(--ds-danger)' : tone === 'o' ? 'var(--ds-warning)' : 'var(--ds-ink)' }}>{value}</span>
    </div>
  );
}

function Empty({ t }: { t: string }) {
  return <div className="kl-viz-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>{t}</div>;
}
