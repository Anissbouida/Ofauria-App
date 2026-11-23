import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { FormField, FormFooter } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Valeurs nutritionnelles d'une matière, pour 100 g (étape 2 bis, mig 634 ; écran au pas 10c).
 * Servent à la déclaration nutritionnelle de l'étiquette des articles préemballés.
 * Une valeur vide reste inconnue (jamais lue comme zéro).
 */
const NUTRIENTS: { key: string; label: string }[] = [
  { key: 'energy_kj', label: 'Énergie (kJ)' }, { key: 'energy_kcal', label: 'Énergie (kcal)' },
  { key: 'fat', label: 'Matières grasses (g)' }, { key: 'saturated_fat', label: 'dont acides gras saturés (g)' },
  { key: 'carbohydrates', label: 'Glucides (g)' }, { key: 'sugars', label: 'dont sucres (g)' },
  { key: 'fibre', label: 'Fibres (g)' }, { key: 'protein', label: 'Protéines (g)' }, { key: 'salt', label: 'Sel (g)' },
];

export default function IngredientNutritionCard({ ingredientId }: { ingredientId: string }) {
  const qc = useQueryClient();
  const key = ['ingredient-nutrition', ingredientId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get(`/ingredients/${ingredientId}/nutrition`).then(r => (r.data.data ?? {}) as Record<string, number>) });
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setValues(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))); }, [data]);
  const parsed = Object.fromEntries(NUTRIENTS.map(n => {
    const raw = (values[n.key] ?? '').trim().replace(',', '.');
    return [n.key, raw === '' ? null : Number(raw)];
  }));
  const invalid = NUTRIENTS.filter(n => parsed[n.key] !== null && !(Number.isFinite(parsed[n.key]) && (parsed[n.key] as number) >= 0));
  const dirty = JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null))) !== JSON.stringify(data ?? {});
  const save = useMutation({
    mutationFn: () => api.put(`/ingredients/${ingredientId}/nutrition`, { nutrition: parsed }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); notify.success('Valeurs nutritionnelles enregistrées'); },
    onError: (e: unknown) => notify.error(apiErrorMessage(e)),
  });
  return (
    <div className="odoo-section" style={{ padding: '0.75rem 1rem' }}>
      <p className="odoo-setting-help" style={{ marginBottom: 10 }}>
        Pour 100 g de matière. Servent à calculer la déclaration nutritionnelle des articles préemballés ; une valeur laissée vide reste inconnue.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {NUTRIENTS.map(n => (
          <FormField key={n.key} label={n.label} htmlFor={`nut-${n.key}`} error={invalid.includes(n) ? 'Nombre positif attendu' : undefined}>
            <input id={`nut-${n.key}`} className="ds-input" inputMode="decimal" value={values[n.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [n.key]: e.target.value }))} />
          </FormField>
        ))}
      </div>
      <FormFooter dirty={dirty} onCancel={() => setValues(Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v)])))}
        busy={save.isPending} disabled={!dirty || invalid.length > 0} onSubmit={() => save.mutate()} />
    </div>
  );
}
