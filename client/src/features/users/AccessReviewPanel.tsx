import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ScanSearch, ShieldAlert, Check, Minus, History, Lock } from 'lucide-react';
import {
  MODULE_LABELS, CAPABILITY_LABELS, DATA_SCOPE_LABELS, BUSINESS_VERB_LABELS, APPROVAL_DOCUMENT_LABELS,
  type AppModule, type Capability, type DataScope, type BusinessVerb, type ApprovalDocumentType,
} from '@ofauria/shared';
import { accessReviewApi, rolesApi, type AccessOverviewRow } from '../../api/users.api';
import { HrModal } from '../employees/ui';
import { StatusBanner } from '../../components/ui/StatusBanner';

/**
 * Outils admin de revue des accès (Phase 3, lecture seule) : « voir en tant que »
 * (droits résolus + provenance + conflits + plafonds), historique des droits,
 * et tableau de revue de tous les comptes.
 */

const moduleLabel = (m: string) => MODULE_LABELS[m as AppModule] ?? (m === 'stock' ? 'Stock' : m === 'controle' ? 'Contrôle & Qualité' : m);
const flag = (on: boolean) => on
  ? <Check size={14} style={{ color: 'var(--odoo-green, #16a34a)' }} />
  : <Minus size={13} style={{ color: 'var(--odoo-text-light)' }} />;

const HISTORY_LABELS: Record<string, string> = {
  user_created: 'Compte créé', user_updated: 'Compte modifié', permission_changed: 'Droits propres modifiés',
  role_INSERT: 'Rôle ajouté', role_DELETE: 'Rôle retiré', role_UPDATE: 'Rôle modifié',
};

