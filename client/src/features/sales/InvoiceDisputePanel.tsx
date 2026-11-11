import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Check, X } from 'lucide-react';
import { invoicesApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Litiges d'une facture (phase 11, D5-59). Déclarer un montant contesté le
 * retire des relances tant que le litige est ouvert ; résoudre/rejeter le
 * rétablit. Panneau compact inséré dans le détail d'une facture émise.
 */
export default function InvoiceDisputePanel({ invoiceId, remaining, editable }: { invoiceId: string; remaining: number; editable: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['invoice-disputes', invoiceId], queryFn: () => invoicesApi.listDisputes(invoiceId) });
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['invoice-disputes', invoiceId] }); qc.invalidateQueries({ queryKey: ['invoices'] }); };

  const open = useMutation({
    mutationFn: () => invoicesApi.openDispute(invoiceId, { reason, disputedAmount: Number(amount) }),
    onSuccess: () => { setReason(''); setAmount(''); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => invoicesApi.resolveDispute(id, 'Résolu'),
    onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: (id: string) => invoicesApi.rejectDispute(id, 'Rejeté'),
    onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const hasOpen = data.some(d => d.status === 'open');

  return (
    <section style={{ marginTop: 12 }}>
      <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 6px' }}><AlertTriangle size={14} /> Litiges</h4>
      {isLoading ? <Loader2 className="spin" size={14} /> : (
        <>
          {data.length > 0 && (
            <table className="odoo-table" style={{ fontSize: 13 }}>
              <thead><tr><th>Motif</th><th>Contesté</th><th>État</th><th /></tr></thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.id}>
                    <td>{d.reason}</td>
                    <td>{Number(d.disputed_amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH</td>
                    <td>{d.status === 'open' ? 'Ouvert' : d.status === 'resolved' ? 'Résolu' : 'Rejeté'}</td>
                    <td>{editable && d.status === 'open' && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button className="odoo-pager-btn" title="Résoudre" onClick={() => resolve.mutate(d.id)}><Check size={13} /></button>
                        <button className="odoo-pager-btn" title="Rejeter" onClick={() => reject.mutate(d.id)}><X size={13} /></button>
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editable && !hasOpen && remaining > 0.005 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
              <input className="odoo-input" placeholder="Motif du litige" value={reason} onChange={e => setReason(e.target.value)} style={{ minWidth: 180 }} />
              <input className="odoo-input" type="number" placeholder="Montant contesté" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 150 }} max={remaining} />
              <button className="odoo-btn-secondary" disabled={!reason || !(Number(amount) > 0) || open.isPending} onClick={() => open.mutate()}>
                {open.isPending ? <Loader2 size={13} className="spin" /> : <AlertTriangle size={13} />} Déclarer un litige
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
