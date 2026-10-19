import { useState } from 'react';
import { Check, X, HandCoins } from 'lucide-react';

/* ═══════════════════════ PAY DIALOG (méthode + retenue d'avance) ═══════════════════════ */
/**
 * Dialogue de paiement commun mensuel/hebdo : choix du mode de règlement +
 * proposition de retenue sur les avances en cours de l'employé.
 * `suggested` = retenue proposée : suit le plan d'étalement de chaque avance
 * (monthly_deduction) si défini, sinon tout le solde. Toujours plafonnée au
 * net dû, et modifiable librement au moment du paiement.
 */
export default function PayrollPayDialog({ employeeName, periodLabel, net, outstanding, suggested, defaultMethod, pending, onClose, onConfirm }: {
  employeeName: string;
  periodLabel: string;
  net: number;
  outstanding: number;
  suggested: number;
  defaultMethod: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (method: string, deduction: number) => void;
}) {
  const maxDeduction = Math.min(outstanding, net);
  const proposed = Math.min(suggested, maxDeduction);
  const hasPlan = suggested < outstanding - 0.005;
  const [method, setMethod] = useState(defaultMethod);
  const [deduction, setDeduction] = useState<string>(proposed > 0 ? proposed.toFixed(2) : '0');
  const ded = Math.max(0, parseFloat(deduction) || 0);
  const cashOut = Math.max(0, Math.round((net - ded) * 100) / 100);
  const invalid = ded > maxDeduction + 0.005;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={ev => ev.stopPropagation()}>
        <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Payer {employeeName}</h2>
            <p className="text-teal-100 text-sm">{periodLabel}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-500">Net dû</span>
            <span className="text-lg font-bold">{net.toFixed(2)} DH</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode de paiement</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="cash">Espèces</option>
              <option value="bank">Virement</option>
              <option value="check">Chèque</option>
            </select>
          </div>

          {outstanding > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-sm text-amber-800">
                <HandCoins size={14} className="inline mr-1" />
                Avances en cours : <strong>{outstanding.toFixed(2)} DH</strong>
              </p>
              <label className="block text-xs font-medium text-amber-800">
                Retenue sur cette paie (max {maxDeduction.toFixed(2)} DH)
                {hasPlan && <span className="font-normal"> — plan d'étalement : {proposed.toFixed(2)} DH proposés</span>}
              </label>
              <input type="number" step="0.01" min="0" max={maxDeduction} value={deduction}
                onChange={e => setDeduction(e.target.value)}
                className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 ${invalid ? 'border-red-400 focus:ring-red-500' : 'border-amber-200 focus:ring-amber-500'}`} />
              {invalid && <p className="text-xs text-red-600">La retenue dépasse le solde d'avances ou le net dû.</p>}
              <p className="text-xs text-amber-700">Montant modifiable — mettre 0 pour ne rien retenir sur cette paie.</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Aucune avance en cours pour cet employé.</p>
          )}

          <div className="bg-green-50 rounded-xl p-3 flex justify-between items-baseline">
            <span className="text-sm text-green-700">À verser ({method === 'cash' ? 'espèces' : method === 'bank' ? 'virement' : 'chèque'})</span>
            <span className="text-xl font-bold text-green-700">{cashOut.toFixed(2)} DH</span>
          </div>

          <button disabled={pending || invalid}
            onClick={() => onConfirm(method, Math.round(ded * 100) / 100)}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
            <Check size={16} /> {pending ? 'Enregistrement...' : 'Confirmer le paiement'}
          </button>
        </div>
      </div>
    </div>
  );
}
