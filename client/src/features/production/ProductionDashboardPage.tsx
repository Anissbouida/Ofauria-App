import { useProductionPolicies, yieldLevel } from './usePolicies';
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
  AlertTriangle, BarChart3, RotateCcw
} from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { planStatusTag } from './status';
import { Alert, DataPanel, KpiCard, KpiGrid, LoadingState, EmptyState, Segmented, SectionHeader, TableFooter } from '../../components/ds';
import { format, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import SalesPageShell from '../sales/SalesPageShell';
import { applyScreenDefinition } from '@ofauria/shared';
import { useScreenDefinition } from '../../hooks/useScreenDefinition';
import { settingsApi } from '../../api/settings.api';

/** Étape 10e : sections du tableau de bord (ordre du code) et rapports du profil. */
const DASH_SECTIONS = ['blocked-alert', 'kpis', 'relaunch', 'cost-split', 'yield', 'cost-per-day', 'reports'];
const REPORT_LINKS: Record<string, { label: string; to: string }> = {
  sales: { label: 'Analyse des ventes', to: '/reports?tab=overview' },
  margins: { label: 'Marges par produit', to: '/reports?tab=margins' },
  builder: { label: 'Rapports personnalisés', to: '/reports?tab=builder' },
  menu: { label: 'Menu engineering', to: '/reports?tab=menu' },
  costs: { label: 'Coûts de production', to: '/production/costs' },
};


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
        result?.meta?.recomputed ? 'besoins et bon de sortie recalculés' : null,
      ].filter(Boolean).join(', ');
      notify.success(`Plan relancé — ${quoi}`);
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

  // Étape 10e : tableau de bord par profil et par rôle (définition « production.dashboard »).
  const dashDef = useScreenDefinition('production.dashboard');
  const dashOrder = applyScreenDefinition('production.dashboard', 'sections', DASH_SECTIONS, dashDef);
  const dashShow = (k: string) => dashOrder.includes(k);
  const dashPos = (k: string) => { const i = dashOrder.indexOf(k); return i < 0 ? 99 : i; };
  const { data: sectorInfo } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector, staleTime: 5 * 60_000, retry: false });
  const reportKeys = (sectorInfo?.current?.report_keys ?? []).filter(k => REPORT_LINKS[k]);
  const isLoading = loadingRendement || loadingCout;

  const avgRend = rendementStats?.avg_rendement ? parseFloat(rendementStats.avg_rendement) : null;
  const avgEcart = coutStats?.avg_ecart_pct ? parseFloat(coutStats.avg_ecart_pct) : null;
  const totalCout = parseFloat(coutStats?.total_cout || '1');
  const costParts: Array<{ label: string; icon: React.ReactNode; value: number; color: string }> = coutStats ? [
    { label: 'Matières', icon: <Package size={12} />, value: parseFloat(coutStats.total_matieres || '0'), color: 'var(--prj-orange)' },
    { label: 'Emballages', icon: <Package size={12} />, value: parseFloat(coutStats.total_emballages || '0'), color: 'var(--ds-cat-brown)' },
    { label: "Main-d'œuvre", icon: <Users size={12} />, value: parseFloat(coutStats.total_main_oeuvre || '0'), color: 'var(--kl-accent)' },
    { label: 'Énergie', icon: <Zap size={12} />, value: parseFloat(coutStats.total_energie || '0'), color: 'var(--ds-cat-purple)' },
    { label: 'Charges', icon: <DollarSign size={12} />, value: parseFloat(coutStats.total_charges || '0'), color: 'var(--prj-green)' },
    { label: 'Pertes', icon: <AlertTriangle size={12} />, value: parseFloat(coutStats.total_pertes || '0'), color: 'var(--ds-danger)' },
  ] : [];

  const periodLabel = period === '7d' ? '7 derniers jours' : period === '30d' ? '30 derniers jours' : '90 derniers jours';
  const rendLevel = yieldLevel(parseFloat(rendementStats?.avg_rendement || '0'), avgGood);
  const noData = !rendementStats?.total_items && !coutStats?.total_plans && blockedPlans.length === 0
    && rendementByProduct.length === 0 && coutByDay.length === 0;

  return (
    <SalesPageShell icon={BarChart3} parent="Production › Tableau de bord" title="Tableau de bord" list
      summary={`Rendement, pertes et coûts de fabrication sur les ${periodLabel}.`}
      actions={
        <Segmented label="Période" value={period} onChange={setPeriod}
          options={[{ key: '7d', label: '7 jours' }, { key: '30d', label: '30 jours' }, { key: '90d', label: '90 jours' }]} />
      }>

      {isLoading && <LoadingState />}

      {!isLoading && (
        // Étape 10e : sections ordonnées et masquables par profil, société et rôle (définition d'écran).
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div data-dash="blocked-alert" style={{ order: dashPos('blocked-alert') }} hidden={!dashShow('blocked-alert')}>
          {/* ═══ Alerte : plans bloqués ═══ */}
          {blockedPlans.length > 0 && (
            <Alert tone="warning" icon={AlertTriangle}>
              {blockedPlans.length} plan{blockedPlans.length > 1 ? 's' : ''} à relancer : articles annulés ou en attente, ou plan confirmé sur un référentiel incomplet.
            </Alert>
          )}
          </div>

          <div data-dash="kpis" style={{ order: dashPos('kpis') }} hidden={!dashShow('kpis')}>
          {/* ═══ Chiffres de la période ═══ */}
          <KpiGrid label="Chiffres de la période">
            <KpiCard label="Rendement moyen" aside={<Scale size={13} aria-hidden="true" />}
              value={avgRend != null ? `${avgRend.toFixed(1)} %` : '—'}
              tone={rendLevel === 'warn' ? 'orange' : 'green'}
              sub={`${rendementStats?.total_items || 0} article(s) produit(s)`} />
            <KpiCard label="Total des pertes" aside={<AlertTriangle size={13} aria-hidden="true" />}
              value={rendementStats?.total_pertes ? parseFloat(rendementStats.total_pertes).toFixed(0) : '0'}
              tone="red"
              sub={`Brut ${parseFloat(rendementStats?.total_brute || '0').toFixed(0)} → net ${parseFloat(rendementStats?.total_nette || '0').toFixed(0)}`} />
            <KpiCard label="Coût total" aside={<DollarSign size={13} aria-hidden="true" />}
              value={fmtMoney(coutStats?.total_cout)}
              sub={`${coutStats?.total_plans || 0} plan(s)`} />
            <KpiCard label="Écart moyen" aside={<TrendingUp size={13} aria-hidden="true" />}
              value={avgEcart != null ? `${avgEcart > 0 ? '+' : ''}${avgEcart.toFixed(1)} %` : '—'}
              tone={parseFloat(coutStats?.avg_ecart_pct || '0') <= 5 ? 'green' : 'red'}
              sub="Prévu contre réel" />
          </KpiGrid>
          </div>

          {noData && (
            <EmptyState icon={BarChart3} title="Aucune production sur la période"
              text="Les rendements et les coûts apparaissent dès qu'un plan de production est terminé." />
          )}

          <div data-dash="relaunch" style={{ order: dashPos('relaunch') }} hidden={!dashShow('relaunch')}>
          {/* ═══ Plans à relancer : tableau standard des listes « à traiter » ═══ */}
          {blockedPlans.length > 0 && (
            <section>
              <SectionHeader title="Plans à relancer" note="Articles annulés ou en attente, ou besoins à recalculer" />
              <DataPanel label="Plans à relancer" footer={<TableFooter note={`${blockedPlans.length} plan${blockedPlans.length > 1 ? 's' : ''}`} />}>
                <table className="odoo-table">
                  <thead>
                    <tr><th>N° plan</th><th>Date</th><th>Statut</th><th>À traiter</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {blockedPlans.map((p) => {
                      const nb = Number(p.relaunchable_count) || 0;
                      const st = planStatusTag(p.status as string);
                      return (
                        <tr key={p.id as string} onClick={() => navigate(`/production/${p.id}`)}>
                          <td><span className="ds-ref">{(p.of_number as string) || (p.id as string).slice(0, 8).toUpperCase()}</span></td>
                          <td className="ds-strong">{format(new Date(p.plan_date as string), 'd MMM yyyy', { locale: fr })}</td>
                          <td><StatusTag tone={st.tone} icon={st.icon} label={PRODUCTION_STATUS_LABELS[p.status as keyof typeof PRODUCTION_STATUS_LABELS] || (p.status as string)} /></td>
                          <td>
                            {nb > 0
                              ? `${nb} article(s) annulé(s) ou en attente`
                              : <span title={((p.warnings as string[] | null) || []).join('\n')}>Besoins à recalculer</span>}
                          </td>
                          <td className="ds-actions" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={async () => {
                                const detail = nb > 0
                                  ? `${nb} article(s) annulé(s) ou en attente repassent en production, et les besoins seront recalculés.`
                                  : 'Les besoins en ingrédients et le bon de sortie seront recalculés depuis les recettes actuelles.';
                                if (await confirmDialog(`${detail}\n\nAucun nouveau plan n'est créé.`, { title: 'Relancer ce plan ?', confirmLabel: 'Relancer' })) {
                                  relaunchMutation.mutate(p.id as string);
                                }
                              }}
                              disabled={relaunchMutation.isPending}
                              className="odoo-btn-secondary ds-btn-sm"
                            >
                              <RotateCcw size={12} aria-hidden="true" /> Relancer
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataPanel>
            </section>
          )}
          </div>

          <div data-dash="cost-split" style={{ order: dashPos('cost-split') }} hidden={!dashShow('cost-split')}>
          {/* ═══ Repartition des couts ═══ */}
          {coutStats && (
            <section>
              <SectionHeader title="Répartition des coûts" note={<><b style={{ color: 'var(--ds-ink)' }}>{fmtMoney(coutStats.total_cout)}</b> sur la période</>} />
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
          </div>

          <div data-dash="yield" style={{ order: dashPos('yield') }} hidden={!dashShow('yield')}>
          {/* ═══ Rendement par produit ═══ */}
          {rendementByProduct.length > 0 && (
            <section>
              <SectionHeader title="Rendement par produit" />
              <DataPanel label="Rendement par produit" footer={<TableFooter note={`${rendementByProduct.length} produit(s)`} />}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th className="ds-num">Productions</th>
                      <th>Rendement moyen</th>
                      <th className="ds-num">Pertes</th>
                      <th className="ds-num">Vers magasin</th>
                      <th className="ds-num">Vers frigo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rendementByProduct.map((r: any, i: number) => {
                      const avgR = parseFloat(r.avg_rendement);
                      const lvl = yieldLevel(avgR, avgGood, avgAlert);
                      return (
                        <tr key={i}>
                          <td className="ds-strong">{r.product_name}</td>
                          <td className="ds-num">{r.nb_productions}</td>
                          <td>
                            <StatusTag tone={lvl === 'good' ? 'done' : lvl === 'warn' ? 'todo' : lvl === 'bad' ? 'blocked' : 'draft'}
                              icon={lvl === 'good' ? TrendingUp : TrendingDown} label={`${avgR.toFixed(1)} %`} />
                          </td>
                          <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{parseFloat(r.total_pertes).toFixed(0)}</td>
                          <td className="ds-num">{parseFloat(r.total_vers_magasin).toFixed(0)}</td>
                          <td className="ds-num">{parseFloat(r.total_vers_frigo).toFixed(0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </DataPanel>
            </section>
          )}
          </div>

          <div data-dash="cost-per-day" style={{ order: dashPos('cost-per-day') }} hidden={!dashShow('cost-per-day')}>
          {/* ═══ Coûts par jour ═══ */}
          {coutByDay.length > 0 && (
            <section>
              <SectionHeader title="Coûts par jour" />
              <DataPanel label="Coûts par jour" footer={<TableFooter note={`${coutByDay.length} jour(s)`} />}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="ds-num">Matières</th>
                      <th className="ds-num">Main-d'œuvre</th>
                      <th className="ds-num">Énergie</th>
                      <th className="ds-num">Pertes</th>
                      <th className="ds-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coutByDay.map((d: any, i: number) => (
                      <tr key={i}>
                        <td className="ds-strong">{format(new Date(d.plan_date), 'd MMM yyyy', { locale: fr })}</td>
                        <td className="ds-num">{fmtMoney(d.matieres)}</td>
                        <td className="ds-num">{fmtMoney(d.main_oeuvre)}</td>
                        <td className="ds-num">{fmtMoney(d.energie)}</td>
                        <td className="ds-num" style={{ color: 'var(--ds-danger)' }}>{fmtMoney(d.pertes)}</td>
                        <td className="ds-num ds-strong">{fmtMoney(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            </section>
          )}
          </div>

          {/* Rapports du profil (report_keys) : raccourcis vers les analyses prévues pour le métier. */}
          {reportKeys.length > 0 && (
            <div data-dash="reports" style={{ order: dashPos('reports') }} hidden={!dashShow('reports')}>
              <section>
                <SectionHeader title="Rapports" note="Analyses prévues pour votre métier" />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {reportKeys.map(k => (
                    <button key={k} type="button" className="odoo-btn-secondary" onClick={() => navigate(REPORT_LINKS[k]?.to ?? '/reports')}>
                      {REPORT_LINKS[k]?.label ?? k}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </SalesPageShell>
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
