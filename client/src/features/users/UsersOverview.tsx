import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, KeyRound, Lock, ShieldAlert, ShieldCheck, TriangleAlert, UserX, type LucideIcon } from 'lucide-react';
import { usersApi, rolesApi, governanceApi } from '../../api/users.api';
import { settingsApi } from '../../api/settings.api';
import { KpiGrid, KpiCard, DataPanel, SectionHeader, EmptyState, LoadingState, ErrorState } from '../../components/ds';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { AUTH_EVENT_LABELS } from '../settings/AuditLogTab';
import { useAccountActions, fullName, formatDateTime, type UserRow } from './AccountSecurity';
import { useAuth } from '../../context/AuthContext';

/**
 * Vue d'ensemble du module Utilisateurs (refonte 2026-11, lot 1) : indicateurs, puis la liste
 * de ce qui demande une action (sécurité des comptes, conflits de séparation des tâches,
 * délégations qui expirent, comptes dormants, rôles sans titulaire), une action par ligne.
 */

const DAY = 86_400_000;
/** Sans connexion depuis ce nombre de jours, un compte actif est signalé « dormant ». */
export const DORMANT_DAYS = 60;
const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDate = (d: string | Date | null | undefined) => (d ? DATE.format(new Date(d)) : '—');

export function daysSince(at: string | null | undefined): number | null {
  return at ? Math.floor((Date.now() - new Date(at).getTime()) / DAY) : null;
}

/** Signaux de sécurité d'un compte actif (pastille « À traiter » de Comptes, Vue d'ensemble). */
export const needsSecurityAction = (u: UserRow) =>
  !!u.isActive && (!!(u.mfaRequired && !u.mfaEnabled) || !!u.lockedUntil || !!u.mustChangePassword || !!u.pinWeak);

type Todo = {
  key: string; tone: StatusTone; icon: LucideIcon; situation: string; who: string; detail: string; since: string;
  action: { label: string; onClick: () => void };
};

export type OverviewTarget = 'accounts' | 'roles' | 'controls' | 'delegations' | 'journal' | 'review';

