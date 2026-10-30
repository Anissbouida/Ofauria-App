import { useEffect, useRef, useState } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area,
} from 'recharts';
import { Banknote, ShoppingCart, TrendingUp, Package, ClipboardList, AlertTriangle, Crown, Activity, Boxes, Sparkles } from 'lucide-react';

type DatePreset = 'today' | '7d' | '30d' | '90d' | 'custom';
const fmtDH = (v: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' DH';
const fmtInt = (v: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);

/** Compteur animé (ease-out) relancé quand la cible change. */
function useCountUp(target: number, ms = 950) {
  const [val, setVal] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const from = ref.current; const start = performance.now(); let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = from + (target - from) * e;
      ref.current = cur; setVal(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

const CSS = `
.fx-ov{position:relative;border-radius:22px;padding:22px;overflow:hidden;
  background:radial-gradient(1200px 500px at 15% -10%, rgba(34,211,238,.14), transparent 60%),
             radial-gradient(900px 500px at 100% 0%, rgba(167,139,250,.14), transparent 55%),
             linear-gradient(160deg,#0a0f1e 0%,#0c1226 55%,#0a1020 100%);
  border:1px solid rgba(120,160,255,.14);
  box-shadow:0 30px 80px -40px rgba(10,20,60,.9), inset 0 1px 0 rgba(255,255,255,.04);
  color:#dbe6ff;font-variant-numeric:tabular-nums;}
.fx-ov::before{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(120,160,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,255,.06) 1px,transparent 1px);
  background-size:40px 40px;mask-image:radial-gradient(900px 500px at 30% 0%,#000,transparent 75%);animation:fxgrid 24s linear infinite;}
@keyframes fxgrid{to{background-position:40px 40px,40px 40px;}}
.fx-ov>*{position:relative;z-index:1;}
.fx-grid{display:grid;gap:14px;}
.fx-glass{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));
  border:1px solid rgba(140,175,255,.14);border-radius:16px;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);}
.fx-kpi{position:relative;padding:16px 16px 14px;overflow:hidden;transition:transform .25s ease, box-shadow .25s ease;}
.fx-kpi:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px var(--glow);}
.fx-kpi::after{content:"";position:absolute;left:0;top:0;height:2px;width:100%;background:linear-gradient(90deg,transparent,var(--accent),transparent);opacity:.8;}
.fx-orb{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;
  background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 0 18px -2px var(--glow), inset 0 1px 0 rgba(255,255,255,.3);}
.fx-val{font-size:1.7rem;font-weight:800;letter-spacing:-.02em;color:#f3f8ff;text-shadow:0 0 18px var(--glow);line-height:1.1;}
.fx-lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;color:#8aa0c8;margin-top:4px;}
.fx-chip{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:999px;
  background:rgba(251,113,133,.14);color:#ff9fb0;border:1px solid rgba(251,113,133,.3);}
.fx-card{padding:18px;}
.fx-h{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9fb2d6;}
.fx-big{font-size:1.55rem;font-weight:800;color:#f3f8ff;margin-top:3px;text-shadow:0 0 16px rgba(34,211,238,.35);}
.fx-sub{font-size:.72rem;color:#7f93b8;}
.fx-seg{display:inline-flex;gap:3px;padding:4px;border-radius:12px;background:rgba(10,16,34,.6);border:1px solid rgba(140,175,255,.14);}
.fx-seg button{padding:6px 13px;border-radius:9px;font-size:.74rem;font-weight:600;color:#9fb2d6;background:transparent;border:0;cursor:pointer;transition:all .18s;}
.fx-seg button:hover{color:#dbe6ff;}
.fx-seg button.on{color:#06121f;background:linear-gradient(135deg,#22d3ee,#38bdf8);box-shadow:0 0 16px -3px rgba(34,211,238,.7);}
.fx-date{background:rgba(10,16,34,.6);border:1px solid rgba(140,175,255,.2);color:#dbe6ff;border-radius:9px;padding:5px 9px;font-size:.78rem;color-scheme:dark;}
.fx-bar-track{height:6px;border-radius:999px;background:rgba(140,175,255,.12);overflow:hidden;}
.fx-bar-fill{height:100%;border-radius:999px;}
.fx-rank{width:26px;height:26px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;flex-shrink:0;}
.fx-row:hover{background:rgba(140,175,255,.05);}
.fx-tag{font-size:.64rem;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(140,175,255,.1);color:#aebfe0;border:1px solid rgba(140,175,255,.16);}
.fx-muted{color:#7f93b8;}
`;

type KPI = { title: string; value: number; currency?: boolean; icon: any; accent: string; accent2: string; glow: string; chip?: string };

function KpiTile({ k, loading }: { k: KPI; loading: boolean }) {
  const n = useCountUp(k.value);
  const Icon = k.icon;
  return (
    <div className="fx-glass fx-kpi" style={{ ['--accent' as any]: k.accent, ['--accent2' as any]: k.accent2, ['--glow' as any]: k.glow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="fx-orb"><Icon size={20} /></div>
        {k.chip && <span className="fx-chip">{k.chip}</span>}
      </div>
      <div className="fx-val">{loading ? '—' : k.currency ? fmtDH(n) : fmtInt(Math.round(n))}</div>
      <div className="fx-lbl">{k.title}</div>
    </div>
  );
}

const TT = { contentStyle: { borderRadius: 12, border: '1px solid rgba(140,175,255,.22)', background: 'rgba(10,16,34,.92)', backdropFilter: 'blur(6px)', boxShadow: '0 10px 40px rgba(0,0,0,.5)', fontSize: 13, color: '#dbe6ff' }, labelStyle: { color: '#9fb2d6' }, cursor: { fill: 'rgba(140,175,255,.06)' } };

type Props = {
  d: any; dashLoading: boolean;
  chartData: { date: string; commandes: number; revenue: number }[]; salesLoading: boolean;
  periodTotals: { totalRevenue: number; totalOrders: number; avgRevenue: number };
  productData: any[]; productsLoading: boolean;
  topProducts: any[]; maxRevenue: number;
  lossStats: any;
  activePreset: DatePreset; presets: { key: DatePreset; label: string }[]; onPreset: (p: DatePreset) => void;
  customStart: string; customEnd: string; setCustomStart: (v: string) => void; setCustomEnd: (v: string) => void;
};

export default function ReportsOverview(p: Props) {
  const { d, dashLoading, chartData, salesLoading, periodTotals, productData, productsLoading, topProducts, maxRevenue, lossStats } = p;
  const kpis: KPI[] = [
    { title: 'CA du jour', value: d.todayRevenue, currency: true, icon: Banknote, accent: '#34d399', accent2: '#059669', glow: 'rgba(52,211,153,.45)' },
    { title: 'Ventes', value: d.todaySales, icon: ShoppingCart, accent: '#22d3ee', accent2: '#0891b2', glow: 'rgba(34,211,238,.45)' },
    { title: 'Panier moyen', value: d.avgSaleValue, currency: true, icon: TrendingUp, accent: '#a78bfa', accent2: '#7c3aed', glow: 'rgba(167,139,250,.45)' },
    { title: 'Articles vendus', value: d.todayItemsSold, icon: Package, accent: '#fbbf24', accent2: '#d97706', glow: 'rgba(251,191,36,.45)' },
    { title: 'Commandes', value: d.pendingOrders, icon: ClipboardList, accent: '#fb7185', accent2: '#e11d48', glow: 'rgba(251,113,133,.45)', chip: 'en attente' },
  ];
  const noData = !salesLoading && chartData.length === 0;

  return (
    <div className="fx-ov">
      <style>{CSS}</style>

      {/* KPI */}
      <div className="fx-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {kpis.map(k => <KpiTile key={k.title} k={k} loading={dashLoading} />)}
      </div>

      {/* Alerte stock */}
      {d.lowStockCount > 0 && (
        <div className="fx-glass" style={{ marginTop: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderColor: 'rgba(251,191,36,.3)', boxShadow: '0 0 30px -14px rgba(251,191,36,.5)' }}>
          <div className="fx-orb" style={{ ['--accent' as any]: '#fbbf24', ['--accent2' as any]: '#d97706', ['--glow' as any]: 'rgba(251,191,36,.5)', width: 34, height: 34 }}><AlertTriangle size={17} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#ffd98a' }}>{d.lowStockCount} ingrédient(s) en stock bas</div>
            <div className="fx-sub">Vérifiez l'inventaire pour éviter les ruptures</div>
          </div>
          <Boxes size={18} className="fx-muted" />
        </div>
      )}

      {/* Barre de période */}
      <div className="fx-glass" style={{ marginTop: 14, padding: '10px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Activity size={16} style={{ color: '#22d3ee' }} />
        <span className="fx-h" style={{ marginRight: 2 }}>Période</span>
        <div className="fx-seg">
          {p.presets.map(pr => <button key={pr.key} className={p.activePreset === pr.key ? 'on' : ''} onClick={() => p.onPreset(pr.key)}>{pr.label}</button>)}
        </div>
        {p.activePreset === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" className="fx-date" value={p.customStart} onChange={e => p.setCustomStart(e.target.value)} />
            <span className="fx-muted">→</span>
            <input type="date" className="fx-date" value={p.customEnd} onChange={e => p.setCustomEnd(e.target.value)} />
          </div>
        )}
      </div>

      {/* Graphes */}
      <div className="fx-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 14 }}>
        <div className="fx-glass fx-card" style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <div className="fx-h">Chiffre d'affaires</div>
          <div className="fx-big">{fmtDH(periodTotals.totalRevenue)}</div>
          <div className="fx-sub">Moyenne {fmtDH(periodTotals.avgRevenue)} / jour</div>
          <div style={{ height: 260, marginTop: 10 }}>
            {salesLoading ? <Empty t="Chargement…" /> : noData ? <Empty t="Aucune donnée" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="fxRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                    <filter id="fxGlow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,175,255,.1)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#7f93b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#7f93b8' }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip {...TT} formatter={(v: number) => [fmtDH(v), 'Revenus']} />
                  <Area type="monotone" dataKey="revenue" stroke="#22d3ee" strokeWidth={2.5} fill="url(#fxRev)" dot={false} activeDot={{ r: 5, fill: '#22d3ee', stroke: '#06121f', strokeWidth: 2 }} style={{ filter: 'url(#fxGlow)' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="fx-glass fx-card" style={{ minWidth: 0 }}>
          <div className="fx-h">Commandes</div>
          <div className="fx-big" style={{ textShadow: '0 0 16px rgba(167,139,250,.4)' }}>{fmtInt(periodTotals.totalOrders)}</div>
          <div className="fx-sub">sur la période</div>
          <div style={{ height: 260, marginTop: 10 }}>
            {salesLoading ? <Empty t="Chargement…" /> : noData ? <Empty t="Aucune donnée" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <defs><linearGradient id="fxBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c4b5fd" /><stop offset="100%" stopColor="#7c3aed" /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(140,175,255,.1)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#7f93b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#7f93b8' }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
                  <Tooltip {...TT} formatter={(v: number) => [v, 'Commandes']} />
                  <Bar dataKey="commandes" fill="url(#fxBar)" radius={[6, 6, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Top produits + performance */}
      <div className="fx-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 14 }}>
        <div className="fx-glass fx-card" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Crown size={16} style={{ color: '#fbbf24' }} /><span className="fx-h">Top produits</span><span className="fx-sub" style={{ marginLeft: 'auto' }}>7 derniers jours</span>
          </div>
          {(!d.topProducts || d.topProducts.length === 0) ? <p className="fx-sub" style={{ textAlign: 'center', padding: '24px 0' }}>Aucune vente</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {d.topProducts.map((pr: any, i: number) => {
                const colors = ['#fbbf24', '#cbd5e1', '#f59e0b'];
                const w = (parseFloat(pr.total_revenue) / (maxRevenue || 1)) * 100;
                return (
                  <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="fx-rank" style={{ background: `${colors[i] || '#64748b'}22`, color: colors[i] || '#9fb2d6', border: `1px solid ${colors[i] || '#64748b'}55` }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.84rem', fontWeight: 600, color: '#eaf1ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pr.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                        <div className="fx-bar-track" style={{ flex: 1 }}><div className="fx-bar-fill" style={{ width: `${w}%`, background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', boxShadow: '0 0 10px rgba(34,211,238,.6)' }} /></div>
                        <span className="fx-sub" style={{ flexShrink: 0 }}>{pr.total_sold}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: '.82rem', fontWeight: 700, color: '#cfe0ff', flexShrink: 0 }}>{fmtDH(parseFloat(pr.total_revenue))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="fx-glass fx-card" style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="fx-h">Performance des produits</span><span className="fx-sub">{productData.length} produits</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid rgba(140,175,255,.14)' }}>
                {['Produit', 'Catégorie', 'Vendus', 'Revenus', 'Part'].map((h, i) => <th key={h} style={{ textAlign: i >= 2 ? 'right' : 'left', padding: '8px 6px', fontSize: '.64rem', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#7f93b8' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {productsLoading ? <tr><td colSpan={5} className="fx-sub" style={{ textAlign: 'center', padding: 24 }}>Chargement…</td></tr>
                  : productData.length === 0 ? <tr><td colSpan={5} className="fx-sub" style={{ textAlign: 'center', padding: 24 }}>Aucune donnée pour cette période</td></tr>
                    : productData.map((pr: any, idx: number) => {
                      const share = periodTotals.totalRevenue > 0 ? (parseFloat(pr.total_revenue) / periodTotals.totalRevenue) * 100 : 0;
                      return (
                        <tr key={pr.id} className="fx-row" style={{ borderBottom: '1px solid rgba(140,175,255,.07)', transition: 'background .15s' }}>
                          <td style={{ padding: '9px 6px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{idx < 3 && <span className="fx-rank" style={{ width: 20, height: 20, fontSize: '.6rem', background: 'rgba(34,211,238,.14)', color: '#7fe3f5' }}>{idx + 1}</span>}<span style={{ fontSize: '.84rem', fontWeight: 600, color: '#eaf1ff' }}>{pr.name}</span></div></td>
                          <td style={{ padding: '9px 6px' }}><span className="fx-tag">{pr.category || '—'}</span></td>
                          <td style={{ padding: '9px 6px', textAlign: 'right', fontSize: '.84rem', color: '#cfe0ff' }}>{pr.total_sold}</td>
                          <td style={{ padding: '9px 6px', textAlign: 'right', fontSize: '.84rem', fontWeight: 700, color: '#f3f8ff' }}>{fmtDH(parseFloat(pr.total_revenue))}</td>
                          <td style={{ padding: '9px 6px', textAlign: 'right' }}><div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><div className="fx-bar-track" style={{ width: 54 }}><div className="fx-bar-fill" style={{ width: `${Math.min(share, 100)}%`, background: 'linear-gradient(90deg,#22d3ee,#38bdf8)' }} /></div><span className="fx-sub" style={{ width: 38, textAlign: 'right' }}>{share.toFixed(1)}%</span></div></td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pertes */}
      {lossStats && (lossStats.topProducts as any[])?.length > 0 && (
        <div className="fx-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: 14 }}>
          <div className="fx-glass fx-card" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="fx-orb" style={{ ['--accent' as any]: '#fb7185', ['--accent2' as any]: '#e11d48', ['--glow' as any]: 'rgba(251,113,133,.5)', width: 30, height: 30 }}><Sparkles size={14} /></div>
              <span className="fx-h">Produits les plus perdus</span><span className="fx-sub" style={{ marginLeft: 'auto' }}>Ce mois</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {(lossStats.topProducts as any[]).slice(0, 5).map((pr: any, i: number) => {
                const cost = parseFloat(pr.total_cost) || 0; const maxCost = parseFloat((lossStats.topProducts as any[])[0]?.total_cost) || 1;
                return (
                  <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="fx-sub" style={{ width: 14, fontWeight: 700 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.82rem', fontWeight: 600, color: '#eaf1ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pr.name}</div>
                      <div className="fx-bar-track" style={{ marginTop: 5 }}><div className="fx-bar-fill" style={{ width: `${(cost / maxCost) * 100}%`, background: 'linear-gradient(90deg,#fb7185,#e11d48)', boxShadow: '0 0 8px rgba(251,113,133,.5)' }} /></div>
                    </div>
                    <span style={{ fontSize: '.82rem', fontWeight: 700, color: '#ff9fb0', whiteSpace: 'nowrap' }}>{fmtDH(cost)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="fx-glass fx-card" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="fx-orb" style={{ ['--accent' as any]: '#fbbf24', ['--accent2' as any]: '#d97706', ['--glow' as any]: 'rgba(251,191,36,.5)', width: 30, height: 30 }}><AlertTriangle size={14} /></div>
              <span className="fx-h">Motifs de perte fréquents</span><span className="fx-sub" style={{ marginLeft: 'auto' }}>Ce mois</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(lossStats.topReasons as any[]).slice(0, 6).map((r: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span className="fx-tag">{String(r.loss_type)}</span>
                    <span style={{ fontSize: '.84rem', color: '#cfe0ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(r.reason)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span className="fx-sub">{r.count}×</span>
                    <span style={{ fontSize: '.84rem', fontWeight: 700, color: '#f3f8ff' }}>{fmtDH(parseFloat(r.total_cost) || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ t }: { t: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#7f93b8', fontSize: '.85rem' }}>{t}</div>;
}
