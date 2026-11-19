import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import './settings.css';

/** Ancre stable d'un réglage, partagée par les blocs et l'index de recherche ⌘K. */
export function settingAnchor(title: string) {
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `set-${slug}`;
}

/**
 * Note d'une ligne en tête de page ou de carte (sobriété façon Odoo) : la phrase
 * courte est visible, le détail passe dans le « ? » au survol.
 */
export function PageNote({ children, help }: { children: ReactNode; help?: string }) {
  return (
    <p className="odoo-page-note">
      {children}
      {help && <span className="odoo-params-q" tabIndex={0} title={help} aria-label={help}><HelpCircle size={13} /></span>}
    </p>
  );
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
    <section id={settingAnchor(title)} className="odoo-setting-section" data-toc={title}>
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
export function SettingItem({ title, description, toggle, children, fullWidth, changed, onRevert }: {
  title: string;
  description?: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  children?: ReactNode;
  fullWidth?: boolean;
  /** Valeur modifiée et non enregistrée (lot S4, voir useDraft().mark). */
  changed?: boolean;
  /** Remet la valeur enregistrée de ce seul réglage. */
  onRevert?: () => void;
}) {
  return (
    <div id={settingAnchor(title)} className={`odoo-setting-block${fullWidth ? ' odoo-setting-wide' : ''}${changed ? ' changed' : ''}`}>
      {toggle && (
        <div className="odoo-setting-block-toggle">
          <OdooToggle checked={toggle.checked} onChange={toggle.onChange} disabled={toggle.disabled} />
        </div>
      )}
      <div className="odoo-setting-block-body">
        <div className="odoo-setting-label">
          {title}
          {changed && <span className="odoo-setting-changed">Modifié</span>}
          {changed && onRevert && (
            <button type="button" className="odoo-setting-revert" onClick={onRevert} title="Remettre la valeur enregistrée">Rétablir</button>
          )}
        </div>
        {description && <p className="odoo-setting-help">{description}</p>}
        {children && <div className="odoo-setting-control">{children}</div>}
      </div>
    </div>
  );
}

/** Événement envoyé par la recherche ⌘K sur un réglage caché dans un onglet inactif. */
export const SETTINGS_REVEAL_EVENT = 'settings-reveal';

export interface SettingsTabDef {
  key: string;
  label: string;
  /** Pastille après le libellé (ex. nombre de changements non enregistrés). */
  badge?: ReactNode;
  content: ReactNode;
}

/**
 * Onglets d'une page de réglages (lot S3). Tous les onglets restent montés (cachés par
 * `hidden`) : les brouillons d'un onglet inactif restent dans la barre d'enregistrement,
 * et un réglage trouvé par la recherche ouvre son onglet (SETTINGS_REVEAL_EVENT).
 * Contrôlé par `value`/`onChange`, ou libre.
 */
export function SettingsTabs({ tabs, value, onChange, label }: {
  tabs: SettingsTabDef[];
  value?: string;
  onChange?: (key: string) => void;
  label: string;
}) {
  const [own, setOwn] = useState(tabs[0]?.key);
  const active = value ?? own;
  const select = (key: string) => { if (value === undefined) setOwn(key); onChange?.(key); };
  const ref = useRef<HTMLDivElement>(null);
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onReveal = (e: Event) => {
      const panel = (e.target as Element | null)?.closest<HTMLElement>('[data-settings-tab]');
      if (panel && panel.parentElement === el && panel.dataset.settingsTab) selectRef.current(panel.dataset.settingsTab);
    };
    el.addEventListener(SETTINGS_REVEAL_EVENT, onReveal);
    return () => el.removeEventListener(SETTINGS_REVEAL_EVENT, onReveal);
  }, []);

  return (
    <div className="odoo-settings-tabs">
      {/* 2 à 4 onglets : contrôle segmenté (design Ventes) ; au-delà, onglets soulignés. */}
      <div className={`odoo-settings-tablist${tabs.length <= 4 ? ' seg' : ''}`} role="tablist" aria-label={label}>
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={t.key === active}
            aria-controls={`tabpanel-${t.key}`} className={t.key === active ? 'active' : ''} onClick={() => select(t.key)}>
            {t.label}{t.badge}
          </button>
        ))}
      </div>
      <div ref={ref}>
        {tabs.map(t => (
          <div key={t.key} role="tabpanel" id={`tabpanel-${t.key}`} aria-labelledby={`tab-${t.key}`} data-settings-tab={t.key}
            hidden={t.key !== active} className="odoo-settings-tabpanel">
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
