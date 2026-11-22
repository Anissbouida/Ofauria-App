import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, TriangleAlert, Info, ChevronRight, ArrowRight, RefreshCw, History } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { settingsApi, type SetupCheck } from '../../api/settings.api';
import { tableLabel } from './AuditLogTab';
import { StatusTag } from '../../components/ui/StatusTag';
import { ErrorState } from '../../components/ds';
import { GROUP_ICONS, LEGACY_PAGES, SETTINGS_GROUPS, SETTINGS_PAGES, USERS_GROUP, type SettingsPageDef, type SettingsPageKey } from './settingsPages';

/**
 * Accueil des paramètres (refonte lot B) : avancement global, liste de contrôle
 * par domaine (à la Odoo « Configuration » / Dynamics BC « Configuration
 * assistée ») et dernières modifications. Chaque point mène au réglage concerné.
 * Lot S2 : une tuile par groupe du menu (icône, état, points ouverts, pages du groupe).
 */

type Filter = 'all' | 'open' | 'done';

const STATUS: Record<SetupCheck['status'], { icon: typeof Info; color: string; label: string }> = {
  todo: { icon: CircleAlert, color: 'var(--ds-danger)', label: 'À faire' },
  warn: { icon: TriangleAlert, color: 'var(--ds-warning)', label: 'Recommandé' },
  info: { icon: Info, color: 'var(--ds-muted)', label: 'À vérifier' },
  ok: { icon: CheckCircle2, color: 'var(--ds-success)', label: 'Fait' },
};
const ORDER: Record<SetupCheck['status'], number> = { todo: 0, warn: 1, info: 2, ok: 3 };
const OPERATIONS: Record<string, string> = { INSERT: 'Création', UPDATE: 'Modification', DELETE: 'Suppression' };

const isDone = (c: SetupCheck) => c.status !== 'todo';
const groupOf = (page: string) =>
  page === 'users' ? USERS_GROUP : SETTINGS_PAGES.find(p => p.key === (LEGACY_PAGES[page] ?? page))?.group ?? SETTINGS_GROUPS[0];

function ProgressRing({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`Paramétrage terminé à ${value} %`}>
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--kl-fill, var(--odoo-border))" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--theme-accent, var(--odoo-purple))" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 42 42)"
        style={{ transition: 'stroke-dashoffset 0.4s' }} />
      <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--odoo-text)">{value} %</text>
    </svg>
  );
}

