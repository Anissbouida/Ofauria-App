import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api/settings.api';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { Warehouse, Factory, ShoppingCart, Home, ChevronRight } from 'lucide-react';
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

  const userGroups = visibleNavGroups(hasModule, user?.role);
  const approvalsCount = useApprovalsCount(!!user);

  // Quick actions
  const quickActions = [
    { label: 'Nouvelle vente', icon: ShoppingCart, href: '/pos', module: 'pos' as AppModule },
    { label: 'Production', icon: Factory, href: '/production', module: 'production' as AppModule },
    { label: MODULE_LABELS.stock, icon: Warehouse, href: '/stock', module: 'stock' as AppModule },
  ].filter(a => hasModule(a.module));

  // Accueil au design Ventes (2026-11-18) : barre (fil d'Ariane + actions rapides), grand titre,
  // puis les modules en listes groupées (kl-group / kl-cell). Les tuiles du jour et les
  // échéances fournisseurs ont été retirées le 2026-11-19 (demande utilisateur).
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
