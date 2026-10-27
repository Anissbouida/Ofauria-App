import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Loader2, Send, RotateCcw, X } from 'lucide-react';
import { automationApi, type OutboxMessage } from '../../api/automation.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Paramètres › E-mails (mig 364). Le serveur d'envoi (SMTP) se configure par variables
 * d'environnement : l'écran montre son état, l'expéditeur affiché et la file d'envoi.
 */
const STATUS: Record<OutboxMessage['status'], { label: string; cls: string }> = {
  queued: { label: 'En attente', cls: 'odoo-tag-orange' }, sent: { label: 'Envoyé', cls: 'odoo-tag-green' },
  failed: { label: 'Échec', cls: 'odoo-tag-red' }, cancelled: { label: 'Annulé', cls: 'odoo-tag-grey' },
};
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };

export default function MailTab() {
  const qc = useQueryClient();
  const { canEdit } = usePermissions();
  const editable = canEdit('settings');
  const { user } = useAuth();
  const { data: st, isLoading } = useQuery({ queryKey: ['automation-mail'], queryFn: automationApi.mail });
  const [filter, setFilter] = useState<string>('');
  const { data: outbox = [] } = useQuery({ queryKey: ['automation-outbox', filter], queryFn: () => automationApi.outbox(filter || undefined), refetchInterval: 30_000 });
  const [form, setForm] = useState({ fromName: '', replyTo: '', footer: '' });
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    if (st) setForm({ fromName: st.settings.from_name ?? '', replyTo: st.settings.reply_to ?? '', footer: st.settings.footer ?? '' });
  }, [st]);
  useEffect(() => { if (user?.email && !testTo) setTestTo(user.email); }, [user?.email, testTo]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['automation-mail'] }); qc.invalidateQueries({ queryKey: ['automation-outbox'] }); };

  const save = useMutation({
    mutationFn: (data: Parameters<typeof automationApi.saveMail>[0]) => automationApi.saveMail(data),
    onSuccess: () => { refresh(); notify.success('Réglages enregistrés'); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => automationApi.testMail(testTo.trim()),
    onSuccess: () => notify.success(st?.mode === 'log' ? 'Message journalisé (mode journal : rien n\'est réellement envoyé)' : `E-mail de test envoyé à ${testTo}`),
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'cancel' }) => automationApi.outboxAction(id, action),
    onSuccess: refresh, onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isLoading || !st) return <Loader2 className="animate-spin" size={18} />;
  const dirty = form.fromName !== (st.settings.from_name ?? '') || form.replyTo !== (st.settings.reply_to ?? '') || form.footer !== (st.settings.footer ?? '');

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      {st.mode === 'off' ? (
        <StatusBanner tone="warning" icon={Mail} title="Aucun serveur d'envoi configuré">
          Les e-mails sont mis en file mais ne partent pas. L'hébergeur doit renseigner les variables du serveur d'envoi
          (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM) ; ce sont des secrets, ils ne se saisissent pas ici.
          Les messages en attente partiront dès que l'envoi sera configuré.
        </StatusBanner>
      ) : st.mode === 'log' ? (
        <StatusBanner tone="info" icon={Mail} title="Mode journal (développement)">
          Les messages sont traités comme envoyés et écrits dans le journal du serveur, sans partir réellement.
        </StatusBanner>
      ) : (
        <StatusBanner tone={st.enabled ? 'success' : 'warning'} icon={Mail} title={st.enabled ? 'Envoi actif' : 'Envoi coupé'}>
          Serveur {st.host} · expéditeur {st.fromAddress}.
          {!st.enabled && ' Les messages restent en file tant que l\'envoi est coupé.'}
        </StatusBanner>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[['En attente', st.counts.queued, '#b85d1a'], ['En échec', st.counts.failed, st.counts.failed ? '#c0392b' : undefined], ['Envoyés (30 j)', st.counts.sent_30d, undefined]].map(([l, v, c]) => (
          <div key={String(l)} style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{l}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: (c as string) || 'var(--odoo-text)' }}>{v}</div>
          </div>
        ))}
      </div>

      <section style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: '0.875rem' }}>Expéditeur</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label style={lab}>Nom affiché<input style={field} maxLength={120} disabled={!editable} value={form.fromName} onChange={e => setForm({ ...form, fromName: e.target.value })} placeholder="Ex. : Ofauria — Gestion" /></label>
          <label style={lab}>Adresse de réponse<input style={field} type="email" maxLength={255} disabled={!editable} value={form.replyTo} onChange={e => setForm({ ...form, replyTo: e.target.value })} placeholder="Laisser vide : réponse à l'expéditeur" /></label>
        </div>
        <label style={lab}>Pied de message<textarea style={{ ...field, minHeight: 56 }} maxLength={500} disabled={!editable} value={form.footer} onChange={e => setForm({ ...form, footer: e.target.value })} placeholder="Ajouté sous chaque e-mail (coordonnées, mention…)" /></label>
        {editable && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="odoo-btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate({ fromName: form.fromName, replyTo: form.replyTo, footer: form.footer })}>Enregistrer</button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
              <input type="checkbox" checked={st.settings.enabled} disabled={save.isPending} onChange={e => save.mutate({ enabled: e.target.checked })} />
              Envoi des e-mails activé
            </label>
          </div>
        )}
      </section>

      {editable && (
        <section style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ ...lab, flex: '1 1 260px', maxWidth: 360 }}>Envoyer un e-mail de test à<input style={field} type="email" value={testTo} onChange={e => setTestTo(e.target.value)} /></label>
          <button className="odoo-btn-secondary" disabled={!st.configured || !/\S+@\S+\.\S+/.test(testTo) || test.isPending} onClick={() => test.mutate()}
            title={st.configured ? undefined : 'Aucun serveur d\'envoi configuré'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {test.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Envoyer le test
          </button>
        </section>
      )}

      <section style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '0.875rem', flex: 1 }}>File d'envoi</h3>
          <select style={{ ...field, width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filtrer par statut">
            <option value="">Tous</option><option value="queued">En attente</option><option value="failed">En échec</option><option value="sent">Envoyés</option><option value="cancelled">Annulés</option>
          </select>
        </div>
        {outbox.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 }}>Aucun message.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Créé le</th><th>Destinataire</th><th>Objet</th><th>Événement</th><th>Statut</th><th></th></tr></thead>
              <tbody>{outbox.map(m => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dt(m.created_at)}</td>
                  <td>{m.to_name ? <>{m.to_name}<div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{m.to_email}</div></> : m.to_email}</td>
                  <td>{m.subject}{m.last_error && <div style={{ fontSize: '0.75rem', color: '#c0392b' }} title={m.last_error}>{m.last_error.slice(0, 120)}</div>}</td>
                  <td style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{m.type_label ?? (m.type === 'manual' ? 'Envoi manuel' : m.type)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`odoo-tag ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--odoo-text-muted)' }}>
                      {m.status === 'sent' ? dt(m.sent_at) : m.status === 'queued' && m.attempts > 0 ? `essai ${m.attempts + 1} à ${dt(m.next_attempt_at)}` : m.attempts ? `${m.attempts} essai(s)` : ''}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {editable && (m.status === 'failed' || m.status === 'cancelled' || (m.status === 'queued' && m.attempts > 0)) && (
                      <button className="odoo-btn-secondary" style={{ padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => act.mutate({ id: m.id, action: 'retry' })}><RotateCcw size={12} /> Renvoyer</button>
                    )}{' '}
                    {editable && (m.status === 'queued' || m.status === 'failed') && (
                      <button className="odoo-btn-secondary" style={{ padding: '2px 8px' }} aria-label="Annuler l'envoi" title="Annuler l'envoi" onClick={() => act.mutate({ id: m.id, action: 'cancel' })}><X size={12} /></button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
