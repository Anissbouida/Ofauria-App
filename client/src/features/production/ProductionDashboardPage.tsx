import { useProductionPolicies, yieldLevel, YIELD_PILL } from './usePolicies';
import { money } from '../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { productionCoutApi } from '../../api/production-cout.api';
import { productionApi } from '../../api/production.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import { PRODUCTION_STATUS_LABELS } from '@ofauria/shared';
import {
  TrendingUp, TrendingDown, DollarSign, Scale, Package, Users, Zap,
  AlertTriangle, BarChart3, Loader2, RotateCcw
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import SalesPageShell from '../sales/SalesPageShell';

export default function ProductionDashboardPage() {
  const { user } = useAuth();
  const storeId = user?.storeId || '';
  // M1-03 : seuils d'affichage du rendement moyen lus dans les politiques de production.
  const policies = useProductionPolicies({ store: storeId || undefined });
  const avgGood = policies.num('production.yield_display', 'good');
  const avgAlert = policies.num('production.yield_display', 'alert');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const dateFrom = format(subDays(new Date(), period === '7d' ? 7 : period === '30d' ? 30 : 90), 'yyyy-MM-dd');
  const dateTo = format(new Date(), 'yyyy-MM-dd');

  const { data: rendementStats, isLoading: loadingRendement } = useQuery({
    queryKey: ['rendement-stats', storeId, dateFrom, dateTo],
    queryFn: () => productionEtapesApi.rendementStats(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const { data: rendementByProduct = [] } = useQuery({
    queryKey: ['rendement-by-product', storeId, dateFrom, dateTo],
    queryFn: () => productionEtapesApi.rendementByProduct(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const { data: coutStats, isLoading: loadingCout } = useQuery({
    queryKey: ['cout-stats', storeId, dateFrom, dateTo],
    queryFn: () => productionCoutApi.costStats(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  const { data: coutByDay = [] } = useQuery({
    queryKey: ['cout-by-day', storeId, dateFrom, dateTo],
    queryFn: () => productionCoutApi.costByDay(storeId, dateFrom, dateTo),
    enabled: !!storeId,
  });

  // ═══ Plans bloques, relancables ═══
  // Deux signaux de blocage : des articles annules / en attente, ou des warnings
  // laisses par une confirmation sur referentiel incomplet (produit sans recette
  // -> aucun besoin calcule, aucun BSI).
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();

  const { data: plansData } = useQuery({
    queryKey: ['production', 'relaunchable'],
    queryFn: () => productionApi.list({ limit: '100' }),
  });
  const blockedPlans = ((plansData?.data || []) as Record<string, any>[]).filter(
    (p) => p.status !== 'draft'
      && (Number(p.relaunchable_count) > 0 || ((p.warnings as string[] | null)?.length ?? 0) > 0)
  );

  const relaunchMutation = useMutation({
    mutationFn: (planId: string) => productionApi.relaunch(planId),
    onSuccess: (result: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      const count = (result?.meta?.relaunchedCount as number) ?? 0;
      const quoi = [
        count > 0 ? `${count} article(s) remis en production` : null,
        result?.meta?.recomputed ? 'besoins et bon de sortie recalcules' : null,
      ].filter(Boolean).join(', ');
      notify.success(`Plan relance — ${quoi}`);
      (result?.warnings as string[] | undefined)?.forEach((w) => notify(w, { icon: '⚠️', duration: 6000 }));
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        || 'Erreur lors de la relance du plan';
      notify.error(msg);
    },
  });

  const fmtMoney = (val: unknown) => {
    const n = parseFloat(String(val));
    if (isNaN(n)) return '—';
    return money(n);
  };

  const isLoading = loadingRendement || loadingCout;

  const avgRend = rendementStats?.avg_rendement ? parseFloat(rendementStats.avg_rendement) : null;
  const avgEcart = coutStats?.avg_ecart_pct ? parseFloat(coutStats.avg_ecart_pct) : null;
  const totalCout = parseFloat(coutStats?.total_cout || '1');
  const costParts: Array<{ label: string; icon: React.ReactNode; value: number; color: string }> = coutStats ? [
    { label: 'Matieres', icon: <Package size={12} />, value: parseFloat(coutStats.total_matieres || '0'), color: 'var(--prj-orange)' },
    { label: 'Emballages', icon: <Package size={12} />, value: parseFloat(coutStats.total_emballages || '0'), color: '#C2410C' },
    { label: "Main d'oeuvre", icon: <Users size={12} />, value: parseFloat(coutStats.total_main_oeuvre || '0'), color: 'var(--kl-accent)' },
    { label: 'Energie', icon: <Zap size={12} />, value: parseFloat(coutStats.total_energie || '0'), color: '#7C3AED' },
    { label: 'Charges', icon: <DollarSign size={12} />, value: parseFloat(coutStats.total_charges || '0'), color: 'var(--prj-green)' },
    { label: 'Pertes', icon: <AlertTriangle size={12} />, value: parseFloat(coutStats.total_pertes || '0'), color: 'var(--prj-red)' },
  ] : [];

  return (
    <SalesPageShell icon={BarChart3} parent="Production" title="Tableau de bord" list
      summary={<>{period === '7d' ? '7 derniers jours' : period === '30d' ? '30 derniers jours' : '90 derniers jours'}{blockedPlans.length ? <> · <b>{blockedPlans.length} plan{blockedPlans.length > 1 ? 's' : ''}</b> à relancer</> : null}</>}
      actions={
        <div className="prj-views" role="group" aria-label="Période">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button key={p} type="button" onClick={() => setPeriod(p)} className={period === p ? 'active' : ''} aria-pressed={period === p}>
              {p === '7d' ? '7j' : p === '30d' ? '30j' : '90j'}
            </button>
          ))}
        </div>
      }>

      {isLoading && (
        <section className="prj-panel sal-empty"><Loader2 size={20} className="animate-spin" /><span>Chargement...</span></section>
      )}

      {!isLoading && (
        <>
          {/* ═══ Chiffres de la période ═══ */}
          <section className="kl-stats" aria-label="Chiffres de la période">
            <StatCard icon={<Scale size={13} />} label="Rendement moyen"
              value={avgRend != null ? `${avgRend.toFixed(1)}%` : '—'}
              tone={yieldLevel(parseFloat(rendementStats?.avg_rendement || '0'), avgGood) === 'warn' ? 'orange' : 'green'}
              sub={`${rendementStats?.total_items || 0} items`} />
            <StatCard icon={<AlertTriangle size={13} />} label="Total pertes"
              value={rendementStats?.total_pertes ? parseFloat(rendementStats.total_pertes).toFixed(0) : '0'}
              tone="red"
              sub={`Brut: ${parseFloat(rendementStats?.total_brute || '0').toFixed(0)} → Net: ${parseFloat(rendementStats?.total_nette || '0').toFixed(0)}`} />
            <StatCard icon={<DollarSign size={13} />} label="Cout total"
              value={fmtMoney(coutStats?.total_cout)}
              sub={`${coutStats?.total_plans || 0} plans`} />
            <StatCard icon={<TrendingUp size={13} />} label="Ecart moyen"
              value={avgEcart != null ? `${avgEcart > 0 ? '+' : ''}${avgEcart.toFixed(1)}%` : '—'}
              tone={parseFloat(coutStats?.avg_ecart_pct || '0') <= 5 ? 'green' : 'red'}
              sub="Prevu vs Reel" />
          </section>

          {/* ═══ Plans a relancer ═══ */}
          {blockedPlans.length > 0 && (
            <section>
              <div className="kl-sec"><h2>Plans a relancer</h2><small>articles annules / en attente, ou plan confirme sur un referentiel incomplet</small></div>
              <div className="kl-group">
                {blockedPlans.map((p) => {
                  const nb = Number(p.relaunchable_count) || 0;
                  return (
                    <div key={p.id as string} className="kl-cell ico" role="button" tabIndex={0}
                      onClick={() => navigate(`/production/${p.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/production/${p.id}`); }}>
                      <span className={`kl-ic ${nb > 0 ? 'o' : 'b'}`}><RotateCcw size={16} /></span>
                      <span className="tx">
                        <span className="t1"><span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{(p.id as string).slice(0, 8).toUpperCase()}</span> · {format(new Date(p.plan_date as string), 'dd/MM/yyyy')}</span>
                        <span className="t2">
                          {PRODUCTION_STATUS_LABELS[p.status as keyof typeof PRODUCTION_STATUS_LABELS] || (p.status as string)}
                          {' · '}
                          {nb > 0
                            ? <span style={{ color: 'var(--prj-orange)', fontWeight: 600 }}>{p.relaunchable_count as number} article(s)</span>
                            : <span title={((p.warnings as string[] | null) || []).join('\n')}>besoins a recalculer</span>}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const detail = nb > 0
                            ? `${nb} article(s) annule(s) ou en attente repassent en production, et les besoins seront recalcules.`
                            : 'Les besoins en ingredients et le bon de sortie seront recalcules depuis les recettes actuelles.';
                          if (await confirmDialog(`${detail}\n\nAucun nouveau plan n'est créé.`, { title: 'Relancer ce plan ?', confirmLabel: 'Relancer' })) {
                            relaunchMutation.mutate(p.id as string);
                          }
                        }}
                        disabled={relaunchMutation.isPending}
                        className="sal-next"
                      >
                        <RotateCcw size={12} /> Relancer
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ═══ Repartition des couts ═══ */}
          {coutStats && (
            <section>
              <div className="kl-sec"><h2>Repartition des couts</h2><small><b style={{ color: 'var(--kl-ink)' }}>{fmtMoney(coutStats.total_cout)}</b> sur la période</small></div>
              <div className="kl-widget">
                <div className="kl-store" aria-hidden="true">
                  {costParts.filter(c => c.value > 0).map(c => (
                    <span key={c.label} style={{ flex: c.value, background: c.color }} />
                  ))}
                </div>
                <div className="kl-legend">
                  {costParts.map(c => <CostBar key={c.label} label={c.label} icon={c.icon} value={c.value} total={totalCout} color={c.color} />)}
                </div>
              </div>
            </section>
          )}

          {/* ═══ Rendement by product ═══ */}
          {rendementByProduct.length > 0 && (
            <section>
              <div className="kl-sec"><h2>Rendement par produit</h2><small>{rendementByProduct.length} produit(s)</small></div>
              <section className="prj-panel sal-panel">
                <div className="prj-scroll">
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Produit</th>
                        <th style={{ textAlign: 'center' }}>Productions</th>
                        <th style={{ textAlign: 'center' }}>Rendement moy.</th>
                        <th style={{ textAlign: 'center' }}>Pertes</th>
                        <th style={{ textAlign: 'center' }}>Vers magasin</th>
                        <th style={{ textAlign: 'center' }}>Vers frigo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rendementByProduct.map((r: any, i: number) => {
                        const avgR = parseFloat(r.avg_rendement);
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>{r.product_name}</td>
                            <td style={{ textAlign: 'center' }}>{r.nb_productions}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${YIELD_PILL[yieldLevel(avgR, avgGood, avgAlert)]}`}>
                                {yieldLevel(avgR, avgGood, avgAlert) === 'good' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                {avgR.toFixed(1)}%
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', color: 'var(--prj-red)' }}>{parseFloat(r.total_pertes).toFixed(0)}</td>
                            <td style={{ textAlign: 'center' }}>{parseFloat(r.total_vers_magasin).toFixed(0)}</td>
                            <td style={{ textAlign: 'center' }}>{parseFloat(r.total_vers_frigo).toFixed(0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}

          {/* ═══ Cost by day ═══ */}
          {coutByDay.length > 0 && (
            <section>
              <div className="kl-sec"><h2>Couts par jour</h2><small>{coutByDay.length} jour(s)</small></div>
              <section className="prj-panel sal-panel">
                <div className="prj-scroll">
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Matieres</th>
                        <th style={{ textAlign: 'right' }}>M.O.</th>
                        <th style={{ textAlign: 'right' }}>Energie</th>
                        <th style={{ textAlign: 'right' }}>Pertes</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coutByDay.map((d: any, i: number) => (
                        <tr key={i}>
                          <td>{format(new Date(d.plan_date), 'dd/MM/yyyy')}</td>
                          <td style={{ textAlign: 'right' }}>{fmtMoney(d.matieres)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtMoney(d.main_oeuvre)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtMoney(d.energie)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--prj-red)' }}>{fmtMoney(d.pertes)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(d.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}
        </>
      )}
    </SalesPageShell>
  );
}

function StatCard({ icon, label, value, tone, sub }: {
  icon: React.ReactNode; label: string; value: string; tone?: 'red' | 'green' | 'orange'; sub?: string;
}) {
  return (
    <div className="kl-widget">
      <div className="kl-wlabel"><span className="kl-sq">{icon}</span>{label}</div>
      <div className="kl-big" style={{ fontSize: 32, color: tone ? `var(--prj-${tone})` : undefined }}>{value}</div>
      {sub && <div className="kl-sub">{sub}</div>}
    </div>
  );
}

function CostBar({ label, icon, value, total, color }: {
  label: string; icon: React.ReactNode; value: number; total: number; color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ padding: '8px 10px' }}>
      <span className="l"><i style={{ background: color }} />{icon} {label}</span>
      <b>{pct.toFixed(0)}%</b>
      <small>{money(value)}</small>
    </div>
  );
}