export default function UsersOverview({ onOpenAccount, onGo }: {
  onOpenAccount: (u: UserRow) => void;
  onGo: (view: OverviewTarget) => void;
}) {
  const { user: me } = useAuth();
  const { run } = useAccountActions();
  const usersQ = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const { data: violations = [] } = useQuery({ queryKey: ['sod-violations'], queryFn: governanceApi.sodViolations, retry: false });
  const { data: sodMode } = useQuery({ queryKey: ['sod-mode'], queryFn: governanceApi.sodMode, retry: false });
  const { data: delegations = [] } = useQuery({ queryKey: ['delegations'], queryFn: governanceApi.delegationsList, retry: false });
  const { data: mfaPolicy } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy, retry: false });
  const { data: events } = useQuery({ queryKey: ['auth-events', 'overview'], queryFn: () => settingsApi.authEvents({ limit: 6 }), retry: false });

  const users = usersQ.data ?? [];
  const active = users.filter(u => u.isActive);
  const inactive = users.length - active.length;
  const security = active.filter(needsSecurityAction);
  const soon = Date.now() + 7 * 86_400_000;
  const running = delegations.filter(d => d.active);
  const expiring = running.filter(d => new Date(d.ends_at).getTime() <= soon);

  const todos = useMemo<Todo[]>(() => {
    const t: Todo[] = [];
    const byId = (id: string) => users.find(u => u.id === id);
    for (const v of violations) {
      const u = byId(v.userId);
      t.push({
        key: `sod-${v.userId}`, tone: 'blocked', icon: TriangleAlert, situation: 'Conflit de tâches', who: v.name,
        detail: v.violations.map(x => x.label).join(' ; '), since: '—',
        action: { label: 'Examiner', onClick: () => (u ? onOpenAccount(u) : onGo('controls')) },
      });
    }
    for (const u of users.filter(x => x.isActive)) {
      const name = fullName(u) || u.email;
      if (u.lockedUntil) t.push({
        key: `lock-${u.id}`, tone: 'todo', icon: Lock, situation: 'Verrouillé', who: name,
        detail: `${u.failedLoginCount ?? 0} échecs de connexion ; déverrouillage automatique le ${formatDateTime(u.lockedUntil)}`, since: "aujourd'hui",
        action: { label: 'Déverrouiller', onClick: () => void run('unlock', u) },
      });
      if (u.mfaRequired && !u.mfaEnabled) t.push({
        key: `mfa-${u.id}`, tone: 'todo', icon: ShieldAlert, situation: '2FA à configurer', who: name,
        detail: u.mfaRequiredByRole ? 'Exigée par son rôle, pas encore activée' : 'Exigée pour ce compte, pas encore activée', since: '—',
        action: { label: 'Ouvrir', onClick: () => onOpenAccount(u) },
      });
      if (u.mustChangePassword) t.push({
        key: `pwd-${u.id}`, tone: 'todo', icon: KeyRound, situation: 'Mot de passe à changer', who: name,
        detail: 'Changement imposé, pas encore fait', since: '—',
        action: { label: 'Lever', onClick: () => void run('mustChangeOff', u) },
      });
      if (u.pinWeak) t.push({
        key: `pin-${u.id}`, tone: 'todo', icon: KeyRound, situation: 'PIN à renouveler', who: name,
        detail: 'Code PIN de moins de 6 chiffres ou antérieur à la règle', since: '—',
        action: { label: 'Ouvrir', onClick: () => onOpenAccount(u) },
      });
      const idle = daysSince(u.lastLoginAt);
      if (u.id !== me?.id && idle !== null && idle >= DORMANT_DAYS) t.push({
        key: `idle-${u.id}`, tone: 'draft', icon: Clock, situation: 'Compte dormant', who: name,
        detail: `Aucune connexion depuis ${idle} jours`, since: fmtDate(u.lastLoginAt),
        action: { label: 'Désactiver', onClick: () => void run('deactivate', u) },
      });
      const age = daysSince(u.createdAt);
      if (u.id !== me?.id && !u.lastLoginAt && age !== null && age >= 7) t.push({
        key: `never-${u.id}`, tone: 'draft', icon: UserX, situation: 'Jamais connecté', who: name,
        detail: `Compte créé il y a ${age} jours, jamais utilisé`, since: fmtDate(u.createdAt),
        action: { label: 'Ouvrir', onClick: () => onOpenAccount(u) },
      });
    }
    for (const d of delegations.filter(x => x.active && new Date(x.ends_at).getTime() <= soon)) t.push({
      key: `deleg-${d.id}`, tone: 'todo', icon: Clock, situation: 'Délégation qui expire', who: d.to_name,
      detail: `Rôle ${d.role_label} délégué par ${d.from_name}, fin le ${fmtDate(d.ends_at)}`, since: fmtDate(d.starts_at),
      action: { label: 'Voir', onClick: () => onGo('delegations') },
    });
    for (const r of roles) {
      if (r.code !== 'admin' && r.is_active && r.available !== false && r.user_count === 0) t.push({
        key: `role-${r.code}`, tone: 'draft', icon: ShieldCheck, situation: 'Rôle sans titulaire', who: r.label,
        detail: 'Rôle actif attribué à aucun compte', since: '—',
        action: { label: 'Rôles', onClick: () => onGo('roles') },
      });
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, roles, violations, delegations, me?.id]);

  if (usersQ.isLoading) return <LoadingState />;
  if (usersQ.isError) return <ErrorState error={usersQ.error} onRetry={() => void usersQ.refetch()} />;

  const required = new Set(mfaPolicy?.requiredRoles ?? []);
  const held = roles.filter(r => r.user_count > 0).sort((a, b) => b.user_count - a.user_count).slice(0, 8);
  const modeLabel = sodMode?.mode === 'enforce' ? 'mode Bloquer' : sodMode?.mode === 'off' ? 'contrôle désactivé' : 'mode Observer : non bloqué';

  return (
    <div style={{ display: 'grid', gap: 'var(--ds-s6)' }}>
      <KpiGrid>
        <KpiCard label="Comptes actifs" value={active.length} sub={`${inactive} désactivé${inactive > 1 ? 's' : ''} sur ${users.length}`} onClick={() => onGo('accounts')} />
        <KpiCard label="Sécurité à traiter" value={security.length} sub="2FA, verrouillage, mot de passe, PIN" tone={security.length ? 'orange' : undefined} onClick={() => onGo('accounts')} />
        <KpiCard label="Conflits de séparation des tâches" value={violations.length} sub={modeLabel} tone={violations.length ? 'red' : undefined} onClick={() => onGo('controls')} />
        <KpiCard label="Délégations en cours" value={running.length} sub={expiring.length ? `${expiring.length} expire${expiring.length > 1 ? 'nt' : ''} sous 7 jours` : 'aucune n\'expire sous 7 jours'} tone={expiring.length ? 'orange' : undefined} onClick={() => onGo('delegations')} />
      </KpiGrid>

      <section style={{ display: 'grid', gap: 'var(--ds-s3)' }}>
        <SectionHeader title="À traiter" note={todos.length ? `${todos.length} point${todos.length > 1 ? 's' : ''}` : undefined} />
        <DataPanel label="À traiter">
          {todos.length === 0
            ? <EmptyState icon={ShieldCheck} title="Rien à traiter" text="Les comptes, rôles et délégations ne demandent aucune action." bare />
            : (
              <table className="odoo-table">
                <thead><tr><th>Situation</th><th>Compte ou rôle</th><th>Détail</th><th>Depuis</th><th className="ds-actions"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {todos.map(x => (
                    <tr key={x.key}>
                      <td style={{ whiteSpace: 'nowrap' }}><StatusTag tone={x.tone} label={x.situation} icon={x.icon} /></td>
                      <td className="ds-strong">{x.who}</td>
                      <td>{x.detail}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{x.since}</td>
                      <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={x.action.onClick}>{x.action.label}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </DataPanel>
      </section>

      <div className="usr-split">
        <section style={{ display: 'grid', gap: 'var(--ds-s3)', alignContent: 'start' }}>
          <SectionHeader title="Comptes par rôle" />
          <DataPanel label="Comptes par rôle">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Rôle</th><th className="ds-num">Comptes</th><th>Double authentification</th></tr></thead>
              <tbody>
                {held.map(r => (
                  <tr key={r.code}>
                    <td className="ds-strong">{r.label}</td>
                    <td className="ds-num">{r.user_count}</td>
                    <td>{required.has(r.code) ? <StatusTag tone="done" label="Exigée" /> : <span style={{ color: 'var(--ds-muted)' }}>Non exigée</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </section>
        <section style={{ display: 'grid', gap: 'var(--ds-s3)', alignContent: 'start' }}>
          <SectionHeader title="Dernières connexions"><button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => onGo('journal')}>Journal des connexions</button></SectionHeader>
          <DataPanel label="Dernières connexions">
            {events?.rows?.length ? (
              <table className="odoo-table ds-dense">
                <thead><tr><th>Date</th><th>Événement</th><th>Compte</th></tr></thead>
                <tbody>
                  {events.rows.map(e => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.created_at)}</td>
                      <td>{AUTH_EVENT_LABELS[e.event_type] ?? e.event_type}{!e.success && <> <StatusTag tone="blocked" label="Échec" /></>}</td>
                      <td>{e.target_name || e.user_name || e.email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={Clock} title="Aucune connexion enregistrée" bare />}
          </DataPanel>
        </section>
      </div>
    </div>
  );
}
