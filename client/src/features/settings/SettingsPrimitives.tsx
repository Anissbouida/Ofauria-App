import type { ReactNode } from 'react';

// Interrupteur facon Odoo, sans label (le label vit dans SettingItem).
export function OdooToggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-primary-600' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={checked ? { backgroundColor: 'var(--color-primary)' } : undefined}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  );
}

// Bloc de reglages titre (en-tete majuscule + bordure accent).
export function SettingsSection({ title, description, columns = 2, children }: {
  title: string; description?: string; columns?: 1 | 2; children: ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="border-b-2 border-primary-100 pb-1.5 mb-1">
        <h3 className="text-[13px] font-bold text-gray-700 uppercase tracking-wide">{title}</h3>
        {description && <p className="text-xs text-gray-400 mt-0.5 normal-case font-normal">{description}</p>}
      </div>
      <div className={columns === 2 ? 'grid sm:grid-cols-2 gap-x-10' : ''}>
        {children}
      </div>
    </section>
  );
}

// Ligne de reglage facon Odoo : controle a gauche, titre + description a droite,
// champ additionnel optionnel en dessous.
export function SettingItem({ title, description, toggle, children, fullWidth }: {
  title: string;
  description?: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  children?: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={`flex gap-3 py-3.5 border-b border-gray-100 last:border-0 ${fullWidth ? 'sm:col-span-2' : ''}`}>
      {toggle && (
        <div className="pt-0.5">
          <OdooToggle checked={toggle.checked} onChange={toggle.onChange} disabled={toggle.disabled} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-800">{title}</div>
        {description && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{description}</p>}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}
