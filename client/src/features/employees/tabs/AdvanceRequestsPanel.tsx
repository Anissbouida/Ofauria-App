import { money, currencySymbol } from '../../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, HandCoins, Landmark } from 'lucide-react';
import { advanceRequestsApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { RowMenu } from '../../../components/ui/RowMenu';
import { PromptDialog } from '../ui';

const fmt = (v: unknown) => (parseFloat(String(v ?? 0)) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Demandes d'avance faites par les salariés depuis leur espace : accorder
 * verse l'avance (paiement, écriture 3431, retenue sur les prochaines paies) ;
 * refuser la clôt avec un motif.
 */
export default function AdvanceRequestsPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [rejecting, setRejecting] = useState<Record<string, any> | null>(null);
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
    <StatusBanner tone="orange" icon={HandCoins} title={`${rows.length} demande(s) d'avance à traiter`}>
      <table className="odoo-table" style={{ marginTop: 6 }}>
        <thead><tr><th>Salarié</th><th>Demandée le</th><th className="ds-num">Montant ({currencySymbol()})</th><th className="ds-num">Retenue par paie ({currencySymbol()})</th><th>Motif</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="ds-strong">{r.first_name} {r.last_name}</td>
              <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
              <td className="ds-num ds-strong">{fmt(r.amount)}</td>
              <td className="ds-num">{r.monthly_deduction ? fmt(r.monthly_deduction) : 'tout'}</td>
              <td>{r.reason ?? '—'}</td>
              <td className="ds-actions">
                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={approve.isPending}
                  onClick={async () => {
                    if (!(await confirm(`Verser ${money(r.amount)} en espèces à ${r.first_name} ${r.last_name} ?`, { title: 'Accorder l\'avance', confirmLabel: 'Verser' }))) return;
                    approve.mutate({ id: r.id, method: 'cash' });
                  }}>
                  <Check size={13} aria-hidden="true" /> Verser en espèces
                </button>
                <RowMenu label={`Plus d'actions pour la demande de ${r.first_name} ${r.last_name}`} items={[
                  { label: 'Verser par virement', icon: Landmark, disabled: approve.isPending, onSelect: async () => {
                    if (!(await confirm(`Verser ${money(r.amount)} par virement à ${r.first_name} ${r.last_name} ?`, { title: 'Accorder l\'avance', confirmLabel: 'Verser' }))) return;
                    approve.mutate({ id: r.id, method: 'bank' });
                  } },
                  { label: 'Refuser', icon: X, danger: true, disabled: reject.isPending, onSelect: () => setRejecting(r) },
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rejecting && (
        <PromptDialog icon={HandCoins} crumb="Avance" title={`Refuser la demande de ${rejecting.first_name} ${rejecting.last_name}`}
          label="Motif du refus (communiqué au salarié)" confirmLabel="Refuser"
          onCancel={() => setRejecting(null)}
          onConfirm={note => { const id = rejecting.id as string; setRejecting(null); reject.mutate({ id, note: note || null }); }} />
      )}
    </StatusBanner>
  );
}
