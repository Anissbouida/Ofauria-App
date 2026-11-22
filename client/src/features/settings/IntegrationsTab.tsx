import { StatusTag } from '../../components/ui/StatusTag';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Webhook, Loader2, Plus, Trash2, Copy, Check } from 'lucide-react';
import { integrationsApi, API_SCOPES, WEBHOOK_EVENTS } from '../../api/integrations.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';
import { DataPanel, FormField, LoadingState, SectionHeader } from '../../components/ds';

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
        <button type="button" className="odoo-btn-secondary" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />} Copier</button>
        <span style={{ opacity: 0.8 }}>— à copier maintenant, il ne sera plus affiché.</span>
      </div>
    </StatusBanner>
  );
}

function ApiKeysSection({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
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
    <section id="set-cles-d-api" data-toc="Clés d'API" style={{ display: 'grid', gap: 10 }}>
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><KeyRound size={17} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /> Clés d'API</span>} />
      <p className="odoo-page-note" style={{ margin: '0 4px' }}>Permettent à un site marchand d'appeler l'API publique (en-tête <code>Authorization: Bearer …</code>).</p>
      {plain && <Secret title="Clé créée" value={plain} />}

      {editable && (
        <section className="ds-panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '14px 18px' }} aria-label="Nouvelle clé d'API">
          <div style={{ minWidth: 220 }}>
            <FormField label="Libellé" htmlFor="apikey-label" required>
              <input id="apikey-label" className="ds-input" placeholder="Ex. Site vitrine" value={label} onChange={e => setLabel(e.target.value)} />
            </FormField>
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', minHeight: 40 }}>
            <legend className="sr-only">Portée</legend>
            {API_SCOPES.map(([s, lbl]) => (
              <label key={s} htmlFor={`apikey-scope-${s}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input id={`apikey-scope-${s}`} type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} /> {lbl}
              </label>
            ))}
          </fieldset>
          <button type="button" className="odoo-btn-primary" disabled={!label || create.isPending} aria-busy={create.isPending || undefined} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Créer
          </button>
        </section>
      )}

      {isLoading ? <LoadingState /> : (
        <DataPanel>
        <table className="odoo-table">
          <thead><tr><th>Libellé</th><th>Préfixe</th><th>Portée</th><th>Dernier appel</th><th>État</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.map(k => (
              <tr key={k.id} style={k.revoked_at ? { opacity: 0.5 } : undefined}>
                <td className="ds-strong">{k.label}</td>
                <td className="ds-ref">{k.key_prefix}…</td>
                <td>{(k.scopes || []).join(', ') || '—'}</td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString('fr-FR') : '—'}</td>
                <td>{k.revoked_at ? <StatusTag tone="cancelled" label="Révoquée" /> : <StatusTag tone="done" label="Active" />}</td>
                <td className="ds-actions">{editable && !k.revoked_at && (
                  <RowMenu label={`Actions sur ${k.label}`} items={[{ label: 'Révoquer la clé', icon: Trash2, danger: true, disabled: revoke.isPending,
                    onSelect: async () => { if (await confirm(`Révoquer la clé « ${k.label} » ? Les appels qui l'utilisent seront refusés.`, { danger: true, confirmLabel: 'Révoquer' })) revoke.mutate(k.id); } }]} />
                )}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucune clé.</td></tr>}
          </tbody>
        </table>
        </DataPanel>
      )}
    </section>
  );
}

function WebhooksSection({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
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
    <section id="set-webhooks" data-toc="Webhooks" style={{ display: 'grid', gap: 10 }}>
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Webhook size={17} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /> Webhooks</span>} />
      <p className="odoo-page-note" style={{ margin: '0 4px' }}>Kalum notifie une URL quand un événement survient. Chaque envoi est signé (en-tête <code>X-Kalum-Signature</code>, HMAC-SHA256 du corps avec le secret).</p>
      {secret && <Secret title="Secret du webhook" value={secret} />}

      {editable && (
        <section className="ds-panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '14px 18px' }} aria-label="Nouveau webhook">
          <div style={{ minWidth: 180 }}>
            <FormField label="Libellé" htmlFor="webhook-label" required>
              <input id="webhook-label" className="ds-input" value={label} onChange={e => setLabel(e.target.value)} />
            </FormField>
          </div>
          <div style={{ minWidth: 260 }}>
            <FormField label="URL" htmlFor="webhook-url" required>
              <input id="webhook-url" className="ds-input" placeholder="https://…/webhook" value={url} onChange={e => setUrl(e.target.value)} />
            </FormField>
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', minHeight: 40 }}>
            <legend className="sr-only">Événements</legend>
            {WEBHOOK_EVENTS.map(([s, lbl]) => (
              <label key={s} htmlFor={`webhook-event-${s}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input id={`webhook-event-${s}`} type="checkbox" checked={events.includes(s)} onChange={() => toggle(s)} /> {lbl}
              </label>
            ))}
          </fieldset>
          <button type="button" className="odoo-btn-primary" disabled={!label || !url || create.isPending} aria-busy={create.isPending || undefined} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Ajouter
          </button>
        </section>
      )}

      {isLoading ? <LoadingState /> : (
        <DataPanel>
        <table className="odoo-table">
          <thead><tr><th>Libellé</th><th>URL</th><th>Événements</th><th>Actif</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.map(w => (
              <tr key={w.id}>
                <td className="ds-strong">{w.label}</td>
                <td style={{ wordBreak: 'break-all' }}>{w.url}</td>
                <td>{(w.events || []).join(', ')}</td>
                <td>
                  <input type="checkbox" checked={w.is_active} disabled={!editable} aria-label={`Activer « ${w.label} »`}
                    onChange={() => setActive.mutate({ id: w.id, active: !w.is_active })} />
                </td>
                <td className="ds-actions">{editable && (
                  <RowMenu label={`Actions sur ${w.label}`} items={[{ label: 'Supprimer le webhook', icon: Trash2, danger: true, disabled: remove.isPending,
                    onSelect: async () => { if (await confirm(`Supprimer le webhook « ${w.label} » ?`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(w.id); } }]} />
                )}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucun webhook.</td></tr>}
          </tbody>
        </table>
        </DataPanel>
      )}
    </section>
  );
}

export default function IntegrationsTab() {
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <ApiKeysSection editable={editable} />
      <WebhooksSection editable={editable} />
    </div>
  );
}
