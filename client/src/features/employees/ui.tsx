import { useState, type CSSProperties, type ReactNode } from 'react';
import { X, Loader2, type LucideIcon } from 'lucide-react';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Briques visuelles du module Personnel, alignees sur le module Achats
 * (SuppliersTab, PurchaseOrdersTab) : modale « odoo » avec barre de titre en
 * fil d'ariane, champs et libelles, titres de section, pied de formulaire.
 */

export const fieldLabel: CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 };
export const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';
/** Intertitre de section (design Ventes 2026-11-18 : casse normale, sans capitales forcées). */
export const sectionTitle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', fontWeight: 600, color: 'var(--kl-ink, var(--theme-text))', margin: '6px 0 2px' };
/** Encadre d'un bloc de contenu (carte arrondie, trait fin). */
export const panel: CSSProperties = { border: '1px solid var(--theme-bg-separator, var(--odoo-border))', borderRadius: 12, padding: 12, background: 'var(--theme-bg-card)' };
/** Bouton compact (actions secondaires dans une section). */
export const smallBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.55rem', fontSize: '0.75rem' };

/** Titre de section, avec icone. */
export function SectionTitle({ icon: Icon, children, actions }: { icon?: LucideIcon; children: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={sectionTitle}>{Icon && <Icon size={12} />} {children}</div>
      {actions && <div style={{ display: 'inline-flex', gap: 4 }}>{actions}</div>}
    </div>
  );
}

/** Champ libelle + controle. */
export function Field({ label, children, hint, style }: { label: string; children: ReactNode; hint?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={style}>
      <label style={fieldLabel}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/**
 * Fenêtre du module au design Ventes (feuille .kl-sheet, 2026-11-18) : en-tête clair
 * (icône, rubrique, titre, étiquette), corps défilant sur fond de carte, pied en pilules.
 */
export function HrModal({
  icon: Icon, crumb, title, tag, width = 640, onClose, headerActions, footer, children,
}: {
  icon: LucideIcon;
  crumb: string;
  title: ReactNode;
  tag?: ReactNode;
  width?: number;
  onClose: () => void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(15,23,42,0.32)' }}>
      <div className="odoo-scope kl-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={typeof title === 'string' ? title : crumb}
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', minHeight: 0 }}>
        <header className="kl-sheet-head" style={{ padding: '16px 20px 14px' }}>
          <span className="kl-ic b" aria-hidden="true"><Icon size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--kl-muted)' }}>{crumb}</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.02em', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {title}{tag && <span style={{ fontSize: 13, fontWeight: 400, letterSpacing: 0 }}>{tag}</span>}
            </h2>
          </div>
          {headerActions && <div style={{ display: 'inline-flex', gap: 4 }}>{headerActions}</div>}
          <button type="button" onClick={onClose} className="kl-sheet-close" title="Fermer" aria-label="Fermer"><X size={16} /></button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--kl-card)' }}>
          {children}
        </div>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </div>
    </ModalBackdrop>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="kl-sheet-foot">{children}</div>;
}

/** Bouton principal avec indicateur d'envoi. */
export function SubmitButton({ pending, children, disabled, onClick, type = 'button', danger }: {
  pending?: boolean; children: ReactNode; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit'; danger?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || pending} className={danger ? 'odoo-btn-danger' : 'odoo-btn-primary'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {pending && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  );
}

/**
 * Saisie d'une valeur (motif, reference, nombre) dans une modale au format
 * Achats, a la place de window.prompt().
 */
export function PromptDialog({
  icon, crumb, title, label, initial = '', type = 'text', placeholder, required, confirmLabel = 'Valider', onCancel, onConfirm, hint,
}: {
  icon: LucideIcon; crumb: string; title: string; label: string; initial?: string; type?: 'text' | 'number';
  placeholder?: string; required?: boolean; confirmLabel?: string; hint?: ReactNode;
  onCancel: () => void; onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ok = !required || value.trim().length > 0;
  return (
    <HrModal icon={icon} crumb={crumb} title={title} width={440} onClose={onCancel}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onCancel}>Annuler</button>
        <SubmitButton disabled={!ok} onClick={() => onConfirm(value)}>{confirmLabel}</SubmitButton>
      </>}>
      <Field label={label} hint={hint}>
        <input className={inputCls} type={type} step={type === 'number' ? '0.25' : undefined} value={value} placeholder={placeholder} autoFocus
          onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok) onConfirm(value); }} />
      </Field>
    </HrModal>
  );
}

/** Etat vide centre (meme rendu que les listes Ventes, sans cadre : a poser dans un panneau). */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="sal-empty">
      <Icon size={28} style={{ opacity: 0.4 }} />
      <span>{children}</span>
    </div>
  );
}

/** Etat vide ou chargement dans sa propre carte (liste vide, ecran en chargement). */
export function EmptyPanel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="prj-panel sal-empty">
      <Icon size={28} style={{ opacity: 0.4 }} />
      <span>{children}</span>
    </section>
  );
}

/** Chargement d'un ecran ou d'une liste, dans une carte (gabarit Ventes). */
export function LoadingPanel({ label = 'Chargement…' }: { label?: string }) {
  return (
    <section className="prj-panel sal-empty">
      <Loader2 className="animate-spin" size={20} />
      <span>{label}</span>
    </section>
  );
}

/**
 * Controle segmente (2 a 4 vues), comme la bascule Colonnes/Liste/Kanban des Achats
 * (prj-views) : remplace les anciens odoo-view-switcher a fond violet.
 */
export function Segmented<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; label: string;
  options: Array<{ key: K; label: ReactNode; icon?: LucideIcon; count?: number; title?: string }>;
}) {
  return (
    <div className="prj-views" role="group" aria-label={label}>
      {options.map(o => {
        const Icon = o.icon;
        return (
          <button key={o.key} type="button" title={o.title} className={value === o.key ? 'active' : ''} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
            {Icon && <Icon size={14} />} {o.label}{o.count !== undefined && <small style={{ marginLeft: 4, opacity: 0.6 }}>{o.count}</small>}
          </button>
        );
      })}
    </div>
  );
}
