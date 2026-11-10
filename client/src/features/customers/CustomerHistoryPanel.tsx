import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { customersApi } from '../../api/customers.api';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';

// Piste d'audit de la fiche client + restauration si archivée (phase 4.4).

const ACTION_LABELS: Record<string, string> = {
  create: 'Création', update: 'Modification', archive: 'Archivage', restore: 'Restauration',
};

export default function CustomerHistoryPanel({ customerId, isActive }: { customerId: string; isActive: boolean }) {
  const qc = useQueryClient();
  const { data: entries = [] } = useQuery({ queryKey: ['customer-history', customerId], queryFn: () => customersApi.history(customerId) });

  const restore = useMutation({
    mutationFn: () => customersApi.restore(customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['customer-history', customerId] });
      notify.success('Client restauré');
    },
    onError: () => notify.error('Impossible de restaurer'),
  });

  return (
    <div style={{ marginTop: 10 }}>
      {!isActive && (
        <div style={{ marginBottom: 8 }}>
          <StatusBanner tone="warning" icon={History} title="Client archivé">
            Ce client est archivé : il garde tout son historique et reste hors des listes actives.
          </StatusBanner>
          <button className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}
            onClick={() => restore.mutate()} disabled={restore.isPending}><RotateCcw size={12} /> Restaurer le client</button>
        </div>
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--odoo-text-muted)', margin: '10px 0 6px' }}>
        <History size={12} /> Piste d'audit
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Aucun évènement enregistré.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8125rem', padding: '4px 0', borderBottom: '1px solid var(--odoo-border)' }}>
              <span style={{ fontWeight: 600 }}>{ACTION_LABELS[e.action] || e.action}
                {e.action === 'update' && Array.isArray(e.detail?.fields) && e.detail.fields.length > 0 &&
                  <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)' }}> · {e.detail.fields.length} champ(s)</span>}
              </span>
              <span style={{ color: 'var(--odoo-text-muted)', whiteSpace: 'nowrap' }}>
                {e.changed_by_name ? `${e.changed_by_name} · ` : ''}{format(new Date(e.changed_at), 'd MMM yyyy HH:mm', { locale: fr })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