export default function SetupHome({ pages, onOpen, onOpenUsers }: {
  /** Pages visibles du menu (droits, modules actifs, vocabulaire). */
  pages: SettingsPageDef[];
  onOpen: (page: SettingsPageKey, anchor?: string) => void;
  onOpenUsers: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['settings', 'setup'], queryFn: settingsApi.setup, staleTime: 0,
  });
  const checks = useMemo(() => data?.checks ?? [], [data]);

  // Un point essentiel est acquis dès qu'il n'est plus « à faire » : une
  // recommandation restante (warn) ne bloque pas l'avancement.
  const required = checks.filter(c => c.required);
  const requiredDone = required.filter(isDone).length;
  const pct = required.length ? Math.round((requiredDone / required.length) * 100) : 100;
  const todo = checks.filter(c => c.status === 'todo').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  // Prochaine étape : le premier point requis à faire, sinon la première recommandation.
  const next = [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status] || Number(b.required) - Number(a.required))
    .find(c => c.status === 'todo' || c.status === 'warn');

  const open = (c: SetupCheck) => (c.page === 'users' ? onOpenUsers() : onOpen(c.page as SettingsPageKey, c.anchor));

  if (isLoading) return <p className="odoo-settings-subtitle">Analyse du paramétrage…</p>;
  if (isError) {
    return <ErrorState error={error} title="État du paramétrage indisponible" onRetry={() => void refetch()} />;
  }

  const visible = (c: SetupCheck) => filter === 'all' || (filter === 'done' ? c.status === 'ok' : c.status !== 'ok');
  const groups = SETTINGS_GROUPS.map(g => {
    const items = checks.filter(c => groupOf(c.page) === g).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const req = items.filter(c => c.required);
    return {
      name: g, icon: GROUP_ICONS[g], items, shown: items.filter(visible), links: pages.filter(p => p.group === g),
      reqDone: req.filter(isDone).length, reqTotal: req.length,
      todo: items.filter(c => c.status === 'todo').length, warn: items.filter(c => c.status === 'warn').length,
    };
  }).filter(g => g.items.length > 0 || g.links.length > 0);

  return (
    <div className="odoo-setup">
      {/* ── Avancement global ── */}
      <section className="odoo-setup-hero">
        <ProgressRing value={pct} />
        <div className="odoo-setup-hero-text">
          <h3 className="odoo-settings-title">
            {pct === 100 ? 'Paramétrage essentiel terminé' : 'Paramétrage en cours'}
          </h3>
          <p className="odoo-settings-subtitle">
            {requiredDone} sur {required.length} points essentiels faits
            {todo > 0 && <> · <strong style={{ color: STATUS.todo.color }}>{todo} à faire</strong></>}
            {warn > 0 && <> · {warn} recommandation{warn > 1 ? 's' : ''}</>}
          </p>
          {next && (
            <button type="button" className="odoo-btn-primary odoo-setup-next" onClick={() => open(next)}>
              Prochaine étape : {next.label} <ArrowRight size={14} />
            </button>
          )}
        </div>
        <button type="button" className="odoo-btn-secondary odoo-setup-refresh" onClick={() => void refetch()} disabled={isFetching}
          title="Recalculer l'état du paramétrage">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} /> Actualiser
        </button>
      </section>

      <div className="odoo-setup-layout">
        <div style={{ display: 'grid', gap: '0.75rem', minWidth: 0 }}>
          <div className="prj-views" role="tablist" aria-label="Filtrer les points" style={{ justifySelf: 'start' }}>
            {([['open', 'À traiter'], ['done', 'Faits'], ['all', 'Tous']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''}
                onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>

          {/* ── Liste de contrôle par domaine ── */}
          <div className="odoo-setup-grid">
            {groups.map(g => (
              <section key={g.name} className="odoo-setup-card odoo-setup-tile" aria-label={g.name}>
                <header className="odoo-setup-card-head">
                  <span className="odoo-setup-tile-title"><g.icon size={17} aria-hidden="true" /> {g.name}</span>
                  {g.todo > 0 ? <StatusTag tone="todo" icon={CircleAlert} label={`${g.todo} à faire`} />
                    : g.warn > 0 ? <StatusTag tone="todo" icon={Info} label={`${g.warn} conseil${g.warn > 1 ? 's' : ''}`} />
                    : <StatusTag tone="done" label="OK" />}
                </header>
                {g.reqTotal > 0 && (
                  <div className="odoo-setup-bar" aria-hidden><span style={{ width: `${(g.reqDone / g.reqTotal) * 100}%` }} /></div>
                )}
                {g.shown.length === 0 ? (
                  <p className="odoo-setup-empty">{filter === 'done' ? 'Rien de terminé ici pour l’instant.' : 'Tout est en ordre.'}</p>
                ) : (
                  <ul className="odoo-setup-list">
                    {g.shown.map(c => {
                      const s = STATUS[c.status];
                      const Icon = s.icon;
                      return (
                        <li key={c.key}>
                          <button type="button" className="odoo-setup-item" onClick={() => open(c)}>
                            <Icon size={16} style={{ color: s.color, flexShrink: 0, marginTop: 1 }} aria-label={s.label} />
                            <span className="odoo-setup-item-body">
                              <span className="odoo-setup-item-label">
                                {c.label}
                                {!c.required && c.status !== 'ok' && <span className="odoo-setup-optional">facultatif</span>}
                              </span>
                              <span className="odoo-setup-item-detail">{c.detail}</span>
                            </span>
                            <ChevronRight size={15} className="odoo-setup-item-go" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {g.links.length > 0 && (
                  <nav className="odoo-setup-tile-links" aria-label={`Pages : ${g.name}`}>
                    {g.links.map(p => (
                      <button key={p.key} type="button" onClick={() => onOpen(p.key)}>{p.label}</button>
                    ))}
                    {g.name === USERS_GROUP && <button type="button" onClick={onOpenUsers}>Utilisateurs et droits</button>}
                  </nav>
                )}
              </section>
            ))}
          </div>
        </div>

        {/* ── Dernières modifications ── */}
        {data?.recent && (
          <aside className="odoo-setup-card odoo-setup-recent" aria-label="Dernières modifications">
            <header className="odoo-setup-card-head">
              <span className="odoo-setup-card-title"><History size={14} /> Dernières modifications</span>
            </header>
            {data.recent.length === 0 ? <p className="odoo-setup-empty">Aucune modification enregistrée.</p> : (
              <ul className="odoo-setup-list">
                {data.recent.map(r => (
                  <li key={r.id} className="odoo-setup-recent-item">
                    <span className="odoo-setup-item-label">{r.record_label || tableLabel(r.table_name)}</span>
                    <span className="odoo-setup-item-detail">
                      {OPERATIONS[r.operation] ?? r.operation}{r.record_label ? ` · ${tableLabel(r.table_name)}` : ''}
                    </span>
                    <span className="odoo-setup-item-detail">
                      {format(new Date(r.changed_at), 'd MMM HH:mm', { locale: fr })}{r.changed_by_name ? ` · ${r.changed_by_name}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="odoo-btn-secondary" style={{ margin: '0.5rem 0.75rem 0.75rem' }} onClick={() => onOpen('audit')}>
              Tout le journal
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}
