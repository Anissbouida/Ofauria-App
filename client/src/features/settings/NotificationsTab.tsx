import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Mail, HelpCircle, Plus, X } from 'lucide-react';
import { ROLE_LABELS } from '@ofauria/shared';
import { settingsApi, type NotificationRule } from '../../api/settings.api';
import { rolesApi } from '../../api/users.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { OdooToggle, settingAnchor } from './SettingsPrimitives';

/**
 * Règles de notification (audit Paramètres, lot 6, mig 332) : par événement,
 * notification active ou non et rôles à prévenir en plus. Appliquées en base
 * (trigger) : tous les écrans qui notifient les respectent.
 * Refonte (après S5) : une carte par domaine, un événement par ligne (interrupteur,
 * volume des 30 derniers jours, rôles en plus, e-mail), résumé et filtre en tête.
 */

const DOMAINS: Record<string, string> = {
  production: 'Production', stock: 'Stock et bons de sortie', replenishment: 'Réapprovisionnement',
  sales: 'Ventes', products: 'Nouveaux produits', quality: 'Qualité', approvals: 'Approbations',
  sav: 'SAV / réclamations', projects: 'Projets', maintenance: 'Maintenance', purchasing: 'Achats', quotes: 'Devis clients',
  crm: 'CRM',
};

type Filter = 'all' | 'on' | 'off' | 'email';

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export default function NotificationsTab() {
  const queryClient = useQueryClient();
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  const [filter, setFilter] = useState<Filter>('all');
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['notification-rules'], queryFn: settingsApi.notificationRules });
  // Rôles éditables (lot 3) pour les libellés ; repli sur les libellés fixes.
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const roleOptions = roles.length
    ? roles.filter(r => r.is_active).map(r => [r.code, r.label] as [string, string])
    : Object.entries(ROLE_LABELS) as [string, string][];
  const roleLabel = (c: string) => roleOptions.find(r => r[0] === c)?.[1] ?? c;

  const save = useMutation({
    mutationFn: ({ type, data }: { type: string; data: { enabled?: boolean; emailEnabled?: boolean; extraRoles?: string[] } }) => settingsApi.updateNotificationRule(type, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-rules'] }),
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const visible = (r: NotificationRule) => filter === 'all' || (filter === 'on' ? r.enabled : filter === 'off' ? !r.enabled : !!r.email_enabled);
  const groups = useMemo(() => {
    const m = new Map<string, NotificationRule[]>();
    for (const r of rules) m.set(r.domain, [...(m.get(r.domain) ?? []), r]);
    return [...m.entries()];
  }, [rules]);

  if (isLoading) return <Loader2 className="animate-spin" size={18} />;
  if (!rules.length) return <StatusBanner tone="warning" icon={Bell} title="Règles indisponibles">La migration 332 n'est pas appliquée sur cette base.</StatusBanner>;

  const active = rules.filter(r => r.enabled).length;
  const byMail = rules.filter(r => r.enabled && r.email_enabled).length;
  const sent = rules.reduce((n, r) => n + Number(r.sent_30d ?? 0), 0);
  const counts: Record<Filter, number> = { all: rules.length, on: active, off: rules.length - active, email: byMail };

  return (
    <div className="odoo-scope odoo-notif">
      <div className="odoo-params-summary">
        <div className="info"><small>Événements actifs</small><strong>{active} / {rules.length}</strong></div>
        <div className="info"><small>Aussi par e-mail</small><strong>{byMail}</strong></div>
        <div className="off"><small>Notifications envoyées · 30 j</small><strong>{sent.toLocaleString('fr-FR')}</strong></div>
      </div>

      <div className="odoo-notif-bar">
        <div className="odoo-view-switcher" role="tablist" aria-label="Filtrer les événements">
          {([['all', 'Tous'], ['on', 'Actifs'], ['off', 'Coupés'], ['email', 'Par e-mail']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
              {l} <span className="odoo-notif-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <span className="odoo-notif-note">
          Chaque événement prévient le rôle prévu ; ajoutez-en d'autres ou coupez-le.
          <span className="odoo-params-q" tabIndex={0}
            title="Le changement vaut pour les notifications suivantes. L'e-mail part aux personnes concernées qui ont une adresse ; le serveur d'envoi se règle dans Automatisation › E-mails.">
            <HelpCircle size={13} />
          </span>
        </span>
      </div>

      {groups.map(([domain, list]) => {
        const shown = list.filter(visible);
        if (!shown.length) return null;
        const on = list.filter(r => r.enabled).length;
        const title = DOMAINS[domain] ?? domain;
        return (
          <section key={domain} id={settingAnchor(title)} data-toc={title} className="odoo-company-card odoo-notif-card">
            <h3>{title}<span className="odoo-company-card-note">{on} / {list.length} actif{on > 1 ? 's' : ''}</span></h3>
            {shown.map(r => {
              const extra = r.extra_roles;
              const recipients = (r.recipients_30d ?? []).map(roleLabel).join(', ');
              return (
                <div key={r.type} id={`notif-row-${r.type}`} className={`odoo-notif-row${r.enabled ? '' : ' off'}`}>
                  <OdooToggle checked={r.enabled} disabled={!editable || save.isPending}
                    onChange={v => save.mutate({ type: r.type, data: { enabled: v } })} />
                  <div className="odoo-notif-main">
                    <span className="odoo-notif-label">{r.label}</span>
                    <span className="odoo-notif-meta">
                      {Number(r.sent_30d) > 0
                        ? <>{r.sent_30d} envoi{Number(r.sent_30d) > 1 ? 's' : ''} en 30 j{recipients ? ` · ${recipients}` : ''}</>
                        : 'Aucun envoi en 30 j'}
                    </span>
                  </div>
                  <div className="odoo-notif-roles">
                    {extra.map(c => (
                      <span key={c} className="odoo-notif-role">
                        + {roleLabel(c)}
                        {editable && (
                          <button type="button" aria-label={`Retirer ${roleLabel(c)}`}
                            onClick={() => save.mutate({ type: r.type, data: { extraRoles: extra.filter(x => x !== c) } })}><X size={11} /></button>
                        )}
                      </span>
                    ))}
                    {editable && r.enabled && (
                      <label className="odoo-notif-add" title="Prévenir aussi un autre rôle">
                        <Plus size={12} />
                        <select aria-label={`Prévenir aussi pour « ${r.label} »`} value=""
                          onChange={e => e.target.value && save.mutate({ type: r.type, data: { extraRoles: [...extra, e.target.value] } })}>
                          <option value="">Rôle</option>
                          {roleOptions.filter(([c]) => !extra.includes(c)).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  <button type="button" className={`odoo-notif-mail${r.email_enabled && r.enabled ? ' on' : ''}`}
                    disabled={!editable || !r.enabled || save.isPending} aria-pressed={!!r.email_enabled}
                    title={r.email_enabled ? 'Envoyé aussi par e-mail : cliquer pour arrêter' : 'Envoyer aussi par e-mail'}
                    onClick={() => save.mutate({ type: r.type, data: { emailEnabled: !r.email_enabled } })}>
                    <Mail size={13} /> E-mail
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
