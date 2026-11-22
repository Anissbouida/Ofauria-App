import { Fragment, createContext, useContext, useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Calendar, ChevronLeft, ChevronRight, Loader2, Lock, Search, SearchX, X, type LucideIcon } from 'lucide-react';
import ModalBackdrop from '../ui/ModalBackdrop';
import { useConfirm } from '../ui/ConfirmDialog';
import '../../styles/design-system.css';

/**
 * Design System Kalum — bibliothèque de composants communs à tous les modules
 * (maquettes validées 2026-11-22, documentation : docs/DESIGN_SYSTEM.md).
 *
 * Gabarit d'une page de gestion, toujours dans cet ordre :
 *   Breadcrumb (+ actions à droite) → PageHeader → KpiGrid → étapes (FilterChips / StagePipeline)
 *   → Toolbar → DataPanel (tableau + TableFooter) → messages.
 * Les styles vivent dans styles/design-system.css (jetons --ds-*).
 */

/* ── Niveau 1 : fil d'Ariane ── */
export type Crumb = { label: ReactNode; onClick?: () => void };

/** Fil d'Ariane « Module › Rubrique › Page » ; le dernier élément est la page courante. */
export function Breadcrumb({ items, icon: Icon }: { items: Crumb[]; icon?: LucideIcon }) {
  return (
    <nav className="odoo-breadcrumb" aria-label="Fil d'Ariane">
      {Icon && <Icon size={14} style={{ color: 'var(--theme-accent)' }} aria-hidden="true" />}
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span className="odoo-breadcrumb-separator" aria-hidden="true">›</span>}
            {last ? <span className="odoo-breadcrumb-current" aria-current="page">{c.label}</span>
              : c.onClick ? <button type="button" className="ds-crumb-link" onClick={c.onClick}>{c.label}</button>
              : <span>{c.label}</span>}
          </Fragment>
        );
      })}
    </nav>
  );
}

/* ── Niveau 2 : titre de page ── */
/** Titre de page et description d'une ligne ; `aside` = étiquette de statut d'une fiche. */
export function PageHeader({ title, description, aside }: { title: ReactNode; description?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="kl-largetitle">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h1>{title}</h1>{aside}</div>
      {description && <p>{description}</p>}
    </header>
  );
}

/* ── Niveau 3 : section ── */
/** En-tête de section : titre, note à droite, actions. */
export function SectionHeader({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ds-section-head">
      <h2>{title}</h2>
      <span className="ds-grow" />
      {note && <small>{note}</small>}
      {children}
    </div>
  );
}

/* ── Indicateurs ── */
export function KpiGrid({ children, label = 'Indicateurs' }: { children: ReactNode; label?: string }) {
  return <section className="ds-kpis" aria-label={label}>{children}</section>;
}

/**
 * Tuile d'indicateur. La valeur reste dans la couleur du texte ; `tone` colore la ligne
 * de commentaire (orange = attention, rouge = retard ou blocage, vert = conforme).
 * `onClick` en fait un filtre cliquable (`active` = filtre en cours).
 */
export function KpiCard({ label, value, sub, tone, aside, onClick, active, children }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'green' | 'orange'; aside?: ReactNode;
  onClick?: () => void; active?: boolean;
  /** Complément sous la tuile (barre de progression, mini-graphique). */
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="ds-kpi-label"><span>{label}</span>{aside && <span>{aside}</span>}</span>
      <span className="ds-kpi-value">{value}</span>
      {sub && <span className={`ds-kpi-sub${tone ? ` ${tone}` : ''}`}>{sub}</span>}
      {children}
    </>
  );
  return onClick
    ? <button type="button" className={`ds-kpi${active ? ' active' : ''}`} aria-pressed={!!active} onClick={onClick}>{body}</button>
    : <div className="ds-kpi">{body}</div>;
}

