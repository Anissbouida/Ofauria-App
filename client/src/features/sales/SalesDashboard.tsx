import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format, startOfDay, startOfMonth, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  LayoutDashboard, AlertTriangle, Clock, FileSignature, PackageCheck, UserPlus, Lock, Plus, CheckCircle2,
  TrendingUp, TrendingDown, ChevronRight, Target, type LucideIcon,
} from 'lucide-react';
import { reportsApi } from '../../api/reports.api';
import { ordersApi } from '../../api/orders.api';
import { quotesApi } from '../../api/quotes.api';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import { salesApi } from '../../api/sales.api';
import { customersApi } from '../../api/customers.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import SalesPageShell from './SalesPageShell';

/**
 * Tableau de bord du module Ventes, style Apple (maquette 2026-11-14) : le CA de la période
 * et sa courbe, trois anneaux d'objectifs, « Où est votre argent » (du devis à l'échu,
 * chaque étape ouvre ses pièces), la liste groupée « À faire » (chaque ligne ouvre la liste
 * déjà filtrée), les familles, les meilleurs clients et les plus gros encours. Lecture seule,
 * sans API dédiée : il assemble les sources des écrans du module.
 */

type Period = 'today' | '7d' | '30d' | 'month';
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'today', label: "Aujourd'hui" }, { key: '7d', label: '7 jours' }, { key: '30d', label: '30 jours' }, { key: 'month', label: 'Ce mois' },
];
const OPEN_ORDER = new Set(['pending', 'confirmed', 'in_production', 'ready', 'partially_delivered']);
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const n0 = (v: number) => Math.round(v || 0).toLocaleString('fr-FR');
const n2 = (v: number) => (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; };
type Row = Record<string, any>;

