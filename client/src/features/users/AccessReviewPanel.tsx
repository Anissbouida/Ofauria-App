import { currencySymbol } from '../../utils/money';
import { FilterChips } from '../sales/ListTemplate';
import ReviewCampaigns from './ReviewCampaigns';
import { LoadingPanel, Segmented } from '../employees/ui';
import { useState } from 'react';
import { DataPanel, ErrorState, Modal } from '../../components/ds';
import { useQuery } from '@tanstack/react-query';
import { ScanSearch, ShieldAlert, Check, Minus, History, Lock } from 'lucide-react';
import {
  MODULE_LABELS, LEGACY_MODULE_KEYS, CAPABILITY_LABELS, DATA_SCOPE_LABELS, BUSINESS_VERB_LABELS, APPROVAL_DOCUMENT_LABELS,
  type AppModule, type Capability, type DataScope, type BusinessVerb, type ApprovalDocumentType,
} from '@ofauria/shared';
import { accessReviewApi } from '../../api/users.api';
import { StatusBanner } from '../../components/ui/StatusBanner';

/**
 * Outils admin de revue des accès (Phase 3, lecture seule) : « voir en tant que »
 * (droits résolus + provenance + conflits + plafonds), historique des droits,
 * et tableau de revue de tous les comptes.
 */

const moduleLabel = (m: string) => MODULE_LABELS[m as AppModule] ?? (m === 'stock' ? 'Stock' : m === 'controle' ? 'Contrôle & Qualité' : m);
const flag = (on: boolean) => on
  ? <Check size={14} aria-label="Oui" style={{ color: 'var(--ds-success)' }} />
  : <Minus size={13} style={{ color: 'var(--ds-muted)' }} />;

const HISTORY_LABELS: Record<string, string> = {
  user_created: 'Compte créé', user_updated: 'Compte modifié', permission_changed: 'Exception individuelle',
  role_INSERT: 'Rôle ajouté', role_DELETE: 'Rôle retiré', role_UPDATE: 'Rôle modifié',
  login_success: 'Connexion', login_failed: 'Échec de connexion', pin_login_success: 'Connexion par PIN', pin_login_failed: 'Échec du PIN',
  logout: 'Déconnexion', account_locked: 'Compte verrouillé', account_unlocked: 'Compte déverrouillé', token_revoked: 'Sessions fermées',
  mfa_trusted_device: 'Connexion depuis un poste mémorisé',
  passkey_added: 'Passkey ajoutée', passkey_removed: 'Passkey supprimée', passkey_failed: 'Échec de connexion par passkey',
  mfa_reset: 'Double authentification réinitialisée', mfa_requirement_changed: 'Exigence de double authentification modifiée',
  access_denied: 'Accès hors droits', user_deleted: 'Compte supprimé définitivement',
  invitation_sent: 'Invitation envoyée', invitation_accepted: 'Invitation acceptée',
  active_store_changed: 'Changement d\'établissement',
};

