import type { LucideIcon } from 'lucide-react';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, subMonths, startOfMonth, startOfYear } from 'date-fns';

/**
 * Briques communes des écrans « processus » (Bons de commande, Factures reçues) :
 * pipeline d'étapes cliquable, barre d'avancement d'une ligne, bascule
 * En cours / Historique, filtre de période et pagination serveur.
 */

export type StageDef = { key: string; label: string; hint: string; icon: LucideIcon };
/** `late` : badge rouge sous la carte ; `alertLabel` remplace « en retard » quand le badge signale autre chose. */
export type StageStat = { count: number; sub: string; late?: number; alertLabel?: string };

export const PAGE_SIZE = 25;

/* ── Période ── */
export type PeriodKey = '3m' | 'month' | 'lastMonth' | 'year' | '12m' | 'all' | 'custom';
export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'all', label: 'Toutes les dates' },
  { key: 'month', label: 'Ce mois-ci' },
  { key: 'lastMonth', label: 'Mois dernier' },
  { key: '3m', label: '3 derniers mois' },
  { key: '12m', label: '12 derniers mois' },
  { key: 'year', label: 'Cette année' },
  { key: 'custom', label: 'Période personnalisée…' },
];
export function periodStart(p: PeriodKey): string | null {
  const now = new Date();
  const d = p === '3m' ? subMonths(now, 3)
    : p === 'month' ? startOfMonth(now)
    : p === 'year' ? startOfYear(now)
    : p === '12m' ? subMonths(now, 12)
    : null;
  return d ? format(d, 'yyyy-MM-dd') : null;
}
/** Paramètres dateFrom/dateTo à envoyer au serveur pour une période. */
export function periodParams(p: PeriodKey, from: string, to: string): Record<string, string> {
  if (p === 'custom') {
    const r: Record<string, string> = {};
    if (from) r.dateFrom = from;
    if (to) r.dateTo = to;
    return r;
  }
  if (p === 'lastMonth') {
    const first = startOfMonth(subMonths(new Date(), 1));
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return { dateFrom: format(first, 'yyyy-MM-dd'), dateTo: format(last, 'yyyy-MM-dd') };
  }
  const start = periodStart(p);
  return start ? { dateFrom: start } : {};
}
export function periodLabel(p: PeriodKey, from: string, to: string): string {
  if (p !== 'custom') return PERIODS.find(x => x.key === p)?.label.toLowerCase() ?? '';
  const f = (d: string) => format(new Date(`${d}T00:00:00`), 'dd/MM/yyyy');
  if (from && to) return `du ${f(from)} au ${f(to)}`;
  if (from) return `depuis le ${f(from)}`;
  if (to) return `jusqu'au ${f(to)}`;
  return 'toutes les dates';
}

const filterLabelStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' } as const;
const activeSelect = { color: 'var(--odoo-purple)', fontWeight: 600 } as const;

