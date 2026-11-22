import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, type LucideIcon } from 'lucide-react';
import {
  EmptyState as DsEmptyState, LoadingState, Segmented as DsSegmented, FormField, Modal,
} from '../../components/ds';

/**
 * Briques du module Personnel. Depuis le Design System commun (2026-11-22, docs/DESIGN_SYSTEM.md)
 * elles délèguent aux composants de `components/ds` : mêmes signatures qu'avant, présentation
 * commune (états, bascule segmentée, champs). Restent propres au module : la fenêtre HrModal
 * et l'emplacement des actions d'en-tête.
 */

/** Libellé de champ posé à la main (hors `Field`) : même échelle que `ds-field > label`. */
export const fieldLabel: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ds-ink)', marginBottom: 6 };
/** Contrôle de saisie standard du Design System (40 px ; ajouter `sm` dans un tableau). */
export const inputCls = 'ds-input';
/** Intertitre de sous-section (niveau 4 du Design System, casse normale). */
export const sectionTitle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 };
/** Encadré d'un bloc de contenu dans une fiche ou une fenêtre (trait fin, sans ombre). */
export const panel: CSSProperties = { border: '1px solid var(--ds-sep)', borderRadius: 12, padding: 12, background: 'var(--ds-card)' };
/** Bouton compact (actions secondaires dans une section) : à combiner avec `ds-btn-sm`. */
export const smallBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, padding: '0 12px', fontSize: 13 };

/**
 * Emplacement des actions de l'écran actif, à droite du fil d'Ariane du module (gabarit de page :
 * exports en secondaire, puis une seule action principale). EmployeesPage fournit l'emplacement ;
 * hors du module (espace salarié seul), les boutons restent à leur place dans la page.
 */
export { HeaderSlotContext as HrHeaderSlot, HeaderActions as HrHeaderActions } from '../../components/ds';

/** Titre de sous-section, avec icône et actions à droite. */
export function SectionTitle({ icon: Icon, children, actions }: { icon?: LucideIcon; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ds-section-head">
      <h3 className="ds-subhead" style={sectionTitle}>{Icon && <Icon size={14} aria-hidden="true" />} {children}</h3>
      <span className="ds-grow" />
      {actions && <div style={{ display: 'inline-flex', gap: 6 }}>{actions}</div>}
    </div>
  );
}

/** Champ libellé + contrôle (FormField du Design System). */
export function Field({ label, children, hint, style, required, error }: {
  label: string; children: ReactNode; hint?: ReactNode; style?: CSSProperties; required?: boolean; error?: ReactNode;
}) {
  const field = <FormField label={label} hint={hint} required={required} error={error}>{children}</FormField>;
  return style ? <div style={style}>{field}</div> : field;
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
  // Délègue à la fenêtre commune (Design System) : en-tête, corps défilant, pied collé.
  return (
    <Modal icon={Icon} title={title} subtitle={crumb} width={width} onClose={onClose}
      label={typeof title === 'string' ? title : crumb}
      aside={(tag || headerActions) ? <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{tag}{headerActions}</div> : undefined}
      footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </Modal>
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
    <button type={type} onClick={onClick} disabled={disabled || pending} className={danger ? 'ds-btn-danger solid' : 'odoo-btn-primary'}
      aria-busy={pending || undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {pending && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
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
      <Field label={label} hint={hint} required={required}>
        <input className={inputCls} type={type} step={type === 'number' ? '0.25' : undefined} value={value} placeholder={placeholder} autoFocus
          onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok) onConfirm(value); }} />
      </Field>
    </HrModal>
  );
}

/** État vide sans cadre : à poser dans un panneau. */
export function EmptyState({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <DsEmptyState icon={icon} title={children} bare />;
}

/** État vide dans sa propre carte (liste vide). */
export function EmptyPanel({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <DsEmptyState icon={icon} title={children} />;
}

/** Chargement d'un écran ou d'une liste, dans une carte. */
export function LoadingPanel({ label = 'Chargement…' }: { label?: string }) {
  return <LoadingState label={label} />;
}

/** Bascule segmentée (2 à 4 vues) : celle du Design System. */
export function Segmented<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; label: string;
  options: Array<{ key: K; label: ReactNode; icon?: LucideIcon; count?: number; title?: string }>;
}) {
  return <DsSegmented value={value} onChange={onChange} options={options} label={label} />;
}
