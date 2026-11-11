import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Webhook, Loader2, Plus, Trash2, Copy, Check } from 'lucide-react';
import { integrationsApi, API_SCOPES, WEBHOOK_EVENTS } from '../../api/integrations.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Paramètres › Intégrations (phase 10.2) : clés d'accès à l'API publique et
 * points de notification sortante (webhooks). La clé et le secret ne sont
 * affichés qu'une fois, à la création : on invite à les copier aussitôt.
 */

function Secret({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  return (
    <StatusBanner tone="warning" icon={KeyRound} title={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{value}</code>
        <button className="odoo-btn-secondary" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />} Copier</button>
        <span style={{ opacity: 0.8 }}>— à copier maintenant, il ne sera plus affiché.</span>
      </div>
    </StatusBanner>
  );
}

function ApiKeysSection({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: integrationsApi.listKeys });
  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState<string[]>(['orders:create']);
  const [plain, setPlain] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => integrationsApi.createKey({ label, scopes }),
    onSuccess: (r) => { setPlain(r.key); setLabel(''); qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => integrationsApi.revokeKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const toggle = (s: string) => setScopes(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={16} /> Clés d'API</h3>
      <p style={{ opacity: 0.75 }}>Permettent à un site marchand d'appeler l'API publique (en-tête <code>Authorization: Bearer …</code>).</p>
      {plain && <Secret title="Clé créée" value={plain} />}

      {editable && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
          <input className="odoo-input" placeholder="Libellé (ex. Site vitrine)" value={label} onChange={e => setLabel(e.target.value)} style={{ minWidth: 200 }} />
          {API_SCOPES.map(([s, lbl]) => (
            <label key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} /> {lbl}
            </label>
          ))}
          <button className="odoo-btn-primary" disabled={!label || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Créer
          </button>
        </div>
      )}

      {isLoading ? <Loader2 className="spin" /> : (
        <table className="odoo-table">
          <thead><tr><th>Libellé</th><th>Préfixe</th><th>Portée</th><th>Dernier appel</th><th>État</th><th /></tr></thead>
          <tbody>
            {data.map(k => (
              <tr key={k.id} style={k.revoked_at ? { opacity: 0.5 } : undefined}>
                <td>{k.label}</td>
                <td><code>{k.key_prefix}…</code></td>
                <td>{(k.scopes || []).join(', ') || '—'}</td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString('fr-FR') : '—'}</td>
                <td>{k.revoked_at ? 'Révoquée' : 'Active'}</td>
                <td>{editable && !k.revoked_at && (
                  <button className="odoo-pager-btn" title="Révoquer" onClick={() => revoke.mutate(k.id)}><Trash2 size={13} /></button>
                )}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={6} style={{ textAlign: 'center', opacity: 0.6 }}>Aucune clé.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}

function WebhooksSection({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: integrationsApi.listWebhooks });
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['order.created']);
  const [secret, setSecret] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => integrationsApi.createWebhook({ label, url, events }),
    onSuccess: (r) => { setSecret(r.secret); setLabel(''); setUrl(''); qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => integrationsApi.setWebhookActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => integrationsApi.removeWebhook(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const toggle = (s: string) => setEvents(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  return (
    <section>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Webhook size={16} /> Webhooks</h3>
      <p style={{ opacity: 0.75 }}>Kalum notifie une URL quand un événement survient. Chaque envoi est signé (en-tête <code>X-Kalum-Signature</code>, HMAC-SHA256 du corps avec le secret).</p>
      {secret && <Secret title="Secret du webhook" value={secret} />}

      {editable && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
          <input className="odoo-input" placeholder="Libellé" value={label} onChange={e => setLabel(e.target.value)} style={{ minWidth: 160 }} />
          <input className="odoo-input" placeholder="https://…/webhook" value={url} onChange={e => setUrl(e.target.value)} style={{ minWidth: 240 }} />
          {WEBHOOK_EVENTS.map(([s, lbl]) => (
            <label key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={events.includes(s)} onChange={() => toggle(s)} /> {lbl}
            </label>
          ))}
          <button className="odoo-btn-primary" disabled={!label || !url || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Ajouter
          </button>
        </div>
      )}

      {isLoading ? <Loader2 className="spin" /> : (
        <table className="odoo-table">
          <thead><tr><th>Libellé</th><th>URL</th><th>Événements</th><th>Actif</th><th /></tr></thead>
          <tbody>
            {data.map(w => (
              <tr key={w.id}>
                <td>{w.label}</td>
                <td style={{ wordBreak: 'break-all' }}>{w.url}</td>
                <td>{(w.events || []).join(', ')}</td>
                <td>
                  <input type="checkbox" checked={w.is_active} disabled={!editable}
                    onChange={() => setActive.mutate({ id: w.id, active: !w.is_active })} />
                </td>
                <td>{editable && (
                  <button className="odoo-pager-btn" title="Supprimer" onClick={() => remove.mutate(w.id)}><Trash2 size={13} /></button>
                )}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={5} style={{ textAlign: 'center', opacity: 0.6 }}>Aucun webhook.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function IntegrationsTab() {
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  return (
    <div>
      <ApiKeysSection editable={editable} />
      <WebhooksSection editable={editable} />
    </div>
  );
}
