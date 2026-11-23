import { useState } from 'react';
import { AlertTriangle, Droplets, Thermometer } from 'lucide-react';

/**
 * Température de base (épic labo L2, incrément 3) — calcul de la T° de l'eau de
 * coup pour atteindre la température de pâte cible en fin de pétrissage.
 * Méthode des facteurs (pétrin spiral) : T°_base = 3 × cible, puis
 * T°_eau = T°_base − T°_farine − T°_fournil. Entrées du jour saisies au
 * lancement ; aucun modèle persisté (la cible vient de la fiche, mig 342).
 */
export default function TemperatureDeBase({ cibleC }: { cibleC: number }) {
  const [fournil, setFournil] = useState('');
  const [farine, setFarine] = useState('');
  const f = parseFloat(fournil.replace(',', '.'));
  const fa = parseFloat(farine.replace(',', '.'));
  const base = 3 * cibleC;
  const eau = (Number.isFinite(f) && Number.isFinite(fa)) ? base - fa - f : null;
  const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-amber-800">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} inputMode="decimal" placeholder="°C"
        className="w-24 border border-amber-200 rounded-lg px-2 py-1.5 text-base font-semibold bg-white" />
    </label>
  );
  return (
    <div className="rounded-2xl border border-amber-200 overflow-hidden shadow-sm">
      <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
        <Thermometer size={18} className="text-amber-600" />
        <span className="font-bold text-amber-800">Température de base</span>
        <span className="text-sm text-amber-700 ml-1">pâte cible {cibleC} °C · base {base} °C</span>
      </div>
      <div className="px-5 py-4 flex flex-wrap items-end gap-4">
        <Field label="T° fournil" value={fournil} onChange={setFournil} />
        <Field label="T° farine" value={farine} onChange={setFarine} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-blue-800 flex items-center gap-1"><Droplets size={12} /> T° eau de coup</span>
          <div className={`min-w-[7rem] rounded-lg px-3 py-1.5 text-xl font-bold tabular-nums ${eau != null ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
            {eau != null ? `${eau.toFixed(1)} °C` : '—'}
          </div>
        </div>
      </div>
      {eau != null && eau < 0 && (
        <div className="px-5 pb-3 text-xs text-red-600 flex items-center gap-1">
          <AlertTriangle size={12} /> Eau glacée nécessaire : fournil et farine déjà trop chauds pour la cible.
        </div>
      )}
    </div>
  );
}