export function AccessReviewModal({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['access-review', userId], queryFn: () => accessReviewApi.review(userId) });
  const { data: history = [] } = useQuery({ queryKey: ['access-history', userId], queryFn: () => accessReviewApi.history(userId) });
  const [tab, setTab] = useState<'rights' | 'history'>('rights');

  const roleName = (code: string) => code === '__custom__' ? 'Droits propres'
    : data?.roles.find(r => r.code === code)?.label ?? code;

  return (
    <HrModal icon={ScanSearch} crumb="Revue des accès" title={name} width={860} onClose={onClose}
      footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
      <div className="odoo-tabs" style={{ marginBottom: 12 }}>
        <button type="button" className={`odoo-tab ${tab === 'rights' ? 'active' : ''}`} onClick={() => setTab('rights')}>
          <ScanSearch size={13} style={{ marginRight: 4 }} /> Droits résolus
        </button>
        <button type="button" className={`odoo-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <History size={13} style={{ marginRight: 4 }} /> Historique
        </button>
      </div>

      {isLoading || !data ? <Loader2 className="animate-spin" size={18} /> : tab === 'rights' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Rôles :</span>
            {data.roles.map(r => (
              <span key={r.code} className={`odoo-tag ${r.delegated ? 'odoo-tag-blue' : 'odoo-tag-purple'}`}>
                {r.label}{r.delegated ? ' (délégué)' : ''}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
              Source : {data.source === 'admin' ? 'administrateur' : data.source === 'user' ? 'droits propres' : 'rôles'}
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
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead><tr>
                    <th>Module</th><th style={{ textAlign: 'center' }}>Voir</th><th style={{ textAlign: 'center' }}>Créer</th>
                    <th style={{ textAlign: 'center' }}>Modifier</th><th style={{ textAlign: 'center' }}>Supprimer</th>
                    <th>Portée</th><th>Actions métier</th><th>Accordé par</th>
                  </tr></thead>
                  <tbody>
                    {data.modules.map(m => (
                      <tr key={m.module}>
                        <td style={{ fontWeight: 600 }}>{moduleLabel(m.module)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canView)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canCreate)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canEdit)}</td>
                        <td style={{ textAlign: 'center' }}>{flag(m.canDelete)}</td>
                        <td>{DATA_SCOPE_LABELS[m.scope as DataScope] ?? m.scope}</td>
                        <td>{m.verbs.length ? m.verbs.map(v => BUSINESS_VERB_LABELS[v as BusinessVerb] ?? CAPABILITY_LABELS[v as Capability] ?? v).join(', ') : '—'}</td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{m.grantedBy.map(roleName).join(', ')}</td>
                      </tr>
                    ))}
                    {!data.modules.length && <tr><td colSpan={8} style={{ color: 'var(--odoo-text-muted)' }}>Aucun accès.</td></tr>}
                  </tbody>
                </table>
              </div>
              {data.approvalLimits.some(l => l.configured) && (
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 4 }}>Plafonds d'approbation</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {data.approvalLimits.filter(l => l.configured).map(l => (
                      <span key={l.documentType} className="odoo-tag odoo-tag-grey">
                        {APPROVAL_DOCUMENT_LABELS[l.documentType as ApprovalDocumentType] ?? l.documentType} : {l.limit === null ? 'illimité' : `${l.limit.toLocaleString('fr-FR')} MAD`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Événement</th><th>Par</th><th>Détail</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{HISTORY_LABELS[h.kind] ?? h.kind}</td>
                  <td>{h.actor ?? '—'}</td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{summarizeDetail(h.detail)}</td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan={4} style={{ color: 'var(--odoo-text-muted)' }}>Aucun historique.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </HrModal>
  );
}

function summarizeDetail(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(d.roles)) parts.push(`rôles : ${(d.roles as string[]).join(', ')}`);
  if (Array.isArray(d.changed) && d.changed.length) parts.push(`modifié : ${(d.changed as string[]).join(', ')}`);
  if (Array.isArray(d.modules)) parts.push(`modules : ${(d.modules as string[]).join(', ')}`);
  if (Array.isArray(d.sodViolations) && (d.sodViolations as string[]).length) parts.push(`conflits SoD : ${(d.sodViolations as string[]).join(', ')}`);
  if (typeof d.role === 'string') parts.push(`rôle : ${d.role}`);
  return parts.join(' · ') || '—';
}

/* ============ ONGLET REVUE DES ACCÈS ============ */
export default function AccessReviewTab() {
  const { data: overview = [], isLoading } = useQuery({ queryKey: ['access-overview'], queryFn: accessReviewApi.overview });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const [review, setReview] = useState<{ id: string; name: string } | null>(null);
  const roleLabel = (code: string) => roles.find(r => r.code === code)?.label ?? code;

  const conflicts = overview.filter(u => u.conflictCount > 0).length;

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone={conflicts ? 'warning' : 'info'} icon={conflicts ? ShieldAlert : ScanSearch}
        title={conflicts ? `${conflicts} compte(s) en conflit de séparation des tâches` : 'Revue des accès de tous les comptes'}>
        Vérifiez qui a quoi, repérez les droits propres et les conflits. Cliquez « Analyser » pour voir les droits résolus et l'historique d'un compte.
      </StatusBanner>
      {isLoading ? <Loader2 className="animate-spin" size={18} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Utilisateur</th><th>Rôles</th><th>Droits propres</th><th>Conflits SoD</th><th style={{ width: 1 }}></th></tr></thead>
            <tbody>
              {(overview as AccessOverviewRow[]).map(u => (
                <tr key={u.userId}>
                  <td><strong>{u.name}</strong><div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{u.email}</div></td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {u.roles.map(c => <span key={c} className="odoo-tag odoo-tag-purple">{roleLabel(c)}</span>)}
                    </div>
                  </td>
                  <td>{u.hasCustomPerms ? <span className="odoo-tag odoo-tag-orange">Oui</span> : <span className="odoo-tag odoo-tag-grey">Non</span>}</td>
                  <td>{u.conflictCount > 0 ? <span className="odoo-tag odoo-tag-red">{u.conflictCount}</span> : <span className="odoo-tag odoo-tag-green">0</span>}</td>
                  <td>
                    <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px', whiteSpace: 'nowrap' }}
                      onClick={() => setReview({ id: u.userId, name: u.name })}>
                      <ScanSearch size={13} /> Analyser
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {review && <AccessReviewModal userId={review.id} name={review.name} onClose={() => setReview(null)} />}
    </div>
  );
}
