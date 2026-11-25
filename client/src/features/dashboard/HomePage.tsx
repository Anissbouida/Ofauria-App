import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api/settings.api';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { Warehouse, Factory, ShoppingCart, Home, ChevronRight } from 'lucide-react';
import { MODULE_LABELS, workspaceHomeRoute, type AppModule } from '@ofauria/shared';
import { useInterfacePreferences } from '../../api/interface-preferences.api';
import { navLabel, visibleNavGroups } from '../../config/navigation';
import { useApprovalsCount } from '../../api/approvals.api';
import { Breadcrumb, PageHeader, SectionHeader } from '../../components/ds';
import './home.css';

export default function HomePage() {
  const { user } = useAuth();
  const { hasModule, sectorLabel, canEdit } = usePermissions();
  // Premier démarrage : l'assistant de configuration est proposé à qui peut configurer.
  const setup = useQuery({ queryKey: ['settings', 'setup'], queryFn: settingsApi.setup, enabled: canEdit('settings'), staleTime: 60_000 });
  const firstRun = !!setup.data?.wizard?.firstRun;
  const navigate = useNavigate();
  const location = useLocation();

  // Accueil par secteur (phase 9.2) : un secteur qui définit sa page d'accueil ouvre
  // dessus (ex. « Générique » ouvre sur les ventes) ; la boulangerie reste sur ce tableau.
  // Le clic sur le nom de l'application (en-tête) demande le menu principal : pas de renvoi.
  const fromLauncher = !!(location.state as { launcher?: boolean } | null)?.launcher;
  const { data: sector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const preferences=useInterfacePreferences(user?.id);
  useEffect(() => {
    if(preferences.isLoading)return;
    const visible=visibleNavGroups(hasModule,user?.role).flatMap(g=>g.items.map(item=>item.href));
    // Les préférences ne confèrent jamais de droit ; une route non visible garde l'accueil général.
    const home=workspaceHomeRoute(preferences.data?.values.workspace??'sector',sector?.current?.home_route,visible,fromLauncher);
    if(home)navigate(home,{replace:true});
  },[sector,navigate,fromLauncher,preferences.isLoading,preferences.data?.values.workspace,hasModule,user?.role]);

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
        <Breadcrumb icon={Home} items={[{ label: 'Accueil' }]} />
        <div style={{ flex: 1 }} />
        {/* Une seule action principale, à droite ; les raccourcis secondaires à sa gauche. */}
        {[...quickActions.slice(1), ...quickActions.slice(0, 1)].map(action => (
          <button key={action.href} type="button" className={action === quickActions[0] ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
            onClick={() => navigate(action.href)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <action.icon size={14} aria-hidden="true" /> {action.label}
          </button>
        ))}
      </div>

      <div className="sal-page" style={{ display: 'flex', flexDirection: 'column' }}>
        <PageHeader title={`Bienvenue, ${user?.firstName ?? ''}`} description="Que souhaitez-vous faire aujourd'hui ?" />
        {firstRun && <div className="ds-alert info" style={{ alignItems: 'center' }}><span style={{ flex: 1 }}><strong>Configurez Kalum pour votre activité.</strong> L’assistant vous guide en quelques étapes : secteur, modules, vocabulaire, règles et rôles. Rien n’est modifié avant l’activation finale.</span>
          <button type="button" className="odoo-btn-primary" onClick={() => navigate('/settings/assistant')}>{setup.data?.wizard?.count ? 'Reprendre la configuration' : 'Démarrer l’assistant'}</button></div>}

        {/* ══════ MODULE NAVIGATION ══════ */}
        <div className="home-groups">
          {userGroups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <SectionHeader title={group.title} />
              <div className="kl-group">
                {group.items.map((mod) => {
                  const pending = mod.counter === 'approvals' && approvalsCount > 0;
                  return (
                    <button key={mod.href} type="button" className="kl-cell ico" onClick={() => navigate(mod.href)}>
                      <span className={`kl-ic home-ic ${mod.color}`}><mod.icon size={17} aria-hidden="true" /></span>
                      <span className="tx">
                        <span className="t1">{navLabel(mod, sectorLabel)}</span>
                        <span className="t2" style={pending ? { color: 'var(--ds-danger)', fontWeight: 600 } : undefined}>
                          {pending
                            ? `${approvalsCount} pièce${approvalsCount > 1 ? 's' : ''} attend${approvalsCount > 1 ? 'ent' : ''} votre décision`
                            : mod.description}
                        </span>
                      </span>
                      {pending && <span className="tr red">{approvalsCount > 99 ? '99+' : approvalsCount}</span>}
                      <ChevronRight size={15} className="chev" aria-hidden="true" />
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
