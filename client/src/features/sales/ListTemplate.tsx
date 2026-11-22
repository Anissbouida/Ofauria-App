import type { ReactNode } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import '../projects/projects.css';
import './sales.css';
import { KpiCard, EmptyState } from '../../components/ds';

/**
 * Briques du gabarit Liste du module Ventes (maquette 2026-11-13), communes aux Commandes,
 * Devis, Bons de livraison, Factures et Créances : même barre d'outils, mêmes pastilles,
 * mêmes tuiles et même panneau, pour que chaque liste se lise de la même façon.
 * Le style vient de projects.css (prj-*) et sales.css (sal-*).
 */

/** Corps de page : à placer sous la barre de contrôle (fil d'Ariane + bouton principal). */
export function ListPage({ children }: { children: ReactNode }) {
  return <div className="prj sal-page">{children}</div>;
}

/** Barre d'outils : recherche à gauche, filtres complémentaires et bascule de vue à droite. */
export function ListToolbar({ search, onSearch, placeholder, children }: {
  search: string; onSearch: (v: string) => void; placeholder: string; children?: ReactNode;
}) {
  return (
    <div className="prj-toolbar">
      <label className="prj-search">
        <Search size={15} aria-hidden="true" style={{ color: 'var(--theme-text-muted)' }} />
        <input type="search" aria-label={placeholder} placeholder={placeholder} value={search} onChange={e => onSearch(e.target.value)} />
      </label>
      {children}
    </div>
  );
}

export interface FilterChip { key: string; label: string; count?: number; tone?: 'late'; icon?: LucideIcon }

/** Pastilles-filtres avec compteurs : remplacent les cartes de suivi et les onglets de statut. */
export function FilterChips({ chips, value, onChange, label = 'Filtrer' }: {
  chips: FilterChip[]; value: string; onChange: (key: string) => void; label?: string;
}) {
  return (
    <div className="prj-chips" role="group" aria-label={label}>
      {chips.map(c => {
        const active = value === c.key;
        const Icon = c.icon;
        return (
          <button key={c.key || 'all'} type="button" aria-pressed={active}
            className={`prj-chip${active ? ' active' : ''}${c.tone === 'late' ? ' sal-late' : ''}${c.count === 0 ? ' empty' : ''}`}
            onClick={() => onChange(c.key)}>
            {Icon && <Icon size={13} />} {c.label}{c.count !== undefined && <small>{c.count}</small>}
          </button>
        );
      })}
    </div>
  );
}

/** Tuile d'indicateur (réservée aux chiffres qui ne doublent pas les pastilles). */
export function ListKpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' | 'orange' }) {
  return <KpiCard label={label} value={value} sub={sub} tone={tone} />;
}

/** Panneau du tableau : bords arrondis, défilement horizontal, pied (compteur, total, pagination). */
export function ListPanel({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="prj-panel sal-panel">
      <div className="prj-scroll">{children}</div>
      {footer}
    </section>
  );
}

/** État vide d'une liste, avec un bouton pour effacer les filtres ou créer la première pièce. */
export function ListEmpty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return <EmptyState icon={Icon} title={title} text={text} action={action} />;
}

/** Bouton de l'étape suivante d'une ligne (Envoyer, Facturer, Relancer…). */
export function NextStep({ icon: Icon, label, onClick, disabled }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={disabled} onClick={e => { e.stopPropagation(); onClick(); }}>
      <Icon size={13} /> {label}
    </button>
  );
}