/** Droits résolus d'un compte : rôles, conflits, droits par module et d'où ils viennent, plafonds. */
export function AccessRightsView({ userId }: { userId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['access-review', userId], queryFn: () => accessReviewApi.review(userId) });
  const roleName = (code: string) => data?.roles.find(r => r.code === code)?.label ?? code;
  if (isError) return <ErrorState bare error={error} title="La revue des accès n'a pas pu être chargée" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingPanel />;
  // Anciennes clés du module Stock (economat, pesage…) : déjà couvertes par « Stock », masquées
  // comme dans les autres écrans de droits.
  const hasStock = data.modules.some(m => m.module === 'stock');
  const modules = data.modules.filter(m => !(hasStock && (LEGACY_MODULE_KEYS as ReadonlySet<string>).has(m.module)));
  return (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Rôles :</span>
            {data.roles.map(r => (
              <span key={r.code} className={`odoo-tag ${r.delegated ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>
                {r.label}{r.delegated ? ' (délégué)' : ''}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ds-muted)' }}>
              {data.isAdmin ? 'Administrateur' : `Rôles${data.modules.some(m => m.grantedBy.includes('__exception__')) ? ' et exceptions individuelles' : ''}`}
            </span>
          </div>

          {data.isAdmin ? (
            <StatusBanner tone="neutral" icon={Lock} title="Administrateur">Accès à tous les modules sans restriction.</StatusBanner>
          ) : (
            <>
              {data.sodViolations.length > 0 && (
                <StatusBanner tone="warning" icon={ShieldAlert} title={`${data.sodViolations.length} conflit(s) de séparation des tâches`}>
                  {data.sodViolations.map(v => v.label).join(' ; ')}
                </StatusBanner>
              )}
              <DataPanel>
                <table className="odoo-table">
                  <thead><tr>
                    <th>Module</th><th style={{ textAlign: 'center' }}>Voir</th><th style={{ textAlign: 'center' }}>Créer</th>
                    <th style={{ textAlign: 'center' }}>Modifier</th><th style={{ textAlign: 'center' }}>Supprimer</th>
                    <th>Portée</th><th>Actions métier</th><th>Accordé par</th>
                  </tr></thead>
                  <tbody>
                    {modules.map(m => (
                      <tr key={m.module}>
                        <td className="ds-strong">{moduleLabel(m.module)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canView)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canCreate)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canEdit)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canDelete)}</td>
                        <td>{DATA_SCOPE_LABELS[m.scope as DataScope] ?? m.scope}</td>
                        <td>{m.verbs.length ? m.verbs.map(v => BUSINESS_VERB_LABELS[v as BusinessVerb] ?? CAPABILITY_LABELS[v as Capability] ?? v).join(', ') : '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                          {m.grantedBy.includes('__exception__')
                            ? <span className="kl-tag o">Exception individuelle</span>
                            : m.grantedBy.map(roleName).join(', ')}
                        </td>
                      </tr>
                    ))}
                    {!modules.length && <tr><td colSpan={8} style={{ color: 'var(--ds-muted)' }}>Aucun accès.</td></tr>}
                  </tbody>
                </table>
              </DataPanel>
              {data.approvalLimits.some(l => l.configured) && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Plafonds d'approbation</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {data.approvalLimits.filter(l => l.configured).map(l => (
                      <span key={l.documentType} className="odoo-tag odoo-tag-grey">
                        {APPROVAL_DOCUMENT_LABELS[l.documentType as ApprovalDocumentType] ?? l.documentType} : {l.limit === null ? 'illimité' : `${l.limit.toLocaleString('fr-FR')} ${currencySymbol()}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
  );
}

/** Historique d'un compte : connexions et sécurité (auth_events) et changements de droits (journal). */
const HISTORY_GROUPS: Record<'logins' | 'rights' | 'security' | 'denied', (kind: string) => boolean> = {
  logins: k => /^(login_|pin_login_|logout|account_locked|active_store_changed)/.test(k),
  rights: k => /^(user_created|user_updated|permission_changed|role_|invitation_)/.test(k),
  security: k => /^(mfa_|token_revoked|account_unlocked|user_deleted)/.test(k),
  denied: k => k === 'access_denied',
};
type HistoryGroup = '' | keyof typeof HISTORY_GROUPS;

export function AccessHistoryView({ userId }: { userId: string }) {
  const { data: all = [] } = useQuery({ queryKey: ['access-history', userId], queryFn: () => accessReviewApi.history(userId) });
  const [group, setGroup] = useState<HistoryGroup>('');
  const count = (g: keyof typeof HISTORY_GROUPS) => all.filter(h => HISTORY_GROUPS[g](h.kind)).length;
  const history = group ? all.filter(h => HISTORY_GROUPS[group](h.kind)) : all;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
        <FilterChips label="Type d'événement" value={group} onChange={k => setGroup(k as HistoryGroup)} chips={[
          { key: '', label: 'Tout', count: all.length },
          { key: 'logins', label: 'Connexions', count: count('logins') },
          { key: 'rights', label: 'Droits', count: count('rights') },
          { key: 'security', label: 'Sécurité', count: count('security') },
          { key: 'denied', label: 'Accès hors droits', count: count('denied') },
        ]} />
        <DataPanel>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Événement</th><th>Par</th><th>Détail</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{HISTORY_LABELS[h.kind] ?? h.kind}</td>
                  <td>{h.actor ?? '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{summarizeDetail(h.detail)}</td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan={4} style={{ color: 'var(--ds-muted)' }}>Aucun historique.</td></tr>}
            </tbody>
          </table>
        </DataPanel>
    </div>
  );
}

export function AccessReviewModal({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const [tab, setTab] = useState<'rights' | 'history'>('rights');
  return (
    <Modal subtitle="Revue des accès" title={name} width={860} onClose={onClose}
      footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
      <div>
        <Segmented label="Vue de la revue" value={tab} onChange={setTab}
          options={[{ key: 'rights', label: 'Droits résolus', icon: ScanSearch }, { key: 'history', label: 'Historique', icon: History }]} />
      </div>
      {tab === 'rights' ? <AccessRightsView userId={userId} /> : <AccessHistoryView userId={userId} />}
    </Modal>
  );
}

function summarizeDetail(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(d.roles)) parts.push(`rôles : ${(d.roles as string[]).join(', ')}`);
  if (Array.isArray(d.changed) && d.changed.length) parts.push(`modifié : ${(d.changed as string[]).join(', ')}`);
  if (Array.isArray(d.modules)) parts.push(`modules : ${(d.modules as string[]).join(', ')}`);
  if (Array.isArray(d.sodViolations) && (d.sodViolations as string[]).length) parts.push(`conflits SoD : ${(d.sodViolations as string[]).join(', ')}`);
  if (typeof d.role === 'string') parts.push(`rôle : ${d.role}`);
  // Exception individuelle (lot 6) : module ou permission, effet, motif, date de fin.
  if (d.kind === 'module' || d.kind === 'action') {
    const effect = d.action === 'removed' ? 'retirée' : d.effect === 'grant' ? 'accordé' : d.effect === 'revoke' ? 'retiré' : 'modifié';
    parts.push(`${d.kind === 'module' ? moduleLabel(String(d.ref)) : String(d.ref)} : ${effect}`);
    if (typeof d.reason === 'string' && d.reason) parts.push(d.reason);
    if (typeof d.endsOn === 'string' && d.endsOn) parts.push(`jusqu'au ${new Date(d.endsOn).toLocaleDateString('fr-FR')}`);
  }
  return parts.join(' · ') || '—';
}

/* ============ ONGLET REVUE DES ACCÈS ============ */
/** Revue des accès en campagnes (lot 9) : remplace le tableau de consultation sans décision. */
export default function AccessReviewTab() {
  return <ReviewCampaigns />;
}
