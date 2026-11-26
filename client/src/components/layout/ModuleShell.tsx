import { Fragment, createContext, useCallback, useContext, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, type LucideIcon } from 'lucide-react';
import { screenCapability } from '@ofauria/shared';
import { usePermissions } from '../../context/PermissionsContext';
import './module-shell.css';
import './apple-look.css';

/**
 * Coquille commune d'un module (discipline reprise d'ERPNext) : chaque module range
 * ses ecrans dans les MEMES rubriques, dans le MEME ordre, pour que l'utilisateur
 * sache ou chercher un rapport ou un parametrage quel que soit le module.
 *
 *   Tableau de bord → Opérations (le travail courant) → Rapports (lecture, états)
 *   → Paramétrage (référentiels et règles du module)
 *
 * L'ecran actif est porte par l'URL (?tab=…) : lien partageable, bouton Precedent,
 * rechargement sans perdre l'ecran. Le menu principal (navigation.ts) reste
 * organise par metier ; cette coquille ne concerne que l'interieur d'un module.
 */
export type ModuleSection = 'dashboard' | 'operations' | 'reports' | 'setup';

export const MODULE_SECTIONS: { key: ModuleSection; label: string }[] = [
  { key: 'dashboard', label: 'Tableau de bord' },
  { key: 'operations', label: 'Opérations' },
  { key: 'reports', label: 'Rapports' },
  { key: 'setup', label: 'Paramétrage' },
];

/**
 * Position de l'écran actif dans son module (Design System, 2026-11-22) : les pages qui
 * posent leur propre barre (SalesPageShell, bar={false}) y lisent « Module › Rubrique »
 * pour afficher le même fil d'Ariane à trois niveaux que la barre de la coquille.
 */
export const ModuleCrumbContext = createContext<{ module: string; section?: string } | null>(null);
export const useModuleCrumb = () => useContext(ModuleCrumbContext);

export interface ModuleView<K extends string = string> {
  key: K;
  label: string;
  icon: LucideIcon;
  section: ModuleSection;
  /** Masque l'ecran (droits, role) : il disparait du menu et son URL retombe sur le premier ecran. */
  hidden?: boolean;
  /**
   * Ecran porte par sa propre route : l'entree y navigue au lieu de changer ?tab=.
   * Sert aux modules faits de plusieurs pages (Production) et aux renvois vers un autre module.
   */
  href?: string;
  /** Renvoi vers un autre module (boite d'approbation, Parametres…) : signale par une fleche. */
  external?: boolean;
  /** Pastille de compteur (pieces a traiter). */
  badge?: number;
  /**
   * Sous-groupe dans la rubrique (Ventes : Caisse, Ventes pro, Livraison…) : un intertitre
   * s'affiche quand il change d'une entree a la suivante, dans l'ordre du tableau `views`.
   */
  group?: string;
}

/**
 * Écrans d'un module filtrés par les capacités de la société (feuille de route, étape 1.4) :
 * un écran déclaré dans le registre partagé (CAPABILITY_SCREENS) disparaît du menu quand sa
 * capacité est éteinte. La page n'écrit plus ce masquage elle-même ; le serveur ferme l'API
 * avec la même déclaration.
 */
export function useCapabilityScreens<V extends { key: string; hidden?: boolean }>(module: string, views: V[]): V[] {
  const { hasFeature } = usePermissions();
  return views.map(v => {
    const cap = screenCapability(module, v.key);
    return cap && !hasFeature(cap) ? { ...v, hidden: true } : v;
  });
}

/**
 * Ecran actif lu dans ?tab=… ; un onglet absent, inconnu ou masque retombe sur le
 * premier ecran visible. `select` pousse une entree d'historique (bouton Precedent).
 */
export function useModuleView<K extends string>(views: ModuleView<K>[]) {
  const [params, setParams] = useSearchParams();
  const visible = views.filter(v => !v.hidden && !v.href);
  const requested = params.get('tab');
  const current = visible.find(v => v.key === requested) ?? visible[0];

  const select = useCallback((key: K) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next);
  }, [params, setParams]);

  return { current, select, visible };
}

