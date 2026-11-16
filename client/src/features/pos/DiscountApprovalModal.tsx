import { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Validation d'une remise au-delà du plafond du caissier (G0-19) : un responsable
 * (gérant ou administrateur) se désigne et saisit son code PIN. Le code n'est jamais
 * gardé : il part avec la vente et le serveur le vérifie.
 */
export interface DiscountApprover { id: string; first_name: string; last_initial: string; role: string; pin_length: number | null }

export default function DiscountApprovalModal({ pct, maxPct, approvers, pending, error, onSubmit, onClose }: {
  pct: number;
  maxPct: number;
  approvers: DiscountApprover[];
  pending: boolean;
  error?: string | null;
  onSubmit: (approval: { userId: string; pinCode: string }) => void;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState(approvers.length === 1 ? approvers[0].id : '');
  const [pin, setPin] = useState('');
  const ready = !!userId && /^\d{4,10}$/.test(pin);

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="discount-approval-title"
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onSubmit={e => { e.preventDefault(); if (ready && !pending) onSubmit({ userId, pinCode: pin }); }}>
        <div className="flex items-start gap-3 border-b border-gray-100 px-6 py-4">
          <ShieldCheck size={22} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <h2 id="discount-approval-title" className="text-base font-bold text-gray-900">Validation d'un responsable</h2>
            <p className="mt-1 text-sm text-gray-600">
              Remise de <span className="font-semibold">{pct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</span>, au-delà
              de votre plafond de <span className="font-semibold">{maxPct.toLocaleString('fr-FR')} %</span>.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-6 py-4">
          {approvers.length === 0 ? (
            <p className="text-sm text-red-600">Aucun responsable n'a de code PIN. Réduisez la remise, ou demandez à un administrateur de définir un PIN.</p>
          ) : (
            <>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Responsable</p>
                <div className="flex flex-wrap gap-2">
                  {approvers.map(a => (
                    <button key={a.id} type="button" onClick={() => { setUserId(a.id); setPin(''); }} aria-pressed={userId === a.id}
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${userId === a.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                      {a.first_name} {a.last_initial}.
                      <span className="ml-1 text-xs font-normal text-gray-500">{a.role === 'admin' ? 'Administrateur' : 'Gérant'}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Code PIN du responsable</span>
                <input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} maxLength={10}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-[0.4em] focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200" />
              </label>
            </>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Annuler</button>
          <button type="submit" disabled={!ready || pending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {pending ? 'Vérification…' : 'Valider la remise'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}
