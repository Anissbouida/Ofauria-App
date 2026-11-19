import { WEIGHT_UNITS, type WeightUnit } from '../../utils/weight-unit';

/**
 * M3-04 : poids saisi en quantité + unité (g ou kg). L'unité choisie est conservée et
 * réaffichée telle quelle (420 g reste 420 g).
 */
export default function WeightQtyInput({ value, onChange, className = '', size = 'xs' }: {
  value: { qty: number; unit: WeightUnit };
  onChange: (v: { qty?: number; unit?: WeightUnit }) => void;
  className?: string;
  size?: 'xs' | 'sm';
}) {
  const text = size === 'sm' ? 'text-sm h-8' : 'text-xs py-1';
  return (
    <div className={`flex ${className}`}>
      <input type="number" min={0} step="0.001" value={value.qty || ''} placeholder="0"
        onChange={e => onChange({ qty: parseFloat(e.target.value) || 0 })}
        className={`w-full min-w-0 px-2 border border-gray-200 rounded-l text-right tabular-nums ${text}`} />
      <select value={value.unit} onChange={e => onChange({ unit: e.target.value as WeightUnit })} aria-label="Unité de poids"
        className={`px-1 border border-l-0 border-gray-200 rounded-r bg-white ${text}`}>
        {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
}
