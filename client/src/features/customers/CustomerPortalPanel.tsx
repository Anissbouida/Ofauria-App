import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, Copy, Check, KeyRound, Trash2 } from 'lucide-react';
import { customersApi } from '../../api/customers.api';
import { usePermissions } from '../../context/PermissionsContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Fiche client › Portail (phase 10.3) : émettre, consulter et révoquer le jeton
 * d'accès au portail client. Le jeton en clair et le lien ne sont montrés qu'à
 * l'émission : on invite à les transmettre aussitôt au client.
 */
export default function CustomerPortalPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const { canEdit } = usePermissions();
  const editable = canEdit('customers');
  const { data: status, isLoading } = useQuery({
    queryKey: ['customer-portal', customerId],
    queryFn: () => customersApi.portalStatus(customerId),
  });
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState('');

  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/portail` : '/portail';

  const issue = useMutation({
    mutationFn: () => customersApi.issuePortalToken(customerId),
    onSuccess: (r) => { setIssued(r.token); qc.invalidateQueries({ queryKey: ['customer-portal', customerId] }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: () => customersApi.revokePortalToken(customerId),
    onSuccess: () => { setIssued(null); qc.invalidateQueries({ queryKey: ['customer-portal', customerId] }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const copy = (what: string, value: string) => {
    navigator.clipboard?.writeText(value).then(() => { setCopied(what); setTimeout(() => setCopied(''), 2000); });
  };

  return (
    <section>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Globe size={15} /> Portail client</h4>
      <p style={{ opacity: 0.75, fontSize: 13 }}>Le client consulte ses commandes, factures et relevé, et télécharge ses factures, sur <code>{portalUrl}</code> avec son jeton.</p>

      {issued && (
        <StatusBanner tone="warning" icon={KeyRound} title="Accès créé — à transmettre maintenant">
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ minWidth: 60 }}>Lien</span><code style={{ userSelect: 'all' }}>{portalUrl}</code>
              <button className="odoo-btn-secondary" onClick={() => copy('url', portalUrl)}>{copied === 'url' ? <Check size={13} /> : <Copy size={13} />}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ minWidth: 60 }}>Jeton</span><code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{issued}</code>
              <button className="odoo-btn-secondary" onClick={() => copy('tok', issued)}>{copied === 'tok' ? <Check size={13} /> : <Copy size={13} />}</button>
            </div>
            <span style={{ opacity: 0.8 }}>Le jeton ne sera plus affiché.</span>
          </div>
        </StatusBanner>
      )}

      {isLoading ? <Loader2 className="spin" /> : status ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <span>Accès actif (<code>{status.token_prefix}…</code>)</span>
          <span style={{ opacity: 0.7 }}>Dernière connexion : {status.last_login_at ? new Date(status.last_login_at).toLocaleString('fr-FR') : 'jamais'}</span>
          {editable && (
            <>
              <button className="odoo-btn-secondary" disabled={issue.isPending} onClick={() => issue.mutate()}>Régénérer</button>
              <button className="odoo-btn-secondary" disabled={revoke.isPending} onClick={() => revoke.mutate()}><Trash2 size={13} /> Révoquer</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <span style={{ opacity: 0.7 }}>Aucun accès. </span>
          {editable && (
            <button className="odoo-btn-primary" disabled={issue.isPending} onClick={() => issue.mutate()}>
              {issue.isPending ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />} Créer un accès
            </button>
          )}
        </div>
      )}
    </section>
  );
}
