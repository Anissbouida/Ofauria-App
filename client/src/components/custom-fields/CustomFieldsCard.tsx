import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import CustomFieldsEditor from './CustomFieldsEditor';
import { customFieldsApi, useCustomFieldDefs, type CfEntity, type CfValues } from '../../api/custom-fields.api';
import { notify } from '../ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Bloc autonome « Champs personnalisés » d'une fiche existante (M4-07) : lit les valeurs,
 * les enregistre d'un clic. Rien n'est affiché tant qu'aucun champ n'est défini pour ce
 * type de fiche (Paramètres › Champs personnalisés).
 */
export default function CustomFieldsCard({ entity, id, readOnly = false }: { entity: CfEntity; id: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { defs } = useCustomFieldDefs(entity);
  const key = ['custom-field-values', entity, id];
  const { data } = useQuery({ queryKey: key, queryFn: () => customFieldsApi.values(entity, id), enabled: defs.length > 0 });
  const [values, setValues] = useState<CfValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setValues(data); }, [data]);
  const save = useMutation({
    mutationFn: () => customFieldsApi.save(entity, id, values),
    onSuccess: () => { setErrors({}); qc.invalidateQueries({ queryKey: key }); notify.success('Champs enregistrés'); },
    onError: (e: unknown) => {
      const details = (e as { response?: { data?: { error?: { details?: Record<string, string> } } } }).response?.data?.error?.details;
      if (details) setErrors(details);
      notify.error(apiErrorMessage(e));
    },
  });
  if (!defs.length) return null;
  const dirty = JSON.stringify(values) !== JSON.stringify(data ?? {});
  return (
    <div className="odoo-section" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
      <CustomFieldsEditor entity={entity} values={values} onChange={setValues} errors={errors} readOnly={readOnly} title="Champs personnalisés" />
      {!readOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="odoo-btn-secondary" disabled={!dirty || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>Enregistrer les champs</button>
        </div>
      )}
    </div>
  );
}
