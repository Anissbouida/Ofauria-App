import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { openingInventoryCheckApi } from '../../api/opening-inventory-check.api';

const REASON_LABELS: Record<string, string> = {
  theft: 'Vol',
  breakage: 'Casse',
  forgotten_recycle: 'Recyclage oublié',
  undeclared_loss: 'Perte non déclarée',
  measurement_error: 'Erreur de comptage',
  other: 'Autre',
};

export default function InventoryCheckValidationPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const { data: pendingChecks = [], isLoading } = useQuery({
    queryKey: ['opening-checks-awaiting'],
    queryFn: () => openingInventoryCheckApi.listAwaitingValidation(),
  });

  const { data: detail } = useQuery({
    queryKey: ['opening-check-detail', selectedId],
    queryFn: () => openingInventoryCheckApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  const validateMutation = useMutation({
    mutationFn: (data: { id: string; action: 'approve' | 'reject'; rejectionReason?: string }) =>
      openingInventoryCheckApi.validate(data.id, {
        action: data.action,
        rejectionReason: data.rejectionReason,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['opening-checks-awaiting'] });
      setSelectedId(null);
      setRejectionReason('');
      setActionMsg({
        type: 'success',
        text: variables.action === 'approve' ? 'Contrôle validé.' : 'Contrôle rejeté.',
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erreur';
      setActionMsg({ type: 'error', text: message });
    },
  });

  const handleApprove = () => {
    if (!selectedId) return;
    validateMutation.mutate({ id: selectedId, action: 'approve' });
  };
  const handleReject = () => {
    if (!selectedId) return;
    if (!rejectionReason.trim()) {
      setActionMsg({ type: 'error', text: 'Motif de rejet requis.' });
      return;
    }
    validateMutation.mutate({ id: selectedId, action: 'reject', rejectionReason });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-2">
          <Shield size={28} /> Validation des contrôles d'inventaire d'ouverture
        </h1>
        <p className="text-gray-600">
          Approuvez ou rejetez les contrôles soumis par les caissières en cas d'écart.
        </p>
      </div>

      {actionMsg && (
        <div
          className={`mb-4 p-4 rounded-xl border ${
            actionMsg.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Liste */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold">En attente ({pendingChecks.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {isLoading && <div className="p-4 text-gray-500">Chargement...</div>}
            {!isLoading && pendingChecks.length === 0 && (
              <div className="p-8 text-center text-gray-500">Aucun contrôle en attente.</div>
            )}
            {pendingChecks.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left p-4 hover:bg-amber-50 flex items-center justify-between ${
                  selectedId === c.id ? 'bg-amber-50' : ''
                }`}
              >
                <div>
                  <div className="font-semibold">
                    {c.checked_by_first} {c.checked_by_last}
                  </div>
                  <div className="text-xs text-gray-500">
                    {format(new Date(c.created_at), 'dd MMM yyyy à HH:mm', { locale: fr })}
                  </div>
                  <div className="text-sm mt-1">
                    <span className="text-red-600 font-bold">{c.discrepancy_lines}</span> ligne(s) en
                    écart · Total{' '}
                    <span className={c.total_discrepancy < 0 ? 'text-red-600' : 'text-blue-600'}>
                      {c.total_discrepancy > 0 ? '+' : ''}
                      {c.total_discrepancy}
                    </span>
                  </div>
                </div>
                <ChevronRight className="text-gray-400" size={20} />
              </button>
            ))}
          </div>
        </div>

        {/* Détail */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {!selectedId && (
            <div className="p-8 text-center text-gray-500">
              Sélectionnez un contrôle pour voir le détail.
            </div>
          )}
          {selectedId && detail && (
            <>
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h2 className="font-semibold">Détail</h2>
              </div>
              <div className="p-4">
                <table className="w-full text-sm mb-4">
                  <thead className="text-xs uppercase text-gray-600 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-2">Produit</th>
                      <th className="text-center py-2">Att.</th>
                      <th className="text-center py-2">Compté</th>
                      <th className="text-center py-2">Écart</th>
                      <th className="text-left py-2">Raison</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.items?.map((it: any) => (
                      <tr key={it.id} className={it.discrepancy !== 0 ? 'bg-amber-50' : ''}>
                        <td className="py-2">{it.product_name}</td>
                        <td className="py-2 text-center">{it.expected_qty}</td>
                        <td className="py-2 text-center font-bold">{it.found_qty}</td>
                        <td
                          className={`py-2 text-center font-bold ${
                            it.discrepancy < 0
                              ? 'text-red-600'
                              : it.discrepancy > 0
                              ? 'text-blue-600'
                              : ''
                          }`}
                        >
                          {it.discrepancy > 0 ? '+' : ''}
                          {it.discrepancy}
                        </td>
                        <td className="py-2 text-xs">
                          {it.missing_reason ? REASON_LABELS[it.missing_reason] : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {detail.notes && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                    <strong>Notes :</strong> {detail.notes}
                  </div>
                )}

                <div className="space-y-3">
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Motif de rejet (requis si vous rejetez)..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReject}
                      disabled={validateMutation.isPending}
                      className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <XCircle size={18} /> Rejeter
                    </button>
                    <button
                      onClick={handleApprove}
                      disabled={validateMutation.isPending}
                      className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={18} /> Approuver
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
