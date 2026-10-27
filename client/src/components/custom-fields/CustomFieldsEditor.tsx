import type { CSSProperties } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useCustomFieldDefs, formatCfValue, type CfEntity, type CfValues, type CustomFieldDef } from '../../api/custom-fields.api';

/**
 * Bloc « Informations complémentaires » d'une fiche : un contrôle par champ personnalisé
 * actif (mig 369). Rien n'est affiché tant qu'aucun champ n'est défini pour ce type de fiche.
 * Les valeurs s'enregistrent après la fiche (customFieldsApi.save) ; le serveur les contrôle.
 */
export default function CustomFieldsEditor({ entity, values, onChange, errors, readOnly, columns = 2, title = 'Informations complémentaires' }: {
  entity: CfEntity; values: CfValues; onChange: (next: CfValues) => void; errors?: Record<string, string>;
  readOnly?: boolean; columns?: number; title?: string;
}) {
  const { defs } = useCustomFieldDefs(entity);
  if (!defs.length) return null;
  const set = (code: string, v: CfValues[string]) => onChange({ ...values, [code]: v });
  const input: CSSProperties = { width: '100%', fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border, #d1d5db)', borderRadius: 4, background: 'var(--odoo-bg, #fff)', color: 'var(--odoo-text, inherit)' };
  const lab: CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted, #6b7280)', marginBottom: 4 };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--theme-text-muted, #6b7280)', marginBottom: 6 }}>
        <SlidersHorizontal size={12} /> {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${columns > 1 ? 200 : 280}px, 1fr))`, gap: 12 }}>
        {defs.map(d => (
          <div key={d.id}>
            {d.field_type !== 'boolean' && <label style={lab}>{d.label}{d.required && ' *'}</label>}
            {readOnly ? <div style={{ fontSize: '0.875rem' }}>{formatCfValue(d, values[d.code]) || '—'}</div> : <Field d={d} value={values[d.code]} onChange={v => set(d.code, v)} style={input} />}
            {d.help && !readOnly && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted, #6b7280)', marginTop: 2 }}>{d.help}</div>}
            {errors?.[d.code] && <div style={{ fontSize: '0.6875rem', color: '#dc3545', marginTop: 2 }}>{errors[d.code]}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ d, value, onChange, style }: { d: CustomFieldDef; value: CfValues[string]; onChange: (v: CfValues[string]) => void; style: CSSProperties }) {
  const aria = d.label;
  switch (d.field_type) {
    case 'boolean':
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', marginTop: 18 }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {d.label}{d.required && ' *'}
        </label>
      );
    case 'select':
      return (
        <select aria-label={aria} style={style} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value || null)}>
          <option value="">—</option>
          {d.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'number':
      return <input aria-label={aria} style={style} type="number" step="any" value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : e.target.value)} />;
    case 'date':
      return <input aria-label={aria} style={style} type="date" value={value == null ? '' : String(value).slice(0, 10)} onChange={e => onChange(e.target.value || null)} />;
    default:
      return <input aria-label={aria} style={style} maxLength={500} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value)} />;
  }
}

/** Colonnes de liste : champs marqués « afficher dans la liste ». */
export function useCustomListColumns(entity: CfEntity) {
  const { defs } = useCustomFieldDefs(entity);
  return defs.filter(d => d.show_in_list);
}
