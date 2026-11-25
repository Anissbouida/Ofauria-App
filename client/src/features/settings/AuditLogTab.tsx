import { Fragment, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { History, LogIn, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Search, Plus, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { settingsApi, type AuditLogEntry, type AuthEventEntry } from '../../api/settings.api';
import { usersApi } from '../../api/users.api';
import { MODULE_LABELS, type AppModule } from '@ofauria/shared';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { DataPanel, DateRangeField, EmptyState, ErrorState, LoadingState } from '../../components/ds';

/**
 * Journal des modifications du paramétrage (mig 328) et des connexions.
 * Lecture seule : le journal est en ajout seul côté base.
 */

const PAGE = 50;

const TABLE_LABELS: Record<string, string> = {
  company_settings: 'Paramètres société',
  stores: 'Points de vente',
  users: 'Utilisateurs',
  user_permissions: 'Exceptions individuelles',
  printer_configs: 'Imprimantes',
  sales_channels: 'Canaux de vente',
  payroll_settings: 'Paramètres de paie',
  payroll_tax_scales: 'Barèmes de paie',
  public_holidays: 'Jours fériés',
  roles: 'Rôles',
  role_permissions: 'Droits des rôles',
  document_sequences: 'Séries de numéros',
  company_bank_accounts: 'Comptes bancaires',
  document_templates: 'Modèles de documents',
  notification_rules: 'Notifications',
  module_parameters: 'Paramètres métier',
  tax_codes: 'Codes TVA',
};
export const tableLabel = (t: string) =>
  t.startsWith('ref:') ? 'Référentiel' : (TABLE_LABELS[t] ?? t);

// Libellés des colonnes les plus courantes ; les autres s'affichent telles quelles.
const FIELD_LABELS: Record<string, string> = {
  company_name: 'Nom commercial', subtitle: 'Sous-titre', logo_url: 'Logo',
  legal_name: 'Raison sociale', legal_address: 'Siège social', legal_city: 'Ville',
  legal_phone: 'Téléphone', legal_email: 'Email', legal_rc: 'RC', legal_if: 'IF',
  legal_ice: 'ICE', legal_patente: 'Patente', staff_discount_percent: 'Remise personnel (%)',
  first_name: 'Prénom', last_name: 'Nom', email: 'Email', role: 'Rôle', is_active: 'Actif',
  password_hash: 'Mot de passe', pin_code: 'Code PIN', store_id: 'Magasin',
  can_view: 'Voir', can_create: 'Créer', can_edit: 'Modifier', can_delete: 'Supprimer', config: 'Restrictions',
  name: 'Nom', city: 'Ville', address: 'Adresse', phone: 'Téléphone', label: 'Libellé',
  is_default: 'Par défaut', value: 'Valeur', rate: 'Taux',
};
const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

const OP_TAG: Record<AuditLogEntry['operation'], { tone: StatusTone; icon: LucideIcon; label: string }> = {
  INSERT: { tone: 'done', icon: Plus, label: 'Création' },
  UPDATE: { tone: 'progress', icon: Pencil, label: 'Modification' },
  DELETE: { tone: 'blocked', icon: Trash2, label: 'Suppression' },
};

/** Libellés des événements de connexion (auth_events), repris par le module Utilisateurs. */
export const AUTH_EVENT_LABELS: Record<string, string> = {
  login_success: 'Connexion', login_failed: 'Échec de connexion',
  pin_login_success: 'Connexion PIN', pin_login_failed: 'Échec PIN',
  logout: 'Déconnexion', account_locked: 'Compte verrouillé',
  user_created: 'Compte créé', user_updated: 'Compte modifié', permission_changed: 'Droits modifiés',
  access_denied: 'Accès hors droits',
  invitation_sent: 'Invitation envoyée', invitation_accepted: 'Invitation acceptée',
  active_store_changed: 'Changement d\'établissement', security_policy_changed: 'Politique de sécurité modifiée',
  account_unlocked: 'Compte déverrouillé', token_revoked: 'Sessions fermées', user_deleted: 'Compte supprimé définitivement',
  mfa_trusted_device: 'Connexion depuis un poste mémorisé',
  passkey_added: 'Passkey ajoutée', passkey_removed: 'Passkey supprimée', passkey_failed: 'Échec de connexion par passkey',
  mfa_reset: 'Double authentification réinitialisée', mfa_requirement_changed: 'Exigence de double authentification modifiée',
  config_export: 'Export de la configuration', data_export: 'Export des données', data_import: 'Import de données',
};

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}

/** Ce qui a changé, en une ligne lisible (détail complet dans la ligne dépliée). */
function summary(e: AuditLogEntry): string {
  if (e.operation === 'UPDATE' && e.diff) {
    return Object.keys(e.diff).map(fieldLabel).join(', ');
  }
  if (e.table_name === 'user_permissions') {
    const row = (e.new_row ?? e.old_row) as Record<string, unknown> | null;
    const mod = String(row?.module ?? e.record_id ?? '');
    return `Module ${MODULE_LABELS[mod as AppModule] ?? mod}`;
  }
  return '';
}

function rowTitle(e: AuditLogEntry): string {
  if (e.table_name === 'user_permissions') {
    const mod = e.record_id ?? '';
    return `${e.subject_name || 'Utilisateur'} · ${MODULE_LABELS[mod as AppModule] ?? mod}`;
  }
  if (e.table_name === 'role_permissions') {
    const mod = e.record_id ?? '';
    return `Rôle ${e.subject_id ?? ''} · ${MODULE_LABELS[mod as AppModule] ?? mod}`;
  }
  return e.record_label || e.record_id || '—';
}

function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (o: number) => void }) {
  if (total <= PAGE) return <span style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>{total} ligne{total > 1 ? 's' : ''}</span>;
  return (
    <span className="odoo-pager">
      {offset + 1}-{Math.min(offset + PAGE, total)} / {total}
      <button type="button" className="odoo-pager-btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))} aria-label="Page précédente"><ChevronLeft size={14} /></button>
      <button type="button" className="odoo-pager-btn" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)} aria-label="Page suivante"><ChevronRight size={14} /></button>
    </span>
  );
}

