import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ListPage } from './ListTemplate';
import { useModuleCrumb } from '../../components/layout/ModuleShell';

/**
 * En-tête standard d'un onglet du module Ventes : barre de contrôle (fil d'Ariane + actions)
 * à ras du haut, puis corps avec la même marge partout. Toutes les pages du module l'emploient
 * pour que la position de l'en-tête et du contenu ne saute pas d'un onglet à l'autre
 * (SalesLayout rend la coquille en bar={false} flush : chaque page pose sa propre barre).
 */
export default function SalesPageShell({ icon: Icon, title, parent, summary, actions, list, children }: {
  icon?: LucideIcon;
  title: string;
  /** Segment parent du fil d'Ariane (ex. « Rapports ») ; omis, seul le titre s'affiche. */
  parent?: string;
  /** Résumé court après le titre (ex. « 8 en cours · 4 047 DH »). */
  summary?: ReactNode;
  /** Boutons de l'écran (Nouveau…, bascules) à droite de la barre. */
  actions?: ReactNode;
  /** Corps au gabarit Liste de la refonte (ListPage : pastilles, tuiles, panneau). */
  list?: boolean;
  children: ReactNode;
}) {
  // Fil d'Ariane à trois niveaux : « Module › Rubrique › Page ». Sans `parent`, la coquille du
  // module fournit les deux premiers niveaux (Design System, 2026-11-22).
  const crumb = useModuleCrumb();
  // `parent` déjà complet (« Module › Rubrique ») : on le garde ; sinon la coquille fait foi.
  const lead = parent && (parent.includes('›') || !crumb) ? [parent]
    : crumb ? [crumb.module, ...(crumb.section && crumb.section !== title ? [crumb.section] : [])]
    : [];
  // Style Apple (2026-11) : grand titre en tête de page, le résumé passe dessous.
  const largeTitle = <header className="kl-largetitle"><h1>{title}</h1>{summary && <p>{summary}</p>}</header>;
  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          {Icon && <Icon size={14} style={{ color: 'var(--ds-accent)' }} />}
          {lead.map(l => <span key={l} style={{ display: 'contents' }}><span>{l}</span><span className="odoo-breadcrumb-separator">›</span></span>)}
          <span className="odoo-breadcrumb-current">{title}</span>
          {summary && <span className="spsh-summary" style={{ marginLeft: 8, color: 'var(--ds-muted)', fontSize: '13px' }}>{summary}</span>}
        </div>
        <div style={{ flex: 1 }} />
        {actions}
      </div>
      {list ? <ListPage>{largeTitle}{children}</ListPage> : (
        <div className="sal-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {largeTitle}
          {children}
        </div>
      )}
    </div>
  );
}
