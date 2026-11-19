import { money, currencySymbol } from '../../utils/money';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api/settings.api';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { reportsApi } from '../../api/reports.api';
import { productionApi } from '../../api/production.api';
import { inventoryApi } from '../../api/inventory.api';
import PaymentAlertsWidget from '../../components/PaymentAlertsWidget';
import {
  Warehouse, Factory, ClipboardList,
  DollarSign, ShoppingCart, AlertTriangle, TrendingUp, Boxes, Clock,
  Home, ChevronRight,
} from 'lucide-react';
import { MODULE_LABELS, type AppModule } from '@ofauria/shared';
import { navLabel, visibleNavGroups } from '../../config/navigation';
import { useApprovalsCount } from '../../api/approvals.api';
import './home.css';

export default function HomePage() {
  const { user } = useAuth();
  const { hasModule, sectorLabel } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();

  // Accueil par secteur (phase 9.2) : un secteur qui définit sa page d'accueil ouvre
  // dessus (ex. « Générique » ouvre sur les ventes) ; la boulangerie reste sur ce tableau.
  // Le clic sur le nom de l'application (en-tête) demande le menu principal : pas de renvoi.
  const fromLauncher = !!(location.state as { launcher?: boolean } | null)?.launcher;
  const { data: sector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  useEffect(() => {
    const home = sector?.current?.home_route;
    if (home && home !== '/' && !fromLauncher) navigate(home, { replace: true });
  }, [sector, navigate, fromLauncher]);

  const canSeeDashboard = hasModule('dashboard') || hasModule('reports');

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard'],
    queryFn: reportsApi.dashboard,
    enabled: canSeeDashboard,
    refetchInterval: 60000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const { data: productionPlans } = useQuery({
    queryKey: ['production-today', today],
    queryFn: () => productionApi.list({ dateFrom: today, dateTo: today }),
    enabled: hasModule('production'),
  });

  const { data: stockAlerts } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: inventoryApi.alerts,
    enabled: hasModule('stock'),
  });

  // Echeances fournisseurs <= 7j affichees aux admins/gerants ayant acces au
  // module purchasing ou accounting.
  const canSeePaymentAlerts = hasModule('purchasing') || hasModule('accounting');

  const userGroups = visibleNavGroups(hasModule, user?.role);
  const approvalsCount = useApprovalsCount(!!user);

  // Production stats
  const plans = (productionPlans?.data || []) as { status: string; items?: { status: string }[] }[];
  const prodTotal = plans.length;
  const prodCompleted = plans.filter(p => p.status === 'completed').length;
  const prodInProgress = plans.filter(p => p.status === 'in_progress').length;
  const prodPct = prodTotal > 0 ? Math.round((prodCompleted / prodTotal) * 100) : 0;

  // Stock alerts
  const alertCount = (stockAlerts as unknown[] || []).length;

  // Dashboard data
  const d = dashboard || { todayRevenue: 0, todaySales: 0, avgSaleValue: 0, pendingOrders: 0, lowStockCount: 0 };

  // Quick actions
  const quickActions = [
    { label: 'Nouvelle vente', icon: ShoppingCart, href: '/pos', module: 'pos' as AppModule },
    { label: 'Production', icon: Factory, href: '/production', module: 'production' as AppModule },
    { label: MODULE_LABELS.stock, icon: Warehouse, href: '/stock', module: 'stock' as AppModule },
  ].filter(a => hasModule(a.module));

  // Accueil au design Ventes (2026-11-18) : barre (fil d'Ariane + actions rapides), grand titre,
  // briques de tableau de bord (kl-widget) puis les modules en listes groupées (kl-group / kl-cell).
  // La route « / » garde la marge p-6 d'AppLayout : la page l'annule pour poser sa barre à ras.
  return (
    <div className="odoo-scope home-page">
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <Home size={14} style={{ color: 'var(--theme-accent)' }} />
          <span className="odoo-breadcrumb-current">Accueil</span>
        </div>
        <div style={{ flex: 1 }} />
        {quickActions.map((action, i) => (
          <button key={action.href} type="button" className={i === 0 ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
            onClick={() => navigate(action.href)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <action.icon size={14} /> {action.label}
          </button>
        ))}
      </div>

      <div className="sal-page" style={{ display: 'flex', flexDirection: 'column' }}>
        <header className="kl-largetitle">
          <h1>Bienvenue, {user?.firstName}</h1>
          <p>Que souhaitez-vous faire aujourd'hui ?</p>
        </header>

        {/* ══════ DASHBOARD KPIs ══════ */}
        {canSeeDashboard && dashboard && (
          <>
            <section className="kl-stats" aria-label="Chiffres du jour">
              {/* CA du jour */}
              <button type="button" className="kl-widget home-widget" onClick={() => navigate('/sales')}>
                <div className="kl-wlabel"><span className="kl-sq"><DollarSign size={13} /></span>CA du jour</div>
                <div className="kl-big">{d.todayRevenue.toFixed(0)}<small>{currencySymbol()}</small></div>
                <div className="kl-sub"><TrendingUp size={12} style={{ verticalAlign: -1 }} /> {d.todaySales} vente{d.todaySales > 1 ? 's' : ''} · moy. {money(d.avgSaleValue, { decimals: 0 })}</div>
              </button>

              {/* Production du jour */}
              {hasModule('production') && (
                <button type="button" className="kl-widget home-widget" onClick={() => navigate('/production')}>
                  <div className="kl-wlabel"><span className="kl-sq"><Factory size={13} /></span>Production</div>
                  <div className="kl-big">{prodCompleted}<small>/ {prodTotal}</small></div>
                  <div className="home-bar" aria-hidden="true"><span style={{ width: `${prodPct}%`, background: prodPct === 100 ? 'var(--prj-green)' : undefined }} /></div>
                  <div className="kl-sub">{prodPct} % terminé{prodInProgress > 0 ? ` · ${prodInProgress} en cours` : ''}</div>
                </button>
              )}

              {/* Alertes stock */}
              {hasModule('stock') && (
                <button type="button" className="kl-widget home-widget" onClick={() => navigate('/stock')}>
                  <div className="kl-wlabel"><span className="kl-sq">{alertCount > 0 ? <AlertTriangle size={13} /> : <Boxes size={13} />}</span>Stock</div>
                  <div className="kl-big" style={{ color: alertCount > 0 ? 'var(--prj-red)' : 'var(--prj-green)' }}>
                    {alertCount > 0 ? <>{alertCount}<small>alerte{alertCount > 1 ? 's' : ''}</small></> : 'OK'}
                  </div>
                  <div className="kl-sub">{alertCount > 0 ? `${alertCount} ingrédient${alertCount > 1 ? 's' : ''} sous le seuil` : 'Aucun article sous le seuil'}</div>
                </button>
              )}

              {/* Commandes en attente */}
              <button type="button" className="kl-widget home-widget" onClick={() => navigate('/orders')}>
                <div className="kl-wlabel"><span className="kl-sq"><ClipboardList size={13} /></span>Commandes</div>
                <div className="kl-big" style={{ color: d.pendingOrders > 0 ? 'var(--prj-orange)' : undefined }}>{d.pendingOrders > 0 ? d.pendingOrders : '0'}</div>
                <div className="kl-sub">{d.pendingOrders > 0 ? <><Clock size={12} style={{ verticalAlign: -1 }} /> En attente de préparation</> : 'Rien en attente'}</div>
              </button>
            </section>

            {/* Echeances fournisseurs <= 7 jours (visible meme a 0 pour confirmer le suivi) */}
            {canSeePaymentAlerts && <PaymentAlertsWidget compact />}
          </>
        )}

        {/* ══════ MODULE NAVIGATION ══════ */}
        <div className="home-groups">
          {userGroups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <div className="kl-sec"><h2>{group.title}</h2></div>
              <div className="kl-group">
                {group.items.map((mod) => {
                  const pending = mod.counter === 'approvals' && approvalsCount > 0;
                  return (
                    <button key={mod.href} type="button" className="kl-cell ico" onClick={() => navigate(mod.href)}>
                      <span className={`kl-ic home-ic ${mod.color}`}><mod.icon size={17} /></span>
                      <span className="tx">
                        <span className="t1">{navLabel(mod, sectorLabel)}</span>
                        <span className="t2" style={pending ? { color: 'var(--prj-red)', fontWeight: 500 } : undefined}>
                          {pending
                            ? `${approvalsCount} pièce${approvalsCount > 1 ? 's' : ''} attend${approvalsCount > 1 ? 'ent' : ''} votre décision`
                            : mod.description}
                        </span>
                      </span>
                      {pending && <span className="tr red">{approvalsCount > 99 ? '99+' : approvalsCount}</span>}
                      <ChevronRight size={15} className="chev" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
