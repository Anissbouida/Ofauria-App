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
export const sectionTitle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--theme-text-muted)', margin: '6px 0 2px' };
/** Encadre d'un bloc de contenu (equivalent des cartes grises arrondies). */
export const panel: CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 4, padding: 12, background: 'var(--odoo-bg)' };
/** Bouton compact (actions secondaires dans une section). */
export const smallBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.55rem', fontSize: '0.75rem' };

/** Titre de section en capitales, avec icone. */
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
 * Modale au format Achats : fond floute, panneau sans arrondi marque, barre
 * de titre « Icone Module / Document », corps defilant, pied colle en bas.
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Icon size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>{crumb}</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">{title}</span>
          </div>
          {tag && <span style={{ marginLeft: 8 }}>{tag}</span>}
          <div style={{ flex: 1 }} />
          {headerActions && <div style={{ display: 'inline-flex', gap: 4, marginRight: 8 }}>{headerActions}</div>}
          <button type="button" onClick={onClose} className="odoo-pager-btn" title="Fermer" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </div>
    </ModalBackdrop>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      {children}
    </div>
  );
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

/** Etat vide centre (meme rendu que les listes Achats). */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
      <Icon size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
      <div style={{ fontSize: '0.8125rem' }}>{children}</div>
    </div>
  );
}
