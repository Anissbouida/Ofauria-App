import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react';
import { PAGE_SIZE } from '../../components/purchasing/ProcessBoard';
import { Breadcrumb, SectionHeader, Segmented, TableFooter } from '../../components/ds';
import '../sales/ListTemplate';
import './stock.css';

/**
 * Petites briques du module Stock au design Ventes (2026-11-18), en complément du gabarit
 * Liste (features/sales/ListTemplate) : rangée de pastilles + résumé, tri dans la barre
 * d'outils, contrôle segmenté des sous-vues, pied de tableau paginé, intertitre de section.
 */

/** Pastilles-filtres (FilterChips) avec un résumé court aligné à droite. */
export function ChipsRow({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="stk-chips-row">
      {children}
      {summary && <span className="stk-summary">{summary}</span>}
    </div>
  );
}

/** Tri d'une liste, posé dans la barre d'outils (liste courte : select natif). */
export function SortSelect<K extends string>({ value, onChange, options, dir, onDir, label = 'Trier' }: {
  value: K; onChange: (k: K) => void; options: { key: K; label: string }[];
  /** Sens du tri (optionnel) : bouton croissant / décroissant. */
  dir?: 'asc' | 'desc'; onDir?: () => void; label?: string;
}) {
  return (
    <label className="stk-sort">
      {label}
      <select value={value} onChange={e => onChange(e.target.value as K)} aria-label={label}>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {dir && onDir && (
        <button type="button" onClick={e => { e.preventDefault(); onDir(); }} title={dir === 'asc' ? 'Croissant' : 'Décroissant'} aria-label={dir === 'asc' ? 'Tri croissant' : 'Tri décroissant'}>
          {dir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </button>
      )}
    </label>
  );
}

export interface SubView<K extends string> { key: K; label: string; icon?: LucideIcon; count?: number }

/** Contrôle segmenté (2 à 4 vues) : délègue à `Segmented` du Design System. */
export function SubViews<K extends string>({ value, onChange, views, label }: {
  value: K; onChange: (k: K) => void; views: SubView<K>[]; label: string;
}) {
  return (
    <div style={{ display: 'flex', alignSelf: 'flex-start' }}>
      <Segmented label={label} value={value} onChange={onChange}
        options={views.map(v => ({ key: v.key, label: v.label, icon: v.icon, count: v.count || undefined }))} />
    </div>
  );
}

/** Pied d'un tableau : compteur + pagination (délègue à `TableFooter`). */
export function PagerFoot({ page, total, onPage, note }: { page: number; total: number; onPage: (p: number) => void; note: string }) {
  return <TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={onPage} note={note} />;
}

/** Intertitre d'une section de page (h2), avec un complément discret. */
export function SectionTitle({ icon: Icon, children, hint }: { icon?: LucideIcon; children: ReactNode; hint?: ReactNode }) {
  return (
    <SectionHeader note={hint}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{Icon && <Icon size={16} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} />}{children}</span>} />
  );
}

/**
 * Barre du haut d'une page pleine page du module (fiche, rapport hors coquille) : retour au
 * module dans le fil d'Ariane, segments intermédiaires, écran courant, actions à droite.
 */
export function FullPageBar({ backLabel, onBack, trail = [], current, actions }: {
  backLabel: string; onBack: () => void; trail?: string[]; current: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="odoo-control-bar">
      <Breadcrumb items={[{ label: backLabel, onClick: onBack }, ...trail.map(t => ({ label: t })), { label: current }]} />
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );
}

/**
 * Emplacement des actions de page, à droite du fil d'Ariane de la coquille du module
 * (Design System : une seule action principale en haut à droite, « Importer » / « Exporter »
 * en secondaire à sa gauche). StockPage fournit l'élément ; un écran y pose ses boutons
 * avec `HeaderActions`. Hors coquille, les boutons restent là où l'écran les écrit.
 */
export { HeaderSlotContext as StockHeaderSlot, HeaderActions as HeaderActions } from '../../components/ds';
