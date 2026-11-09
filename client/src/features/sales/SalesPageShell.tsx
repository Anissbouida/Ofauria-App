import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * En-tête standard d'un onglet du module Ventes : barre de contrôle (fil d'Ariane + actions)
 * à ras du haut, puis corps avec la même marge partout. Toutes les pages du module l'emploient
 * pour que la position de l'en-tête et du contenu ne saute pas d'un onglet à l'autre
 * (SalesLayout rend la coquille en bar={false} flush : chaque page pose sa propre barre).
 */
export default function SalesPageShell({ icon: Icon, title, parent, actions, children }: {
  icon?: LucideIcon;
  title: string;
  /** Segment parent du fil d'Ariane (ex. « Rapports ») ; omis, seul le titre s'affiche. */
  parent?: string;
  /** Boutons de l'écran (Nouveau…, bascules) à droite de la barre. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          {Icon && <Icon size={14} style={{ color: 'var(--theme-accent)' }} />}
          {parent && <><span>{parent}</span><span className="odoo-breadcrumb-separator">/</span></>}
          <span className="odoo-breadcrumb-current">{title}</span>
        </div>
        <div style={{ flex: 1 }} />
        {actions}
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  );
}