/* ── Barre d'outils ── */
/** Barre d'outils : recherche à gauche, filtres ensuite, bascules (segments) à droite. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="prj-toolbar">{children}</div>;
}

export function SearchBar({ value, onChange, placeholder, label, busy }: {
  value: string; onChange: (v: string) => void; placeholder: string; label?: string; busy?: boolean;
}) {
  return (
    <label className="prj-search">
      <Search size={15} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
      <input type="search" aria-label={label ?? placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      {busy && <Loader2 className="animate-spin" size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
    </label>
  );
}

/** Bascule segmentée (période, affichage, densité). */
export function Segmented<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; label: string;
  options: Array<{ key: K; label: ReactNode; icon?: LucideIcon; count?: number }>;
}) {
  return (
    <div className="prj-views" role="group" aria-label={label}>
      {options.map(o => {
        const Icon = o.icon;
        return (
          <button key={o.key} type="button" className={value === o.key ? 'active' : ''} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
            {Icon && <Icon size={14} aria-hidden="true" />} {o.label}{o.count !== undefined && <small>{o.count}</small>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Onglets ── */
export function Tabs<K extends string>({ value, onChange, tabs, label }: {
  value: K; onChange: (k: K) => void; label: string;
  tabs: Array<{ key: K; label: ReactNode; count?: number }>;
}) {
  return (
    <div className="ds-tabs" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <small>{t.count}</small>}
        </button>
      ))}
    </div>
  );
}

/* ── Tableau standard ── */
/**
 * Panneau du tableau standard : carte blanche, défilement horizontal, barre d'actions
 * groupées au-dessus (`bulk`), pied (`footer`). Le tableau lui-même est une
 * `<table className="odoo-table">` ; ajouter `ds-dense` pour la variante dense (36 px).
 * Conventions de colonnes : `ds-num` (nombres et montants, à droite, unité dans l'en-tête),
 * `ds-ref` (numéros de pièce), `ds-strong` (donnée principale), `ds-actions` (dernière colonne).
 */
export function DataPanel({ children, bulk, footer, label, className, style }: {
  children: ReactNode; bulk?: ReactNode; footer?: ReactNode; label?: string; className?: string; style?: CSSProperties;
}) {
  return (
    <section className={`ds-panel${className ? ` ${className}` : ''}`} style={style} aria-label={label}>
      {bulk}
      <div className="ds-scroll">{children}</div>
      {footer}
    </section>
  );
}

/** Barre d'actions groupées, visible quand des lignes sont sélectionnées. */
export function BulkBar({ count, noun, masculine, detail, children, onClear }: {
  count: number; noun: string; /** Accord au masculin (« 2 articles sélectionnés »). */ masculine?: boolean;
  detail?: ReactNode; children: ReactNode; onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="ds-bulk" role="status">
      <strong>{count} {noun}{count > 1 ? 's' : ''} sélectionné{masculine ? '' : 'e'}{count > 1 ? 's' : ''}</strong>
      {detail && <span>· {detail}</span>}
      <span className="ds-grow" />
      {children}
      <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={onClear}>Annuler la sélection</button>
    </div>
  );
}

/** Pied de tableau : note (compteur, total) à gauche, pagination à droite. */
export function TableFooter({ note, page, pageSize, total, onPage, children }: {
  note?: ReactNode; page?: number; pageSize?: number; total?: number; onPage?: (p: number) => void; children?: ReactNode;
}) {
  const paged = page !== undefined && pageSize !== undefined && total !== undefined && !!onPage;
  const pageCount = paged ? Math.max(1, Math.ceil(total! / pageSize!)) : 1;
  return (
    <div className="ds-foot">
      {paged && <span>{total === 0 ? 0 : (page! - 1) * pageSize! + 1} à {Math.min(page! * pageSize!, total!)} sur {total}</span>}
      {note && <span>{paged ? '· ' : ''}{note}</span>}
      <span className="ds-grow" />
      {children}
      {paged && (
        <span className="ds-pager">
          <button type="button" onClick={() => onPage!(page! - 1)} disabled={page! <= 1} aria-label="Page précédente"><ChevronLeft size={16} /></button>
          <span>Page {page} sur {pageCount}</span>
          <button type="button" onClick={() => onPage!(page! + 1)} disabled={page! >= pageCount} aria-label="Page suivante"><ChevronRight size={16} /></button>
        </span>
      )}
    </div>
  );
}

/* ── États d'une liste ── */
/** État vide : ce que la liste contiendra, et l'action pour la remplir. */
export function EmptyState({ icon: Icon, title, text, action, bare }: { icon: LucideIcon; title: ReactNode; text?: ReactNode; action?: ReactNode; bare?: boolean }) {
  return (
    <div className={`ds-state${bare ? ' bare' : ''}`}>
      <Icon size={28} aria-hidden="true" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action && <div className="ds-state-action">{action}</div>}
    </div>
  );
}

/** Aucun résultat pour les filtres en cours, avec le bouton pour les effacer. */
export function NoResultState({ onReset, text = 'Aucune pièce ne correspond aux filtres.', bare }: { onReset?: () => void; text?: ReactNode; bare?: boolean }) {
  return (
    <EmptyState icon={SearchX} title="Aucun résultat" text={text} bare={bare}
      action={onReset && <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={onReset}>Effacer les filtres</button>} />
  );
}

export function LoadingState({ label = 'Chargement…', bare }: { label?: string; bare?: boolean }) {
  return (
    <div className={`ds-state${bare ? ' bare' : ''}`} role="status" aria-live="polite">
      <Loader2 size={22} className="animate-spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/** Code HTTP d'une erreur axios (ou undefined). */
export function httpStatus(err: unknown): number | undefined {
  const s = (err as { response?: { status?: number } } | null)?.response?.status;
  return typeof s === 'number' ? s : undefined;
}

/**
 * Erreur de chargement. Avec `error`, un refus d'accès (401/403) s'affiche comme tel
 * (« Accès refusé », sans bouton Réessayer) au lieu d'un faux problème de connexion.
 */
export function ErrorState({ title, text, onRetry, bare, error }: {
  title?: ReactNode; text?: ReactNode; onRetry?: () => void; bare?: boolean; error?: unknown;
}) {
  const status = httpStatus(error);
  if (status === 401 || status === 403) {
    return (
      <div className={`ds-state${bare ? ' bare' : ''}`} role="status">
        <Lock size={28} aria-hidden="true" />
        <strong>{title ?? 'Accès refusé'}</strong>
        <p>{status === 401 ? 'Votre session a expiré : reconnectez-vous.' : 'Votre rôle ne permet pas d\'afficher ces informations. Demandez l\'accès à un administrateur.'}</p>
      </div>
    );
  }
  title = title ?? 'La liste n\'a pas pu être chargée';
  text = text ?? (status && status >= 500 ? 'Le serveur a rencontré une erreur. Réessayez dans un instant.' : 'Vérifiez la connexion, puis réessayez.');
  return (
    <div className={`ds-state error${bare ? ' bare' : ''}`} role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {onRetry && <div className="ds-state-action"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={onRetry}>Réessayer</button></div>}
    </div>
  );
}

/* ── Messages ── */
export function Alert({ tone, children, icon: Icon, action }: {
  tone: 'success' | 'warning' | 'danger' | 'info'; children: ReactNode; icon?: LucideIcon; /** Bouton à droite du message. */ action?: ReactNode;
}) {
  return (
    <div className={`ds-alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {Icon && <Icon size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />}
      <span style={{ flex: 1 }}>{children}</span>
      {action}
    </div>
  );
}

/* ── Formulaires ── */
/**
 * Champ de formulaire : libellé visible, astérisque si obligatoire, aide ou message
 * d'erreur sous le champ. L'enfant est le contrôle (`className="ds-input"`), relié par `htmlFor`.
 */
export function FormField({ label, htmlFor, required, hint, error, children }: {
  label: ReactNode; htmlFor?: string; required?: boolean; hint?: ReactNode; error?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={`ds-field${error ? ' error' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="ds-req" aria-hidden="true"> *</span>}</label>
      {children}
      {(error || hint) && <span className="ds-field-hint" role={error ? 'alert' : undefined}>{error || hint}</span>}
    </div>
  );
}

/** Section d'un formulaire (regroupement logique de champs). */
export function FormSection({ title, children, collapsible, defaultOpen = true }: {
  title: ReactNode; children: ReactNode;
  /** Section repliable (informations complémentaires d'une fiche longue). */
  collapsible?: boolean; defaultOpen?: boolean;
}) {
  if (collapsible) {
    return (
      <details className="ds-fieldset ds-collapsible" open={defaultOpen}>
        <summary>{title}</summary>
        <div className="ds-collapsible-body">{children}</div>
      </details>
    );
  }
  return <fieldset className="ds-fieldset"><legend>{title}</legend>{children}</fieldset>;
}

/** Pied de formulaire : note à gauche (modifications non enregistrées), Annuler puis Enregistrer à droite. */
export function FormFooter({ dirty, onCancel, submitLabel = 'Enregistrer', cancelLabel = 'Annuler', busy, disabled, onSubmit, children, danger }: {
  dirty?: boolean; onCancel: () => void; submitLabel?: string; cancelLabel?: string; busy?: boolean; disabled?: boolean; onSubmit?: () => void;
  /** Action destructrice (annuler une pièce, extourner) : bouton principal en style danger. */
  danger?: boolean;
  /** Note ou action complémentaire, à gauche du pied. */
  children?: ReactNode;
}) {
  return (
    <div className="ds-form-foot">
      {children}
      <span className="ds-grow">{dirty ? 'Modifications non enregistrées' : ''}</span>
      <button type="button" className="odoo-btn-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
      <button type={onSubmit ? 'button' : 'submit'} className={danger ? 'ds-btn-danger solid' : 'odoo-btn-primary'} onClick={onSubmit} disabled={busy || disabled} aria-busy={busy || undefined}>
        {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} {submitLabel}
      </button>
    </div>
  );
}


/* ── Actions d'en-tête de page ── */
/**
 * Emplacement des actions de l'écran actif à droite du fil d'Ariane (exports en secondaire puis
 * une seule action principale). La barre du module fournit l'élément via `HeaderSlotContext` ;
 * hors barre, les boutons restent là où l'écran les écrit.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}

/* ── Fenêtre et tiroir ── */
type SheetProps = {
  title: ReactNode;
  /** Icône devant le titre. */
  icon?: LucideIcon;
  /** Ligne sous le titre (numéro de pièce, contexte). */
  subtitle?: ReactNode;
  /** Étiquette de statut ou actions à droite du titre. */
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pied collé en bas (FormFooter ou boutons). */
  footer?: ReactNode;
  /** Largeur maximale en px. */
  width?: number;
  /** Empêche la fermeture par Échap et clic extérieur (envoi en cours, saisie non enregistrée). */
  locked?: boolean;
  label?: string;
};

/**
 * Fermeture protégée d'une fenêtre ou d'un tiroir : dès qu'un champ a été modifié à l'intérieur,
 * Échap, le clic extérieur et la croix demandent confirmation avant de perdre la saisie.
 * Les boutons de l'écran (Annuler, Enregistrer) appellent onClose directement.
 */
function useGuardedClose(onClose: () => void, locked?: boolean) {
  const dirty = useRef(false);
  const confirm = useConfirm();
  const request = async () => {
    if (locked) return;
    if (dirty.current && !(await confirm('Les informations saisies dans cette fenêtre seront perdues.', {
      title: 'Fermer sans enregistrer ?', confirmLabel: 'Fermer sans enregistrer', cancelLabel: 'Continuer la saisie', danger: true,
    }))) return;
    onClose();
  };
  const markDirty = () => { dirty.current = true; };
  return { request, markDirty };
}

/** Pile des fenêtres ouvertes : Échap ne ferme que celle du dessus. */
const sheetStack: symbol[] = [];

function useEscape(onClose: () => void, locked?: boolean) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const me = Symbol('sheet');
    sheetStack.push(me);
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || locked) return;
      // Une boîte de confirmation ouverte au-dessus garde la main.
      if (document.querySelector('[role="alertdialog"]')) return;
      if (sheetStack[sheetStack.length - 1] !== me) return;
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      const i = sheetStack.indexOf(me);
      if (i >= 0) sheetStack.splice(i, 1);
    };
  }, [locked]);
}

