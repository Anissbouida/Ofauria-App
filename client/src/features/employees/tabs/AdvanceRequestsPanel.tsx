import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, HandCoins } from 'lucide-react';
import { advanceRequestsApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage } from '../shared';

const fmt = (v: unknown) => (parseFloat(String(v ?? 0)) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Demandes d'avance faites par les salariés depuis leur espace : accorder
 * verse l'avance (paiement, écriture 3431, retenue sur les prochaines paies) ;
 * refuser la clôt avec un motif.
 */
export default function AdvanceRequestsPanel() {
  const queryClient = useQueryClient();
  const { data: rows = [] } = useQuery<Record<string, any>[]>({ queryKey: ['advance-requests'], queryFn: () => advanceRequestsApi.list('pending') });
  const refresh = () => ['advance-requests', 'salary-advances', 'advances-outstanding'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const approve = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) => advanceRequestsApi.approve(id, { paymentMethod: method }),
    onSuccess: () => { refresh(); notify.success('Avance accordée et versée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const reject = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) => advanceRequestsApi.reject(id, note),
    onSuccess: () => { refresh(); notify.success('Demande refusée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  if (!rows.length) return null;
  return (
    <div className="odoo-alert warning" style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem' }}>
      <p style={{ fontWeight: 600, marginBottom: 6 }}><HandCoins size={12} style={{ display: 'inline', marginRight: 4 }} />{rows.length} demande(s) d'avance à traiter</p>
      <table className="odoo-table">
        <thead><tr><th>Salarié</th><th>Demandée le</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Retenue / paie</th><th>Motif</th><th style={{ width: 170 }}></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ fontWeight: 500 }}>{r.first_name} {r.last_name}</td>
              <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(r.amount)} DH</td>
              <td style={{ textAlign: 'right' }}>{r.monthly_deduction ? `${fmt(r.monthly_deduction)} DH` : 'tout'}</td>
              <td>{r.reason ?? '—'}</td>
              <td>
                <div style={{ display: 'inline-flex', gap: 4 }}>
                  <button className="odoo-btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.6875rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    disabled={approve.isPending}
                    onClick={() => { if (confirm(`Verser ${fmt(r.amount)} DH en espèces à ${r.first_name} ${r.last_name} ?`)) approve.mutate({ id: r.id, method: 'cash' }); }}>
                    <Check size={11} /> Espèces
                  </button>
                  <button className="odoo-btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.6875rem' }} disabled={approve.isPending}
                    onClick={() => { if (confirm(`Verser ${fmt(r.amount)} DH par virement à ${r.first_name} ${r.last_name} ?`)) approve.mutate({ id: r.id, method: 'bank' }); }}>
                    Virement
                  </button>
                  <button className="odoo-pager-btn" title="Refuser" style={{ color: '#dc3545' }} disabled={reject.isPending}
                    onClick={() => { const note = prompt('Motif du refus (communiqué au salarié)'); if (note !== null) reject.mutate({ id: r.id, note: note || null }); }}>
                    <X size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
