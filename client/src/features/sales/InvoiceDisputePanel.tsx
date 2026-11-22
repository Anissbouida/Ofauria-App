import { currencySymbol } from '../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Check, X } from 'lucide-react';
import { invoicesApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, SectionHeader } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';

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
      <SectionHeader title={<><AlertTriangle size={14} /> Litiges</>} />
      {isLoading ? <Loader2 className="spin" size={14} /> : (
        <>
          {data.length > 0 && (
            <DataPanel label="Litiges de la facture">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Motif</th><th className="ds-num">Contesté ({currencySymbol()})</th><th>État</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.id}>
                    <td className="ds-strong">{d.reason}</td>
                    <td className="ds-num">{Number(d.disputed_amount ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>{d.status === 'open' ? <StatusTag tone="todo" label="Ouvert" /> : d.status === 'resolved' ? <StatusTag tone="done" label="Résolu" /> : <StatusTag tone="cancelled" label="Rejeté" />}</td>
                    <td className="ds-actions">{editable && d.status === 'open' && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button type="button" className="odoo-pager-btn" title="Résoudre" aria-label="Résoudre le litige" onClick={() => resolve.mutate(d.id)}><Check size={13} /></button>
                        <button type="button" className="odoo-pager-btn" title="Rejeter" aria-label="Rejeter le litige" onClick={() => reject.mutate(d.id)}><X size={13} /></button>
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </DataPanel>
          )}
          {editable && !hasOpen && remaining > 0.005 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
              <input className="odoo-input" aria-label="Motif du litige" placeholder="Motif du litige" value={reason} onChange={e => setReason(e.target.value)} style={{ minWidth: 180 }} />
              <input className="odoo-input" type="number" aria-label={`Montant contesté (${currencySymbol()})`} placeholder="Montant contesté" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 150 }} max={remaining} />
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
