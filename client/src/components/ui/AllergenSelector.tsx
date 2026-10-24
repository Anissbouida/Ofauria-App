import { ALLERGENS, allergenLabel } from '../../constants/allergens';

/**
 * Selecteur des 14 allergenes reglementaires (cases a cocher). Les valeurs
 * historiques hors referentiel sont affichees a part, en orange, avec une
 * croix pour les retirer : le chef requalifie en cochant le bon code.
 */
export function AllergenSelector({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const known = new Set(ALLERGENS.map(a => a.code));
  const legacy = value.filter(v => !known.has(v));
  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter(v => v !== code) : [...value, code]);
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.25rem 0.75rem' }}>
        {ALLERGENS.map(a => (
          <label key={a.code} title={a.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={value.includes(a.code)} onChange={() => toggle(a.code)} />
            <span>{a.short}</span>
          </label>
        ))}
      </div>
      {legacy.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.75rem' }}>
          <span style={{ color: '#b45309' }}>Hors référentiel, à requalifier :</span>
          {legacy.map(v => (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 4, backgroundColor: '#fef3c7', color: '#92400e' }}>
              {allergenLabel(v)}
              <button type="button" onClick={() => onChange(value.filter(x => x !== v))} title="Retirer" style={{ lineHeight: 1, color: '#92400e' }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
