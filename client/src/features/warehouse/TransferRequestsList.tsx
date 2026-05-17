import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Package, PackageOpen, AlertTriangle, X, CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { notify } from '../../components/ui/InlineNotification';

type TransferModalPayload = {
  ligneId: string;
  ingredientName: string;
  unit: string;
  requiredQty: number;
  economatAvailable: number;
  lotNumber?: string;
  lotDlc?: string;
  bonNumero: string;
};

/**
 * Liste auto-portee des transferts BSI Economat -> Pesage en attente.
 * Utilisable telle quelle dans n'importe quelle page (Pesage / Economat / Dashboard).
 * Inclut son propre fetching, sa mutation de transfert + le bouton "Tout transferer".
 *
 * Variant 'transfers-tab' = vue dediee onglet (avec bandeau intro). 'compact' = sans bandeau.
 */
export function TransferRequestsList({ variant = 'transfers-tab' }: { variant?: 'transfers-tab' | 'compact' }) {
  const queryClient = useQueryClient();
  const [transferringAll, setTransferringAll] = useState(false);
  // Modale de confirmation : permet au magasinier d'ajuster qty + saisir une note avant transfert.
  // Reproduit le geste existant du module Economat (OpenContainerModal).
  const [modalPayload, setModalPayload] = useState<TransferModalPayload | null>(null);

  const { data: rows = [], isLoading, error, isError } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-transfer-requests'],
    queryFn: bonSortieApi.transferRequests,
    refetchInterval: 20000,
    retry: 1,
  });

  // Apres transfert, on rafraichit aussi la liste des BSI et le stock pesage / economat
  // pour que toutes les vues qui dependent de ces donnees voient l'etat a jour.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['warehouse-transfer-requests'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
    queryClient.invalidateQueries({ queryKey: ['warehouse-pesage-stock'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['bons-sortie'] });
  };

  const transferLineMutation = useMutation({
    mutationFn: (vars: { ligneId: string; overrideQty?: number; overrideLotId?: string; reason?: string }) =>
      bonSortieApi.transferLineFromEconomat(vars.ligneId, {
        overrideQty: vars.overrideQty,
        overrideLotId: vars.overrideLotId,
        reason: vars.reason,
      }),
    onSuccess: () => {
      invalidateAll();
      setModalPayload(null);
      notify.success('Transfert Economat → Pesage effectue');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur transfert'),
  });

  // "Tout transferer" : raccourci batch qui transfere chaque ligne avec la qty exacte
  // demandee par le BSI (pas de modale, pas d'ajustement). Pour un transfert avec qty
  // ajustee, l'utilisateur clique "Transferer" sur chaque ligne et passe par la modale.
  const transferAll = async () => {
    if (rows.length === 0) return;
    if (!confirm(`Transferer les ${rows.length} ingredient(s) avec la quantite exacte du BSI ?\n\nPour ajuster une quantite (ex. ouvrir un contenant entier), utilise le bouton "Transferer" individuel.`)) return;
    setTransferringAll(true);
    let success = 0;
    let failed = 0;
    try {
      for (const req of rows) {
        try {
          await bonSortieApi.transferLineFromEconomat(req.line_id as string);
          success++;
        } catch {
          failed++;
        }
      }
      invalidateAll();
      if (failed === 0) notify.success(`${success} transfert(s) effectue(s)`);
      else notify(`${success} transferes, ${failed} erreur(s)`, { icon: '⚠️' });
    } finally {
      setTransferringAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-amber-500" />
      </div>
    );
  }
  if (isError) {
    const errMsg = (error as any)?.response?.data?.error || (error as any)?.message || 'Erreur inconnue';
    const status = (error as any)?.response?.status;
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm">
        <div className="flex items-start gap-2 text-red-800 font-semibold mb-1">
          <AlertTriangle size={16} /> Impossible de charger les transferts
        </div>
        <p className="text-red-700 text-xs">
          {status ? `[${status}] ` : ''}{errMsg}
        </p>
        {status === 404 && (
          <p className="text-red-600 text-xs mt-2">
            La route API n'existe pas — le serveur backend doit etre redemarre pour prendre en compte la nouvelle route.
          </p>
        )}
        {status === 403 && (
          <p className="text-red-600 text-xs mt-2">
            Permission refusee — l'acces a cette liste est reserve aux roles magasinier / admin / manager.
          </p>
        )}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-dashed border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
        <PackageOpen size={28} className="mx-auto mb-2 text-gray-300" />
        Aucun transfert demande pour le moment.
      </div>
    );
  }

  // Groupage par BSI pour faciliter la lecture quand plusieurs lignes du meme bon attendent.
  const groups = new Map<string, { bon_numero: string; plan_date?: string; plan_type?: string; bon_status: string; lines: Record<string, any>[] }>();
  for (const r of rows) {
    const key = r.bon_id as string;
    if (!groups.has(key)) {
      groups.set(key, {
        bon_numero: r.bon_numero as string,
        plan_date: r.plan_date as string | undefined,
        plan_type: r.plan_type as string | undefined,
        bon_status: r.bon_status as string,
        lines: [],
      });
    }
    groups.get(key)!.lines.push(r);
  }

  const isTransferring = transferLineMutation.isPending;
  const pendingLineId = transferLineMutation.variables as string | undefined;

  return (
    <div className="space-y-4">
      {variant === 'transfers-tab' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <PackageOpen size={18} className="text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">
              {rows.length} ingredient{rows.length > 1 ? 's' : ''} a transferer de l'economat vers le pesage
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Le magasinier valide ici les transferts demandes par les BSI actifs.
              Le stock economat est decremente et le pesage incremente — le BSI lie peut ensuite etre marque pret.
            </p>
          </div>
          <button
            onClick={transferAll}
            disabled={transferringAll || isTransferring}
            className="px-3.5 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 transition-colors flex items-center gap-1.5 shrink-0 shadow-sm"
          >
            {transferringAll ? <Loader2 size={13} className="animate-spin" /> : <PackageOpen size={13} />}
            {transferringAll ? 'Transfert...' : `Tout transferer (${rows.length})`}
          </button>
        </div>
      )}

      {Array.from(groups.entries()).map(([bonId, g]) => (
        <div key={bonId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Package size={14} className="text-gray-400" />
              <span className="font-mono text-xs text-gray-600">{g.bon_numero}</span>
              <span className="text-gray-300">·</span>
              <span className="font-semibold text-gray-700">
                Plan du {g.plan_date ? format(new Date(g.plan_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </span>
              {g.plan_type && (
                <span className="text-[10px] uppercase tracking-wide text-gray-400">{g.plan_type}</span>
              )}
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              {g.bon_status}
            </span>
          </div>
          <div className="divide-y divide-gray-100">
            {g.lines.map((l) => {
              const ligneId = l.line_id as string;
              const qty = parseFloat(l.transfer_required_qty as string || '0');
              const unit = (l.unit || l.ingredient_unit || 'kg') as string;
              const economatAvailable = parseFloat(l.suggested_lot_economat_qty as string || '0');
              const isPending = isTransferring && pendingLineId === ligneId;
              const insufficient = economatAvailable < qty;
              return (
                <div key={ligneId} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <PackageOpen size={14} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {l.ingredient_name as string}
                    </p>
                    <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 mt-0.5">
                      <span className="font-mono text-amber-700 font-semibold">
                        {qty.toFixed(2)} {unit}
                      </span>
                      {l.suggested_lot_number && (
                        <span className="text-gray-400">
                          lot <span className="font-mono">{l.suggested_lot_number as string}</span>
                        </span>
                      )}
                      <span className="text-gray-400">
                        dispo economat : <span className="font-mono">{economatAvailable.toFixed(2)} {unit}</span>
                      </span>
                      {insufficient && (
                        <span className="text-red-600 font-semibold inline-flex items-center gap-1">
                          <AlertTriangle size={11} /> insuffisant
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setModalPayload({
                      ligneId,
                      ingredientName: l.ingredient_name as string,
                      unit,
                      requiredQty: qty,
                      economatAvailable,
                      lotNumber: l.suggested_lot_number as string | undefined,
                      lotDlc: l.suggested_lot_dlc as string | undefined,
                      bonNumero: g.bon_numero,
                    })}
                    disabled={isPending || transferringAll || insufficient}
                    className="px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1 text-xs font-semibold shrink-0 shadow-sm"
                    title={insufficient ? 'Stock economat insuffisant' : 'Confirmer le transfert'}
                  >
                    {isPending ? <Loader2 size={12} className="animate-spin" /> : <PackageOpen size={12} />}
                    Transferer
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {modalPayload && (
        <BsiTransferModal
          payload={modalPayload}
          onClose={() => setModalPayload(null)}
          onConfirm={(qty, reason, overrideLotId) => transferLineMutation.mutate({
            ligneId: modalPayload.ligneId,
            overrideQty: qty,
            overrideLotId,
            reason,
          })}
          isLoading={transferLineMutation.isPending}
        />
      )}
    </div>
  );
}

/**
 * Modale de confirmation de transfert. Affiche le contexte (ingredient / lot / DLC / BSI),
 * permet d'ajuster la qty (defaut = besoin BSI), de saisir une note et de selectionner
 * un lot alternatif au lot suggere par le FEFO (delta v1 point 4).
 */
function BsiTransferModal({ payload, onClose, onConfirm, isLoading }: {
  payload: TransferModalPayload;
  onClose: () => void;
  onConfirm: (qty: number, reason?: string, overrideLotId?: string) => void;
  isLoading: boolean;
}) {
  // Delta v1 point 4 : chargement de la liste FEFO des lots Economat dispo pour cette ligne.
  // Le magasinier confirme le suggere ou en choisit un autre. La qty max et la DLC sont
  // recalculees dynamiquement en fonction du lot selectionne.
  const { data: economatLots = [], isLoading: lotsLoading } = useQuery<Record<string, any>[]>({
    queryKey: ['bsi-line-economat-lots', payload.ligneId],
    queryFn: () => bonSortieApi.economatLotsForLigne(payload.ligneId),
  });
  // Lot selectionne : initialement le suggere (premier de la liste FEFO).
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const selectedLot = economatLots.find(l => (l.id as string) === selectedLotId) || economatLots.find(l => l.is_suggested) || economatLots[0];
  const effectiveLotId = (selectedLot?.id as string | undefined) || null;
  const effectiveAvailable = parseFloat((selectedLot?.economat_quantity as string) || '0') || payload.economatAvailable;
  const effectiveLotNumber = (selectedLot?.lot_number as string) || payload.lotNumber;
  const effectiveDlc = (selectedLot?.expiration_date as string) || payload.lotDlc;
  const isOverride = !!selectedLot && !selectedLot.is_suggested;

  const [quantity, setQuantity] = useState<string>(payload.requiredQty.toFixed(2));
  const [note, setNote] = useState<string>('');
  const qty = parseFloat(quantity);
  const isValid = !isNaN(qty)
    && qty >= payload.requiredQty
    && qty <= effectiveAvailable
    && !!effectiveLotId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="bg-amber-500 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <PackageOpen size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Transfert Économat → Pesage</h2>
              <p className="text-sm text-white/80">{payload.ingredientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-amber-700">BSI</span>
              <span className="font-mono font-semibold">{payload.bonNumero}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-amber-700">Besoin BSI</span>
              <span className="font-mono font-semibold">{payload.requiredQty.toFixed(2)} {payload.unit}</span>
            </div>
          </div>

          {/* Delta v1 point 4 : selecteur de lot FEFO. Le lot suggere est presente en premier
              (marque par is_suggested). Le magasinier peut le confirmer ou en choisir un autre. */}
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
              Lot a transferer {lotsLoading && <Loader2 size={11} className="inline animate-spin ml-1" />}
            </label>
            {economatLots.length === 0 && !lotsLoading && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                Aucun lot Economat actif pour cet ingredient.
              </div>
            )}
            {economatLots.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {economatLots.map((lot) => {
                  const lotId = lot.id as string;
                  const isSelected = effectiveLotId === lotId;
                  const lotEconomat = parseFloat(lot.economat_quantity as string || '0');
                  const lotInsufficient = lotEconomat < payload.requiredQty;
                  return (
                    <button
                      key={lotId}
                      type="button"
                      onClick={() => setSelectedLotId(lotId)}
                      disabled={lotInsufficient}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-2 ${
                        isSelected
                          ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300'
                          : 'bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50'
                      } ${lotInsufficient ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-gray-800">
                            {(lot.lot_number as string) || (lot.supplier_lot_number as string) || lotId.slice(0, 8)}
                          </span>
                          {lot.is_suggested && (
                            <span className="text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                              Suggéré FEFO
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                          {lot.expiration_date && (
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock size={10} />
                              DLC {format(new Date(lot.expiration_date as string), 'dd/MM/yyyy')}
                            </span>
                          )}
                          <span className="text-gray-400">·</span>
                          <span>{lotEconomat.toFixed(2)} {payload.unit} dispo</span>
                          {lotInsufficient && (
                            <span className="text-red-600 font-semibold">insuffisant</span>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 6.5 5 9 10 3.5"/></svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {isOverride && (
              <p className="text-[11px] text-amber-700 mt-1.5 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                ⚠ Lot different du suggere FEFO : la raison sera tracee dans l'audit.
              </p>
            )}
            {effectiveDlc && (
              <p className="text-[11px] text-gray-500 mt-1.5">
                DLC du lot selectionne : <strong>{format(new Date(effectiveDlc), 'dd/MM/yyyy')}</strong> · Dispo : <strong>{effectiveAvailable.toFixed(2)} {payload.unit}</strong>
              </p>
            )}
            {/* Garde-fou : eviter "unused var" warnings sur effectiveLotNumber (utilisable pour debug). */}
            <span className="hidden">{effectiveLotNumber}</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
              Quantité à transférer
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.01" min={payload.requiredQty} max={effectiveAvailable}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none font-mono text-right"
              />
              <span className="text-sm text-gray-500 font-medium">{payload.unit}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              Doit être ≥ {payload.requiredQty.toFixed(2)} (besoin BSI) et ≤ {effectiveAvailable.toFixed(2)} (dispo du lot sélectionné).
              Tu peux transférer plus si tu ouvres un contenant entier — le surplus restera au pesage.
            </p>
            {qty < payload.requiredQty && (
              <p className="text-xs text-red-600 mt-1">Inférieur au besoin BSI ({payload.requiredQty.toFixed(2)}).</p>
            )}
            {qty > effectiveAvailable && (
              <p className="text-xs text-red-600 mt-1">Dépasse la quantité dispo sur ce lot ({effectiveAvailable.toFixed(2)}).</p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5 block">
              Note (optionnelle)
            </label>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ex : Ouverture nouveau sac, contenant entamé..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 outline-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              disabled={isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-gray-700 font-medium bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-60">
              Annuler
            </button>
            <button onClick={() => onConfirm(qty, note.trim() || undefined, isOverride ? (effectiveLotId || undefined) : undefined)}
              disabled={!isValid || isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl text-white font-medium bg-amber-600 hover:bg-amber-700 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <PackageOpen size={14} />}
              {isLoading ? 'Transfert...' : 'Confirmer le transfert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
