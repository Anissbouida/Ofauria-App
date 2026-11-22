import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Note d'une ligne en tête d'écran (règle de sobriété 2026-11, façon Odoo) : la phrase
 * courte est visible, le détail passe dans le « ? » au survol. Les bandeaux colorés
 * (StatusBanner) restent réservés aux états et alertes.
 */
export default function PageNote({ children, help }: { children: ReactNode; help?: string }) {
  return (
    <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-muted)' }}>
      {children}
      {help && (
        <span tabIndex={0} title={help} aria-label={help}
          style={{ display: 'inline-flex', marginLeft: 6, verticalAlign: -2, cursor: 'help', color: 'var(--ds-muted)' }}>
          <HelpCircle size={13} />
        </span>
      )}
    </p>
  );
}