function SheetHead({ title, subtitle, aside, onClose, id, locked, icon: Icon }: Pick<SheetProps, 'title' | 'subtitle' | 'aside' | 'onClose' | 'locked' | 'icon'> & { id: string }) {
  return (
    <header className="ds-sheet-head">
      {Icon && <Icon size={18} aria-hidden="true" style={{ color: 'var(--ds-accent)', marginTop: 3, flex: 'none' }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <h2 id={id} className="ds-sheet-title">{title}</h2>
        {subtitle && <p className="ds-sheet-sub">{subtitle}</p>}
      </div>
      {aside}
      <button type="button" className="ds-icon-btn" onClick={onClose} disabled={locked} aria-label="Fermer"><X size={18} /></button>
    </header>
  );
}

/** Fenêtre modale commune : en-tête (titre, sous-titre, fermer), corps qui défile, pied collé. */
export function Modal({ icon, title, subtitle, aside, onClose, children, footer, width = 640, locked, label }: SheetProps) {
  const id = useId();
  const guard = useGuardedClose(onClose, locked);
  useEscape(guard.request, locked);
  return (
    <ModalBackdrop onClose={() => void guard.request()} className="fixed inset-0 z-[70] flex items-center justify-center p-4 ds-scrim">
      <div className="kl-ds ds-sheet ds-modal" role="dialog" aria-modal="true" aria-labelledby={id} aria-label={label} style={{ width: `min(${width}px, 100%)` }}
        onInput={guard.markDirty} onChange={guard.markDirty}>
        <SheetHead icon={icon} title={title} subtitle={subtitle} aside={aside} onClose={() => void guard.request()} id={id} locked={locked} />
        <div className="ds-sheet-body">{children}</div>
        {footer && <div className="ds-sheet-foot">{footer}</div>}
      </div>
    </ModalBackdrop>
  );
}

/** Tiroir latéral commun (fiche consultée sans quitter la liste). */
export function Drawer({ icon, title, subtitle, aside, onClose, children, footer, width = 720, locked, label }: SheetProps) {
  const id = useId();
  const guard = useGuardedClose(onClose, locked);
  useEscape(guard.request, locked);
  return (
    <ModalBackdrop onClose={() => void guard.request()} className="fixed inset-0 z-[70] flex justify-end ds-scrim">
      <div className="kl-ds ds-sheet ds-drawer" role="dialog" aria-modal="true" aria-labelledby={id} aria-label={label} style={{ width: `min(${width}px, 100%)` }}
        onInput={guard.markDirty} onChange={guard.markDirty}>
        <SheetHead icon={icon} title={title} subtitle={subtitle} aside={aside} onClose={() => void guard.request()} id={id} locked={locked} />
        <div className="ds-sheet-body">{children}</div>
        {footer && <div className="ds-sheet-foot">{footer}</div>}
      </div>
    </ModalBackdrop>
  );
}

/* ── Champs de période ── */
/** Période à dates libres « du … au … » (barres d'outils des états et rapports). */
export function DateRangeField({ from, to, onFrom, onTo, label = 'Période' }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; label?: string;
}) {
  return (
    <span role="group" aria-label={label} className="ds-period">
      <Calendar size={14} aria-hidden="true" /> {label}
      <input type="date" aria-label={`${label} : début`} value={from} max={to || undefined} onChange={e => onFrom(e.target.value)} className="ds-input sm" style={{ width: 150 }} />
      <span aria-hidden="true">→</span>
      <input type="date" aria-label={`${label} : fin`} value={to} min={from || undefined} onChange={e => onTo(e.target.value)} className="ds-input sm" style={{ width: 150 }} />
    </span>
  );
}

const DS_MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** Période « mois + année ». */
export function MonthYearField({ month, year, onMonth, onYear, label = 'Mois' }: {
  month: number; year: number; onMonth: (m: number) => void; onYear: (y: number) => void; label?: string;
}) {
  return (
    <span role="group" aria-label="Période" className="ds-period">
      <Calendar size={14} aria-hidden="true" /> {label}
      <select value={month} onChange={e => onMonth(parseInt(e.target.value, 10))} className="ds-input sm" style={{ width: 'auto' }} aria-label="Mois">
        {DS_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <input type="number" value={year} onChange={e => onYear(+e.target.value)} className="ds-input sm" style={{ width: 90 }} aria-label="Année" />
    </span>
  );
}
