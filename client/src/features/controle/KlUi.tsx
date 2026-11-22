import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PAGE_SIZE, type StageDef, type StageStat } from '../../components/purchasing/ProcessBoard';
import { DataPanel, LoadingState, SectionHeader, Segmented as DsSegmented, TableFooter, Tabs as DsTabs } from '../../components/ds';
import '../sales/ListTemplate';
import './kl-ui.css';

/**
 * Briques communes au design Ventes (2026-11-18) pour Contrôle & Qualité, Journée boutique,
 * HACCP, Traçabilité et Maintenance, en complément du gabarit Liste (features/sales/ListTemplate) :
 * pastilles-filtres à compteurs (même API que StagePipeline), contrôle segmenté, onglets,
 * panneau de tableau, intertitre de section, chargement.
 * Depuis le Design System (2026-11-22), ces briques délèguent aux composants communs
 * (components/ds) : seules les signatures historiques sont conservées ici.
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
              <Icon size={13} aria-hidden="true" /> {s.label} <small>{st.count.toLocaleString('fr-FR')}</small>
              {(st.late ?? 0) > 0 && <span className="klc-chip-alert">{st.late} {st.alertLabel ?? 'en retard'}</span>}
            </button>
          );
        })}
      </div>
      {summary && <span className="klc-summary">{summary}</span>}
    </div>
  );
}

/** Contrôle segmenté (2 à 4 vues) : délègue à la bascule commune. */
export function Segmented<K extends string>({ value, onChange, options, label }: {
  value: K; onChange: (k: K) => void; options: ReadonlyArray<readonly [K, string]>; label: string;
}) {
  return <DsSegmented label={label} value={value} onChange={onChange} options={options.map(([key, l]) => ({ key, label: l }))} />;
}

/** Onglets internes (plus de 4 vues) : délègue aux onglets communs, sans capitales. */
export function Tabs<K extends string>({ value, onChange, options, label, extra }: {
  value: K; onChange: (k: K) => void; options: ReadonlyArray<readonly [K, string]>; label: string; extra?: ReactNode;
}) {
  const tabs = <DsTabs label={label} value={value} onChange={onChange} tabs={options.map(([key, l]) => ({ key, label: l }))} />;
  if (!extra) return tabs;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>{tabs}</div>
      <div>{extra}</div>
    </div>
  );
}

/** Tableau en carte : délègue au panneau commun (défilement horizontal, intitulé et pied optionnels). */
export function Panel({ children, footer, title, hint, actions, style }: {
  children: ReactNode; footer?: ReactNode; title?: ReactNode; hint?: ReactNode; actions?: ReactNode; style?: React.CSSProperties;
}) {
  const head = title ? (
    <div className="prj-panel-head">
      {title}{hint && <small>{hint}</small>}
      {actions && <span className="klc-section-actions">{actions}</span>}
    </div>
  ) : undefined;
  const panel = <DataPanel bulk={head} footer={footer}>{children}</DataPanel>;
  return style ? <div style={style}>{panel}</div> : panel;
}

/** Pied d'un panneau : compteur + pagination (pied de tableau commun). */
export function PagerFoot({ page, total, onPage, note }: { page: number; total: number; onPage: (p: number) => void; note: string }) {
  return <TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={onPage} note={note} />;
}

/** Intertitre d'une section de page (h2), avec un complément discret et des actions à droite. */
export function SectionTitle({ icon: Icon, children, hint, actions }: { icon?: LucideIcon; children: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  const title = Icon
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon size={16} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} />{children}</span>
    : children;
  return <SectionHeader title={title} note={hint}>{actions}</SectionHeader>;
}

export function PageLoading() {
  return <LoadingState bare />;
}
