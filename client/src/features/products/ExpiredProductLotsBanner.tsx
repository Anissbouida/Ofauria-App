import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, X, HelpCircle } from 'lucide-react';
import { productLotApi } from '../../api/product-lot.api';
import { notify } from '../../components/ui/InlineNotification';

type Item = Record<string, any> & { kind?: 'lot' | 'orphan' };

export default function ExpiredProductLotsBanner() {
  const qc = useQueryClient();
  const [dialogItem, setDialogItem] = useState<Item | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['product-lots-expired-active'],
    queryFn: productLotApi.expiredActive,
    refetchInterval: 60_000,
  });

  const handleSuccess = (data: unknown) => {
    const d = data as { lostQuantity: number; lostValue: number; reasonLabel: string };
    notify.success(
      `Envoyé aux pertes : ${d.lostQuantity.toFixed(2)} u (${d.lostValue.toFixed(2)} DH) — ${d.reasonLabel}`
    );
    qc.invalidateQueries({ queryKey: ['product-lots-expired-active'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    setDialogItem(null);
  };
  const handleError = (err: unknown) => {
    const e = err as { response?: { data?: { error?: { message?: string } } } };
    notify.error(e?.response?.data?.error?.message || 'Erreur');
  };

  const sendLotMutation = useMutation({
    mutationFn: ({ lotId, reason, note }: { lotId: string; reason: string; note?: string }) =>
      productLotApi.sendToLosses(lotId, reason, note),
    onSuccess: handleSuccess,
    onError: handleError,
  });
  const sendOrphanMutation = useMutation({
    mutationFn: ({ productId, reason, note }: { productId: string; reason: string; note?: string }) =>
      productLotApi.sendOrphanToLosses(productId, reason, note),
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const list = items as Item[];
  if (list.length === 0) return null;

  const lotCount = list.filter(i => i.kind !== 'orphan').length;
  const orphanCount = list.filter(i => i.kind === 'orphan').length;

  return (
    <>
      <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-2xl p-4 shadow-sm">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center shrink-0 animate-pulse">
            <AlertTriangle size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-base font-bold text-red-900">
              {list.length} produit{list.length > 1 ? 's' : ''} à régulariser
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              {lotCount > 0 && <>{lotCount} lot{lotCount > 1 ? 's' : ''} expiré{lotCount > 1 ? 's' : ''} (DLC ou exposition dépassée)</>}
              {lotCount > 0 && orphanCount > 0 && ' · '}
              {orphanCount > 0 && <>{orphanCount} stock{orphanCount > 1 ? 's' : ''} non tracé{orphanCount > 1 ? 's' : ''} (sans lot actif)</>}
              {' '}— à envoyer aux pertes.
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-red-200 divide-y divide-red-50 max-h-80 overflow-y-auto">
          {list.map((item) => {
            const isOrphan = item.kind === 'orphan';
            const totalQty = parseFloat(item.total_qty as string) || 0;
            const unitCost = parseFloat(item.cost_price as string) || 0;
            const lostValue = totalQty * unitCost;
            const vitrineQty = parseFloat(item.vitrine_qty as string) || 0;
            const backroomQty = parseFloat(item.backroom_qty as string) || 0;
            const reason = item.expiry_reason as string | undefined;
            const daysExpired = item.days_expired as number | undefined;
            const lastProducedRaw = item.last_lot_produced_at as string | null | undefined;
            const lastProduced = lastProducedRaw ? new Date(lastProducedRaw).toLocaleDateString('fr-FR') : null;

            return (
              <div key={`${item.kind}-${item.id as string}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-red-50/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 truncate">{item.product_name as string}</span>
                    {isOrphan ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                        <HelpCircle size={10} /> Stock sans lot
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] font-mono text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                          {(item.lot_number as string) || '?'}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          reason === 'dlv_expired' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {reason === 'dlv_expired' ? 'Exposition vitrine dépassée' : 'DLC expirée'}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {isOrphan ? (
                      <>
                        Stock non tracé par lot
                        {lastProduced && <> · Dernier lot produit : <strong>{lastProduced}</strong></>}
                        <span className="ml-2">Vitrine : {vitrineQty.toFixed(0)}u</span>
                        <span className="ml-2">Réserve : {backroomQty.toFixed(0)}u</span>
                      </>
                    ) : (
                      <>
                        Expiré depuis <strong className="text-red-600">{daysExpired}j</strong> ·
                        <span className="ml-1">Vitrine : {vitrineQty.toFixed(0)}u</span>
                        <span className="ml-2">Réserve : {backroomQty.toFixed(0)}u</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-red-700">{totalQty.toFixed(0)} u</div>
                  <div className="text-[10px] text-gray-500">{lostValue.toFixed(2)} DH perdus</div>
                </div>
                <button
                  onClick={() => setDialogItem(item)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 shrink-0">
                  <Trash2 size={12} /> Envoyer aux pertes
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {dialogItem && (
        <SendToLossesDialog
          item={dialogItem}
          isPending={sendLotMutation.isPending || sendOrphanMutation.isPending}
          onClose={() => setDialogItem(null)}
          onConfirm={(reason, note) => {
            if (dialogItem.kind === 'orphan') {
              sendOrphanMutation.mutate({
                productId: dialogItem.product_id as string, reason, note,
              });
            } else {
              sendLotMutation.mutate({
                lotId: dialogItem.id as string, reason, note,
              });
            }
          }}
        />
      )}
    </>
  );
}

function SendToLossesDialog({ item, isPending, onClose, onConfirm }: {
  item: Item;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string, note?: string) => void;
}) {
  const isOrphan = item.kind === 'orphan';
  const initialReason = (item.expiry_reason as string) || (isOrphan ? 'dlv_expired' : 'dlc_expired');
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState('');

  const totalQty = parseFloat(item.total_qty as string) || 0;
  const unitCost = parseFloat(item.cost_price as string) || 0;
  const lostValue = totalQty * unitCost;
  const vitrineQty = parseFloat(item.vitrine_qty as string) || 0;
  const backroomQty = parseFloat(item.backroom_qty as string) || 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-red-100 bg-gradient-to-r from-red-50 to-orange-50 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-red-900">Envoyer aux pertes</h3>
            <p className="text-xs text-red-700 mt-0.5">
              {isOrphan
                ? 'Stock non tracé par lot — sera retiré du compteur global.'
                : 'Action irréversible — le lot sera retiré du stock.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-red-100 rounded-lg">
            <X size={18} className="text-red-700" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Produit</span>
              <span className="font-semibold text-gray-900">{item.product_name as string}</span>
            </div>
            {!isOrphan && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">N° lot</span>
                <span className="font-mono text-xs text-gray-700">{(item.lot_number as string) || '?'}</span>
              </div>
            )}
            {isOrphan && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Origine</span>
                <span className="text-xs text-amber-700 font-semibold">Stock sans lot actif</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Stock à retirer</span>
              <span className="font-bold text-red-700">
                {totalQty.toFixed(0)} u
                <span className="text-xs text-gray-400 ml-1">
                  ({vitrineQty > 0 ? `${vitrineQty.toFixed(0)} vitrine` : ''}
                  {vitrineQty > 0 && backroomQty > 0 ? ' + ' : ''}
                  {backroomQty > 0 ? `${backroomQty.toFixed(0)} réserve` : ''})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-gray-200">
              <span className="text-gray-500">Valeur perdue</span>
              <span className="font-bold text-red-700">{lostValue.toFixed(2)} DH</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Motif</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: 'dlc_expired', label: 'DLC expirée', sub: 'Date de péremption' },
                { v: 'dlv_expired', label: 'Exposition dépassée', sub: 'Durée d\'exposition vitrine' },
                { v: 'damaged', label: 'Endommagé', sub: 'Casse, contamination' },
                { v: 'quarantine_failed', label: 'Échec contrôle', sub: 'Non conforme' },
              ] as const).map(opt => (
                <button key={opt.v} type="button" onClick={() => setReason(opt.v)}
                  className={`px-3 py-2 rounded-lg border text-left transition-all ${
                    reason === opt.v
                      ? 'border-red-400 bg-red-50 ring-2 ring-red-200'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                  <div className="text-sm font-semibold text-gray-900">{opt.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Note (optionnel)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="Détails additionnels..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={isPending}
              className="flex-1 py-2.5 px-4 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200">
              Annuler
            </button>
            <button onClick={() => onConfirm(reason, note || undefined)}
              disabled={isPending}
              className="flex-1 py-2.5 px-4 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {isPending ? 'Envoi...' : <><Trash2 size={14} /> Confirmer l&apos;envoi aux pertes</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
