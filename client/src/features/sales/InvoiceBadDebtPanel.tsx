import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Loader2, RotateCcw } from 'lucide-react';
import { invoicesApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Créances douteuses / irrécouvrables d'une facture (phase 11, D5-45). Classer
 * « douteuse » la signale (toujours suivie) ; « irrécouvrable » retire le reste
 * des relances. L'écriture comptable (perte, TVA) reste une OD manuelle.
 */
export default function InvoiceBadDebtPanel({ invoiceId, remaining, editable }: { invoiceId: string; remaining: number; editable: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['invoice-bad-debts', invoiceId], queryFn: () => invoicesApi.listBadDebts(invoiceId) });
  const [reason, setReason] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['invoice-bad-debts', invoiceId] }); qc.invalidateQueries({ queryKey: ['invoices'] }); };

  const classify = useMutation({
    mutationFn: (status: 'doubtful' | 'written_off') => invoicesApi.classifyBadDebt(invoiceId, { status, reason: reason || undefined }),
    onSuccess: () => { setReason(''); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const revert = useMutation({
    mutationFn: (id: string) => invoicesApi.revertBadDebt(id),
    onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const active = data.find(d => !d.reverted_at);

  return (
    <section style={{ marginTop: 12 }}>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 6px' }}><HandCoins size={14} /> Créance douteuse / irrécouvrable</h4>
      {isLoading ? <Loader2 className="spin" size={14} /> : active ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <span>{active.status === 'written_off' ? 'Irrécouvrable' : 'Douteuse'} · {Number(active.amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH</span>
          {active.reason && <span style={{ opacity: 0.7 }}>— {active.reason}</span>}
          {active.status === 'written_off' && <span style={{ opacity: 0.6 }}>(exclue des relances ; passez l'OD de perte à la main)</span>}
          {editable && (
            <button className="odoo-btn-secondary" disabled={revert.isPending} onClick={() => revert.mutate(active.id)}><RotateCcw size={13} /> Annuler le classement</button>
          )}
        </div>
      ) : editable && remaining > 0.005 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="odoo-input" placeholder="Motif (facultatif)" value={reason} onChange={e => setReason(e.target.value)} style={{ minWidth: 200 }} />
          <button className="odoo-btn-secondary" disabled={classify.isPending} onClick={() => classify.mutate('doubtful')}>Marquer douteuse</button>
          <button className="odoo-btn-secondary" disabled={classify.isPending} onClick={() => classify.mutate('written_off')} title="Retire le reste des relances">Passer en irrécouvrable</button>
        </div>
      ) : <span style={{ opacity: 0.6, fontSize: 13 }}>—</span>}
    </section>
  );
}