export default function AuditLogTab() {
  const [view, setView] = useState<'changes' | 'logins'>('changes');
  // Liste des comptes pour les filtres : réservée aux admins côté API, filtre masqué sinon.
  const { data: users = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    retry: false,
  });

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <PageNote help="Paramètres, points de vente, utilisateurs, droits, imprimantes, paie et référentiel : chaque modification est enregistrée avec son auteur et l'ancienne valeur. Personne, administrateur compris, ne peut modifier ou effacer ce journal depuis l'application.">
        Toutes les modifications, avec leur auteur. Le journal ne s'efface pas.
      </PageNote>
      <div className="prj-views" role="group" aria-label="Journal" style={{ alignSelf: 'start', justifySelf: 'start' }}>
        <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <History size={14} /> Modifications
        </button>
        <button className={view === 'logins' ? 'active' : ''} onClick={() => setView('logins')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LogIn size={14} /> Connexions
        </button>
      </div>
      {view === 'changes' ? <ChangesView users={users} /> : <LoginsView users={users} />}
    </div>
  );
}

function ChangesView({ users }: { users: Record<string, any>[] }) {
  // « Historique de cette page » (lot S4) ouvre le journal filtré par ?table=.
  const [table, setTable] = useState(() => new URLSearchParams(window.location.search).get('table') ?? '');
  const [changedBy, setChangedBy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const { data: tables = [] } = useQuery({ queryKey: ['audit-log-tables'], queryFn: settingsApi.auditTables, retry: 1 });
  const params = { table: table || undefined, changedBy: changedBy || undefined, from: from || undefined, to: to || undefined, q: q.trim() || undefined, limit: PAGE, offset };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit-log', params],
    queryFn: () => settingsApi.auditLog(params),
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };

  return (
    <>
      <div className="prj-toolbar">
        <label className="prj-search" style={{ maxWidth: 360 }}>
          <Search size={15} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
          <input type="search" placeholder="Rechercher (libellé, valeur)…"
            value={q} onChange={e => reset(setQ)(e.target.value)} aria-label="Rechercher" />
        </label>
        <SearchSelect value={table} onChange={reset(setTable)} ariaLabel="Objet" placeholder="Tous les objets" width={200}
          options={[...tables.map((t: string) => ({ id: t, label: tableLabel(t) })), { id: 'referentiel', label: 'Référentiel' }]} />
        {users.length > 0 && (
          <SearchSelect value={changedBy} onChange={reset(setChangedBy)} ariaLabel="Auteur" placeholder="Tous les auteurs" width={200}
            options={users.map(u => ({ id: String(u.id), label: `${u.firstName} ${u.lastName}` }))} />
        )}
        <DateRangeField from={from} to={to} onFrom={reset(setFrom)} onTo={reset(setTo)} />
        <div style={{ flex: 1 }} />
        <Pager offset={offset} total={data?.total ?? 0} onChange={setOffset} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} text="Le journal n'a pas pu être chargé. Vérifiez que la migration 328 est appliquée, puis réessayez." />
      ) : !data?.rows.length ? (
        <EmptyState icon={History} title="Aucune modification pour ces filtres" />
      ) : (
        <DataPanel>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}><span className="sr-only">Détail</span></th><th>Date</th><th>Auteur</th><th>Objet</th><th>Élément</th><th>Action</th><th>Champs</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(e => {
                const isOpen = open === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className="ds-clickable" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)}>
                      <td>{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                      <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(e.changed_at)}</td>
                      <td>{e.changed_by_name || <span style={{ color: 'var(--ds-muted)' }}>Système</span>}</td>
                      <td>{tableLabel(e.table_name)}</td>
                      <td className="ds-strong">{rowTitle(e)}</td>
                      <td><StatusTag tone={OP_TAG[e.operation].tone} icon={OP_TAG[e.operation].icon} label={OP_TAG[e.operation].label} /></td>
                      <td style={{ color: 'var(--ds-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary(e)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td></td>
                        <td colSpan={6} style={{ background: 'var(--ds-bg)' }}>
                          <ChangeDetail e={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}

function ChangeDetail({ e }: { e: AuditLogEntry }) {
  const pairs: [string, unknown, unknown][] = e.diff
    ? Object.entries(e.diff).map(([k, v]) => [k, v.old, v.new])
    : Object.entries((e.new_row ?? e.old_row) ?? {})
        .filter(([k]) => !['id', 'created_at', 'updated_at', 'updated_by'].includes(k))
        .map(([k, v]) => [k, e.operation === 'DELETE' ? v : undefined, e.operation === 'DELETE' ? undefined : v]);
  if (!pairs.length) return <span style={{ color: 'var(--ds-muted)', fontSize: '13px' }}>Aucun détail.</span>;
  return (
    <table className="odoo-table ds-dense ds-nested">
      <thead><tr><th>Champ</th><th>Avant</th><th>Après</th></tr></thead>
      <tbody>
        {pairs.map(([k, o, n]) => (
          <tr key={k}>
            <td className="ds-strong">{fieldLabel(k)}</td>
            <td style={{ color: 'var(--ds-muted)', wordBreak: 'break-word' }}>{o === undefined ? '' : fmtValue(o)}</td>
            <td style={{ wordBreak: 'break-word' }}>{n === undefined ? '' : fmtValue(n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LoginsView({ users }: { users: Record<string, any>[] }) {
  const [eventType, setEventType] = useState('');
  const [userId, setUserId] = useState('');
  const [result, setResult] = useState<'' | 'true' | 'false'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const params = {
    eventType: eventType || undefined, userId: userId || undefined,
    success: result === '' ? undefined : result === 'true',
    from: from || undefined, to: to || undefined, limit: PAGE, offset,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['auth-events', params],
    queryFn: () => settingsApi.authEvents(params),
    placeholderData: keepPreviousData,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };

  return (
    <>
      <div className="prj-toolbar">
        <select className="ds-input sm" style={{ width: 'auto' }} value={eventType} onChange={e => reset(setEventType)(e.target.value)} aria-label="Événement">
          <option value="">Tous les événements</option>
          {Object.entries(AUTH_EVENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="ds-input sm" style={{ width: 'auto' }} value={result} onChange={e => reset(setResult)(e.target.value as '' | 'true' | 'false')} aria-label="Résultat">
          <option value="">Réussis et échoués</option>
          <option value="true">Réussis</option>
          <option value="false">Échoués</option>
        </select>
        {users.length > 0 && (
          <SearchSelect value={userId} onChange={reset(setUserId)} ariaLabel="Utilisateur" placeholder="Tous les utilisateurs" width={200}
            options={users.map(u => ({ id: String(u.id), label: `${u.firstName} ${u.lastName}` }))} />
        )}
        <DateRangeField from={from} to={to} onFrom={reset(setFrom)} onTo={reset(setTo)} />
        <div style={{ flex: 1 }} />
        <Pager offset={offset} total={data?.total ?? 0} onChange={setOffset} />
      </div>
      {isLoading ? (
        <LoadingState />
      ) : !data?.rows.length ? (
        <EmptyState icon={LogIn} title="Aucun événement pour ces filtres" />
      ) : (
        <DataPanel>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Événement</th><th>Utilisateur</th><th>Compte visé</th><th>Adresse IP</th><th>Détail</th></tr></thead>
            <tbody>
              {data.rows.map((e: AuthEventEntry) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(e.created_at)}</td>
                  <td><StatusTag tone={e.success ? 'done' : 'blocked'} label={AUTH_EVENT_LABELS[e.event_type] ?? e.event_type} /></td>
                  <td>{e.user_name || e.email || '—'}</td>
                  <td>{e.target_name || ''}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{e.ip || ''}</td>
                  <td style={{ color: 'var(--ds-muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${fmtValue(v)}`).join(' · ') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}
