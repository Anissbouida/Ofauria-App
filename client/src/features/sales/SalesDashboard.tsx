import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format, startOfDay, startOfMonth, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  LayoutDashboard, AlertTriangle, Clock, FileSignature, PackageCheck, UserPlus, Lock, Plus, CheckCircle2,
  TrendingUp, TrendingDown, type LucideIcon,
} from 'lucide-react';
import { reportsApi } from '../../api/reports.api';
import { ordersApi } from '../../api/orders.api';
import { quotesApi } from '../../api/quotes.api';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import { salesApi } from '../../api/sales.api';
import { customersApi } from '../../api/customers.api';
import { cashRegisterApi } from '../../api/cash-register.api';
import SalesPageShell from './SalesPageShell';
import { ListKpi } from './ListTemplate';

/**
 * Tableau de bord du module Ventes (maquette 2026-11-13, planche 1) : les chiffres de la
 * période, ce qui demande une action (« À traiter », chaque ligne ouvre la liste déjà
 * filtrée), la chaîne pro devis → encaissement, le CA par jour et par famille, les
 * meilleurs clients et les plus gros encours. Lecture seule, sans API dédiée : il
 * assemble les sources des écrans du module.
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

  /* ── Chaîne pro, du devis à l'encaissement ── */
  const flow = [
    { label: 'Devis ouverts', count: String(openQuotes.count), amount: openQuotes.amount, href: '/quotes?status=open' },
    { label: 'Commandes en cours', count: String(openOrders.length), amount: sum(openOrders, 'total'), href: '/orders' },
    { label: 'Livrées, à facturer', count: String(blCount), amount: blAmount, href: '/delivery-notes' },
    { label: 'Créances à encaisser', count: String(t?.documents ?? 0), amount: t?.total ?? 0, href: '/sales?tab=unpaid' },
    { label: 'Dont échu', count: `${overdueCustomers.length} client${overdueCustomers.length > 1 ? 's' : ''}`, amount: t?.overdue ?? 0, href: '/sales?tab=unpaid&filter=overdue', red: true },
  ];
  const flowMax = Math.max(1, ...flow.map(f => f.amount));

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

  return (
    <SalesPageShell icon={LayoutDashboard} parent="Ventes" title="Tableau de bord" list
      summary={format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
      actions={<button type="button" className="odoo-btn-primary" onClick={() => navigate('/orders')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouvelle commande</button>}>

      <div className="prj-toolbar">
        <div className="prj-views" role="group" aria-label="Période">
          {PERIODS.map(p => (
            <button key={p.key} type="button" className={period === p.key ? 'active' : ''} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <span className="prj-note">Évolutions {r.label}</span>
      </div>

      <section className="prj-kpis" aria-label="Indicateurs">
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Chiffre d'affaires</span><Delta d={delta(revenue, prevRevenue)} /></div>
          <div className="prj-kpi-value">{n0(revenue)} DH</div>
          <div className="prj-kpi-sub">période précédente {n0(prevRevenue)} DH</div>
        </div>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Tickets</span><Delta d={delta(tickets, prevTickets)} /></div>
          <div className="prj-kpi-value">{n0(tickets)}</div>
          <div className="prj-kpi-sub">panier moyen {n2(basket)} DH <Delta d={delta(basket, prevBasket)} /></div>
        </div>
        <ListKpi label="Commandes en cours" value={String(openOrders.length)}
          sub={lateOrders.length ? `${lateOrders.length} en retard · ${n0(sum(openOrders, 'total'))} DH` : `${n0(sum(openOrders, 'total'))} DH à livrer`} tone={lateOrders.length ? 'red' : undefined} />
        <ListKpi label="Devis ouverts" value={String(openQuotes.count)}
          sub={`${n0(openQuotes.amount)} DH${qov?.conversion.rate != null ? ` · transformation ${qov.conversion.rate} %` : ''}`} />
        <ListKpi label="À encaisser" value={t ? `${n0(t.total)} DH` : '—'} sub={t ? (t.overdue > 0 ? `${n0(t.overdue)} DH échus` : 'rien d\'échu') : ''} tone={t && t.overdue > 0 ? 'orange' : undefined} />
        <ListKpi label="Marge brute" value={margin ? `${margin.pct.toFixed(1).replace('.', ',')} %` : '—'}
          sub={margin ? `${n0(margin.amount)} DH · coût matière ${margin.food.toFixed(1).replace('.', ',')} %` : 'coûts non disponibles'} />
      </section>

      <div className="sal-row">
        <section className="prj-panel sal-grow">
          <div className="prj-panel-head">À traiter <small>{todo.length ? `${todo.length} point${todo.length > 1 ? 's' : ''} demande${todo.length > 1 ? 'nt' : ''} une action` : ''}</small></div>
          {todo.length ? (
            <ul className="sal-todo">
              {todo.map(i => (
                <li key={i.title}>
                  <span className={`sal-todo-ic ${i.tone}`}><i.icon size={16} /></span>
                  <div className="sal-todo-tx"><strong>{i.title}</strong><span className="sal-sub">{i.sub}</span></div>
                  {i.amount && <span className="sal-todo-amt">{i.amount}</span>}
                  <button type="button" className="sal-next" onClick={() => navigate(i.href)}>{i.action}</button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sal-empty"><CheckCircle2 size={26} style={{ color: 'var(--prj-green)' }} /><strong>Rien à traiter</strong><span>Commandes, devis, livraisons et créances sont à jour.</span></div>
          )}
        </section>
        <section className="prj-panel sal-side">
          <div className="prj-panel-head">Ventes pro, du devis à l'encaissement</div>
          <ol className="sal-flow">
            {flow.map(f => (
              <li key={f.label}>
                <button type="button" onClick={() => navigate(f.href)}>
                  <span className="sal-flow-h"><span>{f.label} · {f.count}</span><strong>{n0(f.amount)} DH</strong></span>
                  <span className={`prj-bar ${f.red ? 'red' : ''}`}><span style={{ width: `${f.amount ? Math.max(2, f.amount / flowMax * 100) : 0}%` }} /></span>
                </button>
              </li>
            ))}
          </ol>
          <p className="prj-note" style={{ padding: '0 16px 14px' }}>Chaque étape ouvre la liste correspondante.</p>
        </section>
      </div>

      <div className="sal-row">
        <section className="prj-panel sal-grow">
          <div className="prj-panel-head">Chiffre d'affaires par jour <small>{PERIODS.find(p => p.key === period)?.label}</small></div>
          <div style={{ padding: '12px 12px 6px', height: 260 }}>
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--odoo-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--odoo-text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--odoo-text-muted)' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => n0(v)} />
                  <Tooltip formatter={(v: number) => [`${n2(v)} DH`, "Chiffre d'affaires"]} cursor={{ fill: 'var(--odoo-border)', opacity: 0.4 }} />
                  <Bar dataKey="revenue" fill="var(--odoo-purple)" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="sal-empty" style={{ height: '100%', alignContent: 'center' }}>Aucune vente sur la période.</div>}
          </div>
        </section>
        <section className="prj-panel sal-side">
          <div className="prj-panel-head">CA par famille <button type="button" className="sal-link" onClick={() => navigate('/reports?tab=margins')}>Marges</button></div>
          {byCategory.length ? (
            <ul className="sal-cat">
              {byCategory.map(c => (
                <li key={c.name}>
                  <span className="sal-flow-h"><span>{c.name}</span><strong>{n0(c.value)} DH</strong></span>
                  <span className="prj-bar"><span style={{ width: `${Math.max(2, c.pct)}%` }} /></span>
                </li>
              ))}
            </ul>
          ) : <div className="sal-empty">Aucune vente sur la période.</div>}
        </section>
      </div>

      <div className="sal-row">
        <section className="prj-panel sal-grow sal-panel">
          <div className="prj-panel-head">Meilleurs clients <small>CA cumulé</small><button type="button" className="sal-link" onClick={() => navigate('/customers')}>Tous les clients</button></div>
          <div className="prj-scroll">
            <table className="odoo-table">
              <thead><tr><th>Client</th><th style={{ textAlign: 'right' }}>Achats</th><th style={{ textAlign: 'right' }}>CA TTC</th><th style={{ textAlign: 'right' }}>Reste dû</th></tr></thead>
              <tbody>
                {topCustomers.map(c => (
                  <tr key={c.id} onClick={() => navigate('/customers')}>
                    <td><span style={{ fontWeight: 500 }}>{c.name}</span><span className="sal-sub">{c.pro ? 'Professionnel' : 'Particulier'}</span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.purchases}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}><strong>{n2(c.spent)}</strong></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: c.owed > 0 ? 'var(--prj-orange)' : 'var(--odoo-text-muted)', fontWeight: c.owed > 0 ? 600 : 400 }}>{c.owed > 0 ? n2(c.owed) : '—'}</td>
                  </tr>
                ))}
                {!topCustomers.length && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--odoo-text-muted)' }}>Aucun client avec des achats.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="prj-panel sal-side">
          <div className="prj-panel-head">Plus gros encours <button type="button" className="sal-link" onClick={() => navigate('/sales?tab=unpaid')}>Créances</button></div>
          {topDebtors.length ? (
            <ul className="sal-cat">
              {topDebtors.map(c => (
                <li key={c.customerId ?? c.name}>
                  <span className="sal-flow-h"><span>{c.name}</span><strong>{n0(c.total)} DH</strong></span>
                  <span className="sal-sub" style={{ marginTop: 0, color: c.overdue > 0 ? 'var(--prj-red)' : undefined }}>
                    {c.overdue > 0 ? `${n0(c.overdue)} DH échus · retard ${c.maxDaysLate} j` : 'rien d\'échu'}
                    {c.creditLimit ? ` · plafond ${n0(c.creditLimit)} DH` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : <div className="sal-empty">Aucune créance ouverte.</div>}
        </section>
      </div>
    </SalesPageShell>
  );
}