function rangeOf(p: Period): { from: string; to: string; prevFrom: string; prevTo: string; label: string } {
  const today = startOfDay(new Date());
  const from = p === 'today' ? today : p === '7d' ? subDays(today, 6) : p === '30d' ? subDays(today, 29) : startOfMonth(today);
  const days = Math.round((today.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = subDays(from, 1);
  const prevFrom = subDays(prevTo, days - 1);
  return { from: iso(from), to: iso(today), prevFrom: iso(prevFrom), prevTo: iso(prevTo), label: `comparé aux ${days} jour${days > 1 ? 's' : ''} précédent${days > 1 ? 's' : ''}` };
}

function delta(cur: number, prev: number) {
  if (!prev) return null;
  const p = (cur - prev) / Math.abs(prev) * 100;
  return { up: p >= 0, text: `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1).replace('.', ',')} %` };
}

function Delta({ d }: { d: ReturnType<typeof delta> }) {
  if (!d) return null;
  return <span className={d.up ? 'sal-up' : 'sal-down'}>{d.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {d.text}</span>;
}

/** Anneaux concentriques (0-100 %) : un par objectif, du plus grand au plus petit. */
function Rings({ rings }: { rings: Array<{ pct: number | null; color: string }> }) {
  const radii = [64, 49, 34];
  return (
    <svg viewBox="0 0 160 160" width={150} height={150} role="img" aria-hidden="true" style={{ flex: 'none' }}>
      <g transform="rotate(-90 80 80)" fill="none" strokeWidth={13} strokeLinecap="round">
        {rings.map((r, i) => {
          const c = 2 * Math.PI * radii[i];
          const v = Math.max(0, Math.min(100, r.pct ?? 0));
          return (
            <g key={i}>
              <circle cx={80} cy={80} r={radii[i]} stroke="var(--kl-fill)" />
              {v > 0 && <circle cx={80} cy={80} r={radii[i]} stroke={r.color} strokeDasharray={`${(v / 100) * c} ${c}`} />}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
const pct1 = (v: number) => `${v.toFixed(1).replace('.', ',')} %`;

export default function SalesDashboard() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('30d');
  const r = rangeOf(period);
  const todayIso = iso(new Date());

  const { data: sales = [] } = useQuery({ queryKey: ['reports-sales', r.from, r.to], queryFn: () => reportsApi.sales(r.from, r.to) });
  const { data: prevSales = [] } = useQuery({ queryKey: ['reports-sales', r.prevFrom, r.prevTo], queryFn: () => reportsApi.sales(r.prevFrom, r.prevTo) });
  const { data: products = [] } = useQuery({ queryKey: ['reports-products', r.from, r.to], queryFn: () => reportsApi.products(r.from, r.to) });
  const { data: cost } = useQuery({ queryKey: ['reports-cost-summary', r.from, r.to], queryFn: () => reportsApi.costSummary(r.from, r.to), retry: false });
  const { data: ordersResp } = useQuery({ queryKey: ['orders', { all: true }], queryFn: () => ordersApi.list({ limit: '500' }) });
  const { data: qov } = useQuery({ queryKey: ['quotes', 'overview'], queryFn: quotesApi.overview, retry: false });
  const { data: toInvoice = [] } = useQuery({ queryKey: ['delivery-notes', 'to-invoice'], queryFn: () => deliveryNotesApi.toInvoice(), retry: false });
  const { data: rec } = useQuery({ queryKey: ['receivables'], queryFn: salesApi.receivables, retry: false });
  const { data: customersResp } = useQuery({ queryKey: ['customers', 'dashboard'], queryFn: () => customersApi.list({ limit: '1000' }) });
  const { data: sessionsResp } = useQuery({ queryKey: ['cash-register-sessions', { dateFrom: todayIso, dateTo: todayIso }], queryFn: () => cashRegisterApi.list({ dateFrom: todayIso, dateTo: todayIso }) });

  /* ── Chiffres de la période ── */
  const sum = (rows: Row[], k: string) => rows.reduce((s, x) => s + num(x[k]), 0);
  const revenue = sum(sales as Row[], 'revenue');
  const tickets = sum(sales as Row[], 'sales_count');
  const prevRevenue = sum(prevSales as Row[], 'revenue');
  const prevTickets = sum(prevSales as Row[], 'sales_count');
  const basket = tickets ? revenue / tickets : 0;
  const prevBasket = prevTickets ? prevRevenue / prevTickets : 0;
  const margin = cost && cost.netSales > 0 ? { amount: cost.netSales - cost.foodCost, pct: (cost.netSales - cost.foodCost) / cost.netSales * 100, food: cost.foodCostPct } : null;

  const orders: Row[] = (ordersResp as { data?: Row[] } | undefined)?.data ?? [];
  const today = startOfDay(new Date());
  const openOrders = orders.filter(o => OPEN_ORDER.has(o.status));
  // Même règle que l'écran Commandes : commande en cours dont la date de retrait est dépassée.
  const lateOrders = openOrders.filter(o => o.pickup_date && startOfDay(new Date(o.pickup_date)) < today);
  const by = qov?.byStatus ?? {};
  const openQuotes = { count: (by.draft?.count ?? 0) + (by.sent?.count ?? 0), amount: (by.draft?.amount ?? 0) + (by.sent?.amount ?? 0) };
  const followQuotes = (by.sent?.expiring ?? 0) + (by.sent?.overdue ?? 0);
  const blCount = toInvoice.reduce((s, g) => s + g.notes.length, 0);
  const blAmount = toInvoice.reduce((s, g) => s + num(g.totalTtc), 0);
  const t = rec?.totals;
  const overdueCustomers = (rec?.customers ?? []).filter(c => c.overdue > 0);
  const customers: Row[] = (customersResp as { data?: Row[] } | undefined)?.data ?? [];
  const noIce = customers.filter(c => (c.customer_type === 'professionnel' || c.customer_type === 'revendeur') && !c.ice);
  const openSessions: Row[] = ((sessionsResp as { data?: Row[] } | undefined)?.data ?? []).filter(s => s.status !== 'closed');

  /* ── À traiter : seulement ce qui demande une action ── */
  const todo: Array<{ tone: 'r' | 'o' | 'b' | 'x'; icon: LucideIcon; title: string; sub: string; amount?: string; action: string; href: string }> = [];
  if (lateOrders.length) todo.push({ tone: 'r', icon: AlertTriangle, title: `${lateOrders.length} commande${lateOrders.length > 1 ? 's' : ''} en retard de retrait`, sub: 'Date de retrait dépassée sans remise au client', amount: `${n2(sum(lateOrders, 'total'))} DH`, action: 'Traiter', href: '/orders?filter=late' });
  if (t && t.overdue > 0) todo.push({ tone: 'o', icon: Clock, title: 'Créances échues', sub: `${overdueCustomers.length} client${overdueCustomers.length > 1 ? 's' : ''} · plus ancien retard ${Math.max(0, ...overdueCustomers.map(c => c.maxDaysLate))} j`, amount: `${n2(t.overdue)} DH`, action: 'Relancer', href: '/sales?tab=unpaid&filter=overdue' });
  if (followQuotes) todo.push({ tone: 'o', icon: FileSignature, title: `${followQuotes} devis à relancer`, sub: 'Validité proche ou dépassée, sans réponse du client', action: 'Relancer', href: '/quotes?status=follow' });
  if (blCount) todo.push({ tone: 'b', icon: PackageCheck, title: `${blCount} bon${blCount > 1 ? 's' : ''} de livraison à facturer`, sub: `${toInvoice.length} client${toInvoice.length > 1 ? 's' : ''} · livrés, pas encore facturés`, amount: `${n2(blAmount)} DH`, action: 'Facturer', href: '/delivery-notes' });
  if (noIce.length) todo.push({ tone: 'b', icon: UserPlus, title: `${noIce.length} client${noIce.length > 1 ? 's' : ''} professionnel${noIce.length > 1 ? 's' : ''} sans ICE`, sub: 'Leurs factures ne seraient pas conformes', action: 'Compléter', href: '/customers' });
  if (openSessions.length) todo.push({ tone: 'x', icon: Lock, title: `${openSessions.length} session${openSessions.length > 1 ? 's' : ''} de caisse ouverte${openSessions.length > 1 ? 's' : ''}`, sub: openSessions.map(s => `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() + (s.opened_at ? ` depuis ${format(new Date(s.opened_at), 'HH:mm')}` : '')).join(' · '), action: 'Voir', href: '/sales?tab=sessions' });

  /* ── Où est votre argent : du devis signé à l'échu, une teinte de l'accent par étape, le retard en rouge ── */
  const overdue = t?.overdue ?? 0;
  const money: Array<{ label: string; amount: number; sub: string; color: string; href: string; red?: boolean }> = [
    { label: 'Devis ouverts', amount: openQuotes.amount, sub: `${openQuotes.count} devis${followQuotes ? ` · ${followQuotes} à relancer` : ''}`,
      color: 'color-mix(in srgb, var(--theme-accent) 28%, var(--theme-bg-card))', href: followQuotes ? '/quotes?status=follow' : '/quotes?status=open' },
    { label: 'Commandes en cours', amount: sum(openOrders, 'total'), sub: `${openOrders.length} commande${openOrders.length > 1 ? 's' : ''}${lateOrders.length ? ` · ${lateOrders.length} en retard` : ''}`,
      color: 'color-mix(in srgb, var(--theme-accent) 50%, var(--theme-bg-card))', href: lateOrders.length ? '/orders?filter=late' : '/orders' },
    { label: 'Livré, à facturer', amount: blAmount, sub: `${blCount} bon${blCount > 1 ? 's' : ''} de livraison`,
      color: 'color-mix(in srgb, var(--theme-accent) 78%, var(--theme-bg-card))', href: '/delivery-notes' },
    { label: 'Facturé, à encaisser', amount: Math.max(0, (t?.total ?? 0) - overdue), sub: `${t?.documents ?? 0} pièce${(t?.documents ?? 0) > 1 ? 's' : ''}`,
      color: 'var(--theme-accent-hover)', href: '/sales?tab=unpaid' },
    { label: 'En retard', amount: overdue, sub: `${overdueCustomers.length} client${overdueCustomers.length > 1 ? 's' : ''}`,
      color: 'var(--prj-red)', href: '/sales?tab=unpaid&filter=overdue', red: true },
  ];
  const moneyTotal = money.reduce((s, m) => s + m.amount, 0);

  /* ── Objectifs (anneaux) : transformation des devis, marge brute, créances à jour ── */
  const conv = qov?.conversion.rate ?? null;
  const onTime = t && t.total > 0 ? (t.total - overdue) / t.total * 100 : null;

  const chart = useMemo(() => (sales as Row[]).map(x => ({ date: format(new Date(x.date), 'd MMM', { locale: fr }), revenue: num(x.revenue) })), [sales]);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products as Row[]) { const k = p.category || 'Sans famille'; m.set(k, (m.get(k) || 0) + num(p.total_revenue)); }
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = rows[0]?.[1] || 1;
    return rows.map(([name, value]) => ({ name, value, pct: value / max * 100 }));
  }, [products]);
  const owedBy = useMemo(() => new Map((rec?.customers ?? []).filter(c => c.customerId).map(c => [c.customerId as string, c.total])), [rec]);
  const topCustomers = useMemo(() => [...customers]
    .sort((a, b) => num(b.total_spent) - num(a.total_spent)).slice(0, 5)
    .map(c => ({
      id: c.id as string,
      name: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—',
      pro: !!c.customer_type && c.customer_type !== 'particulier',
      purchases: (Number(c.orders_count) || 0) + (Number(c.sales_count) || 0),
      spent: num(c.total_spent), owed: owedBy.get(c.id) ?? 0,
    })).filter(c => c.spent > 0), [customers, owedBy]);
  const topDebtors = (rec?.customers ?? []).slice().sort((a, b) => b.total - a.total).slice(0, 5);

  const rings = [
    { pct: conv, color: 'var(--theme-accent)', label: 'Transformation des devis', value: conv != null ? `${conv} %` : '—', small: qov ? `${qov.conversion.won} gagné(s) sur 90 j` : '' },
    { pct: margin?.pct ?? null, color: 'var(--prj-green)', label: 'Marge brute', value: margin ? pct1(margin.pct) : '—', small: margin ? `coût matière ${pct1(margin.food)}` : 'coûts non disponibles' },
    { pct: onTime, color: 'var(--prj-orange)', label: 'Créances à jour', value: onTime != null ? `${Math.round(onTime)} %` : '—', small: 'non échues' },
  ];

  return (
    <SalesPageShell icon={LayoutDashboard} parent="Ventes" title="Tableau de bord" list
      summary={<>{format(new Date(), 'EEEE d MMMM', { locale: fr })}{todo.length ? <> · <b>{todo.length} point{todo.length > 1 ? 's' : ''}</b> à traiter</> : ' · rien à traiter'}</>}
      actions={<>
        <div className="prj-views" role="group" aria-label="Période">
          {PERIODS.map(p => (
            <button key={p.key} type="button" className={period === p.key ? 'active' : ''} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <button type="button" className="odoo-btn-primary" onClick={() => navigate('/orders')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouvelle commande</button>
      </>}>

      <section className="kl-hero" aria-label="Chiffres de la période">
        <div className="kl-widget kl-wide">
          <div className="kl-wlabel"><span className="kl-sq"><TrendingUp size={13} /></span>Chiffre d'affaires · {PERIODS.find(p => p.key === period)?.label.toLowerCase()}</div>
          <div className="kl-big">{n0(revenue)}<small>DH</small></div>
          <div className="kl-sub"><Delta d={delta(revenue, prevRevenue)} /> {r.label} · {n0(tickets)} tickets · panier moyen {n2(basket)} DH <Delta d={delta(basket, prevBasket)} /></div>
          <div style={{ height: 190, marginTop: 14 }}>
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--kl-hair)" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--kl-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--kl-muted)' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => n0(v)} />
                  <Tooltip formatter={(v: number) => [`${n2(v)} DH`, "Chiffre d'affaires"]} />
                  <Area type="monotone" dataKey="revenue" stroke="var(--theme-accent)" strokeWidth={2.5} fill="var(--theme-accent-light)" fillOpacity={0.7} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="kl-empty" style={{ height: '100%', alignContent: 'center' }}>Aucune vente sur la période.</div>}
          </div>
        </div>
        <div className="kl-widget">
          <div className="kl-wlabel"><span className="kl-sq"><Target size={13} /></span>Objectifs</div>
          <div className="kl-rings">
            <Rings rings={rings} />
            <dl>
              {rings.map(x => (
                <div key={x.label}>
                  <dt><i style={{ background: x.color }} />{x.label}</dt>
                  <dd>{x.value}<small>{x.small}</small></dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section aria-label="Où est votre argent">
        <div className="kl-sec"><h2>Où est votre argent</h2><small><b style={{ color: 'var(--kl-ink)' }}>{n0(moneyTotal)} DH</b> en circulation</small></div>
        <div className="kl-widget">
          <div className="kl-store" aria-hidden="true">
            {money.filter(m => m.amount > 0).map(m => <span key={m.label} style={{ width: `${moneyTotal ? m.amount / moneyTotal * 100 : 0}%`, background: m.color }} />)}
          </div>
          <div className="kl-legend">
            {money.map(m => (
              <button key={m.label} type="button" className={m.red && m.amount > 0 ? 'red' : ''} onClick={() => navigate(m.href)}>
                <span className="l"><i style={{ background: m.color }} />{m.label}</span>
                <b>{n0(m.amount)}</b>
                <small>{m.sub}</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="kl-two">
        <div className="a">
          <section aria-label="À faire">
            <div className="kl-sec"><h2>À faire</h2><small>{todo.length ? 'classé par urgence' : ''}</small></div>
            {todo.length ? (
              <div className="kl-group">
                {todo.map(i => (
                  <button key={i.title} type="button" className="kl-cell ico" onClick={() => navigate(i.href)}>
                    <span className={`kl-ic ${i.tone}`}><i.icon size={16} /></span>
                    <span className="tx"><span className="t1">{i.title}</span><span className="t2">{i.sub}</span></span>
                    <span className="tr">{i.amount ?? i.action}</span>
                    <ChevronRight size={15} className="chev" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="kl-group kl-empty"><CheckCircle2 size={26} style={{ color: 'var(--prj-green)' }} /><strong>Rien à traiter</strong><span>Commandes, devis, livraisons et créances sont à jour.</span></div>
            )}
          </section>
          <section aria-label="CA par famille">
            <div className="kl-sec"><h2>CA par famille</h2><button type="button" className="sal-link" onClick={() => navigate('/reports?tab=margins')}>Marges</button></div>
            <div className="kl-group">
              {byCategory.length ? (
                <ul className="kl-bars" style={{ paddingTop: 14 }}>
                  {byCategory.map(c => (
                    <li key={c.name}>
                      <span className="h"><span>{c.name}</span><b>{n0(c.value)} DH</b></span>
                      <span className="bar"><span style={{ width: `${Math.max(2, c.pct)}%` }} /></span>
                    </li>
                  ))}
                </ul>
              ) : <div className="kl-empty">Aucune vente sur la période.</div>}
            </div>
          </section>
        </div>

        <div className="b">
          <section aria-label="Meilleurs clients">
            <div className="kl-sec"><h2>Meilleurs clients</h2><button type="button" className="sal-link" onClick={() => navigate('/customers')}>Tous</button></div>
            <div className="kl-group">
              {topCustomers.length ? topCustomers.map(c => (
                <button key={c.id} type="button" className="kl-cell av" onClick={() => navigate(`/customers/${c.id}`)}>
                  <span className="kl-mono">{initials(c.name)}</span>
                  <span className="tx"><span className="t1">{c.name}</span><span className="t2">{c.purchases} achat{c.purchases > 1 ? 's' : ''}{c.owed > 0 ? ` · reste dû ${n0(c.owed)} DH` : ''}</span></span>
                  <span className="tr">{n0(c.spent)}</span>
                  <ChevronRight size={15} className="chev" />
                </button>
              )) : <div className="kl-empty">Aucun client avec des achats.</div>}
            </div>
          </section>
          <section aria-label="Plus gros encours">
            <div className="kl-sec"><h2>Plus gros encours</h2><button type="button" className="sal-link" onClick={() => navigate('/sales?tab=unpaid')}>Créances</button></div>
            <div className="kl-group">
              {topDebtors.length ? topDebtors.map(c => (
                <button key={c.customerId ?? c.name} type="button" className="kl-cell" onClick={() => navigate(c.customerId ? `/customers/${c.customerId}` : '/sales?tab=unpaid')}>
                  <span className="tx"><span className="t1">{c.name}</span>
                    <span className="t2">{c.overdue > 0 ? `${n0(c.overdue)} DH échus · retard ${c.maxDaysLate} j` : 'rien d\'échu'}{c.creditLimit ? ` · plafond ${n0(c.creditLimit)} DH` : ''}</span></span>
                  <span className={`tr${c.overdue > 0 ? ' red' : ''}`}>{n0(c.total)}</span>
                  <ChevronRight size={15} className="chev" />
                </button>
              )) : <div className="kl-empty">Aucune créance ouverte.</div>}
            </div>
          </section>
        </div>
      </div>
    </SalesPageShell>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(w => /[A-Za-zÀ-ÿ]/.test(w[0] ?? '')).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';
}
