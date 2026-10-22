import type { ReactNode } from 'react';
import './settings.css';

/** Ancre stable d'un réglage, partagée par les blocs et l'index de recherche ⌘K. */
export function settingAnchor(title: string) {
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `set-${slug}`;
}

// Interrupteur facon Odoo, sans label (le label vit dans SettingItem).
export function OdooToggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`odoo-toggle${checked ? ' on' : ''}`}>
      <span className="odoo-toggle-knob" />
    </button>
  );
}

// Bloc de reglages : en-tete + grille de reglages (2 colonnes par defaut).
export function SettingsSection({ title, description, columns = 2, children }: {
  title: string; description?: string; columns?: 1 | 2; children: ReactNode;
}) {
  return (
    <section id={settingAnchor(title)} className="odoo-setting-section">
      <div className="odoo-setting-section-head">
        <h3 className="odoo-setting-section-title">{title}</h3>
        {description && <p className="odoo-setting-section-help">{description}</p>}
      </div>
      <div className={`odoo-setting-grid${columns === 1 ? ' cols-1' : ''}`}>
        {children}
      </div>
    </section>
  );
}

// Reglage unique facon Odoo : interrupteur optionnel a gauche, puis
// libelle + aide + controle.
export function SettingItem({ title, description, toggle, children, fullWidth }: {
  title: string;
  description?: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  children?: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div id={settingAnchor(title)} className={`odoo-setting-block${fullWidth ? ' odoo-setting-wide' : ''}`}>
      {toggle && (
        <div className="odoo-setting-block-toggle">
          <OdooToggle checked={toggle.checked} onChange={toggle.onChange} disabled={toggle.disabled} />
        </div>
      )}
      <div className="odoo-setting-block-body">
        <div className="odoo-setting-label">{title}</div>
        {description && <p className="odoo-setting-help">{description}</p>}
        {children && <div className="odoo-setting-control">{children}</div>}
      </div>
    </div>
  );
}