export function ModuleShell<K extends string>({ title, views, current, onSelect, actions, flush, bar = true, look, children }: {
  title: string;
  views: ModuleView<K>[];
  current: ModuleView<K> | undefined;
  onSelect: (key: K) => void;
  /** Boutons de l'ecran actif (Nouveau, Importer…), a droite du fil d'Ariane. */
  actions?: ReactNode;
  /** Contenu sans marge : pour les ecrans qui gerent eux-memes leurs bandeaux pleine largeur. */
  flush?: boolean;
  /** false : pas de barre de fil d'Ariane, les pages du module affichent la leur. */
  bar?: boolean;
  /**
   * Style de la refonte 2026-11 (apple-look.css), aux couleurs du thème. Depuis le 2026-11-18
   * c'est le style de TOUS les modules (même design que Ventes) : la prop reste acceptée
   * pour compatibilité mais n'a plus d'effet.
   */
  look?: 'apple';
  children: ReactNode;
}) {
  void look;
  const navigate = useNavigate();
  const visible = views.filter(v => !v.hidden);
  const sectionLabel = MODULE_SECTIONS.find(s => s.key === current?.section)?.label;

  return (
    <div className={`odoo-scope module-shell kl-apple${bar ? '' : ' no-bar'}`}>
      {bar && <div className="odoo-control-bar">
        <div className="odoo-breadcrumb" aria-label="Fil d'Ariane">
          <span>{title}</span>
          {current && sectionLabel && (
            <><span className="odoo-breadcrumb-separator">›</span><span>{sectionLabel}</span></>
          )}
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{current?.label}</span>
        </div>
        {actions}
      </div>}

      <div className="module-shell-body">
        <aside className="module-shell-nav" aria-label={`Écrans du module ${title}`}>
          {MODULE_SECTIONS.map(section => {
            const items = visible.filter(v => v.section === section.key);
            if (!items.length) return null;
            return (
              <nav key={section.key} className="module-shell-group" aria-label={section.label}>
                {section.key !== 'dashboard' && <div className="module-shell-group-title">{section.label}</div>}
                {items.map((v, i) => {
                  const Icon = v.icon;
                  const active = v.key === current?.key;
                  const groupTitle = v.group && v.group !== items[i - 1]?.group
                    ? <div className="module-shell-subtitle">{v.group}</div> : null;
                  return (
                    <Fragment key={v.key}>{groupTitle}
                    <button type="button" onClick={() => (v.href ? navigate(v.href) : onSelect(v.key))}
                      className={`module-shell-item${active ? ' active' : ''}`}
                      aria-current={active ? 'page' : undefined}>
                      <Icon size={15} /> {v.label}
                      {!!v.badge && <span className="module-shell-badge">{v.badge > 99 ? '99+' : v.badge}</span>}
                      {v.external && <ExternalLink size={12} className="module-shell-external" />}
                    </button>
                    </Fragment>
                  );
                })}
              </nav>
            );
          })}
        </aside>

        <div className={`module-shell-main${flush ? ' flush' : ''}`}>
          <ModuleCrumbContext.Provider value={{ module: title, section: sectionLabel }}>{children}</ModuleCrumbContext.Provider>
        </div>
      </div>
    </div>
  );
}

/**
 * Page d'un module au design Ventes (2026-11-18) : grand titre (+ résumé optionnel) et marges
 * standard (.kl-page = mêmes marges que .sal-page/.acc-page). À utiliser dans une coquille
 * `flush` dont la barre de fil d'Ariane est celle du module, ou sous la barre propre d'une page.
 */
export function ModulePage({ title, summary, children }: { title?: ReactNode; summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="kl-page">
      {title && <header className="kl-largetitle"><h1>{title}</h1>{summary && <p>{summary}</p>}</header>}
      {children}
    </div>
  );
}
