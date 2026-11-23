import { SlidersHorizontal } from 'lucide-react';
import { FormField } from '../ds';
import { useCustomFieldDefs, formatCfValue, type CfEntity, type CfValues, type CustomFieldDef } from '../../api/custom-fields.api';

/**
 * Bloc « Informations complémentaires » d'une fiche : un contrôle par champ personnalisé
 * actif (mig 369). Rien n'est affiché tant qu'aucun champ n'est défini pour ce type de fiche.
 * Les valeurs s'enregistrent après la fiche (customFieldsApi.save) ; le serveur les contrôle.
 */
export default function CustomFieldsEditor({ entity, values, onChange, errors, readOnly, columns = 2, title = 'Informations complémentaires', only, exclude }: {
  entity: CfEntity; values: CfValues; onChange: (next: CfValues) => void; errors?: Record<string, string>;
  readOnly?: boolean; columns?: number; title?: string;
  /** Étape 10 (10g) : champs placés dans une autre section de la fiche (codes). */
  only?: string[]; exclude?: string[];
}) {
  const { defs: allDefs } = useCustomFieldDefs(entity);
  const defs = allDefs.filter(d => (!only || only.includes(d.code)) && !exclude?.includes(d.code));
  if (!defs.length) return null;
  const set = (code: string, v: CfValues[string]) => onChange({ ...values, [code]: v });
  return (
    <div>
      <h3 className="ds-subhead" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <SlidersHorizontal size={14} aria-hidden="true" /> {title}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${columns > 1 ? 200 : 280}px, 1fr))`, gap: 12 }}>
        {defs.map(d => (
          d.field_type === 'boolean' && !readOnly ? (
            <div key={d.id} className={`ds-field${errors?.[d.code] ? ' error' : ''}`}>
              <Field d={d} value={values[d.code]} onChange={v => set(d.code, v)} />
              {(errors?.[d.code] || d.help) && <span className="ds-field-hint" role={errors?.[d.code] ? 'alert' : undefined}>{errors?.[d.code] || d.help}</span>}
            </div>
          ) : (
            <FormField key={d.id} label={d.label} htmlFor={readOnly ? undefined : `cf-${entity}-${d.code}`} required={d.required && !readOnly}
              hint={readOnly ? undefined : d.help} error={errors?.[d.code]}>
              {readOnly ? <div style={{ fontSize: 14, color: 'var(--ds-ink)' }}>{formatCfValue(d, values[d.code]) || '—'}</div>
                : <Field d={d} id={`cf-${entity}-${d.code}`} value={values[d.code]} onChange={v => set(d.code, v)} />}
            </FormField>
          )
        ))}
      </div>
    </div>
  );
}

function Field({ d, value, onChange, id }: { d: CustomFieldDef; value: CfValues[string]; onChange: (v: CfValues[string]) => void; id?: string }) {
  switch (d.field_type) {
    case 'boolean':
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, marginTop: 24, color: 'var(--ds-ink)' }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {d.label}{d.required && <span className="ds-req" aria-hidden="true"> *</span>}
        </label>
      );
    case 'select':
      return (
        <select id={id} className="ds-input" value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value || null)}>
          <option value="">—</option>
          {d.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'number':
      return <input id={id} className="ds-input" type="number" step="any" value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : e.target.value)} />;
    case 'date':
      return <input id={id} className="ds-input" type="date" value={value == null ? '' : String(value).slice(0, 10)} onChange={e => onChange(e.target.value || null)} />;
    default:
      return <input id={id} className="ds-input" maxLength={500} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value)} />;
  }
}

/** Colonnes de liste : champs marqués « afficher dans la liste ». */
export function useCustomListColumns(entity: CfEntity) {
  const { defs } = useCustomFieldDefs(entity);
  return defs.filter(d => d.show_in_list);
}
