import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { History } from 'lucide-react';

/**
 * Historique des actions d'un document d'achat (journal document_actions, mig 306) :
 * qui, quand, quoi, pourquoi. Lecture seule, le journal est append-only en base.
 */
export type DocumentActionRow = {
  id: number; seq: number; action: string; channel: string; note: string | null;
  snapshot_amount: string | null; acted_at: string;
  reason_code: string | null; reason_label: string | null;
  actor_name: string | null; on_behalf_of_name: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  created: 'Créé', submitted: 'Soumis', approved: 'Approuvé', rejected: 'Rejeté', returned: 'Retourné',
  auto_approved: 'Approuvé automatiquement', sent: 'Envoyé', acknowledged: 'Accusé fournisseur',
  received: 'Réceptionné', invoiced: 'Facturé', paid: 'Payé', changed: 'Modifié',
  cancelled: 'Annulé', not_delivered: 'Non livré', reopened: 'Rouvert', closed: 'Clos',
  force_closed: 'Reliquat clôturé', held: 'Bloqué', released: 'Débloqué', frozen: 'Gelé',
  unfrozen: 'Dégelé', locked: 'Verrouillé', unlocked: 'Déverrouillé', escalated: 'Escaladé',
  delegated: 'Délégué', deleted: 'Supprimé', reversed: 'Réception annulée',
};

const ACTION_TAG: Record<string, string> = {
  cancelled: 'odoo-tag-grey', not_delivered: 'odoo-tag-red', held: 'odoo-tag-red', deleted: 'odoo-tag-red',
  reversed: 'odoo-tag-orange', released: 'odoo-tag-green', received: 'odoo-tag-green', approved: 'odoo-tag-green',
  invoiced: 'odoo-tag-purple', sent: 'odoo-tag-blue', changed: 'odoo-tag-yellow', frozen: 'odoo-tag-blue',
};

export default function DocumentActionsTimeline({ queryKey, fetcher }: {
  queryKey: unknown[];
  fetcher: () => Promise<DocumentActionRow[]>;
}) {
  const { data: rows = [], isLoading } = useQuery({ queryKey, queryFn: fetcher });
  if (isLoading) return <div role="status" style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Chargement de l'historique…</div>;
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="ds-subhead" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <History size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} /> Historique
      </h3>
      <table className="odoo-table ds-dense">
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--ds-muted)', width: 150 }}>{format(new Date(r.acted_at), 'd MMM yyyy HH:mm', { locale: fr })}</td>
              <td style={{ width: 150 }}><span className={`odoo-tag ${ACTION_TAG[r.action] ?? 'odoo-tag-grey'}`}>{ACTION_LABELS[r.action] ?? r.action}</span></td>
              <td>
                {r.actor_name ?? <span style={{ color: 'var(--ds-muted)' }}>{r.channel === 'script' ? 'reprise' : 'système'}</span>}
                {r.on_behalf_of_name && <span style={{ color: 'var(--ds-muted)' }}> pour {r.on_behalf_of_name}</span>}
              </td>
              <td style={{ color: 'var(--ds-muted)' }}>
                {r.reason_label && <span className="ds-strong">{r.reason_label}</span>}
                {r.reason_label && r.note ? ' · ' : ''}{r.note}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
