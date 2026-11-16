import { useState } from 'react';
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { rejectedList, retryRejected, abandonRejected, type RejectedCheckout } from './offlineQueue';

/**
 * Ventes hors-ligne refusées par le serveur au moment de leur envoi (G0-21) : caisse
 * fermée, stock insuffisant, promotion épuisée… Elles ne bloquent plus les suivantes.
 * Le caissier corrige la cause puis renvoie la vente, ou l'abandonne avec un motif.
 */
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export default function OfflineRejectedModal({ onClose, onChanged }: {
  onClose: () => void;
  /** Appelé après un renvoi (la file doit être rejouée) ou un abandon. */
  onChanged: (action: 'retry' | 'abandon') => void;
}) {
  const [items, setItems] = useState<RejectedCheckout[]>(() => rejectedList());
  const [abandoning, setAbandoning] = useState<string | null>(null);
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
                    {r.meta.total != null && <span className="ml-2 tabular-nums">{r.meta.total.toFixed(2)} DH</span>}
                  </div>
                  <div className="text-xs text-gray-500">Réf. provisoire {key.slice(0, 8).toUpperCase()}</div>
                </div>
                {r.meta.summary && <p className="mt-1 text-xs text-gray-600">{r.meta.summary}</p>}
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">Refusée :</span> {r.reason}</p>

                {abandoning === key ? (
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
