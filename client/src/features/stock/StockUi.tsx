import type { ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, type LucideIcon } from 'lucide-react';
import { Pager } from '../../components/purchasing/ProcessBoard';
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

/** Contrôle segmenté (2 à 4 vues) : même grammaire que LayoutSwitch des Achats. */
export function SubViews<K extends string>({ value, onChange, views, label }: {
  value: K; onChange: (k: K) => void; views: SubView<K>[]; label: string;
}) {
  return (
    <div className="prj-views" role="group" aria-label={label} style={{ alignSelf: 'flex-start' }}>
      {views.map(v => {
        const Icon = v.icon;
        return (
          <button key={v.key} type="button" className={value === v.key ? 'active' : ''} aria-pressed={value === v.key} onClick={() => onChange(v.key)}>
            {Icon && <Icon size={14} />} {v.label}
            {!!v.count && <span className="stk-count">{v.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Pied d'un ListPanel : compteur + pagination. */
export function PagerFoot({ page, total, onPage, note }: { page: number; total: number; onPage: (p: number) => void; note: string }) {
  return <div className="stk-foot"><Pager page={page} total={total} onPage={onPage} note={note} /></div>;
}

/** Intertitre d'une section de page (h2), avec un complément discret. */
export function SectionTitle({ icon: Icon, children, hint }: { icon?: LucideIcon; children: ReactNode; hint?: ReactNode }) {
  return <h2 className="stk-section-title">{Icon && <Icon size={16} style={{ color: 'var(--theme-accent)' }} />}{children}{hint && <small>{hint}</small>}</h2>;
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
      <div className="odoo-breadcrumb">
        <button type="button" className="sal-link" style={{ marginLeft: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={onBack}>
          <ArrowLeft size={14} /> {backLabel}
        </button>
        {trail.map(t => <span key={t} style={{ display: 'contents' }}><span className="odoo-breadcrumb-separator">›</span><span>{t}</span></span>)}
        <span className="odoo-breadcrumb-separator">›</span>
        <span className="odoo-breadcrumb-current">{current}</span>
      </div>
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );
}
