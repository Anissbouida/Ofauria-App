import { money } from '../../utils/money';
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import {
  rejectedList, retryRejected, abandonRejected, correctRejected, CORRECTABLE_PAYMENTS,
  type RejectedCheckout, type CorrectablePayment,
} from './offlineQueue';

/**
 * Ventes hors-ligne refusées par le serveur au moment de leur envoi (G0-21) : caisse
 * fermée, stock insuffisant, promotion épuisée… Elles ne bloquent plus les suivantes.
 * Le caissier corrige la cause puis renvoie la vente, ou l'abandonne avec un motif.
 * Il peut aussi corriger le CONTENU avant renvoi (quantités, lignes retirées, moyen de
 * paiement, code promo) ; l'abandon remonte au serveur (journal de la direction).
 */
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export default function OfflineRejectedModal({ onClose, onChanged }: {
  onClose: () => void;
  /** Appelé après un renvoi (la file doit être rejouée) ou un abandon. */
  onChanged: (action: 'retry' | 'abandon') => void;
}) {
  const [items, setItems] = useState<RejectedCheckout[]>(() => rejectedList());
  const [abandoning, setAbandoning] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => setItems(rejectedList());

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="offline-rejected-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-gray-100 px-6 py-4">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-red-600" />
          <div className="flex-1">
            <h2 id="offline-rejected-title" className="text-base font-bold text-gray-900">Ventes hors ligne à traiter</h2>
            <p className="mt-1 text-sm text-gray-600">
              Ces ventes ont été encaissées hors ligne, mais le serveur les a refusées. Corrigez la cause (rouvrir la caisse, saisir le stock…)
              puis renvoyez-les, ou abandonnez-les avec un motif.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {items.length === 0 && <p className="py-6 text-center text-sm text-gray-500">Aucune vente à traiter.</p>}
          {items.map(r => {
            const key = String(r.payload.idempotencyKey);
            return (
              <div key={key} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900">
                    Vente du {when(r.meta.queuedAt)}
                    {r.meta.total != null && <span className="ml-2 tabular-nums">{money(r.meta.total)}</span>}
                  </div>
                  <div className="text-xs text-gray-500">Réf. provisoire {key.slice(0, 8).toUpperCase()}</div>
                </div>
                {r.meta.summary && <p className="mt-1 text-xs text-gray-600">{r.meta.summary}</p>}
                {r.meta.correctedAt && (
                  <p className="mt-1 text-xs text-amber-700">Corrigée le {when(r.meta.correctedAt)}{r.meta.originalSummary ? ` · avant : ${r.meta.originalSummary}` : ''}</p>
                )}
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">Refusée :</span> {r.reason}</p>

                {correcting === key ? (
                  <CorrectionForm item={r} onCancel={() => setCorrecting(null)} onSent={() => {
                    setCorrecting(null); refresh(); onChanged('retry');
                  }} />
                ) : abandoning === key ? (
                  <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => {
                    e.preventDefault();
                    if (reason.trim().length < 3) return;
                    abandonRejected(key, reason.trim());
                    setAbandoning(null); setReason(''); refresh(); onChanged('abandon');
                  }}>
                    <input autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={200} aria-label="Motif de l'abandon"
                      placeholder="Motif de l'abandon (obligatoire)"
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200" />
                    <button type="submit" disabled={reason.trim().length < 3}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Abandonner la vente</button>
                    <button type="button" onClick={() => { setAbandoning(null); setReason(''); }}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Annuler</button>
                  </form>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => { retryRejected(key); refresh(); onChanged('retry'); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                      <RotateCcw size={14} /> Renvoyer
                    </button>
                    <button type="button" onClick={() => { setCorrecting(key); setAbandoning(null); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                      <Pencil size={14} /> Corriger
                    </button>
                    <button type="button" onClick={() => { setAbandoning(key); setReason(''); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                      <Trash2 size={14} /> Abandonner
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Fermer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

const PAYMENT_LABELS: Record<CorrectablePayment, string> = { cash: 'Espèces', card: 'Carte', mobile: 'Paiement mobile', check: 'Chèque', mixed: 'Mixte (espèces + carte)' };
const inputCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200';

/**
 * Correction du contenu d'une vente refusée, puis renvoi (G0-21). Ce qui est contrôlé
 * localement est dans `applyCorrection` (offlineQueue.ts) ; le serveur revérifie tout.
 */
function CorrectionForm({ item, onCancel, onSent }: { item: RejectedCheckout; onCancel: () => void; onSent: () => void }) {
  const key = String(item.payload.idempotencyKey);
  const saleItems = (Array.isArray(item.payload.items) ? item.payload.items : []) as { productId?: string; quantity?: number }[];
  const unpaid = item.payload.paymentStatus === 'unpaid';
  const [rows, setRows] = useState(() => saleItems.map((it, index) => ({ index, keep: true, quantity: String(it.quantity ?? '') })));
  const currentPm = String(item.payload.paymentMethod ?? 'cash');
  const [pm, setPm] = useState<string>(currentPm);
  const [cash, setCash] = useState(item.payload.cashAmount != null ? String(item.payload.cashAmount) : '');
  const [card, setCard] = useState(item.payload.cardAmount != null ? String(item.payload.cardAmount) : '');
  const hasCoupon = Boolean(item.payload.couponCode);
  const [removeCoupon, setRemoveCoupon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = correctRejected(key, {
      items: rows.filter(r => r.keep).map(r => ({ index: r.index, quantity: num(r.quantity) })),
      paymentMethod: !unpaid && (CORRECTABLE_PAYMENTS as readonly string[]).includes(pm) ? pm as CorrectablePayment : undefined,
      cashAmount: pm === 'mixed' ? num(cash) : undefined,
      cardAmount: pm === 'mixed' ? num(card) : undefined,
      removeCoupon,
    });
    if (err) { setError(err); return; }
    retryRejected(key);
    onSent();
  };

  return (
    <form className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3" onSubmit={submit}>
      <div className="space-y-2">
        {rows.map((row, i) => {
          const line = item.meta.lines?.[row.index];
          const unitLabel = line?.unit === 'g' ? 'g' : line?.unit === 'person' ? 'pers' : '×';
          return (
            <div key={row.index} className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-800">
                <input type="checkbox" checked={row.keep} aria-label={`Garder ${line?.name || `la ligne ${row.index + 1}`}`}
                  onChange={e => setRows(rs => rs.map((r, j) => (j === i ? { ...r, keep: e.target.checked } : r)))} />
                <span className={row.keep ? 'truncate' : 'truncate text-gray-400 line-through'}>
                  {line?.name || `Article ${String(saleItems[row.index]?.productId ?? '').slice(0, 8)}`}
                </span>
              </label>
              <input inputMode="decimal" value={row.quantity} disabled={!row.keep} aria-label={`Quantité de ${line?.name || `la ligne ${row.index + 1}`}`}
                onChange={e => setRows(rs => rs.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))}
                className={`${inputCls} w-24 text-right tabular-nums disabled:opacity-50`} />
              <span className="w-8 text-xs text-gray-500">{unitLabel}</span>
            </div>
          );
        })}
      </div>

      {unpaid ? (
        <p className="text-xs text-gray-600">Vente non encaissée (à crédit) : le moyen de paiement ne se corrige pas.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-700" htmlFor={`pm-${key}`}>Paiement</label>
          <select id={`pm-${key}`} value={pm} onChange={e => setPm(e.target.value)} className={inputCls}>
            {!(CORRECTABLE_PAYMENTS as readonly string[]).includes(currentPm) && <option value={currentPm}>{currentPm}</option>}
            {CORRECTABLE_PAYMENTS.map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
          </select>
          {pm === 'mixed' && (
            <>
              <input inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} placeholder="Espèces" aria-label="Part espèces" className={`${inputCls} w-24 text-right`} />
              <input inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} placeholder="Carte" aria-label="Part carte" className={`${inputCls} w-24 text-right`} />
            </>
          )}
        </div>
      )}

      {hasCoupon && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={removeCoupon} onChange={e => setRemoveCoupon(e.target.checked)} />
          Retirer le code promo « {String(item.payload.couponCode)} »
        </label>
      )}

      <p className="text-xs text-gray-500">Le serveur recalcule le total (prix, promotions) au renvoi. La référence provisoire du ticket client reste la même.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700">
          <RotateCcw size={14} /> Enregistrer et renvoyer
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Annuler</button>
      </div>
    </form>
  );
}
