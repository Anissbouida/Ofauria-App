import type { ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Pager, type StageDef, type StageStat } from '../../components/purchasing/ProcessBoard';
import '../sales/ListTemplate';
import './kl-ui.css';

/**
 * Briques communes au design Ventes (2026-11-18) pour Contrôle & Qualité, Journée boutique,
 * HACCP, Traçabilité et Maintenance, en complément du gabarit Liste (features/sales/ListTemplate) :
 * pastilles-filtres à compteurs (même API que StagePipeline), contrôle segmenté, onglets,
 * panneau de tableau, intertitre de section, chargement.
 */

/** Pastilles-filtres avec compteurs + résumé à droite : même API que StagePipeline. */
export function StageChips({ title, summary, stages, stats, isActive, onPick }: {
  title: string; summary?: ReactNode; stages: StageDef[];
  stats: Record<string, StageStat | undefined>;
  isActive: (key: string) => boolean;
  onPick: (key: string) => void;
}) {
  return (
    <div className="klc-chips-row">
      <div className="prj-chips" role="group" aria-label={title}>
        {stages.map(s => {
          const st = stats[s.key] ?? { count: 0, sub: '' };
          const active = isActive(s.key);
          const Icon = s.icon;
          return (
            <button key={s.key} type="button" onClick={() => onPick(s.key)} aria-pressed={active}
              title={[st.sub, s.hint].filter(Boolean).join(' · ')}
              className={`prj-chip${active ? ' active' : ''}${st.count ? '' : ' empty'}`}>
              <Icon size={13} /> {s.label} <small>{st.count.toLocaleString('fr-FR')}</small>
              {(st.late ?? 0) > 0 && <span className="klc-chip-alert">{st.late} {st.alertLabel ?? 'en retard'}</span>}
            </button>
          );
        })}
      </div>
      {summary && <span className="klc-summary">{summary}</span>}
    </div>
  );
}

/** Contrôle segmenté (2 à 4 vues) : même grammaire que LayoutSwitch des Achats. */
export function Segmented<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; options: ReadonlyArray<readonly [K, string]>; label: string;
}) {
  return (
    <div className="prj-views" role="tablist" aria-label={label} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/** Onglets internes (plus de 4 vues) : odoo-tabs, sans capitales. */
export function Tabs<K extends string>({ value, onChange, options, label, extra }: {
  value: K; onChange: (k: K) => void; options: ReadonlyArray<readonly [K, string]>; label: string; extra?: ReactNode;
}) {
  return (
    <div className="odoo-tabs klc-tabs" role="tablist" aria-label={label} style={{ alignItems: 'center' }}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={`odoo-tab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{l}</button>
      ))}
      {extra && <div style={{ marginLeft: 'auto' }}>{extra}</div>}
    </div>
  );
}

/** Tableau en carte (prj-panel) : défilement horizontal, intitulé et pied optionnels. */
export function Panel({ children, footer, title, hint, actions, style }: {
  children: ReactNode; footer?: ReactNode; title?: ReactNode; hint?: ReactNode; actions?: ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section className="prj-panel" style={{ overflow: 'hidden', ...style }}>
      {title && (
        <div className="prj-panel-head">
          {title}{hint && <small>{hint}</small>}
          {actions && <span className="klc-section-actions">{actions}</span>}
        </div>
      )}
      <div className="prj-scroll">{children}</div>
      {footer}
    </section>
  );
}

/** Pied d'un panneau : compteur + pagination. */
export function PagerFoot({ page, total, onPage, note }: { page: number; total: number; onPage: (p: number) => void; note: string }) {
  return <div className="klc-foot"><Pager page={page} total={total} onPage={onPage} note={note} /></div>;
}

/** Intertitre d'une section de page (h2), avec un complément discret et des actions à droite. */
export function SectionTitle({ icon: Icon, children, hint, actions }: { icon?: LucideIcon; children: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  const h = <h2 className="klc-section">{Icon && <Icon size={16} style={{ color: 'var(--theme-accent)' }} />}{children}{hint && <small>{hint}</small>}</h2>;
  if (!actions) return h;
  return <div className="klc-section-row">{h}<span className="klc-section-actions">{actions}</span></div>;
}

export function PageLoading() {
  return <div className="klc-loading"><Loader2 size={22} className="animate-spin" /></div>;
}
