import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2 } from 'lucide-react';
import { ROLE_LABELS } from '@ofauria/shared';
import { settingsApi, type NotificationRule } from '../../api/settings.api';
import { rolesApi } from '../../api/users.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Règles de notification (audit Paramètres, lot 6, mig 332) : par événement,
 * notification active ou non et rôles à prévenir en plus. Appliquées en base
 * (trigger) : tous les écrans qui notifient les respectent.
 */

const DOMAINS: Record<string, string> = {
  production: 'Production', stock: 'Stock et bons de sortie', replenishment: 'Réapprovisionnement',
  sales: 'Ventes', products: 'Nouveaux produits', quality: 'Qualité',
};

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export default function NotificationsTab() {
  const queryClient = useQueryClient();
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['notification-rules'], queryFn: settingsApi.notificationRules });
  // Rôles éditables (lot 3) pour les libellés ; repli sur les libellés fixes.
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const roleOptions = roles.length
    ? roles.filter(r => r.is_active).map(r => [r.code, r.label] as [string, string])
    : Object.entries(ROLE_LABELS) as [string, string][];
  const roleLabel = (c: string) => roleOptions.find(r => r[0] === c)?.[1] ?? c;

  const save = useMutation({
    mutationFn: ({ type, data }: { type: string; data: { enabled?: boolean; extraRoles?: string[] } }) => settingsApi.updateNotificationRule(type, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-rules'] }),
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const groups = useMemo(() => {
    const m = new Map<string, NotificationRule[]>();
    for (const r of rules) m.set(r.domain, [...(m.get(r.domain) ?? []), r]);
    return [...m.entries()];
  }, [rules]);

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <StatusBanner tone="neutral" icon={Bell} title="Qui est prévenu, et de quoi">
        Chaque événement prévient le rôle prévu par l'application. Vous pouvez couper un événement trop bavard ou prévenir
        d'autres rôles en plus. Le changement s'applique aux notifications suivantes.
      </StatusBanner>
      {!rules.length && <StatusBanner tone="warning" icon={Bell} title="Règles indisponibles">La migration 332 n'est pas appliquée sur cette base.</StatusBanner>}
      {groups.map(([domain, list]) => (
        <section key={domain} style={{ display: 'grid', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--odoo-text-muted)' }}>{DOMAINS[domain] ?? domain}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th style={{ width: 70 }}>Active</th><th>Événement</th><th>Prévenus (30 jours)</th><th style={{ textAlign: 'right' }}>Envois (30 j)</th><th>Prévenir aussi</th></tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.type} style={{ opacity: r.enabled ? 1 : 0.6 }}>
                    <td>
                      <input id={`notif-${r.type}`} type="checkbox" checked={r.enabled} disabled={!editable || save.isPending}
                        aria-label={`Activer « ${r.label} »`}
                        onChange={e => save.mutate({ type: r.type, data: { enabled: e.target.checked } })} />
                    </td>
                    <td>{r.label}</td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{(r.recipients_30d ?? []).map(roleLabel).join(', ') || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.sent_30d}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.extra_roles.map(c => (
                          <span key={c} className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {roleLabel(c)}
                            {editable && (
                              <button type="button" aria-label={`Retirer ${roleLabel(c)}`} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}
                                onClick={() => save.mutate({ type: r.type, data: { extraRoles: r.extra_roles.filter(x => x !== c) } })}>×</button>
                            )}
                          </span>
                        ))}
                        {editable && r.enabled && (
                          <select aria-label={`Prévenir aussi pour « ${r.label} »`} value=""
                            style={{ fontSize: '0.8125rem', padding: '2px 4px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }}
                            onChange={e => e.target.value && save.mutate({ type: r.type, data: { extraRoles: [...r.extra_roles, e.target.value] } })}>
                            <option value="">+ Ajouter</option>
                            {roleOptions.filter(([c]) => !r.extra_roles.includes(c)).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
