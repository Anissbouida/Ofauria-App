import { useQuery } from '@tanstack/react-query';
import { KeyRound, Lock, LogOut, ScanSearch, ShieldAlert, TriangleAlert, Unlock, UserCheck } from 'lucide-react';
import { usersApi, rolesApi, governanceApi } from '../../api/users.api';
import { storesApi } from '../../api/stores.api';
import { Drawer, Alert } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { MfaTag, useAccountActions, fullName, formatLastLogin, formatDateTime, type UserRow } from './AccountSecurity';

/**
 * Aperçu d'un compte sans quitter la liste (refonte Utilisateurs, lot 1) : l'essentiel, les
 * signaux, les actions rapides de sécurité ; « Ouvrir la fiche » mène à la fiche complète.
 */
export default function AccountDrawer({ user, selfId, onClose, onOpen, onReview }: {
  user: UserRow; selfId?: string;
  onClose: () => void; onOpen: (u: UserRow) => void; onReview: (u: UserRow) => void;
}) {
  const { run, pending } = useAccountActions();
  const { data: users = [] } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { data: violations = [] } = useQuery({ queryKey: ['sod-violations'], queryFn: governanceApi.sodViolations, retry: false });
  const { data: employees = [] } = useQuery<Array<{ id: string; name: string; user_id: string | null }>>({ queryKey: ['employees-link'], queryFn: usersApi.employeesForLink });

  // Ligne à jour après une action (la liste est rechargée).
  const u = users.find(x => x.id === user.id) ?? user;
  const self = u.id === selfId;
  const roleCodes: string[] = Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []);
  const label = (code: string) => roles.find(r => r.code === code)?.label ?? code;
  const store = stores.find(s => s.id === u.storeId)?.name as string | undefined;
  const conflicts = violations.find(v => v.userId === u.id)?.violations ?? [];
  const employee = employees.find(e => e.user_id === u.id);
  const name = fullName(u) || u.email;

  return (
    <Drawer title={name} subtitle={u.email} onClose={onClose} width={460} label={`Aperçu du compte ${name}`}
      aside={self ? <StatusTag tone="progress" label="Vous" /> : undefined}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
        <button type="button" className="odoo-btn-primary" onClick={() => onOpen(u)}>Ouvrir la fiche</button>
      </>}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <StatusTag tone={u.isActive ? 'done' : 'cancelled'} label={u.isActive ? 'Actif' : 'Désactivé'} />
        {u.lockedUntil && <StatusTag tone="blocked" label="Verrouillé" icon={Lock} />}
        {u.mfaRequired && !u.mfaEnabled && <StatusTag tone="todo" label="2FA à configurer" icon={ShieldAlert} />}
        {u.mustChangePassword && <StatusTag tone="todo" label="Mot de passe à changer" icon={KeyRound} />}
        {conflicts.length > 0 && <StatusTag tone="blocked" label="Conflit de tâches" icon={TriangleAlert} />}
      </div>
      {conflicts.length > 0 && (
        <Alert tone="danger">{conflicts.map(c => c.label).join(' ; ')}</Alert>
      )}
      <dl className="usr-kv">
        <dt>Rôles</dt>
        <dd style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {roleCodes.map(c => <span key={c} className={`kl-tag ${c === u.role ? 'b' : 'x'}`} title={c === u.role ? 'Rôle principal' : undefined}>{label(c)}</span>)}
        </dd>
        <dt>Établissement</dt><dd>{store ?? (u.role === 'admin' ? 'Tous les établissements' : 'Non assigné')}</dd>
        <dt>Fiche salarié</dt><dd>{employee?.name ?? <span style={{ color: 'var(--ds-muted)' }}>Aucune</span>}</dd>
        <dt>Connexion</dt><dd title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>{u.lastLoginAt ? formatLastLogin(u.lastLoginAt) : 'Jamais connecté'}</dd>
        <dt>Double authentification</dt><dd><MfaTag u={u} /></dd>
        <dt>Code PIN</dt><dd>{!u.hasPin ? 'Non défini' : u.pinWeak ? 'À renouveler' : 'Défini'}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!u.isActive && !self && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!!pending} onClick={() => void run('activate', u)}><UserCheck size={13} aria-hidden="true" /> Réactiver</button>
        )}
        {u.lockedUntil && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!!pending} onClick={() => void run('unlock', u)}><Unlock size={13} aria-hidden="true" /> Déverrouiller</button>
        )}
        {u.mustChangePassword && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!!pending} onClick={() => void run('mustChangeOff', u)}><KeyRound size={13} aria-hidden="true" /> Lever le changement de mot de passe</button>
        )}
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => onReview(u)}><ScanSearch size={13} aria-hidden="true" /> Voir ses droits</button>
        {!self && u.isActive && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!!pending} onClick={() => void run('revoke', u)}><LogOut size={13} aria-hidden="true" /> Fermer les sessions</button>
        )}
      </div>
    </Drawer>
  );
}