export function PeriodFilter({ label, title, period, onPeriod, from, onFrom, to, onTo }: {
  label: string; title?: string;
  period: PeriodKey; onPeriod: (p: PeriodKey) => void;
  from: string; onFrom: (v: string) => void;
  to: string; onTo: (v: string) => void;
}) {
  return (
    <>
      <label style={filterLabelStyle} title={title}>
        <CalendarRange size={13} /> {label}
        <select value={period} onChange={e => onPeriod(e.target.value as PeriodKey)} className="odoo-filter-dropdown"
          style={period !== 'all' ? activeSelect : undefined}>
          {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      {period === 'custom' && (
        <span style={filterLabelStyle}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            du
            <input type="date" value={from} max={to || undefined} onChange={e => onFrom(e.target.value)} className="odoo-filter-dropdown" />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            au
            <input type="date" value={to} min={from || undefined} onChange={e => onTo(e.target.value)} className="odoo-filter-dropdown" />
          </label>
        </span>
      )}
    </>
  );
}

export function SelectFilter({ label, icon: Icon, value, onChange, options, allLabel = 'Tous' }: {
  label: string; icon: LucideIcon; value: string; onChange: (v: string) => void;
  options: Array<{ key: string; label: string }>; allLabel?: string;
}) {
  return (
    <label style={filterLabelStyle}>
      <Icon size={13} /> {label}
      <select value={value} onChange={e => onChange(e.target.value)} className="odoo-filter-dropdown"
        style={value ? activeSelect : undefined}>
        <option value="">{allLabel}</option>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

/* ── Pipeline ── */
export function StagePipeline({ title, summary, stages, stats, isActive, onPick }: {
  title: string; summary: string; stages: StageDef[];
  stats: Record<string, StageStat | undefined>;
  isActive: (key: string) => boolean;
  onPick: (key: string) => void;
}) {
  const last = stages[stages.length - 1]?.key;
  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '10px 16px 0' }}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--odoo-text-muted)' }}>
          {title}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{summary}</span>
      </div>
      <div className="odoo-stat-grid" style={{ borderBottom: 'none' }}>
        {stages.map((s, idx) => {
          const st = stats[s.key] ?? { count: 0, sub: '' };
          const active = isActive(s.key);
          const Icon = s.icon;
          return (
            <button key={s.key} type="button" onClick={() => onPick(s.key)} aria-pressed={active}
              className={`odoo-stat-card ${active ? 'active' : ''}`}
              style={s.key === last ? { opacity: active ? 1 : 0.8 } : undefined}>
              <div className="odoo-stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.625rem', fontWeight: 700,
                  background: active ? 'var(--odoo-purple)' : 'var(--odoo-border)', color: active ? '#fff' : 'var(--odoo-text)',
                }}>{idx + 1}</span>
                <Icon size={11} /> {s.label}
              </div>
              <div className="odoo-stat-card-value">{st.count}</div>
              <div className="odoo-stat-card-sub">{st.sub ? `${st.sub} · ` : ''}{s.hint}</div>
              {(st.late ?? 0) > 0 && (
                <span className="odoo-tag odoo-tag-red" style={{ marginTop: 6, display: 'inline-block' }}>
                  {st.late} {st.alertLabel ?? 'en retard'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Barre d'avancement d'une ligne : étapes franchies pleines, étape courante atténuée (rouge si en retard). */
export function StageProgress({ count, current, done, late }: { count: number; current: number; done?: boolean; late?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 3, marginBottom: 4 }} aria-hidden="true">
      {Array.from({ length: count }, (_, k) => (
        <span key={k} style={{
          height: 5, flex: '1 1 0', maxWidth: 30, borderRadius: 3,
          background: k < current || done ? 'var(--odoo-purple)'
            : k === current ? (late ? '#dc3545' : 'color-mix(in srgb, var(--odoo-purple) 40%, transparent)')
            : 'var(--odoo-border)',
        }} />
      ))}
    </div>
  );
}

export function ViewSwitch({ view, onChange, openLabel, historyLabel, ariaLabel = 'Vue' }: {
  view: 'open' | 'history'; onChange: (v: 'open' | 'history') => void; openLabel: string; historyLabel: string; ariaLabel?: string;
}) {
  return (
    <div className="odoo-view-switcher" role="tablist" aria-label={ariaLabel}>
      {([['open', openLabel], ['history', historyLabel]] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => onChange(key)}
          style={{
            padding: '0.3rem 0.75rem', fontSize: '0.8125rem',
            background: view === key ? 'var(--odoo-purple-light)' : 'transparent',
            color: view === key ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
            fontWeight: view === key ? 600 : 400,
          }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, total, onPage, note }: { page: number; total: number; onPage: (p: number) => void; note: string }) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
      <span>{note}</span>
      <span className="odoo-pager">
        {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {total}
        <button type="button" className="odoo-pager-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Page précédente">
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="odoo-pager-btn" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Page suivante">
          <ChevronRight size={14} />
        </button>
      </span>
    </div>
  );
}
