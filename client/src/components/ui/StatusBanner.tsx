import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Bandeau de statut / d'action unifie (meme palette que les .odoo-tag) :
 *   info = bleu, warning = jaune, success = vert, danger = rouge,
 *   orange = action requise, neutral = informatif.
 * Titre + texte a gauche, boutons (odoo-btn-*) a droite.
 */
export function StatusBanner({
  tone, icon: Icon, title, actions, children,
}: {
  tone: 'info' | 'warning' | 'success' | 'danger' | 'orange' | 'neutral';
  icon: LucideIcon;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`status-banner ${tone}`}>
      <Icon size={16} className="status-banner-icon" />
      <div className="status-banner-body">
        <div className="status-banner-title">{title}</div>
        {children && <div className="status-banner-text">{children}</div>}
      </div>
      {actions && <div className="status-banner-actions">{actions}</div>}
    </div>
  );
}
